"""
server.py  –  Backend Flask para el dashboard web de Auto Scheduler.

Endpoints:
  GET  /              → Sirve el dashboard HTML
  GET  /api/tasks     → Devuelve las tareas sincronizadas agrupadas por fecha
  POST /api/verify    → Ejecuta extracción de Classroom + sincronización con Calendar
  PUT  /api/tasks/<source_id>/notes → Actualiza notas de una tarea y sincroniza con Calendar
"""

import os
import sys
import json
import time
import datetime
from collections import defaultdict

from flask import Flask, jsonify, request, send_from_directory

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from modules import db, classroom_api, calendar_sync

app = Flask(__name__, static_folder='static')

NOW_UTC = datetime.datetime.now(datetime.timezone.utc)


def _serialize_task(rec: dict) -> dict:
    """Normaliza un registro de la BD al formato que consume el frontend."""
    return {
        'id':                rec.get('source_id', ''),
        'title':             rec.get('title', ''),
        'course':            rec.get('course_name', ''),
        'due_date':          rec.get('due_date', ''),
        'source':            rec.get('source', ''),
        'is_urgent':         bool(rec.get('is_urgent', 0)),
        'link':              rec.get('link', ''),
        'notes':             rec.get('notes', ''),
        'description':       rec.get('description', ''),
        'status':            rec.get('status', 'pending'),
        'recurrence_group':  rec.get('recurrence_group', ''),
    }


# ── Páginas ────────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')


@app.route('/<path:path>')
def static_files(path):
    return send_from_directory(app.static_folder, path)


# ── API ────────────────────────────────────────────────────────────────────────

@app.route('/api/tasks')
def get_tasks():
    """Devuelve las tareas agrupadas por fecha, ordenadas cronológicamente."""
    db.init_db()
    records = db.get_all_synced()

    grouped = defaultdict(list)
    for rec in records:
        day = rec.get('due_date', '')[:10] if rec.get('due_date') else 'Sin fecha'
        grouped[day].append(_serialize_task(rec))

    # Ordenar por fecha (las sin fecha van al final)
    sorted_days = sorted(
        grouped.keys(),
        key=lambda d: d if d != 'Sin fecha' else '9999-99-99'
    )

    columns = []
    for day in sorted_days:
        tasks = grouped[day]
        # Ordenar tareas dentro del día: urgentes primero
        tasks.sort(key=lambda t: (not t['is_urgent'], t['course']))
        columns.append({
            'date': day,
            'tasks': tasks,
        })

    return jsonify({'columns': columns, 'total': len(records)})


@app.route('/api/tasks/<path:source_id>/notes', methods=['PUT'])
def update_notes(source_id):
    """Actualiza las notas de una tarea en la BD y sincroniza con Google Calendar."""
    data = request.get_json()
    notes = data.get('notes', '')

    task = db.get_task_by_source_id(source_id)
    if not task:
        return jsonify({'error': 'Tarea no encontrada'}), 404

    # Guardar en BD local
    db.update_task_notes(source_id, notes)

    # Sincronizar con Calendar
    event_id = task.get('calendar_event_id')
    cal_ok = False
    if event_id:
        cal_ok = calendar_sync.update_calendar_event_notes(event_id, notes)

    return jsonify({
        'success': True,
        'calendar_synced': cal_ok,
        'source_id': source_id,
    })


