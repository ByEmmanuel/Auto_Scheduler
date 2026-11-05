"""
sync_pipeline.py – Orquesta el pipeline de sincronización de 4 pasos que usan
tanto `main.py` (CLI) como `web/server.py` (endpoint /api/verify), para que
ambos flujos se comporten exactamente igual.

Pipeline (ver también memory/classroom-calendar-sync-pipeline.md):
  1. Calendar → local:  se revisa Google Calendar PRIMERO, en dos mitades.
     1a. Verificación: confirma que los eventos guardados en la BD siguen
         existiendo. Si uno de Classroom fue borrado a mano, se limpia SOLO su
         `calendar_event_id` para que el Paso 3 lo recree (la entrega sigue
         pendiente); si era una tarea manual, pasa al historial; si era una
         nota importada del propio Calendar, se borra el registro local (allá
         se creó y allá se borró).
     1b. Importación: se traen los eventos que el usuario escribió a mano en
         Google Calendar (típicamente desde el celular) y que la app no
         conoce, y se guardan como tareas locales con `source='calendar'`. Si
         movió allá un evento creado por la app, la tarea lo sigue. Lo que se
         escribe como «📝 …» o «Nota: …» entra como nota, no como tarea.
     1c. Notas: las notas del dashboard (eventos de día completo sin
         alertas) se sincronizan en los dos sentidos (`sync_notes`).
  2. Local → Classroom:  se descargan las tareas pendientes actuales de
     Google Classroom.
  3. Diff Classroom vs. local:  Classroom manda sobre las tareas de Classroom.
     Lo que ya tiene evento vivo no se duplica (solo se refresca si el profesor
     cambió título o fecha); lo que no lo tiene se crea en Calendar, o queda
     solo en el tablero si ya venció o no tiene fecha. Lo que ya no está
     pendiente se marca como completado y se borra su evento, y lo que el
     pipeline había cerrado pero Classroom sigue pidiendo se reabre. Lo que el
     usuario cerró a mano se respeta.
  4. Reporte:  se arma un resumen con el resultado de cada paso; quien lo
     use (CLI o API web) lo muestra.

El tablero lo corre completo al abrirse y al volver a la pestaña; el botón
"Sincronizar" hace lo mismo pero reporta todo el resultado.
"""

import datetime
from collections import defaultdict

from dateutil import parser as date_parser

from . import db, classroom_api, calendar_sync

# Marca de las tareas que nacieron como un evento del propio Google Calendar.
CALENDAR_SOURCE = 'calendar'

# Prefijo del `recurrence_group` de las instancias importadas de una serie
# repetida de Google Calendar: `gcal_<id del evento maestro>`. Permite que el
# dashboard las muestre como serie y ofrezca borrarla entera.
CALENDAR_SERIES_PREFIX = 'gcal_'

# Ventana que se revisa al importar desde Calendar.
IMPORT_PAST_DAYS = 7
IMPORT_FUTURE_DAYS = 120

# Las series repetidas (una clase, un recordatorio diario) se expanden en una
# instancia por ocurrencia: un evento cada dos días llena 56 tarjetas en la
# ventana completa y deja el tablero ilegible. De esas solo entran las de las
# próximas dos semanas, y nunca las que ya pasaron: la siguiente tanda se
# importa sola conforme avanzan los días.
RECURRING_HORIZON_DAYS = 14


def _live_event_ids(records: list[dict]) -> set[str]:
    """Ids vivos según un solo listado del calendario, para no pedir evento por
    evento. Faltar aquí no prueba nada (el listado tiene tope y puede fallar a
    medias): eso lo confirma `event_exists`, una por una."""
    dates = sorted(rec['due_date'][:10] for rec in records if rec.get('due_date'))
    if not dates:
        return set()
    tz = calendar_sync.local_tz()
    time_min = datetime.datetime.fromisoformat(dates[0]).replace(tzinfo=tz) - datetime.timedelta(days=2)
    time_max = datetime.datetime.fromisoformat(dates[-1]).replace(tzinfo=tz) + datetime.timedelta(days=2)
    return {event['id'] for event in calendar_sync.list_primary_events(time_min, time_max)}


