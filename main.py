"""
main.py  –  Auto Scheduler

Pipeline de sincronización (4 pasos, ver también
memory/classroom-calendar-sync-pipeline.md):
  1. Calendar → local:  se revisa Calendar primero. Confirma que los eventos
     guardados siguen vivos (si uno fue borrado a mano se limpia el registro
     local para que el Paso 3 lo re-cree) e importa las notas que el usuario
     escribió a mano en Google Calendar, por ejemplo desde el celular.
  2. Local → Classroom:  descarga las tareas pendientes actuales.
  3. Diff Classroom vs. local:  crea en Calendar solo lo que está en
     Classroom y no tiene ya un evento vivo en local; retira lo entregado.
  4. Refresca y reporta:  imprime el resumen y confirma "sincronización
     completa".
"""

import os
import sys

sys.path.append(os.path.dirname(__file__))
from modules import sync_pipeline


def _print_summary(summary: dict):
    print(f"\n① Calendar → local: {summary['calendar_checked']} eventos verificados, "
          f"{summary['calendar_scanned']} revisados en el calendario.")
    if summary['calendar_healed']:
        print(f"   🔧 {len(summary['calendar_healed'])} evento(s) borrados a mano en Calendar, marcados para re-crear:")
        for rec in summary['calendar_healed']:
            print(f"      · {rec['title']}")
    if summary['calendar_removed']:
        print(f"   🗑️  {len(summary['calendar_removed'])} nota(s) borradas desde Calendar, retiradas del tablero:")
        for rec in summary['calendar_removed']:
            print(f"      · {rec['title']}")
    if summary['calendar_imported']:
        print(f"   📥 {len(summary['calendar_imported'])} nota(s) nuevas traídas de Google Calendar:")
        for task in summary['calendar_imported']:
            print(f"      · {task['title']}")
    if summary['calendar_updated']:
        print(f"   🔄 {len(summary['calendar_updated'])} nota(s) actualizadas desde Calendar.")

    print(f"\n② Local → Classroom: {summary['classroom_total']} tareas pendientes encontradas.")

    if summary['completed']:
        print(f"\n③ 🧹 Limpiando {len(summary['completed'])} tareas entregadas/calificadas:")
        for rec in summary['completed']:
            print(f"      🗑️  Removiendo: {rec['title']}")

    if summary['skipped']:
        print(f"\n   ⏭️  Omitidas ({len(summary['skipped'])} tareas):")
        for task, reason in summary['skipped']:
            label = 'Sin fecha' if reason == 'sin_fecha' else 'Ya venció'
            print(f"      · [{label}] {task.get('course_name', '')} – {task['title']}")

    print(f"\n   ✔️  Ya sincronizadas, sin cambios: {summary['already_synced']}")

    if summary['synced']:
        print(f"\n③ 📌 Tareas nuevas sincronizadas a Calendar: {len(summary['synced'])}")
        for task in summary['synced']:
            print(f"      · {task.get('course_name', '')} – {task['title']}")
    else:
        print("\n③ 🎉 No hay tareas nuevas que sincronizar.")

    if summary['errors']:
        print(f"\n   ⚠️  {len(summary['errors'])} tarea(s) no se pudieron sincronizar.")

    print(f"\n④ ✅ {summary['message']}")


def main():
    print("=" * 55)
    print("        🗓️  AUTO SCHEDULER  –  Iniciando…")
    print("=" * 55)

    summary = sync_pipeline.run_full_sync()
    _print_summary(summary)

    print("=" * 55)


if __name__ == '__main__':
    main()