@app.route('/api/manual_task', methods=['POST'])
def add_manual_task():
    """Añade una tarea/nota manual (opcionalmente repetida) a la BD y a Google Calendar."""
    data = request.get_json()
    title = data.get('title', '').strip()
    time_str = data.get('time', '23:59')
    date_str = data.get('date', '')
    notes = data.get('notes', '').strip()
    course_type = data.get('type', 'Tarea Manual').strip()
    reminder_minutes = data.get('reminder_minutes')

    # Repetición: cada N días, un número de ocurrencias (incluye la primera)
    repeat_interval_days = data.get('repeat_interval_days')
    repeat_count = data.get('repeat_count', 1) or 1
    try:
        repeat_count = max(1, min(int(repeat_count), 60))
    except (TypeError, ValueError):
        repeat_count = 1
    if not repeat_interval_days:
        repeat_count = 1

    if not title or not date_str:
        return jsonify({'error': 'Título y fecha son requeridos'}), 400

    from dateutil import parser as date_parser
    import zoneinfo

    base_dt = date_parser.isoparse(f"{date_str}T{time_str}:00").replace(tzinfo=zoneinfo.ZoneInfo("America/Mexico_City"))
    now = datetime.datetime.now(zoneinfo.ZoneInfo("America/Mexico_City"))

    batch_id = int(time.time())
    recurrence_group = f"manual_{batch_id}" if repeat_count > 1 else ''
    created = []

    db.init_db()

    for i in range(repeat_count):
        due_dt = base_dt + datetime.timedelta(days=int(repeat_interval_days) * i) if repeat_interval_days else base_dt
        due_date = due_dt.replace(tzinfo=None).isoformat()
        source_id = f"manual_{batch_id}_{i}" if repeat_count > 1 else f"manual_{batch_id}"
        is_urgent = (due_dt.date() - now.date()).days <= 1

        task = {
            'source_id': source_id,
            'title': title,
            'course_name': course_type,
            'due_date': due_date,
            'source': 'manual',
            'is_urgent': is_urgent,
            'description': notes,
            'link': '',
            'notes': notes,
        }

        event_id = calendar_sync.add_task_to_calendar(task, is_urgent=is_urgent, reminder_minutes=reminder_minutes)

        db.mark_task_as_synced(
            source_id=task['source_id'],
            title=task['title'],
            course_name=task['course_name'],
            due_date=task['due_date'],
            source=task['source'],
            calendar_event_id=event_id or '',
            is_urgent=task['is_urgent'],
            link=task['link'],
            description=task['description'],
            recurrence_group=recurrence_group,
        )
        created.append(source_id)

    return jsonify({'success': True, 'created': created})


@app.route('/api/tasks/<path:source_id>', methods=['DELETE'])
def delete_task_api(source_id):
    """Elimina una tarea permanentemente (BD local + evento de calendario)."""
    task = db.get_task_by_source_id(source_id)
    if not task:
        return jsonify({'error': 'Tarea no encontrada'}), 404

    if task.get('calendar_event_id'):
        calendar_sync.delete_calendar_event(task['calendar_event_id'])

    db.delete_task(source_id)
    return jsonify({'success': True})


@app.route('/api/tasks/completed')
def get_completed_tasks():
    """Devuelve las tareas completadas, ordenadas por fecha."""
    db.init_db()
    records = db.get_all_synced(status='completed')

    result = [_serialize_task(rec) for rec in records]

    # Ordenar por fecha descendente
    result.sort(key=lambda t: t['due_date'] if t['due_date'] else '0000-00-00', reverse=True)
    return jsonify({'tasks': result})


@app.route('/api/tasks/<path:source_id>/status', methods=['PUT'])
def update_task_status_api(source_id):
    """Marca o desmarca una tarea como completada."""
    data = request.get_json()
    new_status = data.get('status')
    
    if new_status not in ['pending', 'completed']:
        return jsonify({'error': 'Invalid status'}), 400

    task = db.get_task_by_source_id(source_id)
    if not task:
        return jsonify({'error': 'Tarea no encontrada'}), 404
        
    # Prevent unmarking classroom tasks to avoid loop conflicts
    if new_status == 'pending' and task.get('source') == 'classroom':
        return jsonify({'error': 'Las tareas de Classroom no se pueden desmarcar manualmente.'}), 400

    db.update_task_status(source_id, new_status)

    # Calendar logic
    event_id = task.get('calendar_event_id')
    
    if new_status == 'completed':
        if event_id:
            calendar_sync.delete_calendar_event(event_id)
            db.update_calendar_event_id(source_id, '')
    else:
        # Re-create event in calendar
        new_event_id = calendar_sync.add_task_to_calendar(task, is_urgent=bool(task.get('is_urgent')))
        if new_event_id:
            db.update_calendar_event_id(source_id, new_event_id)

    return jsonify({
        'success': True,
        'status': new_status,
        'source_id': source_id,
    })