def reconcile_calendar_with_local(records: list[dict] | None = None) -> dict:
    """
    Paso 1a: verifica cada tarea local con evento contra Google Calendar.

    Si el evento ya no existe, la reacción depende de quién manda sobre esa
    tarea. Classroom: solo se limpia su `calendar_event_id` y el Paso 3 lo
    recrea, porque la entrega sigue pendiente. Manual: borrar el evento es
    decirle a la app que ya no va, así que pasa al historial, de donde se puede
    restaurar. Importada de Calendar: vive allá, así que se quita de aquí.
    Nunca se crean eventos en este paso.
    """
    records = records if records is not None else db.get_all_synced()
    with_event = [rec for rec in records if rec.get('calendar_event_id')]
    live = _live_event_ids(with_event)
    healed, removed = [], []
    for rec in with_event:
        event_id = rec['calendar_event_id']
        if event_id in live or calendar_sync.event_exists(event_id):
            continue
        if rec.get('source') == CALENDAR_SOURCE:
            db.delete_task(rec['source_id'])
            removed.append(rec)
        elif rec.get('source') == 'manual':
            db.update_task_status(rec['source_id'], 'completed', completed_by='user')
            db.update_calendar_event_id(rec['source_id'], '')
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
    own_tasks = {rec['calendar_event_id']: rec for rec in db.get_all_synced()
                 if rec.get('calendar_event_id') and rec['source'] != CALENDAR_SOURCE}

    imported, updated, deferred, adopted_notes = [], [], 0, []
    for event in events:
        if event.get('status') == 'cancelled':
            continue
        # Las notas no son tareas: las lleva `sync_notes`, nunca el tablero.
        if calendar_sync.is_note_event(event):
            continue
        if calendar_sync.is_app_event(event):
            # Evento de la app movido desde Calendar: la tarea lo sigue.
            rec = own_tasks.get(event['id'])
            deadline = calendar_sync.event_deadline(event)
            if rec and deadline and deadline[:16] != (rec.get('due_date') or '')[:16]:
                db.update_task_due_date(rec['source_id'], deadline)
                updated.append(rec)
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

        # «📝 …» o «Nota: …» escrito en el celular es una nota, no una tarea.
        # Solo si es nuevo (lo ya importado como tarea se queda así) y no es
        # parte de una serie. Si Calendar no deja marcarlo, se reintenta en la
        # próxima pasada; mientras, no entra como tarea.
        if (calendar_sync.looks_like_phone_note(event) and not event.get('recurringEventId')
                and not db.get_task_by_source_id(f"calendar_{event['id']}")):
            note = adopt_phone_note(event)
            if note:
                adopted_notes.append(note)
            continue

        task = calendar_sync.event_to_task(event)
        if not task:
            continue

        # Una instancia de serie repetida solo se importa si cae en el
        # horizonte corto. Si ya estaba importada se respeta y se actualiza:
        # el recorte es para no traer de golpe una serie entera, no para
        # borrar lo que el usuario ya tiene en el tablero.
        existing = db.get_task_by_source_id(task['source_id'])
        series_group = (CALENDAR_SERIES_PREFIX + event['recurringEventId']
                        if event.get('recurringEventId') else '')
        # Instancias importadas antes de que existiera el grupo de serie.
        if existing and series_group and not existing.get('recurrence_group'):
            db.set_recurrence_group(task['source_id'], series_group)
            # Cuenta como cambio para que el tablero se recargue y la muestre
            # ya como serie.
            updated.append(task)
            continue
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
            recurrence_group=series_group,
        )
        imported.append(task)

    return {
        'scanned': len(events),
        'imported': imported,
        'updated': updated,
        'deferred_recurring': deferred,
        'adopted_notes': adopted_notes,
    }


# ── Notas ──────────────────────────────────────────────────────────────────────

def new_note_id() -> str:
    import uuid
    return f'note_{uuid.uuid4().hex[:12]}'


def _is_newer(remote: str, seen: str) -> bool:
    """True si el `updated` del evento es posterior al último que vio la app."""
    if not seen:
        return True
    try:
        return date_parser.isoparse(remote) > date_parser.isoparse(seen)
    except (TypeError, ValueError):
        return remote != seen


def adopt_phone_note(event: dict) -> dict | None:
    """Guarda como nota un evento «📝 …» escrito a mano en Calendar."""
    note_id = new_note_id()
    tagged = calendar_sync.adopt_phone_note(event, note_id)
    if not tagged:
        return None
    fields = calendar_sync.note_from_event(tagged)
    return db.create_note(note_id, fields['title'], fields['body'], fields['date'],
                          calendar_event_id=tagged['id'],
                          calendar_updated=tagged.get('updated', ''))


