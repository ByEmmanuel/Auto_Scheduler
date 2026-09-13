"""
server.py  –  Backend Flask para el dashboard web de Auto Scheduler.

Endpoints:
  GET  /              → Sirve el dashboard (React, compilado en static/next)
  GET  /next          → Redirige a / (dirección antigua del dashboard React)
  GET  /clasico       → Sirve el dashboard anterior (static/index.html)
  GET  /api/tasks     → Devuelve las tareas sincronizadas agrupadas por fecha
  POST /api/sync/calendar → Solo Calendar → local (importa notas del celular)
  POST /api/verify    → Ejecuta extracción de Classroom + sincronización con Calendar
  PUT  /api/tasks/<source_id>/notes    → Actualiza notas de una tarea y sincroniza con Calendar
  PUT  /api/tasks/<source_id>/schedule → Reprograma la tarea y mueve su evento de Calendar
"""

import os
import re
import sys
import json
import time
import datetime
import threading
from collections import defaultdict

from flask import Flask, jsonify, redirect, request, send_from_directory

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from modules import db, calendar_sync, sync_pipeline

app = Flask(__name__, static_folder='static')

NOW_UTC = datetime.datetime.now(datetime.timezone.utc)

# Evita que dos /api/verify concurrentes (doble clic, dos pestañas) corran el
# pipeline al mismo tiempo: ambos podrían no ver todavía la tarea que el otro
# está a punto de insertar y crear el mismo evento duplicado en Calendar.
_sync_lock = threading.Lock()

# Tope de eventos que puede crear una sola llamada a /api/manual_task, tanto
# repitiendo cada N días como marcando días sueltos en el calendario.
MAX_MANUAL_OCCURRENCES = 60


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


def _calendar_summary(summary: dict) -> dict:
    """Parte del resumen que describe el paso Calendar → local."""
    return {
        'calendar_checked':  summary['calendar_checked'],
        'calendar_scanned':  summary['calendar_scanned'],
        'calendar_healed':   len(summary['calendar_healed']),
        'calendar_removed':  len(summary['calendar_removed']),
        'calendar_imported': [{'title': t['title'], 'due_date': t['due_date']}
                              for t in summary['calendar_imported']],
        'calendar_updated':  len(summary['calendar_updated']),
        'message':           summary['message'],
    }


