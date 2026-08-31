import os
import sys
from googleapiclient.discovery import build
import datetime

# Para poder importar auth.py desde el directorio padre
sys.path.append(os.path.dirname(os.path.dirname(__file__)))
import auth

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

def fetch_pending_tasks():
    service = get_classroom_service()
    
    pending_tasks = []
    
    # 1. Obtener los cursos activos del estudiante
    try:
        courses_result = service.courses().list(studentId='me', courseStates=['ACTIVE']).execute()
        courses = courses_result.get('courses', [])
    except Exception as e:
        print(f"Error obteniendo cursos: {e}")
        return []

    for course in courses:
        course_id = course['id']
        course_name = course['name']
        
        # 2. Obtener las tareas del curso
        try:
            coursework_result = service.courses().courseWork().list(courseId=course_id).execute()
            courseworks = coursework_result.get('courseWork', [])
        except Exception as e:
            print(f"Error obteniendo tareas del curso {course_name}: {e}")
            continue
            
        for cw in courseworks:
            cw_id = cw['id']
            title = cw.get('title', 'Sin título')
            description = cw.get('description', '')
            
            # 3. Verificar el estado de entrega (submissions)
            try:
                submissions_result = service.courses().courseWork().studentSubmissions().list(
                    courseId=course_id,
                    courseWorkId=cw_id,
                    userId='me'
                ).execute()
                submissions = submissions_result.get('studentSubmissions', [])

                # Si no hay entregas, o si el estado no es entregado/calificado, está pendiente
                is_submitted = False
                submission_id = ''
                submission_state = ''
                if submissions:
                    submission_id = submissions[0].get('id', '')
                    submission_state = submissions[0].get('state', '')
                for sub in submissions:
                    state = sub.get('state')
                    if state in ['TURNED_IN', 'RETURNED']:
                        is_submitted = True
                        break

                if not is_submitted:
                    due_date = parse_due_date(cw.get('dueDate'), cw.get('dueTime'))

                    pending_tasks.append({
                        'source_id': f"classroom_{cw_id}",
                        'title': title,
                        'course_name': course_name,
                        'due_date': due_date,
                        'description': description,
                        'source': 'classroom',
                        'link': cw.get('alternateLink', ''),
                        'course_id': course_id,
                        'coursework_id': cw_id,
                        'submission_id': submission_id,
                        'submission_state': submission_state,
                    })
                    
            except Exception as e:
                print(f"Error verificando entrega para {title}: {e}")
                
    return pending_tasks

if __name__ == '__main__':
    print("Extrayendo tareas pendientes de Google Classroom...")
    tasks = fetch_pending_tasks()
    for t in tasks:
        print(f"- {t['title']} ({t['course_name']}) | Vence: {t['due_date']}")
    print(f"Total pendientes: {len(tasks)}")
