"""
sync_pipeline.py – Orquesta el pipeline de sincronización de 4 pasos que usan
tanto `main.py` (CLI) como `web/server.py` (endpoint /api/verify), para que
ambos flujos se comporten exactamente igual.

Pipeline (ver también memory/classroom-calendar-sync-pipeline.md):
  1. Calendar → local:  se revisa Google Calendar PRIMERO, en dos mitades.
     1a. Verificación: confirma que los eventos guardados en la BD siguen
         existiendo. Si uno de Classroom/manual fue borrado a mano, se limpia
         SOLO su `calendar_event_id` para que el Paso 3 lo recree; si el que
         desapareció era una nota importada del propio Calendar, se borra el
         registro local (allá se creó y allá se borró).
     1b. Importación: se traen los eventos que el usuario escribió a mano en
         Google Calendar (típicamente desde el celular) y que la app no
         conoce, y se guardan como tareas locales con `source='calendar'`.
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

# Marca de las tareas que nacieron como un evento del propio Google Calendar.
CALENDAR_SOURCE = 'calendar'

# Ventana que se revisa al importar desde Calendar.
IMPORT_PAST_DAYS = 7
IMPORT_FUTURE_DAYS = 120

# Las series repetidas (una clase, un recordatorio diario) se expanden en una
# instancia por ocurrencia: un evento cada dos días llena 56 tarjetas en la
# ventana completa y deja el tablero ilegible. De esas solo entran las de las
# próximas dos semanas, y nunca las que ya pasaron: la siguiente tanda se
# importa sola conforme avanzan los días.
RECURRING_HORIZON_DAYS = 14


def reconcile_calendar_with_local(records: list[dict] | None = None) -> dict:
    """
    Paso 1a: verifica cada tarea local con evento contra Google Calendar.

    Si el evento ya no existe, la reacción depende de quién manda sobre esa
    tarea: las de Classroom y las manuales viven en la BD, así que solo se
    limpia su `calendar_event_id` y el Paso 3 las recrea; las importadas de
    Calendar viven en Calendar, así que borrarlas allá (por ejemplo desde el
    celular) también las quita de aquí. Nunca se crean eventos en este paso.
    """
    records = records if records is not None else db.get_all_synced()
    healed, removed = [], []
    for rec in records:
        event_id = rec.get('calendar_event_id')
        if not event_id:
            continue
        if calendar_sync.event_exists(event_id):
            continue
        if rec.get('source') == CALENDAR_SOURCE:
            db.delete_task(rec['source_id'])
            removed.append(rec)
        else:
            db.update_calendar_event_id(rec['source_id'], '')
            healed.append(rec)
    return {'checked': len(records), 'healed': healed, 'removed': removed}


def import_from_calendar(now: datetime.datetime | None = None) -> dict:
    """
    Paso 1b: trae a la BD los eventos que el usuario creó a mano en Google
    Calendar (desde el celular, la web, donde sea) y que la app no conoce.

    Sin esto el tablero solo mostraba lo que él mismo había escrito en
    Calendar: una nota añadida desde el teléfono nunca aparecía en la
    computadora. Se descartan tres cosas para no ensuciar el tablero:
      - los eventos que creó la propia app (llevan su marca privada, o su id
        ya está en la BD),
      - las invitaciones de otras personas (el usuario no es el creador),
      - los eventos cancelados.

    Los que ya se habían importado antes se actualizan en vez de duplicarse:
    la llave local es el id del evento, que es estable entre dispositivos.
    """
    tz = calendar_sync.local_tz()
    now = now or datetime.datetime.now(tz)

    # Ventana: unos días hacia atrás para que una nota recién vencida siga
    # apareciendo como atrasada, y unos meses hacia adelante.
    time_min = (now - datetime.timedelta(days=IMPORT_PAST_DAYS)).replace(
        hour=0, minute=0, second=0, microsecond=0)
    time_max = now + datetime.timedelta(days=IMPORT_FUTURE_DAYS)

    events = calendar_sync.list_primary_events(time_min, time_max)
    known_event_ids = db.get_known_event_ids()

    recurring_horizon = (now + datetime.timedelta(days=RECURRING_HORIZON_DAYS)).date()

    imported, updated, deferred = [], [], 0
    for event in events:
        if event.get('status') == 'cancelled':
            continue
        if calendar_sync.is_app_event(event):
            continue
        if event['id'] in known_event_ids and not db.get_task_by_source_id(f"calendar_{event['id']}"):
            # Evento de una tarea de Classroom/manual creada antes de que
            # existiera la marca privada: es nuestro, no una nota del usuario.
            continue

        creator = event.get('creator') or {}
        organizer = event.get('organizer') or {}
        # `self` solo viene como True; su ausencia en ambos campos significa
        # que el evento es de alguien más (una invitación recibida).
        if not (creator.get('self') or organizer.get('self')):
            continue

        task = calendar_sync.event_to_task(event)
        if not task:
            continue

        # Una instancia de serie repetida solo se importa si cae en el
        # horizonte corto. Si ya estaba importada se respeta y se actualiza:
        # el recorte es para no traer de golpe una serie entera, no para
        # borrar lo que el usuario ya tiene en el tablero.
        existing = db.get_task_by_source_id(task['source_id'])
        if not existing and event.get('recurringEventId'):
            occurrence = datetime.date.fromisoformat(task['due_date'][:10])
            if occurrence < now.date() or occurrence > recurring_horizon:
                deferred += 1
                continue

        if existing:
            # Ya importado: solo refrescar si el evento cambió en Calendar.
            if (existing.get('title') != task['title']
                    or existing.get('due_date') != task['due_date']
                    or (existing.get('description') or '') != task['description']):
                db.update_imported_task(
                    source_id=task['source_id'],
                    title=task['title'],
                    due_date=task['due_date'],
                    description=task['description'],
                    link=task['link'],
                    calendar_event_id=task['calendar_event_id'],
                )
                updated.append(task)
            continue

        db.mark_task_as_synced(
            source_id=task['source_id'],
            title=task['title'],
            course_name=task['course_name'],
            due_date=task['due_date'],
            source=CALENDAR_SOURCE,
            calendar_event_id=task['calendar_event_id'],
            is_urgent=False,
            link=task['link'],
            description=task['description'],
        )
        imported.append(task)

    return {
        'scanned': len(events),
        'imported': imported,
        'updated': updated,
        'deferred_recurring': deferred,
    }


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


def run_full_sync(include_classroom: bool = True) -> dict:
    """
    Ejecuta el pipeline completo y devuelve un resumen serializable.

    `include_classroom=False` corre solo la mitad de Calendar (Pasos 1a y 1b).
    El dashboard la usa al abrirse para traer al instante las notas escritas
    desde el celular sin pagar el costo de consultar Classroom, que es la parte
    lenta y se deja para el botón de sincronizar.
    """
    db.init_db()

    step1a = reconcile_calendar_with_local()
    step1b = import_from_calendar()

    summary = {
        'calendar_checked':   step1a['checked'],
        'calendar_healed':    step1a['healed'],
        'calendar_removed':   step1a['removed'],
        'calendar_scanned':   step1b['scanned'],
        'calendar_imported':  step1b['imported'],
        'calendar_updated':   step1b['updated'],
        'classroom_total':    0,
        'already_synced':     0,
        'completed':          [],
        'skipped':            [],
        'synced':             [],
        'errors':             [],
        'message':            'Google Calendar está al día.',
    }

    if not include_classroom:
        return summary

    step2_3 = sync_from_classroom()
    summary.update({
        'classroom_total':   step2_3['classroom_total'],
        'already_synced':    len(step2_3['already_synced']),
        'completed':         step2_3['completed'],
        'skipped':           step2_3['skipped'],
        'synced':            step2_3['synced'],
        'errors':            step2_3['errors'],
        'message':           'Sincronización completa: Calendar y Classroom están al día.',
    })
    return summary


def run_calendar_sync() -> dict:
    """Solo Calendar → local: verificación e importación, sin tocar Classroom."""
    return run_full_sync(include_classroom=False)
