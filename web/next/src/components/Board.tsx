import { useDroppable } from '@dnd-kit/core'
import type { Group, Task } from '../types'
import { dayLabel } from '../lib/date'
import { XmasEmoji } from './Christmas'
import { IconAlert, IconCheck, IconInbox, IconPlus } from './Icons'
import { TaskCard } from './TaskCard'
import { Button, cx } from './ui'

/** Selección de varias atrasadas para completarlas de una vez. */
export interface Selection {
  active: boolean
  ids: Set<string>
  busy: boolean
  onStart: () => void
  onCancel: () => void
  onToggle: (task: Task) => void
  onToggleAll: (tasks: Task[]) => void
  onComplete: () => void
}

interface ColumnProps {
  group: Group
  dragging: boolean
  onOpen: (task: Task) => void
  onNotesSaved: (taskId: string, notes: string) => void
  onComplete: (task: Task) => void
  onAdd: (dateKey: string) => void
  selection?: Selection
}

function ColumnHeader({ group }: { group: Group }) {
  if (group.kind === 'overdue') {
    return (
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-lg bg-danger-soft text-danger">
          <IconAlert className="size-[18px]" />
        </span>
        <div className="min-w-0">
          <div className="text-[20px] leading-tight font-semibold tracking-tighter text-ink">
            Atrasadas <XmasEmoji emoji="🥶" className="text-[15px]" />
          </div>
          <div className="mt-0.5 text-[12.5px] text-ink-dim">Arrástralas a un día o complétalas</div>
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
          <div className="text-[20px] leading-tight font-semibold tracking-tighter text-ink">
            Sin fecha <XmasEmoji emoji="🧦" className="text-[15px]" />
          </div>
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
          'text-[22px] leading-tight font-semibold tracking-tighter',
          isToday ? 'text-accent' : 'text-ink',
        )}
      >
        {headline} <XmasEmoji seed={group.key} emoji={isToday ? '🎅' : undefined} className="text-[16px]" />
      </div>
      <div className="tnum mt-0.5 text-[13px] text-ink-dim first-letter:uppercase">{sub}</div>
    </div>
  )
}

function Column({ group, dragging, onOpen, onNotesSaved, onComplete, onAdd, selection }: ColumnProps) {
  const isDay = group.kind === 'day'
  const selecting = Boolean(selection?.active)
  const picked = selection ? group.tasks.filter((t) => selection.ids.has(t.id)).length : 0
  const allPicked = picked === group.tasks.length && picked > 0
  const { setNodeRef, isOver } = useDroppable({ id: `day:${group.key}`, disabled: !isDay })
  const isToday = isDay && dayLabel(group.key).isToday

  return (
    <section
      ref={setNodeRef}
      className={cx(
        isToday && 'as-today',
        'as-column flex h-full w-[286px] shrink-0 flex-col rounded-panel border transition-colors duration-200',
        isOver
          ? 'glass border-accent/70 bg-accent-soft'
          : dragging && isDay
            ? 'glass border-dashed border-line-strong'
            : isToday
              ? 'glass border-accent/45 shadow-[0_0_32px_-8px_rgba(127,180,255,0.45)]'
              : 'glass border-line',
      )}
    >
      <header className="flex items-start justify-between gap-2 px-4 pt-4 pb-3.5">
        <ColumnHeader group={group} />
        <span className="tnum rounded-full bg-sunken px-2 py-0.5 text-[12px] text-ink-dim">
          {selecting ? `${picked}/${group.tasks.length}` : group.tasks.length}
        </span>
      </header>

      {selection && group.tasks.length > 1 ? (
        <div className="-mt-1 flex items-center gap-1.5 px-3 pb-2.5">
          {selecting ? (
            <>
              <Button size="sm" variant="subtle" onClick={() => selection.onToggleAll(group.tasks)}>
                {allPicked ? 'Ninguna' : 'Todas'}
              </Button>
              <Button size="sm" variant="ghost" onClick={selection.onCancel} className="ml-auto">
                Cancelar
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={selection.onStart}>
              <IconCheck className="size-3.5" />
              Seleccionar varias
            </Button>
          )}
        </div>
      ) : null}

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
              onComplete={onComplete}
              selectable={selecting}
              checked={selection?.ids.has(task.id)}
              onToggle={selection?.onToggle}
            />
          </div>
        ))}

        {group.tasks.length === 0 ? (
          <p className="rounded-card border border-dashed border-line px-3 py-6 text-center text-[12px] text-ink-faint">
            {isOver ? 'Suelta aquí' : 'Sin tareas'}
          </p>
        ) : null}

        {selecting ? (
          <div className="sticky bottom-0 mt-auto -mx-3 -mb-3 border-t border-line glass-strong px-3 py-3">
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              disabled={picked === 0}
              loading={selection?.busy}
              onClick={selection?.onComplete}
            >
              {selection?.busy ? null : <IconCheck className="size-[18px]" />}
              {picked === 0
                ? 'Elige las que ya hiciste'
                : `Completar ${picked === 1 ? '1 tarea' : `${picked} tareas`}`}
            </Button>
          </div>
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
  onComplete: (task: Task) => void
  onAdd: (dateKey: string) => void
  /** Solo la columna de atrasadas permite seleccionar varias. */
  selection: Selection
}

export function Board({ groups, dragging, onOpen, onNotesSaved, onComplete, onAdd, selection }: BoardProps) {
  return (
    <div className="flex h-full gap-3 overflow-x-auto px-5 py-5">
      {groups.map((group) => (
        <Column
          key={group.key}
          group={group}
          dragging={dragging}
          onOpen={onOpen}
          onNotesSaved={onNotesSaved}
          onComplete={onComplete}
          onAdd={onAdd}
          selection={group.kind === 'overdue' ? selection : undefined}
        />
      ))}
      <div className="w-2 shrink-0" />
    </div>
  )
}

export function boardIsEmpty(groups: Group[]): boolean {
  return groups.every((g) => g.tasks.length === 0)
}