def push_note(note: dict) -> bool:
    """Lleva una nota a Calendar: crea su evento o lo reescribe. Si falla queda
    marcada para que la próxima sincronización lo reintente."""
    event_id = note.get('calendar_event_id')
    event = (calendar_sync.update_note_event(event_id, note) if event_id
             else calendar_sync.add_note_event(note))
    if not event:
        db.update_note(note['id'], touch=False, needs_push=True)
        return False
    db.update_note(note['id'], touch=False, needs_push=False,
                   calendar_event_id=event['id'], calendar_updated=event.get('updated', ''))
    return True


def sync_notes() -> dict:
    """
    Paso 1c: notas en los dos sentidos, después de 1a y 1b.

    - Lo editado en Calendar (título, texto, día) se trae, salvo que haya un
      cambio local que todavía no subió: ese gana y se sube.
    - Si el evento de una nota se borró en Calendar, la nota se archiva (no se
      borra): desde Archivadas se puede recuperar.
    - Una nota archivada cuyo evento sigue vivo (falló el borrado) se reintenta.
    - Un evento-nota que la BD no conoce se trae como nota nueva.
    """
    events = calendar_sync.list_note_events()
    if events is None:
        return {'imported': [], 'updated': [], 'archived': [], 'pushed': [], 'failed': True}

    remote = {e['id']: e for e in events if e.get('status') != 'cancelled'}
    # Por id de nota: si Calendar creó el evento pero la respuesta se perdió,
    # la nota queda sin id de evento aunque el evento exista con su marca.
    by_note_id = {}
    for e in remote.values():
        by_note_id.setdefault(calendar_sync.note_id_of(e), e)
    imported, updated, archived, pushed = [], [], [], []

    for note in db.list_notes(status=None):
        event_id = note.get('calendar_event_id') or ''
        event = remote.pop(event_id, None) if event_id else None

        if note['status'] == 'archived':
            if event_id and calendar_sync.delete_calendar_event(event_id):
                db.update_note(note['id'], touch=False, calendar_event_id='', needs_push=False)
            stray = by_note_id.get(note['id'])
            if not event_id and stray and stray['id'] in remote:
                if calendar_sync.delete_calendar_event(stray['id']):
                    remote.pop(stray['id'], None)
            continue

        if not event_id:
            event = by_note_id.get(note['id'])
            if event and note['status'] == 'active':
                # Ya está en Calendar: se enlaza y se le sube lo de aquí.
                remote.pop(event['id'], None)
                db.update_note(note['id'], touch=False, calendar_event_id=event['id'],
                               calendar_updated=event.get('updated', ''))
                note = db.get_note(note['id'])
            if push_note(note):
                pushed.append(note)
            continue

        if event is None:
            # El listado no la trajo: se confirma una por una antes de archivar.
            if calendar_sync.event_exists(event_id):
                continue
            db.update_note(note['id'], touch=False, status='archived',
                           calendar_event_id='', needs_push=False)
            archived.append(note)
            continue

        if note.get('needs_push'):
            if push_note(note):
                pushed.append(note)
            continue

        if _is_newer(event.get('updated', ''), note.get('calendar_updated', '')):
            fields = calendar_sync.note_from_event(event)
            changed = any(fields[k] != (note.get(k) or '') for k in ('title', 'body', 'date'))
            db.update_note(note['id'], touch=changed, calendar_updated=event.get('updated', ''),
                           **(fields if changed else {}))
            if changed:
                updated.append({**note, **fields})

    # Eventos-nota sin fila local (p. ej. la BD se reinició): se traen.
    for event in remote.values():
        note_id = calendar_sync.note_id_of(event) or new_note_id()
        if db.get_note(note_id):
            # Copia de una nota que ya tiene su evento (p. ej. dos subidas a la
            # vez): se quita la sobrante en vez de duplicar la nota.
            calendar_sync.delete_calendar_event(event['id'])
            continue
        fields = calendar_sync.note_from_event(event)
        imported.append(db.create_note(note_id, fields['title'], fields['body'], fields['date'],
                                       calendar_event_id=event['id'],
                                       calendar_updated=event.get('updated', '')))

    return {'imported': imported, 'updated': updated, 'archived': archived,
            'pushed': pushed, 'failed': False}


def _retire_classroom_task(rec: dict) -> None:
    """Saca del tablero y de Calendar una tarea que ya no se debe en Classroom.
    Si Calendar no deja borrar el evento se conserva su id, y lo reintenta
    `_sweep_completed_events`."""
    if rec.get('calendar_event_id') and calendar_sync.delete_calendar_event(rec['calendar_event_id']):
        db.update_calendar_event_id(rec['source_id'], '')
    db.update_task_status(rec['source_id'], 'completed', completed_by='classroom')


