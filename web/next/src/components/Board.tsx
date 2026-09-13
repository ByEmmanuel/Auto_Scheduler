import { useDroppable } from '@dnd-kit/core'
import type { Group, Task } from '../types'
import { dayLabel } from '../lib/date'
import { IconAlert, IconInbox, IconPlus } from './Icons'
import { TaskCard } from './TaskCard'
import { cx } from './ui'

interface ColumnProps {
  group: Group
  dragging: boolean
  onOpen: (task: Task) => void
  onNotesSaved: (taskId: string, notes: string) => void
  onAdd: (dateKey: string) => void
}

function ColumnHeader({ group }: { group: Group }) {
  if (group.kind === 'overdue') {
    return (
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-lg bg-danger-soft text-danger">
          <IconAlert className="size-[18px]" />
        </span>
        <div className="min-w-0">
          <div className="text-[18px] leading-tight font-semibold text-ink">Atrasadas</div>
          <div className="mt-0.5 text-[12.5px] text-ink-dim">Arrástralas a un día</div>
        </div>
      </div>
    )
  }

  if (group.kind === 'undated') {
    return (
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-lg bg-sunken text-ink-faint">
          <IconInbox className="size-[18px]" />
        </span>
        <div>
          <div className="text-[18px] leading-tight font-semibold text-ink">Sin fecha</div>
          <div className="mt-0.5 text-[12.5px] text-ink-dim">Arrástralas a un día</div>
        </div>
      </div>
    )
  }

  const { headline, sub, isToday } = dayLabel(group.key)

  return (
    <div className="min-w-0">
      <div
        className={cx(
          'text-[20px] leading-tight font-semibold tracking-tight',
          isToday ? 'text-accent' : 'text-ink',
        )}
      >
        {headline}
      </div>
      <div className="tnum mt-0.5 text-[13px] text-ink-dim first-letter:uppercase">{sub}</div>
    </div>
  )
}

function Column({ group, dragging, onOpen, onNotesSaved, onAdd }: ColumnProps) {
  const isDay = group.kind === 'day'
  const { setNodeRef, isOver } = useDroppable({ id: `day:${group.key}`, disabled: !isDay })
  const isToday = isDay && dayLabel(group.key).isToday

  return (
    <section
      ref={setNodeRef}
      className={cx(
        'flex h-full w-[286px] shrink-0 flex-col rounded-panel border transition-colors duration-200',
        isOver
          ? 'border-accent/60 bg-accent-soft'
          : dragging && isDay
            ? 'border-dashed border-line-strong bg-surface/60'
            : isToday
              ? 'border-accent/35 bg-surface'
              : 'border-line bg-surface',
      )}
    >
      <header className="flex items-start justify-between gap-2 px-4 pt-4 pb-3.5">
        <ColumnHeader group={group} />
        <span className="tnum rounded-full bg-sunken px-2 py-0.5 text-[12px] text-ink-dim">
          {group.tasks.length}
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3">
        {group.tasks.map((task, i) => (
          <div key={task.id} className="anim-fade-up" style={{ animationDelay: `${i * 0.025}s` }}>
            {/* Todas las tarjetas se arrastran, estén en la columna que estén:
                si solo se pudiera mover lo atrasado, soltar una tarea en un día
                la dejaría clavada ahí, sin forma de deshacer el movimiento ni de
                volver a cambiarla de día. */}
            <TaskCard
              task={task}
              draggable
              onOpen={onOpen}
              onNotesSaved={onNotesSaved}
            />
          </div>
        ))}

        {group.tasks.length === 0 ? (
          <p className="rounded-card border border-dashed border-line px-3 py-6 text-center text-[12px] text-ink-faint">
            {isOver ? 'Suelta aquí' : 'Sin tareas'}
          </p>
        ) : null}

        {isDay ? (
          <button
            type="button"
            onClick={() => onAdd(group.key)}
            className={cx(
              'mt-auto flex items-center justify-center gap-1.5 rounded-card border border-dashed border-line',
              'px-3 py-2 text-[12px] text-ink-faint transition-colors duration-150',
              'hover:border-line-strong hover:text-ink-dim',
            )}
          >
            <IconPlus className="size-3.5" />
            Recordatorio
          </button>
        ) : null}
      </div>
    </section>
  )
}

interface BoardProps {
  groups: Group[]
  dragging: boolean
  onOpen: (task: Task) => void
  onNotesSaved: (taskId: string, notes: string) => void
  onAdd: (dateKey: string) => void
}

export function Board({ groups, dragging, onOpen, onNotesSaved, onAdd }: BoardProps) {
  return (
    <div className="flex h-full gap-3 overflow-x-auto px-5 py-5">
      {groups.map((group) => (
        <Column
          key={group.key}
          group={group}
          dragging={dragging}
          onOpen={onOpen}
          onNotesSaved={onNotesSaved}
          onAdd={onAdd}
        />
      ))}
      <div className="w-2 shrink-0" />
    </div>
  )
}

export function boardIsEmpty(groups: Group[]): boolean {
  return groups.every((g) => g.tasks.length === 0)
}
