"""
main.py  –  Auto Scheduler

Flujo al iniciar la PC:
  1. Inicializa la base de datos SQLite local.
  2. Extrae tareas pendientes de Google Classroom.
  3. Clasifica cada tarea:
       - Sin fecha                  → se omite (no podemos poner un recordatorio sin fecha)
       - Fecha vencida (ya pasó)    → se omite (ya era para antes)
       - Única en su día            → evento normal (azul, 3 alertas)
       - Varias en el mismo día     → evento URGENTE (rojo, 5 alertas)
  4. Crea en Google Calendar solo las tareas nuevas (las ya sincronizadas se ignoran).
  5. Muestra un resumen final.
"""

import os
import sys
import datetime
from collections import defaultdict

sys.path.append(os.path.dirname(__file__))
from modules import db, classroom_api, calendar_sync


# ── Zona horaria actual del usuario (UTC-6) ───────────────────────────────────
NOW_UTC = datetime.datetime.now(datetime.timezone.utc)


def classify_tasks(tasks: list[dict]) -> tuple[list, list, list]:
    """
    Divide las tareas en tres grupos:
      - to_sync   → lista de (task, is_urgent) listas para sincronizar
      - skipped   → omitidas (sin fecha o ya pasadas)
      - already   → ya registradas en la BD local

    La regla de urgencia se calcula SOLO sobre las tareas que van a sincronizarse
    (ignora las que ya están en BD para no reclasificar).
    """
    already   = []
    candidates = []   # tareas que sí van a sincronizarse
    skipped   = []

    for task in tasks:
        source_id = task['source_id']

        # ¿Ya sincronizada?
        if db.is_task_synced(source_id):
            already.append(task)
            continue

        due_str = task.get('due_date')

        # ¿Sin fecha?
        if not due_str:
            skipped.append((task, 'sin_fecha'))
            continue

        from dateutil import parser as dp
        due_dt = dp.isoparse(due_str)
        if due_dt.tzinfo is None:
            due_dt = due_dt.replace(tzinfo=datetime.timezone.utc)

        # ¿Ya venció?
        if due_dt < NOW_UTC:
            skipped.append((task, 'vencida'))
            continue

        candidates.append((task, due_dt))

    # ── Contar cuántas tareas hay por día (solo sobre candidatas) ─────────────
    tasks_per_day: dict[str, int] = defaultdict(int)
    for task, due_dt in candidates:
        day_key = due_dt.strftime('%Y-%m-%d')
        tasks_per_day[day_key] += 1

    # ── Asignar flag de urgencia ──────────────────────────────────────────────
    to_sync = []
    for task, due_dt in candidates:
        day_key = due_dt.strftime('%Y-%m-%d')
        is_urgent = tasks_per_day[day_key] > 1
        to_sync.append((task, is_urgent))

    return to_sync, skipped, already


def main():
    print("=" * 55)
    print("        🗓️  AUTO SCHEDULER  –  Iniciando…")
    print("=" * 55)

    # 1. Inicializar BD
    db.init_db()

    # 2. Extraer tareas de Classroom
    print("\n📡 Consultando Google Classroom…")
    all_tasks = classroom_api.fetch_pending_tasks()

    if not all_tasks:
        print("   ℹ️  No se encontraron tareas pendientes en Classroom.")
    else:
        print(f"   ✅ {len(all_tasks)} tareas pendientes encontradas.\n")

    # 3. Limpieza de tareas entregadas
    all_source_ids = {t['source_id'] for t in all_tasks}
    synced_records = db.get_all_synced()
    completed_tasks = []
    
    for rec in synced_records:
        if rec['source'] == 'classroom' and rec['source_id'] not in all_source_ids:
            completed_tasks.append(rec)
            
    if completed_tasks:
        print(f"🧹 Limpiando {len(completed_tasks)} tareas entregadas/calificadas:")
        for rec in completed_tasks:
            print(f"   🗑️  Removiendo: {rec['title']}")
            if rec.get('calendar_event_id'):
                calendar_sync.delete_calendar_event(rec['calendar_event_id'])
            db.delete_task(rec['source_id'])
        print()

    # 4. Clasificar
    to_sync, skipped, already = classify_tasks(all_tasks)

    # ── Reporte de omitidas ───────────────────────────────────────────────────
    if skipped:
        print(f"⏭️  Omitidas ({len(skipped)} tareas):")
        for task, reason in skipped:
            label = 'Sin fecha' if reason == 'sin_fecha' else 'Ya venció'
            print(f"   · [{label}] {task.get('course_name','')} – {task['title']}")

    if already:
        print(f"\n✔️  Ya en calendario ({len(already)} tareas), sin cambios.")

    # 4. Sincronizar
    if not to_sync:
        print("\n🎉 Todo al día. No hay tareas nuevas que sincronizar.")
    else:
        normal  = [(t, u) for t, u in to_sync if not u]
        urgent  = [(t, u) for t, u in to_sync if u]

        print(f"\n📌 Tareas a sincronizar: {len(to_sync)}")
        if urgent:
            print(f"   🔴 Urgentes (días con múltiples tareas): {len(urgent)}")
        if normal:
            print(f"   🔵 Normales: {len(normal)}\n")

        synced_count = 0
        for task, is_urgent in to_sync:
            status = "🔴 URGENTE" if is_urgent else "🔵 Normal "
            print(f"  {status} | {task.get('course_name','')} – {task['title']}")

            event_id = calendar_sync.add_task_to_calendar(task, is_urgent=is_urgent)

            if event_id:
                db.mark_task_as_synced(
                    source_id        = task['source_id'],
                    title            = task['title'],
                    course_name      = task.get('course_name', ''),
                    due_date         = task.get('due_date'),
                    source           = task.get('source', 'classroom'),
                    calendar_event_id= event_id,
                    is_urgent        = is_urgent,
                    link             = task.get('link', ''),
                    description      = task.get('description', ''),
                )
                synced_count += 1
            else:
                print(f"     ⚠️  No se pudo sincronizar esta tarea.")

        print(f"\n{'='*55}")
        print(f"  ✅ Proceso completado. {synced_count}/{len(to_sync)} tareas sincronizadas.")

    print("=" * 55)


if __name__ == '__main__':
    main()