# ── Páginas ────────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    """
    Dashboard principal (React + Tailwind, código en `web/next/`, compilado a
    `web/static/next/`). El build pide sus assets bajo `/next/assets/`, que
    resuelve la ruta de archivos estáticos de abajo.
    """
    next_dir = os.path.join(app.static_folder, 'next')
    if not os.path.exists(os.path.join(next_dir, 'index.html')):
        return (
            '<h1>Dashboard sin compilar</h1>'
            '<p>Ejecuta <code>cd web/next && npm install && npm run build</code>.</p>',
            404,
        )
    return send_from_directory(next_dir, 'index.html')


@app.route('/next')
@app.route('/next/')
def next_index():
    """
    Dirección que tuvo el dashboard de React mientras convivía con el anterior.
    Redirige para no romper marcadores; 302 y no 301 para que el navegador no
    la memorice si algún día se vuelve atrás.
    """
    return redirect('/')


@app.route('/clasico')
def classic_index():
    """Dashboard anterior (HTML + JS sin compilar), por si hace falta volver a él."""
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


@app.route('/api/tasks/<path:source_id>/schedule', methods=['PUT'])
def reschedule_task(source_id):
    """
    Reprograma una tarea a otro día/hora (drag & drop del dashboard nuevo y
    campo "Mover" del panel de detalle).

    Actualiza la fecha local y mueve el evento en Google Calendar. La fecha de
    entrega real en Classroom no cambia (la API no lo permite): esto solo
    reorganiza el calendario y el tablero del usuario.
    """
    data = request.get_json(silent=True) or {}
    date_str = (data.get('date') or '').strip()
    time_str = (data.get('time') or '').strip()

    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', date_str):
        return jsonify({'error': 'Fecha inválida, se espera YYYY-MM-DD'}), 400
    if time_str and not re.fullmatch(r'\d{2}:\d{2}', time_str):
        return jsonify({'error': 'Hora inválida, se espera HH:MM'}), 400

    task = db.get_task_by_source_id(source_id)
    if not task:
        return jsonify({'error': 'Tarea no encontrada'}), 404

    # Sin hora explícita se conserva la que ya tenía la tarea.
    if not time_str:
        try:
            from dateutil import parser as date_parser
            time_str = date_parser.isoparse(task.get('due_date') or '').strftime('%H:%M')
        except (ValueError, TypeError):
            time_str = '23:59'

    new_due = f'{date_str}T{time_str}:00'
    try:
        datetime.datetime.fromisoformat(new_due)
    except ValueError:
        return jsonify({'error': 'Fecha y hora inválidas'}), 400

    db.update_task_due_date(source_id, new_due)

    cal_ok = False
    if task.get('calendar_event_id'):
        # Para las notas que el usuario creó en Google Calendar la fecha
        # guardada es la de inicio del evento; para las tareas que crea la app,
        # el vencimiento (el evento termina ahí).
        anchor = 'start' if task.get('source') == sync_pipeline.CALENDAR_SOURCE else 'end'
        cal_ok = calendar_sync.update_calendar_event_datetime(
            task['calendar_event_id'], new_due, anchor=anchor)

    return jsonify({
        'success': True,
        'calendar_synced': cal_ok,
        'task': _serialize_task(db.get_task_by_source_id(source_id)),
    })


@app.route('/api/manual_task', methods=['POST'])
def add_manual_task():
    """
    Añade una tarea/nota manual a la BD y a Google Calendar.

    Acepta dos formas de crear varias ocurrencias de golpe:
      - `dates`: la lista de días concretos que el usuario marcó en el
        calendario del compositor (p. ej. el 8, 12, 14 y 20). Manda sobre todo
        lo demás: se crea un evento en cada uno, a la misma hora.
      - `repeat_interval_days` + `repeat_count`: el patrón "cada N días, M
        veces" a partir de `date`.
    Todas las ocurrencias creadas juntas comparten un `recurrence_group`.
    """
    data = request.get_json()
    title = data.get('title', '').strip()
    time_str = data.get('time', '23:59')
    date_str = data.get('date', '')
    notes = data.get('notes', '').strip()
    course_type = data.get('type', 'Tarea Manual').strip()
    reminder_minutes = data.get('reminder_minutes')

    if not re.fullmatch(r'\d{2}:\d{2}', time_str or ''):
        return jsonify({'error': 'Hora inválida, se espera HH:MM'}), 400

    # Fechas sueltas elegidas en el calendario del compositor ("los días 8, 12,
    # 14 y 20"). Cuando vienen, mandan sobre `date` y sobre la repetición: son
    # exactamente los días que el usuario marcó, ni uno más.
    explicit_dates = data.get('dates')
    if explicit_dates is not None and not isinstance(explicit_dates, list):
        return jsonify({'error': 'El campo "dates" debe ser una lista de fechas'}), 400

    selected_dates = []
    if explicit_dates:
        for raw in explicit_dates:
            day = str(raw).strip()
            if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', day):
                return jsonify({'error': f'Fecha inválida: «{day}», se espera YYYY-MM-DD'}), 400
            try:
                datetime.date.fromisoformat(day)
            except ValueError:
                return jsonify({'error': f'Fecha inexistente: «{day}»'}), 400
            selected_dates.append(day)
        # Ordenadas y sin repetidos: marcar dos veces el mismo día en el
        # calendario no debe crear dos eventos idénticos.
        selected_dates = sorted(set(selected_dates))[:MAX_MANUAL_OCCURRENCES]

    # Repetición: cada N días, un número de ocurrencias (incluye la primera)
    repeat_interval_days = data.get('repeat_interval_days')
    repeat_count = data.get('repeat_count', 1) or 1
    try:
        repeat_count = max(1, min(int(repeat_count), MAX_MANUAL_OCCURRENCES))
    except (TypeError, ValueError):
        repeat_count = 1
    if not repeat_interval_days:
        repeat_count = 1

    if not title:
        return jsonify({'error': 'El título es requerido'}), 400
    if not selected_dates and not date_str:
        return jsonify({'error': 'Se requiere una fecha o una lista de fechas'}), 400

    import zoneinfo
    tz = zoneinfo.ZoneInfo('America/Mexico_City')
    now = datetime.datetime.now(tz)

    # Todas las ocurrencias que hay que crear, vengan de días marcados a mano o
    # de un intervalo repetido, para que el resto del flujo sea uno solo.
    try:
        if selected_dates:
            occurrences = [
                datetime.datetime.fromisoformat(f'{day}T{time_str}:00').replace(tzinfo=tz)
                for day in selected_dates
            ]
        else:
            base_dt = datetime.datetime.fromisoformat(f'{date_str}T{time_str}:00').replace(tzinfo=tz)
            step = int(repeat_interval_days) if repeat_interval_days else 0
            occurrences = [base_dt + datetime.timedelta(days=step * i) for i in range(repeat_count)]
    except ValueError:
        return jsonify({'error': 'Fecha y hora inválidas'}), 400

    batch_id = int(time.time())
    # El grupo une las ocurrencias creadas de una sola vez, se hayan generado
    # por intervalo o marcando días sueltos en el calendario.
    recurrence_group = f'manual_{batch_id}' if len(occurrences) > 1 else ''
    created = []

    db.init_db()

    for i, due_dt in enumerate(occurrences):
        due_date = due_dt.replace(tzinfo=None).isoformat()
        source_id = f'manual_{batch_id}_{i}' if len(occurrences) > 1 else f'manual_{batch_id}'
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


@app.route('/api/sync/calendar', methods=['POST'])
def sync_calendar_only():
    """
    Media sincronización: solo Calendar → local (Pasos 1a y 1b del pipeline).

    El dashboard la dispara al abrirse para que las notas que el usuario
    escribió desde el celular aparezcan sin tener que tocar nada. Se deja fuera
    Classroom a propósito: esa consulta es la lenta, y sigue en el botón de
    sincronizar.
    """
    if not _sync_lock.acquire(blocking=False):
        return jsonify({'error': 'Ya hay una sincronización en curso, espera a que termine.'}), 409

    try:
        summary = sync_pipeline.run_calendar_sync()
    except Exception as e:
        return jsonify({'error': f'No se pudo leer Google Calendar: {e}'}), 502
    finally:
        _sync_lock.release()

    return jsonify(_calendar_summary(summary))


@app.route('/api/verify', methods=['POST'])
def verify_and_sync():
    """
    Dispara el pipeline de 4 pasos (modules/sync_pipeline.py), compartido con
    main.py, y devuelve el resumen para el dashboard:
      1. Calendar → local (sana eventos borrados a mano)
      2. Local → Classroom (descarga tareas pendientes)
      3. Diff Classroom vs. local (crea solo lo nuevo, retira lo entregado)
      4. Reporte / mensaje de "sincronización completa"
    """
    if not _sync_lock.acquire(blocking=False):
        return jsonify({'error': 'Ya hay una sincronización en curso, espera a que termine.'}), 409

    try:
        summary = sync_pipeline.run_full_sync()
    finally:
        _sync_lock.release()

    return jsonify({
        **_calendar_summary(summary),
        'classroom_total':  summary['classroom_total'],
        'already_synced':   summary['already_synced'],
        'new_synced':       len(summary['synced']),
        'skipped':          [{'title': t['title'], 'course': t.get('course_name', ''),
                               'reason': 'Sin fecha' if reason == 'sin_fecha' else 'Ya venció'}
                              for t, reason in summary['skipped']],
        'errors':           [{'title': t['title'], 'course': t.get('course_name', '')} for t in summary['errors']],
        'synced_tasks':     [{'title': t['title'], 'course': t.get('course_name', '')} for t in summary['synced']],
        'completed_count':  len(summary['completed']),
    })


if __name__ == '__main__':
    # El reloader de debug=True no conviene bajo supervisión de systemd
    # (bifurca un proceso hijo que el servicio no rastrea). Actívalo con
    # FLASK_DEBUG=1 solo para desarrollo local.
    debug_mode = os.environ.get('FLASK_DEBUG', '0') == '1'
    app.run(host='0.0.0.0', port=5050, debug=debug_mode)
