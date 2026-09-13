import os
import sys
import datetime
import zoneinfo
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from dateutil import parser as date_parser

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
import auth

# Zona horaria local del usuario (America/Mexico_City = UTC-6)
LOCAL_TZ = 'America/Mexico_City'

# Clave privada con la que la app firma los eventos que ella misma crea, para
# no volver a importarlos como si fueran notas escritas a mano por el usuario.
APP_TAG_KEY = 'autoScheduler'
APP_TAG_VALUE = 'task'

# Separador con el que `update_calendar_event_notes` pega las notas del
# dashboard al final de la descripción del evento.
NOTES_SEPARATOR = '\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'
NOTES_MARKER = '✏️ Mis notas:'


def local_tz() -> zoneinfo.ZoneInfo:
    return zoneinfo.ZoneInfo(LOCAL_TZ)

_calendar_service = None


def get_calendar_service():
    """Instancia única del servicio (singleton para no autenticar en cada llamada)."""
    global _calendar_service
    if _calendar_service is None:
        creds = auth.get_credentials()
        _calendar_service = build('calendar', 'v3', credentials=creds)
    return _calendar_service


def _build_reminders(is_urgent: bool, custom_reminder_minutes=None) -> list:
    """Devuelve la lista de recordatorios dependiendo del nivel de urgencia o personalización.

    `custom_reminder_minutes` acepta un int (una sola alerta) o una lista de
    ints (múltiples alertas). Google Calendar permite máximo 5 overrides por evento.
    """
    if custom_reminder_minutes is not None:
        minutes_list = custom_reminder_minutes if isinstance(custom_reminder_minutes, (list, tuple)) else [custom_reminder_minutes]
        minutes_list = sorted(set(int(m) for m in minutes_list if m is not None))[:5]
        if minutes_list:
            return [{'method': 'popup', 'minutes': m} for m in minutes_list]
        # Lista vacía explícita → sin alertas
        return []

    if is_urgent:
        # Múltiples tareas en el mismo día → 5 alertas
        return [
            {'method': 'popup', 'minutes': 48 * 60},  # 48 horas antes
            {'method': 'popup', 'minutes': 24 * 60},  # 24 horas antes
            {'method': 'popup', 'minutes': 12 * 60},  # 12 horas antes
            {'method': 'popup', 'minutes':  6 * 60},  #  6 horas antes
            {'method': 'popup', 'minutes':  2 * 60},  #  2 horas antes
        ]
    else:
        # Tarea normal → 3 alertas
        return [
            {'method': 'popup', 'minutes': 24 * 60},  # 24 horas antes
            {'method': 'popup', 'minutes': 12 * 60},  # 12 horas antes
            {'method': 'popup', 'minutes':  2 * 60},  #  2 horas antes
        ]


