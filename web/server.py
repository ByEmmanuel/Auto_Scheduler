"""
server.py  –  Backend Flask para el dashboard web de Auto Scheduler.

Endpoints:
  GET  /              → Sirve el dashboard (React, compilado en static/next)
  GET  /next          → Redirige a / (dirección antigua del dashboard React)
  GET  /clasico       → Sirve el dashboard anterior (static/index.html)
  GET  /api/tasks     → Devuelve las tareas sincronizadas agrupadas por fecha
  POST /api/sync/calendar → Solo Calendar → local (dashboard clásico)
  POST /api/verify    → Sincroniza Calendar y después Classroom (pipeline completo)
  PUT  /api/tasks/<source_id>/notes    → Actualiza notas de una tarea y sincroniza con Calendar
  PUT  /api/tasks/<source_id>/schedule → Reprograma la tarea y mueve su evento de Calendar
  DELETE /api/tasks/<source_id>/series → Borra la serie completa (repetida) de una tarea
  POST /api/tasks/bulk_status          → Completa o restaura varias tareas a la vez
  GET|POST /api/notes                  → Notas (eventos de día completo en Calendar)
  PUT|DELETE /api/notes/<id>           → Edita / borra para siempre una nota
  POST /api/notes/<id>/archive|restore → Archiva / recupera una nota
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
from modules import classroom_api, db, calendar_sync, sync_pipeline

app = Flask(__name__, static_folder='static')

NOW_UTC = datetime.datetime.now(datetime.timezone.utc)

# Evita que dos /api/verify concurrentes (doble clic, dos pestañas) corran el
# pipeline al mismo tiempo: ambos podrían no ver todavía la tarea que el otro
# está a punto de insertar y crear el mismo evento duplicado en Calendar.
_sync_lock = threading.Lock()

# Cuánto espera una sincronización a que termine otra antes de rendirse.
SYNC_WAIT_SECONDS = 60

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
        'notes_imported':    len(summary.get('notes_imported', [])),
        'notes_updated':     len(summary.get('notes_updated', [])),
        'notes_archived':    len(summary.get('notes_archived', [])),
        'notes_failed':      bool(summary.get('notes_failed')),
        'message':           summary['message'],
    }


def _serialize_note(rec: dict) -> dict:
    return {
        'id':              rec['id'],
        'title':           rec.get('title', ''),
        'body':            rec.get('body', ''),
        'date':            rec.get('date', ''),
        'status':          rec.get('status', 'active'),
        'calendar_synced': bool(rec.get('calendar_event_id')) and not rec.get('needs_push'),
        'updated_at':      rec.get('updated_at', ''),
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
    if not task.get('calendar_event_id'):
        # Una vencida no tiene evento: si vuelve al futuro, necesita alertas.
        moved_to_future = (datetime.datetime.fromisoformat(new_due).replace(tzinfo=calendar_sync.local_tz())
                           > datetime.datetime.now(calendar_sync.local_tz()))
        if moved_to_future and task.get('status') == 'pending':
            event_id = calendar_sync.add_task_to_calendar(
                {**task, 'due_date': new_due}, is_urgent=bool(task.get('is_urgent')))
            if event_id:
                db.update_calendar_event_id(source_id, event_id)
                cal_ok = True
    else:
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
    calendar_failed = 0

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
        if not event_id:
            calendar_failed += 1

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

    return jsonify({'success': True, 'created': created, 'calendar_failed': calendar_failed})


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


@app.route('/api/tasks/<path:source_id>/series', methods=['DELETE'])
def delete_series_api(source_id):
    """
    Elimina la serie completa a la que pertenece una tarea.

    - Serie importada de Google Calendar (un evento repetido que el usuario
      creó allá): se borra el evento *maestro*, lo que cancela todas sus
      ocurrencias en Calendar, pasadas y futuras. El maestro se obtiene
      leyendo `recurringEventId` de la instancia en la API, nunca adivinándolo
      por el formato del id.
    - Serie creada desde el dashboard (varias fechas creadas de una vez): se
      borra el evento de cada ocurrencia pendiente.
    En ambos casos se quitan del tablero las ocurrencias pendientes; las ya
    completadas se quedan en el historial.
    """
    task = db.get_task_by_source_id(source_id)
    if not task:
        return jsonify({'error': 'Tarea no encontrada'}), 404

    group = task.get('recurrence_group') or ''

    if task.get('source') == sync_pipeline.CALENDAR_SOURCE:
        event = calendar_sync.get_event(task['calendar_event_id']) if task.get('calendar_event_id') else None
        master_id = (event or {}).get('recurringEventId')
        if not master_id:
            return jsonify({'error': 'Este evento de Calendar no forma parte de una serie repetida.'}), 400
        if not calendar_sync.delete_calendar_event(master_id):
            return jsonify({'error': 'Google Calendar no dejó borrar la serie. Intenta de nuevo.'}), 502

        rows = {r['source_id']: r for r in db.get_all_synced(source_id_prefix=f'calendar_{master_id}_')}
        for r in db.get_tasks_in_group(sync_pipeline.CALENDAR_SERIES_PREFIX + master_id):
            rows[r['source_id']] = r
        for sid in rows:
            db.delete_task(sid)
        return jsonify({'success': True, 'deleted': sorted(rows)})

    if not group or task.get('source') == 'classroom':
        return jsonify({'error': 'Esta tarea no forma parte de una serie.'}), 400

    deleted = []
    for rec in db.get_tasks_in_group(group):
        if rec.get('calendar_event_id'):
            calendar_sync.delete_calendar_event(rec['calendar_event_id'])
        db.delete_task(rec['source_id'])
        deleted.append(rec['source_id'])
    return jsonify({'success': True, 'deleted': sorted(deleted)})


@app.route('/api/tasks/completed')
def get_completed_tasks():
    """Devuelve las tareas completadas, ordenadas por fecha."""
    db.init_db()
    records = db.get_all_synced(status='completed')

    result = [_serialize_task(rec) for rec in records]

    # Ordenar por fecha descendente
    result.sort(key=lambda t: t['due_date'] if t['due_date'] else '0000-00-00', reverse=True)
    return jsonify({'tasks': result})


def _apply_status(task: dict, new_status: str) -> None:
    """Cambia el estado de una tarea y su evento de Calendar.

    Al devolverla a pendientes solo se recrea el evento si vence en el futuro:
    una atrasada no lo merece (igual que en la sincronización), y deshacer
    varias de golpe llenaría el calendario de entregas en días ya pasados.
    """
    source_id = task['source_id']
    # Se puede restaurar cualquier tarea: si era de Classroom y sí está entregada,
    # la siguiente sincronización la vuelve a retirar.
    db.update_task_status(source_id, new_status, completed_by='user' if new_status == 'completed' else '')
    event_id = task.get('calendar_event_id')

    if new_status == 'completed':
        # Si Calendar falla se conserva el id: la sincronización lo reintenta.
        if event_id and calendar_sync.delete_calendar_event(event_id):
            db.update_calendar_event_id(source_id, '')
        return

    due = sync_pipeline._due_datetime(task)
    if event_id or not due or due <= datetime.datetime.now(calendar_sync.local_tz()):
        return
    new_event_id = calendar_sync.add_task_to_calendar(task, is_urgent=bool(task.get('is_urgent')))
    if new_event_id:
        db.update_calendar_event_id(source_id, new_event_id)


@app.route('/api/tasks/<path:source_id>/status', methods=['PUT'])
def update_task_status_api(source_id):
    """Marca o desmarca una tarea como completada."""
    data = request.get_json(silent=True) or {}
    new_status = data.get('status')
    if new_status not in ['pending', 'completed']:
        return jsonify({'error': 'Invalid status'}), 400

    task = db.get_task_by_source_id(source_id)
    if not task:
        return jsonify({'error': 'Tarea no encontrada'}), 404

    _apply_status(task, new_status)
    return jsonify({'success': True, 'status': new_status, 'source_id': source_id})


@app.route('/api/tasks/bulk_status', methods=['POST'])
def bulk_status_api():
    """Completa (o devuelve a pendientes) varias tareas de una vez. Responde
    tarea por tarea: que falle una no deshace las demás."""
    data = request.get_json(silent=True) or {}
    new_status = data.get('status')
    ids = data.get('ids')
    if new_status not in ['pending', 'completed']:
        return jsonify({'error': 'Invalid status'}), 400
    if not isinstance(ids, list) or not ids:
        return jsonify({'error': 'Se espera una lista "ids" con al menos una tarea'}), 400

    results = []
    for source_id in dict.fromkeys(str(i) for i in ids):
        task = db.get_task_by_source_id(source_id)
        if not task:
            results.append({'id': source_id, 'ok': False, 'error': 'Tarea no encontrada'})
            continue
        try:
            _apply_status(task, new_status)
            results.append({'id': source_id, 'ok': True})
        except Exception as e:
            results.append({'id': source_id, 'ok': False, 'error': str(e)})
    return jsonify({'status': new_status, 'results': results})


# ── Notas ──────────────────────────────────────────────────────────────────────

def _note_payload(data: dict, partial: bool = False):
    """Valida título, texto y día. Devuelve (campos, error)."""
    fields = {}
    if 'title' in data or not partial:
        title = str(data.get('title') or '').strip()
        if not title:
            return None, 'La nota necesita un título'
        fields['title'] = title[:200]
    if 'body' in data or not partial:
        fields['body'] = str(data.get('body') or '').strip()
    if 'date' in data or not partial:
        day = str(data.get('date') or '').strip()
        try:
            datetime.date.fromisoformat(day)
        except ValueError:
            return None, 'Fecha inválida, se espera YYYY-MM-DD'
        fields['date'] = day
    return fields, None


@app.route('/api/notes')
def list_notes_api():
    db.init_db()
    active = sorted(db.list_notes('active'), key=lambda n: (n['date'], n['updated_at']))
    archived = sorted(db.list_notes('archived'), key=lambda n: n['updated_at'], reverse=True)
    return jsonify({'notes': [_serialize_note(n) for n in active],
                    'archived': [_serialize_note(n) for n in archived]})


@app.route('/api/notes', methods=['POST'])
def create_note_api():
    fields, error = _note_payload(request.get_json(silent=True) or {})
    if error:
        return jsonify({'error': error}), 400
    db.init_db()
    note = db.create_note(sync_pipeline.new_note_id(), **fields)
    synced = sync_pipeline.push_note(note)
    return jsonify({'note': _serialize_note(db.get_note(note['id'])), 'calendar_synced': synced})


@app.route('/api/notes/<note_id>', methods=['PUT'])
def update_note_api(note_id):
    note = db.get_note(note_id)
    if not note:
        return jsonify({'error': 'Nota no encontrada'}), 404
    fields, error = _note_payload(request.get_json(silent=True) or {}, partial=True)
    if error:
        return jsonify({'error': error}), 400
    note = db.update_note(note_id, **fields)
    synced = note['status'] == 'active' and sync_pipeline.push_note(note)
    return jsonify({'note': _serialize_note(db.get_note(note_id)), 'calendar_synced': synced})


@app.route('/api/notes/<note_id>/archive', methods=['POST'])
def archive_note_api(note_id):
    """Quita la nota de la vista y de Calendar, pero la guarda en Archivadas.
    Si Calendar no deja borrar el evento, la sincronización lo reintenta."""
    note = db.get_note(note_id)
    if not note:
        return jsonify({'error': 'Nota no encontrada'}), 404
    event_id = note.get('calendar_event_id')
    gone = not event_id or calendar_sync.delete_calendar_event(event_id)
    db.update_note(note_id, status='archived', needs_push=False,
                   **({'calendar_event_id': ''} if gone else {}))
    return jsonify({'note': _serialize_note(db.get_note(note_id)), 'calendar_synced': gone})


@app.route('/api/notes/<note_id>/restore', methods=['POST'])
def restore_note_api(note_id):
    note = db.get_note(note_id)
    if not note:
        return jsonify({'error': 'Nota no encontrada'}), 404
    note = db.update_note(note_id, status='active')
    synced = sync_pipeline.push_note(note)
    return jsonify({'note': _serialize_note(db.get_note(note_id)), 'calendar_synced': synced})


@app.route('/api/notes/<note_id>', methods=['DELETE'])
def delete_note_api(note_id):
    """Borra la nota para siempre. Si su evento sigue en Calendar y no se
    puede borrar, no se toca nada: si no, volvería a importarse sola."""
    note = db.get_note(note_id)
    if not note:
        return jsonify({'error': 'Nota no encontrada'}), 404
    event_id = note.get('calendar_event_id')
    if event_id and not calendar_sync.delete_calendar_event(event_id):
        return jsonify({'error': 'Google Calendar no dejó borrar el evento. Intenta de nuevo.'}), 502
    db.delete_note(note_id)
    return jsonify({'success': True})


@app.route('/api/sync/calendar', methods=['POST'])
def sync_calendar_only():
    """Solo Calendar → local, para el dashboard clásico. El de React usa /api/verify."""
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
    main.py, y devuelve el resumen para el dashboard. El tablero lo llama solo
    al abrirse y al volver a la pestaña, además de desde el botón.

    Espera su turno en vez de rechazar al instante: pulsar "Sincronizar" justo
    después de abrir la página debe funcionar, no devolver un error.
    """
    if not _sync_lock.acquire(timeout=SYNC_WAIT_SECONDS):
        return jsonify({'error': 'Ya hay una sincronización en curso, espera a que termine.'}), 409

    try:
        summary = sync_pipeline.run_full_sync()
    except classroom_api.ClassroomUnavailable as e:
        return jsonify({'error': f'Google Classroom no respondió: {e}'}), 502
    except Exception as e:
        return jsonify({'error': f'No se pudo sincronizar: {e}'}), 502
    finally:
        _sync_lock.release()

    return jsonify({
        **_calendar_summary(summary),
        'classroom_total':  summary['classroom_total'],
        'already_synced':   summary['already_synced'],
        'new_synced':       len(summary['synced']),
        'errors':           [{'title': t['title'], 'course': t.get('course_name', '')} for t in summary['errors']],
        'synced_tasks':     [{'title': t['title'], 'course': t.get('course_name', '')} for t in summary['synced']],
        'completed_count':  len(summary['completed']),
        'reopened':         [{'title': t['title']} for t in summary['reopened']],
        'rescheduled':      [{'title': t['title']} for t in summary['rescheduled']],
        'board_only':       [{'title': t['title']} for t in summary['board_only']],
        'failed_courses':   summary['failed_courses'],
    })


if __name__ == '__main__':
    # El reloader de debug=True no conviene bajo supervisión de systemd
    # (bifurca un proceso hijo que el servicio no rastrea). Actívalo con
    # FLASK_DEBUG=1 solo para desarrollo local.
    debug_mode = os.environ.get('FLASK_DEBUG', '0') == '1'
    app.run(host='0.0.0.0', port=5050, debug=debug_mode)
