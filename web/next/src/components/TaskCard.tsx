import { useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import type { Task } from '../types'
import { courseDotColor } from '../lib/course'
import { formatTime, isOverdue } from '../lib/date'
import { sourceLabel } from '../lib/source'
import { IconClock, IconGrip, IconNote } from './Icons'
import { NotesEditor } from './NotesEditor'
import { cx, Dot } from './ui'

interface Props {
  task: Task
  /** Si la tarjeta se puede arrastrar a otro día del tablero. */
  draggable?: boolean
  onOpen?: (task: Task) => void
  onNotesSaved?: (taskId: string, notes: string) => void
  /** Copia que sigue al cursor durante el arrastre. */
  overlay?: boolean
}

export function TaskCard({ task, draggable = false, onOpen, onNotesSaved, overlay }: Props) {
  const [editingNotes, setEditingNotes] = useState(false)
  const overdue = isOverdue(task.due_date)

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { task },
    disabled: !draggable || editingNotes || overlay,
  })

  const dragProps = draggable && !editingNotes && !overlay ? { ...listeners, ...attributes } : {}
  const noteFirstLine = task.notes?.trim().split('\n')[0] ?? ''

  return (
    <article
      ref={overlay ? undefined : setNodeRef}
      {...dragProps}
      onClick={() => {
        if (!editingNotes) onOpen?.(task)
      }}
      className={cx(
        'group relative rounded-card border bg-raised p-3 text-left transition-all duration-200',
        'border-line hover:border-line-strong',
        overlay ? 'shadow-drag w-[268px] rotate-[1.5deg] cursor-grabbing' : 'cursor-pointer',
        draggable && !editingNotes && !overlay && 'cursor-grab active:cursor-grabbing',
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
        <Dot color={courseDotColor(task.course)} />
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-dim">{task.course}</span>
        {draggable && !overlay ? (
          <IconGrip className="size-3.5 text-ink-faint opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
        ) : null}
      </div>

      <h3 className="mt-1.5 line-clamp-2 text-[13.5px] leading-snug font-medium text-ink">
        {task.title}
      </h3>

      {editingNotes ? (
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
        <span className="ml-auto">{sourceLabel(task.source)}</span>
      </div>
    </article>
  )
}