def _build_event_body(task: dict, is_urgent: bool, reminder_minutes: int = None) -> dict:
    """Construye el cuerpo del evento para la API de Google Calendar."""
    course = task.get('course_name', 'Sin materia')
    title  = task.get('title', 'Tarea sin nombre')
    source = task.get('source', 'manual')
    notes  = task.get('description', '').strip()
    due_date_str = task.get('due_date')

    # ── Fecha ──────────────────────────────────────────────────────────
    if not due_date_str:
        return None  # Sin fecha no podemos crear el evento

    due_dt = date_parser.isoparse(due_date_str)
    # Si la fecha no tiene offset la tratamos como hora local (México)
    if due_dt.tzinfo is None:
        import zoneinfo
        local_tz = zoneinfo.ZoneInfo(LOCAL_TZ)
        due_dt = due_dt.replace(tzinfo=local_tz)

    start_dt = due_dt - datetime.timedelta(hours=1)

    # ── Título ─────────────────────────────────────────────────────────
    urgency_emoji = '🔴 ' if is_urgent else '📌 '
    label = f"[{course}]"
    summary = f"{urgency_emoji}ENTREGAR: {label} {title}"

    # ── Descripción ────────────────────────────────────────────────────
    lines = []
    if is_urgent:
        lines.append("⚠️ DÍA OCUPADO: Tienes múltiples entregas este día. ¡Organiza tu tiempo!")
        lines.append('')
    lines.append(f"📚 Materia: {course}")
    lines.append(f"📋 Tarea:   {title}")
    lines.append(f"📅 Fecha límite: {due_dt.strftime('%d/%m/%Y %H:%M')} (Hora Central México)")
    if notes:
        lines.append('')
        lines.append(f"📝 Notas: {notes}")
    lines.append('')
    origin = 'Google Classroom' if source == 'classroom' else 'Ingreso manual'
    lines.append(f"🤖 Fuente: {origin}")

    description = '\n'.join(lines)

    # ── Cuerpo del evento ──────────────────────────────────────────────
    return {
        'summary': summary,
        'description': description,
        'start': {
            'dateTime': start_dt.isoformat(),
            'timeZone': LOCAL_TZ,
        },
        'end': {
            'dateTime': due_dt.isoformat(),
            'timeZone': LOCAL_TZ,
        },
        'reminders': {
            'useDefault': False,
            'overrides': _build_reminders(is_urgent, custom_reminder_minutes=reminder_minutes),
        },
        # Colorize events: 11=Tomato(red) para urgente, 7=Peacock(blue) para normal
        'colorId': '11' if is_urgent else '7',
        # Marca de autoría: permite distinguir en el Paso 0 los eventos que creó
        # la app (no se reimportan) de los que el usuario escribió a mano en
        # Google Calendar desde el celular (sí se importan).
        'extendedProperties': {
            'private': {
                APP_TAG_KEY: APP_TAG_VALUE,
                'autoSchedulerSourceId': str(task.get('source_id', '')),
            }
        },
    }


def add_task_to_calendar(task: dict, is_urgent: bool = False, reminder_minutes: int = None) -> str | None:
    """
    Crea un evento en Google Calendar para la tarea dada.
    Retorna el event_id si se creó correctamente, None si hubo error.
    """
    service = get_calendar_service()
    event_body = _build_event_body(task, is_urgent, reminder_minutes=reminder_minutes)

    if event_body is None:
        print(f"  ⏭️  Omitida (sin fecha): {task.get('title', '?')}")
        return None

    try:
        event = service.events().insert(calendarId='primary', body=event_body).execute()
        return event.get('id')
    except Exception as e:
        print(f"  ❌ Error al crear evento '{task.get('title')}': {e}")
        return None


def event_exists(event_id: str) -> bool:
    """
    Confirma si un evento sigue vivo en Google Calendar (no fue borrado ni
    cancelado a mano). Se usa en el Paso 1 del pipeline para detectar
    "drift" entre la BD local y el calendario real antes de tocar Classroom.
    """
    service = get_calendar_service()
    try:
        event = service.events().get(calendarId='primary', eventId=event_id).execute()
        return event.get('status') != 'cancelled'
    except HttpError as e:
        if e.resp.status in (404, 410):
            return False
        # Error transitorio (red, cuota, etc.): asumimos que sigue existiendo
        # para no arriesgarnos a recrear (y duplicar) un evento que sí está.
        print(f"  ⚠️  No se pudo verificar el evento {event_id}: {e}")
        return True
    except Exception as e:
        print(f"  ⚠️  No se pudo verificar el evento {event_id}: {e}")
        return True


def delete_calendar_event(event_id: str) -> bool:
    """Borra un evento de Google Calendar por su ID."""
    service = get_calendar_service()
    try:
        service.events().delete(calendarId='primary', eventId=event_id).execute()
        return True
    except Exception as e:
        print(f"  ⚠️  No se pudo borrar evento {event_id}: {e}")
        return False


