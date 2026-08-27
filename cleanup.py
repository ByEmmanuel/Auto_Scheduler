"""
cleanup.py  –  Borra todos los eventos del calendario que están en la BD local
               y resetea la tabla de tareas sincronizadas.
"""

import os
import sys

sys.path.append(os.path.dirname(__file__))
from modules import db, calendar_sync


def cleanup():
    print("🧹 Iniciando limpieza...")

    if not os.path.exists(db.DB_PATH):
        print("   ℹ️  La base de datos no existe. No hay nada que limpiar.")
        return

    records = db.get_all_synced()
    if not records:
        print("   ℹ️  La base de datos está vacía. Nada que borrar.")
        return

    deleted = 0
    errors  = 0
    for rec in records:
        event_id = rec.get('calendar_event_id')
        if event_id:
            success = calendar_sync.delete_calendar_event(event_id)
            if success:
                deleted += 1
                print(f"   🗑️  Borrado: {rec['title']}")
            else:
                errors += 1

    db.clear_all()
    print(f"\n✅ Limpieza completada.")
    print(f"   Eventos borrados de Calendar: {deleted}")
    if errors:
        print(f"   Eventos con error (ya no existían): {errors}")
    print(f"   Base de datos reseteada.")


if __name__ == '__main__':
    cleanup()
