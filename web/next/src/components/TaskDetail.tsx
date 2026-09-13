import { useEffect, useState } from 'react'
import type { Task } from '../types'
import { courseDotColor } from '../lib/course'
import { formatFull, isOverdue, keyOfIso, timeOfDay } from '../lib/date'
import { sourceLabel } from '../lib/source'
import { IconCheck, IconClose, IconLink, IconTrash } from './Icons'
import { NotesEditor } from './NotesEditor'
import { Button, cx, Dot, Label } from './ui'

const URL_SPLIT = /(https?:\/\/[^\s]+)/g
// Prueba sin bandera /g: `test` sobre una regex global va moviendo lastIndex y
// devolvería falsos negativos alternados dentro del map.
const IS_URL = /^https?:\/\//

/** Renderiza texto plano convirtiendo las URLs en enlaces (sin innerHTML). */
function Linkified({ text }: { text: string }) {
  return (
    <>
      {text.split(URL_SPLIT).map((part, i) =>
        IS_URL.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-ink underline underline-offset-2 hover:opacity-80"
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  )
}

interface Props {
  task: Task
  onClose: () => void
  onNotesSaved: (taskId: string, notes: string) => void
  onComplete: (task: Task) => Promise<void>
  onDelete: (task: Task) => Promise<void>
  onReschedule: (task: Task, date: string, time: string) => Promise<void>
}

/**
 * Detalle de una tarea, como diálogo centrado (no como panel lateral): al
 * abrirlo la atención se queda donde ya estaba mirando el usuario, en el
 * centro de la pantalla, en vez de saltar a una orilla.
 */
export function TaskDetail({
  task,
  onClose,
  onNotesSaved,
  onComplete,
  onDelete,
  onReschedule,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState<'complete' | 'delete' | 'move' | null>(null)

  const [date, setDate] = useState(() => keyOfIso(task.due_date))
  const [time, setTime] = useState(() => timeOfDay(task.due_date))

  useEffect(() => {
    setDate(keyOfIso(task.due_date))
    setTime(timeOfDay(task.due_date))
    setExpanded(false)
    setConfirmDelete(false)
  }, [task.id, task.due_date])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const overdue = isOverdue(task.due_date)
  const moved = date !== keyOfIso(task.due_date) || time !== timeOfDay(task.due_date)
  const longDescription = (task.description ?? '').length > 320

  const fieldCls =
    'h-10 rounded-lg border border-line bg-sunken px-3 text-[13.5px] text-ink outline-none transition-colors focus:border-accent/50'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center">
      <div
        className="anim-fade-in absolute inset-0 bg-black/40 backdrop-blur-[3px]"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={task.title}
        className="anim-pop relative flex max-h-[88vh] w-full max-w-[600px] flex-col overflow-hidden rounded-panel border border-line bg-surface shadow-panel"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-6 pt-5 pb-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {overdue ? (
                <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[11.5px] font-medium text-danger">
                  Atrasada
                </span>
              ) : task.is_urgent ? (
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-medium text-accent-ink">
                  Día ocupado
                </span>
              ) : null}
              <span className="rounded-full bg-sunken px-2 py-0.5 text-[11.5px] text-ink-dim">
                {sourceLabel(task.source)}
              </span>
            </div>
            <h2 className="text-[19px] leading-snug font-semibold text-balance text-ink">
              {task.title}
            </h2>
            <div className="mt-1.5 flex items-center gap-1.5 text-[13px] text-ink-dim">
              <Dot color={courseDotColor(task.course)} />
              {task.course}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-lg p-2 text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
          >
            <IconClose className="size-[18px]" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {/* ── Fecha límite / reprogramar ───────────────────────────────── */}
          <section>
            <Label>Fecha límite</Label>
            <p className="mb-2.5 text-[15px] font-medium text-ink first-letter:uppercase">
              {formatFull(task.due_date)}
            </p>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={cx(fieldCls, 'flex-1')}
              />
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className={cx(fieldCls, 'tnum w-[132px]')}
              />
              <Button
                variant={moved ? 'primary' : 'subtle'}
                size="lg"
                disabled={!moved}
                loading={busy === 'move'}
                onClick={async () => {
                  setBusy('move')
                  try {
                    await onReschedule(task, date, time)
                  } finally {
                    setBusy(null)
                  }
                }}
              >
                Mover
              </Button>
            </div>
          </section>

          {/* ── Notas ─────────────────────────────────────────────────────── */}
          <section>
            <Label>Mis notas</Label>
            <NotesEditor
              key={task.id}
              taskId={task.id}
              initialNotes={task.notes}
              onSaved={(notes) => onNotesSaved(task.id, notes)}
              placeholder="Se guarda solo mientras escribes y se copia al evento de Calendar…"
            />
          </section>

          {/* ── Descripción ───────────────────────────────────────────────── */}
          {task.description?.trim() ? (
            <section>
              <Label>Descripción</Label>
              <div
                className={cx(
                  'rounded-card border border-line bg-sunken px-3 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap text-ink-dim',
                  longDescription && !expanded && 'line-clamp-6',
                )}
              >
                <Linkified text={task.description} />
              </div>
              {longDescription ? (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="mt-1.5 text-[12.5px] text-accent-ink hover:opacity-80"
                >
                  {expanded ? 'Ver menos' : 'Ver más'}
                </button>
              ) : null}
            </section>
          ) : null}

          {task.link ? (
            <a
              href={task.link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-card border border-line px-3 py-2.5 text-[13.5px] text-ink transition-colors hover:border-line-strong"
            >
              <IconLink className="size-4 text-ink-faint" />
              Abrir en Classroom
            </a>
          ) : null}
        </div>

        <footer className="flex items-center gap-2 border-t border-line px-6 py-4">
          <Button
            variant="primary"
            size="lg"
            className="flex-1"
            loading={busy === 'complete'}
            onClick={async () => {
              setBusy('complete')
              try {
                await onComplete(task)
              } finally {
                setBusy(null)
              }
            }}
          >
            <IconCheck className="size-[18px]" />
            Completar
          </Button>

          {task.source === 'manual' ? (
            confirmDelete ? (
              <div className="flex items-center gap-1.5">
                <Button
                  variant="danger"
                  size="lg"
                  loading={busy === 'delete'}
                  onClick={async () => {
                    setBusy('delete')
                    try {
                      await onDelete(task)
                    } finally {
                      setBusy(null)
                    }
                  }}
                >
                  Sí, eliminar
                </Button>
                <Button variant="ghost" size="lg" onClick={() => setConfirmDelete(false)}>
                  No
                </Button>
              </div>
            ) : (
              <Button variant="ghost" size="lg" onClick={() => setConfirmDelete(true)}>
                <IconTrash className="size-[18px]" />
                Eliminar
              </Button>
            )
          ) : null}
        </footer>
      </div>
    </div>
  )
}
