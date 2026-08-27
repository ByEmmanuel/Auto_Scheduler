import os
import sys
import datetime
from googleapiclient.discovery import build
from dateutil import parser as date_parser

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
import auth

# Zona horaria local del usuario (America/Mexico_City = UTC-6)
LOCAL_TZ = 'America/Mexico_City'

_calendar_service = None


def get_calendar_service():
    """Instancia única del servicio (singleton para no autenticar en cada llamada)."""
    global _calendar_service
    if _calendar_service is None:
        creds = auth.get_credentials()
        _calendar_service = build('calendar', 'v3', credentials=creds)
    return _calendar_service


def _build_reminders(is_urgent: bool) -> list:
    """Devuelve la lista de recordatorios dependiendo del nivel de urgencia."""
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


def _build_event_body(task: dict, is_urgent: bool) -> dict:
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
            'overrides': _build_reminders(is_urgent),
        },
        # Colorize events: 11=Tomato(red) para urgente, 7=Peacock(blue) para normal
        'colorId': '11' if is_urgent else '7',
    }


def add_task_to_calendar(task: dict, is_urgent: bool = False) -> str | None:
    """
    Crea un evento en Google Calendar para la tarea dada.
    Retorna el event_id si se creó correctamente, None si hubo error.
    """
    service = get_calendar_service()
    event_body = _build_event_body(task, is_urgent)

    if event_body is None:
        print(f"  ⏭️  Omitida (sin fecha): {task.get('title', '?')}")
        return None

    try:
        event = service.events().insert(calendarId='primary', body=event_body).execute()
        return event.get('id')
    except Exception as e:
        print(f"  ❌ Error al crear evento '{task.get('title')}': {e}")
        return None


def delete_calendar_event(event_id: str) -> bool:
    """Borra un evento de Google Calendar por su ID."""
    service = get_calendar_service()
    try:
        service.events().delete(calendarId='primary', eventId=event_id).execute()
        return True
    except Exception as e:
        print(f"  ⚠️  No se pudo borrar evento {event_id}: {e}")
        return False


def update_calendar_event_notes(event_id: str, notes: str) -> bool:
    """Agrega o actualiza las notas del usuario en la descripción de un evento existente."""
    service = get_calendar_service()
    try:
        event = service.events().get(calendarId='primary', eventId=event_id).execute()

        # Separar la descripción original de las notas del usuario
        desc = event.get('description', '')
        separator = '\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'
        marker = '✏️ Mis notas:'

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

