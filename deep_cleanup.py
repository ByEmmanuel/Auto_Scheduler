"""
deep_cleanup.py  –  Busca y borra TODOS los eventos creados por Auto Scheduler
                    directamente en Google Calendar, sin depender de la BD local.
                    Busca eventos cuyo título contenga "ENTREGAR:".
"""

import os
import sys

sys.path.append(os.path.dirname(__file__))
from modules import db, calendar_sync


def deep_cleanup():
    print("🔍 Buscando TODOS los eventos de Auto Scheduler en Google Calendar...")
    
    service = calendar_sync.get_calendar_service()
    
    deleted = 0
    page_token = None
    
    while True:
        # Buscar eventos que contengan nuestro prefijo en el título
        events_result = service.events().list(
            calendarId='primary',
            q='ENTREGAR:',
            maxResults=250,
            pageToken=page_token,
            singleEvents=True,
        ).execute()
        
        events = events_result.get('items', [])
        
        if not events and page_token is None:
            print("   ℹ️  No se encontraron eventos de Auto Scheduler.")
            break
            
        for event in events:
            summary = event.get('summary', '')
            event_id = event['id']
            
            try:
                service.events().delete(calendarId='primary', eventId=event_id).execute()
                deleted += 1
                print(f"   🗑️  Borrado: {summary}")
            except Exception as e:
                print(f"   ⚠️  Error borrando '{summary}': {e}")
        
        page_token = events_result.get('nextPageToken')
        if not page_token:
            break
    
    # Limpiar la BD local también
    if os.path.exists(db.DB_PATH):
        db.clear_all()
    
    print(f"\n✅ Limpieza profunda completada.")
    print(f"   {deleted} eventos eliminados de Google Calendar.")
    print(f"   Base de datos local reseteada.")


if __name__ == '__main__':
    deep_cleanup()