def update_calendar_event_datetime(event_id: str, due_date_str: str, anchor: str = 'end') -> bool:
    """
    Mueve un evento existente a una nueva fecha/hora, conservando el resto del
    evento (título, recordatorios, color y notas del usuario).

    `anchor` dice qué extremo del evento representa `due_date_str`:
      - 'end'   → la fecha es el vencimiento; el evento termina ahí (tareas de
                  Classroom y manuales, que la app crea como bloque previo).
      - 'start' → la fecha es el inicio; el evento arranca ahí (notas que el
                  usuario creó en Google Calendar, donde lo que importa es la
                  hora a la que empieza).

    La duración original se conserva en ambos casos, y un evento de día
    completo sigue siendo de día completo: solo se corre de fecha.
    """
    service = get_calendar_service()
    try:
        due_dt = date_parser.isoparse(due_date_str)
        if due_dt.tzinfo is None:
            due_dt = due_dt.replace(tzinfo=local_tz())

        event = service.events().get(calendarId='primary', eventId=event_id).execute()

        if event.get('start', {}).get('date'):
            # Evento de día completo: se mantiene así, moviendo el rango de días
            # completo para conservar su duración (Calendar usa fin exclusivo).
            span = _all_day_span(event)
            new_start = due_dt.date()
            event['start'] = {'date': new_start.isoformat()}
            event['end'] = {'date': (new_start + span).isoformat()}
        else:
            duration = _event_duration(event)
            if anchor == 'start':
                start_dt, end_dt = due_dt, due_dt + duration
            else:
                start_dt, end_dt = due_dt - duration, due_dt
            event['start'] = {'dateTime': start_dt.isoformat(), 'timeZone': LOCAL_TZ}
            event['end'] = {'dateTime': end_dt.isoformat(), 'timeZone': LOCAL_TZ}

        # La descripción repite la fecha límite en texto; si no se actualiza,
        # el evento movido mostraría la fecha vieja en su cuerpo.
        desc = event.get('description', '')
        if '📅 Fecha límite:' in desc:
            import re
            event['description'] = re.sub(
                r'(📅 Fecha límite: ).*',
                lambda m: m.group(1) + due_dt.strftime('%d/%m/%Y %H:%M') + ' (Hora Central México)',
                desc,
                count=1,
            )

        service.events().update(calendarId='primary', eventId=event_id, body=event).execute()
        return True
    except Exception as e:
        print(f"  ❌ Error moviendo el evento {event_id}: {e}")
        return False


def _event_duration(event: dict) -> datetime.timedelta:
    """Duración de un evento con hora; una hora si no se puede calcular."""
    try:
        start = date_parser.isoparse(event['start']['dateTime'])
        end = date_parser.isoparse(event['end']['dateTime'])
        delta = end - start
        return delta if delta > datetime.timedelta(0) else datetime.timedelta(hours=1)
    except (KeyError, TypeError, ValueError):
        return datetime.timedelta(hours=1)


def _all_day_span(event: dict) -> datetime.timedelta:
    """Número de días que ocupa un evento de día completo (mínimo uno)."""
    try:
        start = datetime.date.fromisoformat(event['start']['date'])
        end = datetime.date.fromisoformat(event['end']['date'])
        span = end - start
        return span if span >= datetime.timedelta(days=1) else datetime.timedelta(days=1)
    except (KeyError, TypeError, ValueError):
        return datetime.timedelta(days=1)


def update_calendar_event_notes(event_id: str, notes: str) -> bool:
    """Agrega o actualiza las notas del usuario en la descripción de un evento existente."""
    service = get_calendar_service()
    try:
        event = service.events().get(calendarId='primary', eventId=event_id).execute()

        # Separar la descripción original de las notas del usuario
        desc = event.get('description', '')
        separator = NOTES_SEPARATOR
        marker = NOTES_MARKER

        # Eliminar notas anteriores si existen
        if marker in desc:
            desc = desc[:desc.index(separator + marker)].rstrip()

        # Agregar nuevas notas
        if notes.strip():
            desc = f"{desc}{separator}{marker}\n{notes}"

        event['description'] = desc
        service.events().update(calendarId='primary', eventId=event_id, body=event).execute()
        return True
    except Exception as e:
        print(f"  ❌ Error actualizando notas del evento {event_id}: {e}")
        return False



