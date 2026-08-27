import argparse
import sys
import uuid
from dateutil import parser
import datetime
import os

# Asegurar que se puedan importar los módulos
sys.path.append(os.path.dirname(__file__))
from modules import db, calendar_sync

def add_manual_task(title, course, date_str, notes):
    db.init_db()
    try:
        # Intentar parsear la fecha
        due_date = parser.parse(date_str)
        
        # Si la fecha no tiene hora explícita, le asignamos las 23:59 por defecto
        if due_date.hour == 0 and due_date.minute == 0:
            due_date = due_date.replace(hour=23, minute=59)
            
        due_date_iso = due_date.isoformat()
    except Exception as e:
        print(f"Error: No se pudo entender la fecha '{date_str}'. Usa un formato como '2026-09-10' o '2026-09-10 15:00'.")
        return

    source_id = f"manual_{uuid.uuid4().hex[:8]}"
    
    task = {
        'source_id': source_id,
        'title': title,
        'course_name': course,
        'due_date': due_date_iso,
        'description': notes,
        'source': 'manual'
    }
    
    print(f"Sincronizando '{title}' al calendario...")
    event_id = calendar_sync.add_task_to_calendar(task)
    
    if event_id:
        db.mark_task_as_synced(source_id, title, course, due_date_iso, 'manual', event_id)
        print(f"✅ Tarea guardada y sincronizada exitosamente.")
    else:
        print("❌ Hubo un problema sincronizando al calendario.")

if __name__ == '__main__':
    arg_parser = argparse.ArgumentParser(description="Añadir tarea manualmente al Auto Scheduler")
    arg_parser.add_argument("titulo", help="Nombre de la tarea")
    arg_parser.add_argument("materia", help="Nombre de la materia")
    arg_parser.add_argument("fecha", help="Fecha de entrega (ej. '2026-09-10' o '2026-09-10 15:00')")
    arg_parser.add_argument("notas", nargs="?", default="", help="Notas adicionales (opcional)")
    
    args = arg_parser.parse_args()
    
    add_manual_task(args.titulo, args.materia, args.fecha, args.notas)
