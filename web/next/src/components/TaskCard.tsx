import { useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import type { Task } from '../types'
import { courseDotColor } from '../lib/course'
import { formatTime, isOverdue } from '../lib/date'
import { sourceLabel } from '../lib/source'
import { inSeries } from '../lib/series'
import { IconCheck, IconClock, IconGrip, IconNote, IconRepeat } from './Icons'
import { NotesEditor } from './NotesEditor'
import { XmasEmoji } from './Christmas'
import { cx, Dot } from './ui'

interface Props {
  task: Task
  /** Si la tarjeta se puede arrastrar a otro día del tablero. */
  draggable?: boolean
  onOpen?: (task: Task) => void
  onNotesSaved?: (taskId: string, notes: string) => void
  /** Completar sin abrir el detalle (botón que aparece al pasar el cursor). */
  onComplete?: (task: Task) => void
  /** Copia que sigue al cursor durante el arrastre. */
  overlay?: boolean
  /**
   * Modo selección (completar varias): el clic marca la tarjeta en vez de
   * abrirla, y no se arrastra ni se editan notas.
   */
  selectable?: boolean
  checked?: boolean
  onToggle?: (task: Task) => void
}

export function TaskCard({
  task,
  draggable = false,
  onOpen,
  onNotesSaved,
  onComplete,
  overlay,
  selectable = false,
  checked = false,
  onToggle,
}: Props) {
  const [editingNotes, setEditingNotes] = useState(false)
  const overdue = isOverdue(task.due_date)
  const canDrag = draggable && !editingNotes && !overlay && !selectable

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { task },
    disabled: !canDrag,
  })

  const dragProps = canDrag ? { ...listeners, ...attributes } : {}
  const noteFirstLine = task.notes?.trim().split('\n')[0] ?? ''

  return (
    <article
      ref={overlay ? undefined : setNodeRef}
      {...dragProps}
      {...(selectable ? { role: 'checkbox', 'aria-checked': checked, tabIndex: 0 } : {})}
      onClick={() => {
        if (selectable) onToggle?.(task)
        else if (!editingNotes) onOpen?.(task)
      }}
      onKeyDown={(e) => {
        if (selectable && (e.key === ' ' || e.key === 'Enter')) {
          e.preventDefault()
          onToggle?.(task)
        }
      }}
      className={cx(
        'group relative rounded-card border bg-raised p-3 text-left transition-all duration-200',
        checked
          ? 'border-accent/70 bg-accent-soft'
          : 'border-line hover:border-line-strong hover:bg-[rgba(24,24,30,0.82)]',
        overlay ? 'shadow-drag w-[268px] rotate-[1.5deg] cursor-grabbing' : 'cursor-pointer',
        canDrag && 'cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-35',
      )}
    >
      {/* Barra de estado: rojo si ya venció, acento si es urgente. */}
      {(overdue || task.is_urgent) && (
        <span
          aria-hidden
          className={cx(
            'absolute top-3 bottom-3 left-0 w-[2px] rounded-full',
            overdue ? 'bg-danger' : 'bg-accent',
          )}
        />
      )}

      <div className="flex items-center gap-1.5">
        {selectable ? (
          <span
            aria-hidden
            className={cx(
              'grid size-[18px] shrink-0 place-items-center rounded-md border transition-colors duration-150',
              checked ? 'border-white bg-white text-black' : 'border-line-strong text-transparent',
            )}
          >
            <IconCheck className="size-3" />
          </span>
        ) : (
          <Dot color={courseDotColor(task.course)} />
        )}
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-dim">{task.course}</span>
        {onComplete && !overlay && !selectable ? (
          <button
            type="button"
            aria-label={`Completar «${task.title}»`}
            title="Completar"
            onClick={(e) => {
              e.stopPropagation()
              onComplete(task)
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className={cx(
              'grid size-5 place-items-center rounded-full border border-line-strong text-transparent',
              'opacity-0 transition-all duration-150 group-hover:opacity-100 focus-visible:opacity-100',
              'hover:border-ok hover:bg-ok hover:text-black',
            )}
          >
            <IconCheck className="size-3" />
          </button>
        ) : null}
        {canDrag ? (
          <IconGrip className="size-3.5 text-ink-faint opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
        ) : null}
        <XmasEmoji seed={task.id} className="text-[13px] leading-none" />
      </div>

      <h3 className="mt-1.5 line-clamp-2 text-[13.5px] leading-snug font-medium text-ink">
        {task.title}
      </h3>

      {selectable ? (
        noteFirstLine ? (
          <p className="mt-2 flex items-center gap-1.5 px-1.5 text-[11.5px] text-ink-dim">
            <IconNote className="size-3 shrink-0" />
            <span className="truncate">{noteFirstLine}</span>
          </p>
        ) : null
      ) : editingNotes ? (
        <div className="mt-2.5" onClick={(e) => e.stopPropagation()}>
          <NotesEditor
            key={task.id}
            taskId={task.id}
            initialNotes={task.notes}
            autoFocus
            compact
            onSaved={(notes) => onNotesSaved?.(task.id, notes)}
            onClose={() => setEditingNotes(false)}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setEditingNotes(true)
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className={cx(
            'mt-2 flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11.5px]',
            'transition-colors duration-150 hover:bg-sunken',
            noteFirstLine
              ? 'text-ink-dim'
              : 'text-ink-faint opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
          )}
        >
          <IconNote className="size-3 shrink-0" />
          <span className="truncate">{noteFirstLine || 'Añadir nota'}</span>
        </button>
      )}

      <div className="mt-2 flex items-center gap-1.5 text-[11.5px] text-ink-faint">
        <IconClock className="size-3" />
        <span className="tnum">{formatTime(task.due_date)}</span>
        {inSeries(task) ? (
          <span className="flex items-center gap-1" title="Se repite">
            <IconRepeat className="size-3" />
          </span>
        ) : null}
        <span className="ml-auto">{sourceLabel(task.source)}</span>
      </div>
    </article>
  )
}