@app.route('/api/verify', methods=['POST'])
def verify_and_sync():
    """
    Ejecuta el flujo completo:
      1. Lee tareas pendientes de Classroom
      2. Clasifica (vencidas, sin fecha, ya sincronizadas)
      3. Sincroniza las nuevas con Google Calendar
      4. Devuelve el resumen
    """
    db.init_db()

    # 1. Extraer
    all_tasks = classroom_api.fetch_pending_tasks()
    
    # 1.5 Limpiar tareas entregadas
    all_source_ids = {t['source_id'] for t in all_tasks}
    synced_records = db.get_all_synced()
    completed_tasks = []
    
    for rec in synced_records:
        if rec.get('source') == 'classroom' and rec.get('source_id') not in all_source_ids:
            completed_tasks.append(rec)
            
    completed_count = 0
    for rec in completed_tasks:
        if rec.get('calendar_event_id'):
            calendar_sync.delete_calendar_event(rec['calendar_event_id'])
        db.update_task_status(rec['source_id'], 'completed')
        completed_count += 1

    # 2. Clasificar
    from dateutil import parser as dp

    now = datetime.datetime.now(datetime.timezone.utc)
    already   = []
    skipped   = []
    candidates = []

    for task in all_tasks:
        if db.is_task_synced(task['source_id']):
            already.append(task)
            continue

        due_str = task.get('due_date')
        if not due_str:
            skipped.append({'title': task['title'], 'course': task.get('course_name', ''), 'reason': 'Sin fecha'})
            continue

        due_dt = dp.isoparse(due_str)
        if due_dt.tzinfo is None:
            import zoneinfo
            local_tz = zoneinfo.ZoneInfo("America/Mexico_City")
            due_dt = due_dt.replace(tzinfo=local_tz)

        if due_dt < now:
            skipped.append({'title': task['title'], 'course': task.get('course_name', ''), 'reason': 'Ya venció'})
            continue

        candidates.append((task, due_dt))

    # Contar por día para urgencia
    tasks_per_day = defaultdict(int)
    for task, due_dt in candidates:
        tasks_per_day[due_dt.strftime('%Y-%m-%d')] += 1

    # 3. Sincronizar
    synced = []
    errors = []

    for task, due_dt in candidates:
        day_key = due_dt.strftime('%Y-%m-%d')
        is_urgent = tasks_per_day[day_key] > 1

        event_id = calendar_sync.add_task_to_calendar(task, is_urgent=is_urgent)

        if event_id:
            db.mark_task_as_synced(
                source_id=task['source_id'],
                title=task['title'],
                course_name=task.get('course_name', ''),
                due_date=task.get('due_date'),
                source=task.get('source', 'classroom'),
                calendar_event_id=event_id,
                is_urgent=is_urgent,
                link=task.get('link', ''),
                description=task.get('description', ''),
                course_id=task.get('course_id', ''),
                coursework_id=task.get('coursework_id', ''),
                submission_id=task.get('submission_id', ''),
                submission_state=task.get('submission_state', ''),
            )
            synced.append({'title': task['title'], 'course': task.get('course_name', '')})
        else:
            errors.append({'title': task['title'], 'course': task.get('course_name', '')})

    return jsonify({
        'classroom_total':  len(all_tasks),
        'already_synced':   len(already),
        'new_synced':       len(synced),
        'skipped':          skipped,
        'errors':           errors,
        'synced_tasks':     synced,
        'completed_count':  completed_count,
    })


if __name__ == '__main__':
    # El reloader de debug=True no conviene bajo supervisión de systemd
    # (bifurca un proceso hijo que el servicio no rastrea). Actívalo con
    # FLASK_DEBUG=1 solo para desarrollo local.
    debug_mode = os.environ.get('FLASK_DEBUG', '0') == '1'
    app.run(host='0.0.0.0', port=5050, debug=debug_mode)
