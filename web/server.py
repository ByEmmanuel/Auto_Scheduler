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
import datetime
from collections import defaultdict

from flask import Flask, jsonify, request, send_from_directory

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from modules import db, classroom_api, calendar_sync

app = Flask(__name__, static_folder='static')

NOW_UTC = datetime.datetime.now(datetime.timezone.utc)


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
        grouped[day].append({
            'id':          rec.get('source_id', ''),
            'title':       rec.get('title', ''),
            'course':      rec.get('course_name', ''),
            'due_date':    rec.get('due_date', ''),
            'source':      rec.get('source', ''),
            'is_urgent':   bool(rec.get('is_urgent', 0)),
            'link':        rec.get('link', ''),
            'notes':       rec.get('notes', ''),
            'description': rec.get('description', ''),
        })

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
        db.delete_task(rec['source_id'])
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
    app.run(host='0.0.0.0', port=5050, debug=True)