def _sweep_completed_events() -> None:
    """Quita de Calendar los eventos de tareas cerradas que no se pudieron borrar
    en su momento (o que nunca se borraron): un evento de algo ya entregado
    seguiría mandando alertas."""
    for rec in db.get_all_synced(status='completed'):
        if rec.get('calendar_event_id') and calendar_sync.delete_calendar_event(rec['calendar_event_id']):
            db.update_calendar_event_id(rec['source_id'], '')


def _due_datetime(task: dict) -> datetime.datetime | None:
    """Vencimiento con zona. La BD lo guarda como hora local sin zona, así que
    compararlo como si fuera UTC adelantaba seis horas el vencimiento."""
    if not task.get('due_date'):
        return None
    due = date_parser.isoparse(task['due_date'])
    return due if due.tzinfo else due.replace(tzinfo=calendar_sync.local_tz())


def _refresh_classroom_task(rec: dict, task: dict) -> bool:
    """Aplica a una tarea ya sincronizada lo que cambió en Classroom. La fecha
    solo se toca si cambió respecto a la última vista allá: si difiere de la del
    tablero pero no de esa, la movió el usuario. True si el profesor la cambió."""
    new_due = task.get('due_date') or ''
    baseline = rec.get('classroom_due') or ''
    moved_by_teacher = bool(baseline) and new_due != baseline

    db.update_classroom_task(
        rec['source_id'], task['title'], task.get('course_name', ''),
        task.get('description', ''), task.get('link', ''), new_due,
        due_date=new_due if moved_by_teacher else None,
    )
    if moved_by_teacher and new_due and rec.get('calendar_event_id'):
        calendar_sync.update_calendar_event_datetime(rec['calendar_event_id'], new_due)
    return moved_by_teacher


def _save_classroom_task(task: dict, event_id: str, is_urgent: bool = False) -> None:
    db.mark_task_as_synced(
        source_id=task['source_id'],
        title=task['title'],
        course_name=task.get('course_name', ''),
        due_date=task.get('due_date') or '',
        source=task.get('source', 'classroom'),
        calendar_event_id=event_id,
        is_urgent=is_urgent,
        link=task.get('link', ''),
        description=task.get('description', ''),
        course_id=task.get('course_id', ''),
        coursework_id=task.get('coursework_id', ''),
        submission_id=task.get('submission_id', ''),
        submission_state=task.get('submission_state', ''),
        classroom_due=task.get('classroom_due') or task.get('due_date') or '',
    )


def sync_from_classroom(now: datetime.datetime | None = None) -> dict:
    """Pasos 2-3: Classroom manda sobre sus tareas. Retira lo entregado, reabre
    lo que se cerró de más, refresca lo que cambió y crea en Calendar solo lo
    que falte, evitando así duplicar tareas ya sincronizadas."""
    now = now or datetime.datetime.now(calendar_sync.local_tz())

    fetched = classroom_api.fetch_pending_tasks()
    all_tasks = fetched['tasks']
    failed_courses = fetched['failed_courses']
    all_source_ids = {t['source_id'] for t in all_tasks}

    # Que no venga en la lista solo significa "ya no se debe" si Classroom
    # respondió por su curso. Ante la duda se queda pendiente: una tarea de más
    # en el tablero se ve, una de menos se olvida.
    completed = []
    if fetched['course_count'] > 0:
        for rec in db.get_all_synced():
            if rec['source'] != 'classroom' or rec['source_id'] in all_source_ids:
                continue
            if rec.get('course_id') in failed_courses or (failed_courses and not rec.get('course_id')):
                continue
            _retire_classroom_task(rec)
            completed.append(rec)

    already, reopened, rescheduled, board_only, candidates = [], [], [], [], []
    for task in all_tasks:
        existing = db.get_task_by_source_id(task['source_id'])
        is_closed = bool(existing) and existing.get('status') == 'completed'

        if is_closed and existing.get('completed_by') == 'user':
            continue
        if is_closed:
            reopened.append(task)
        elif existing:
            if _refresh_classroom_task(existing, task):
                rescheduled.append(task)
            if existing.get('calendar_event_id'):
                already.append(task)
                continue
            # Sin evento (borrado a mano, o Calendar falló): se recrea en la
            # fecha del tablero, que el usuario pudo haber movido.
            task = {**task, 'classroom_due': task.get('due_date'),
                    'due_date': db.get_task_by_source_id(task['source_id'])['due_date']}

        due_dt = _due_datetime(task)
        if due_dt and due_dt > now:
            candidates.append((task, due_dt))
        elif not existing or is_closed:
            # Vencida o sin fecha: no merece evento, pero sigue pendiente y
            # debe verse en "Atrasadas" o "Sin fecha".
            _save_classroom_task(task, '')
            board_only.append(task)

    tasks_per_day = defaultdict(int)
    for task, due_dt in candidates:
        tasks_per_day[due_dt.strftime('%Y-%m-%d')] += 1

    synced, errors = [], []
    for task, due_dt in candidates:
        is_urgent = tasks_per_day[due_dt.strftime('%Y-%m-%d')] > 1
        event_id = calendar_sync.add_task_to_calendar(task, is_urgent=is_urgent)
        # Aunque Calendar falle la tarea entra al tablero, y sin evento se
        # reintenta en la próxima sincronización.
        _save_classroom_task(task, event_id or '', is_urgent)
        (synced if event_id else errors).append(task)

    _sweep_completed_events()

    return {
        'classroom_total': len(all_tasks),
        'already_synced': already,
        'completed': completed,
        'reopened': reopened,
        'rescheduled': rescheduled,
        'board_only': board_only,
        'synced': synced,
        'errors': errors,
        'failed_courses': list(failed_courses.values()),
    }


