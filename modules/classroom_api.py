import os
import sys
from googleapiclient.discovery import build
import datetime

# Para poder importar auth.py desde el directorio padre
sys.path.append(os.path.dirname(os.path.dirname(__file__)))
import auth

# Estados en los que el alumno ya no debe nada: entregada, o devuelta/calificada.
SUBMITTED_STATES = ('TURNED_IN', 'RETURNED')

def get_classroom_service():
    creds = auth.get_credentials()
    return build('classroom', 'v1', credentials=creds)

def parse_due_date(due_date_obj, due_time_obj):
    if not due_date_obj:
        return None
    year = due_date_obj.get('year')
    month = due_date_obj.get('month')
    day = due_date_obj.get('day')
    
    hours = 23
    minutes = 59
    if due_time_obj:
        hours = due_time_obj.get('hours', 23)
        minutes = due_time_obj.get('minutes', 59)
        
    try:
        import zoneinfo
        # Classroom devuelve UTC
        dt_utc = datetime.datetime(year, month, day, hours, minutes, tzinfo=datetime.timezone.utc)
        local_tz = zoneinfo.ZoneInfo("America/Mexico_City")
        dt_local = dt_utc.astimezone(local_tz)
        
        # Devolver como string ingenuo (naive) para que la base de datos y la web
        # lo interpreten directamente como hora local.
        return dt_local.replace(tzinfo=None).isoformat()
    except Exception as e:
        print(f"Error parseando fecha: {e}")
        return None

class ClassroomUnavailable(Exception):
    """Classroom no respondió: no se sabe nada, y nada debe darse por entregado."""


def _all_pages(request, key):
    """Recorre todas las páginas de un listado de la API."""
    items, token = [], None
    while True:
        response = request(pageToken=token).execute()
        items.extend(response.get(key, []))
        token = response.get('nextPageToken')
        if not token:
            return items


def fetch_pending_tasks():
    """
    Lee de Classroom lo que el alumno aún debe, curso por curso.

    Devuelve las tareas pendientes, cuántos cursos activos hay y los cursos que
    no se pudieron leer. La distinción importa: que una tarea no venga en la
    lista significa "ya no se debe" solo si su curso se leyó completo, nunca si
    la consulta falló. Sin los cursos ni siquiera se sigue.
    """
    try:
        service = get_classroom_service()
        courses = _all_pages(
            lambda **page: service.courses().list(studentId='me', courseStates=['ACTIVE'], **page),
            'courses',
        )
    except Exception as e:
        raise ClassroomUnavailable(str(e)) from e

    pending_tasks = []
    failed_courses = {}

    for course in courses:
        course_id = course['id']
        course_name = course['name']

        try:
            courseworks = _all_pages(
                lambda **page: service.courses().courseWork().list(courseId=course_id, **page),
                'courseWork',
            )
            # `-` trae las entregas de todo el curso en una sola consulta, en
            # vez de una por tarea: es lo que permite sincronizar al abrir.
            submissions = _all_pages(
                lambda **page: service.courses().courseWork().studentSubmissions().list(
                    courseId=course_id, courseWorkId='-', userId='me', **page),
                'studentSubmissions',
            )
        except Exception as e:
            print(f"Error leyendo el curso {course_name}: {e}")
            failed_courses[course_id] = course_name
            continue

        by_work = {}
        for sub in submissions:
            by_work.setdefault(sub.get('courseWorkId'), []).append(sub)

        for cw in courseworks:
            cw_id = cw['id']
            own = by_work.get(cw_id, [])
            # Sin entrega registrada, o sin entregar ni calificar: está pendiente.
            if any(sub.get('state') in SUBMITTED_STATES for sub in own):
                continue

            pending_tasks.append({
                'source_id': f"classroom_{cw_id}",
                'title': cw.get('title', 'Sin título'),
                'course_name': course_name,
                'due_date': parse_due_date(cw.get('dueDate'), cw.get('dueTime')),
                'description': cw.get('description', ''),
                'source': 'classroom',
                'link': cw.get('alternateLink', ''),
                'course_id': course_id,
                'coursework_id': cw_id,
                'submission_id': own[0].get('id', '') if own else '',
                'submission_state': own[0].get('state', '') if own else '',
            })

    return {
        'tasks': pending_tasks,
        'course_count': len(courses),
        'failed_courses': failed_courses,
    }

if __name__ == '__main__':
    print("Extrayendo tareas pendientes de Google Classroom...")
    tasks = fetch_pending_tasks()['tasks']
    for t in tasks:
        print(f"- {t['title']} ({t['course_name']}) | Vence: {t['due_date']}")
    print(f"Total pendientes: {len(tasks)}")
