"""
sync_pipeline.py – Orquesta el pipeline de sincronización de 4 pasos que usan
tanto `main.py` (CLI) como `web/server.py` (endpoint /api/verify), para que
ambos flujos se comporten exactamente igual.

Pipeline (ver también memory/classroom-calendar-sync-pipeline.md):
  1. Calendar → local:  confirma que los eventos guardados en la BD siguen
     existiendo en Google Calendar. Si alguno fue borrado o cancelado a mano,
     se limpia SOLO el `calendar_event_id` local (nunca se borra el registro
     ni se crea nada aquí) para que el Paso 3 lo detecte como pendiente.
  2. Local → Classroom:  se descargan las tareas pendientes actuales de
     Google Classroom.
  3. Diff Classroom vs. local:  todo lo que ya tiene un evento vivo en
     Calendar se deja intacto (evita duplicados); todo lo que está en
     Classroom y NO tiene evento vivo local (nuevo, o sanado en el Paso 1)
     se crea en Calendar. Lo que ya no está pendiente en Classroom (se
     entregó/calificó) se marca como completado y se borra su evento.
  4. Reporte:  se arma un resumen con el resultado de cada paso; quien lo
     use (CLI o API web) lo muestra como "sincronización completa".
"""

import datetime
from collections import defaultdict

from dateutil import parser as date_parser

from . import db, classroom_api, calendar_sync


def reconcile_calendar_with_local(records: list[dict] | None = None) -> dict:
    """Paso 1: Calendar → local. Verifica cada tarea local con evento y limpia
    el event_id si ya no existe en Calendar (nunca crea/borra eventos aquí)."""
    records = records if records is not None else db.get_all_synced()
    healed = []
    for rec in records:
        event_id = rec.get('calendar_event_id')
        if not event_id:
            continue
        if not calendar_sync.event_exists(event_id):
            db.update_calendar_event_id(rec['source_id'], '')
            healed.append(rec)
    return {'checked': len(records), 'healed': healed}


def sync_from_classroom(now: datetime.datetime | None = None) -> dict:
    """Pasos 2-3: trae tareas de Classroom, retira las entregadas/calificadas
    y crea en Calendar solo lo que falte localmente (nuevo o sanado en el
    Paso 1), evitando así duplicar tareas ya sincronizadas."""
    now = now or datetime.datetime.now(datetime.timezone.utc)

    all_tasks = classroom_api.fetch_pending_tasks()
    all_source_ids = {t['source_id'] for t in all_tasks}

    # Lo que ya no está pendiente en Classroom se marca como completado.
    completed = []
    for rec in db.get_all_synced():
        if rec['source'] == 'classroom' and rec['source_id'] not in all_source_ids:
            if rec.get('calendar_event_id'):
                calendar_sync.delete_calendar_event(rec['calendar_event_id'])
            db.update_task_status(rec['source_id'], 'completed')
            completed.append(rec)

    already, skipped, candidates = [], [], []
    for task in all_tasks:
        existing = db.get_task_by_source_id(task['source_id'])
        # Ya sincronizada y con evento vivo en Calendar → no tocar.
        if existing and existing.get('calendar_event_id'):
            already.append(task)
            continue

        due_str = task.get('due_date')
        if not due_str:
            skipped.append((task, 'sin_fecha'))
            continue

        due_dt = date_parser.isoparse(due_str)
        if due_dt.tzinfo is None:
            due_dt = due_dt.replace(tzinfo=datetime.timezone.utc)
        if due_dt < now:
            skipped.append((task, 'vencida'))
            continue

        candidates.append((task, due_dt))

    tasks_per_day = defaultdict(int)
    for task, due_dt in candidates:
        tasks_per_day[due_dt.strftime('%Y-%m-%d')] += 1

    synced, errors = [], []
    for task, due_dt in candidates:
        is_urgent = tasks_per_day[due_dt.strftime('%Y-%m-%d')] > 1
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
            synced.append(task)
        else:
            errors.append(task)

    return {
        'classroom_total': len(all_tasks),
        'already_synced': already,
        'completed': completed,
        'skipped': skipped,
        'synced': synced,
        'errors': errors,
    }


def run_full_sync() -> dict:
    """Ejecuta el pipeline completo de 4 pasos y devuelve un resumen serializable."""
    db.init_db()

    step1 = reconcile_calendar_with_local()
    step2_3 = sync_from_classroom()

    return {
        'calendar_checked':  step1['checked'],
        'calendar_healed':   step1['healed'],
        'classroom_total':   step2_3['classroom_total'],
        'already_synced':    len(step2_3['already_synced']),
        'completed':         step2_3['completed'],
        'skipped':           step2_3['skipped'],
        'synced':            step2_3['synced'],
        'errors':            step2_3['errors'],
        'message':           'Sincronización completa: Calendar y Classroom están al día.',
    }