def restore_manual_events(now: datetime.datetime | None = None) -> dict:
    """Crea el evento que le faltó a una tarea manual futura: pasa cuando Calendar
    falló al crearla. Si el usuario borró el evento, el Paso 1a ya la cerró."""
    now = now or datetime.datetime.now(calendar_sync.local_tz())
    synced, errors = [], []
    for rec in db.get_all_synced():
        if rec['source'] != 'manual' or rec.get('calendar_event_id'):
            continue
        due_dt = _due_datetime(rec)
        if not due_dt or due_dt <= now:
            continue
        event_id = calendar_sync.add_task_to_calendar(rec, is_urgent=bool(rec.get('is_urgent')))
        if event_id:
            db.update_calendar_event_id(rec['source_id'], event_id)
            synced.append({**rec, 'course_name': rec.get('course_name', '')})
        else:
            errors.append(rec)
    return {'synced': synced, 'errors': errors}


def _notes_summary(step1b: dict, notes: dict) -> dict:
    return {
        'notes_imported': step1b['adopted_notes'] + notes['imported'],
        'notes_updated':  notes['updated'],
        'notes_archived': notes['archived'],
        'notes_failed':   notes['failed'],
    }


def run_full_sync() -> dict:
    """Ejecuta el pipeline completo y devuelve un resumen serializable."""
    db.init_db()

    step1a = reconcile_calendar_with_local()
    step1b = import_from_calendar()
    notes = sync_notes()
    step2_3 = sync_from_classroom()
    manual = restore_manual_events()

    failed_courses = step2_3['failed_courses']
    return {
        'calendar_checked':  step1a['checked'],
        'calendar_healed':   step1a['healed'],
        'calendar_removed':  step1a['removed'],
        'calendar_scanned':  step1b['scanned'],
        'calendar_imported': step1b['imported'],
        'calendar_updated':  step1b['updated'],
        **_notes_summary(step1b, notes),
        'classroom_total':   step2_3['classroom_total'],
        'already_synced':    len(step2_3['already_synced']),
        'completed':         step2_3['completed'],
        'reopened':          step2_3['reopened'],
        'rescheduled':       step2_3['rescheduled'],
        'board_only':        step2_3['board_only'],
        'synced':            step2_3['synced'] + manual['synced'],
        'errors':            step2_3['errors'] + manual['errors'],
        'failed_courses':    failed_courses,
        'message': ('Sincronización incompleta: no se pudieron leer '
                    f'{len(failed_courses)} cursos de Classroom.' if failed_courses
                    else 'Sincronización completa: Calendar y Classroom están al día.'),
    }


def run_calendar_sync() -> dict:
    """Solo Calendar → local (Pasos 1a y 1b). Lo usa el dashboard clásico."""
    db.init_db()
    step1a = reconcile_calendar_with_local()
    step1b = import_from_calendar()
    notes = sync_notes()
    return {
        'calendar_checked':  step1a['checked'],
        'calendar_healed':   step1a['healed'],
        'calendar_removed':  step1a['removed'],
        'calendar_scanned':  step1b['scanned'],
        'calendar_imported': step1b['imported'],
        'calendar_updated':  step1b['updated'],
        **_notes_summary(step1b, notes),
        'message':           'Google Calendar está al día.',
    }
