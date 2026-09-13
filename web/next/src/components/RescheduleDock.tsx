import { useDroppable } from '@dnd-kit/core'
import { addDaysToKey, formatShortDate, todayKey } from '../lib/date'
import { cx } from './ui'

/**
 * Atajos de reprogramación que aparecen mientras se arrastra una tarea.
 *
 * El tablero solo tiene columna para los días que ya tienen tareas, así que sin
 * esto sería imposible mover algo a, por ejemplo, "dentro de una semana" si ese
 * día está vacío. Los ids llevan prefijo `dock:` para no chocar con los
 * droppables de las columnas (`day:`), que pueden ser la misma fecha.
 */
function DockTarget({ label, dateKey }: { label: string; dateKey: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: `dock:${dateKey}` })

  return (
    <div
      ref={setNodeRef}
      className={cx(
        'flex min-w-[104px] flex-col items-center gap-0.5 rounded-xl border px-4 py-2.5 transition-all duration-150',
        isOver
          ? 'border-accent/60 bg-accent-soft text-accent-ink scale-105'
          : 'border-line bg-raised text-ink-dim',
      )}
    >
      <span className="text-[12.5px] font-medium">{label}</span>
      <span className="text-[11px] text-ink-faint capitalize">{formatShortDate(dateKey)}</span>
    </div>
  )
}

export function RescheduleDock({ visible }: { visible: boolean }) {
  if (!visible) return null

  const today = todayKey()

  return (
    <div className="anim-pop pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-line bg-surface/85 p-2 shadow-panel backdrop-blur-xl">
        <span className="px-2 text-[11px] tracking-[0.08em] text-ink-faint uppercase">
          Mover a
        </span>
        <DockTarget label="Hoy" dateKey={today} />
        <DockTarget label="Mañana" dateKey={addDaysToKey(today, 1)} />
        <DockTarget label="En 3 días" dateKey={addDaysToKey(today, 3)} />
        <DockTarget label="Próxima semana" dateKey={addDaysToKey(today, 7)} />
      </div>
    </div>
  )
}