# ── Lectura del calendario (Calendar → local) ──────────────────────────────────

def list_primary_events(time_min: datetime.datetime,
                        time_max: datetime.datetime,
                        max_results: int = 500) -> list[dict]:
    """
    Devuelve los eventos del calendario principal dentro de la ventana dada.

    `singleEvents=True` expande las series repetidas en instancias sueltas, que
    es como el dashboard trata todo (una tarjeta = un día concreto). Pagina
    hasta `max_results` para no colgarse en calendarios muy cargados.
    """
    service = get_calendar_service()
    events: list[dict] = []
    page_token = None

    while True:
        try:
            resp = service.events().list(
                calendarId='primary',
                timeMin=time_min.isoformat(),
                timeMax=time_max.isoformat(),
                singleEvents=True,
                orderBy='startTime',
                maxResults=250,
                pageToken=page_token,
            ).execute()
        except Exception as e:
            print(f"  ⚠️  No se pudieron listar los eventos del calendario: {e}")
            break

        events.extend(resp.get('items', []))
        page_token = resp.get('nextPageToken')
        if not page_token or len(events) >= max_results:
            break

    return events[:max_results]


def is_app_event(event: dict) -> bool:
    """True si el evento lo creó esta app (lleva su marca privada)."""
    private = (event.get('extendedProperties') or {}).get('private') or {}
    return private.get(APP_TAG_KEY) == APP_TAG_VALUE


def _strip_dashboard_notes(description: str) -> str:
    """Quita el bloque «✏️ Mis notas» que el dashboard pega en la descripción.

    Sin esto, cada importación devolvería las notas del usuario dentro de la
    descripción del evento y se irían duplicando en cada pasada.
    """
    if NOTES_SEPARATOR + NOTES_MARKER in description:
        return description[:description.index(NOTES_SEPARATOR + NOTES_MARKER)].rstrip()
    return description


def event_to_task(event: dict) -> dict | None:
    """
    Traduce un evento de Google Calendar a un registro de tarea local.

    A diferencia de lo que crea la app (donde el evento *termina* en la fecha
    límite), aquí la fecha relevante es la de inicio: si el usuario apunta algo
    a las 15:00 desde el celular, eso es lo que espera ver en la tarjeta. Un
    evento de día completo se ancla a las 23:59 de ese día.
    """
    start = event.get('start') or {}

    if start.get('dateTime'):
        due_dt = date_parser.isoparse(start['dateTime'])
        if due_dt.tzinfo is None:
            due_dt = due_dt.replace(tzinfo=local_tz())
        due_local = due_dt.astimezone(local_tz())
    elif start.get('date'):
        day = datetime.date.fromisoformat(start['date'])
        due_local = datetime.datetime.combine(day, datetime.time(23, 59), tzinfo=local_tz())
    else:
        return None  # Evento sin fecha utilizable

    title = (event.get('summary') or '').strip() or 'Evento sin título'
    description = _strip_dashboard_notes((event.get('description') or '').strip())

    return {
        # El id del evento es estable entre dispositivos, así que sirve de
        # llave natural: reimportar el mismo evento actualiza, no duplica.
        'source_id': f"calendar_{event['id']}",
        'title': title,
        'course_name': 'Google Calendar',
        # Se guarda como ISO local sin zona, igual que el resto de la BD.
        'due_date': due_local.replace(tzinfo=None).isoformat(),
        'source': 'calendar',
        'description': description,
        'link': event.get('htmlLink', ''),
        'calendar_event_id': event['id'],
        'all_day': bool(start.get('date')),
    }
