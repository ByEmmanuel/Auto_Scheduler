import { useEffect, useState } from 'react'
import type { Task } from '../types'
import { api } from '../lib/api'
import { courseDotColor } from '../lib/course'
import { formatFull } from '../lib/date'
import { IconClose, IconUndo } from './Icons'
import { Button, Dot, Spinner } from './ui'

interface Props {
  onClose: () => void
  onRestored: () => void
  onError: (message: string) => void
}

/** Historial de tareas completadas, como diálogo centrado igual que el detalle. */
export function HistoryDialog({ onClose, onRestored, onError }: Props) {
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function load() {
    try {
      const data = await api.completed()
      setTasks(data.tasks)
    } catch (e) {
      setTasks([])
      onError(e instanceof Error ? e.message : 'No se pudo cargar el historial')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center">
      <div
        className="anim-fade-in absolute inset-0 bg-black/40 backdrop-blur-[3px]"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Historial de tareas completadas"
        className="anim-pop relative flex max-h-[88vh] w-full max-w-[560px] flex-col overflow-hidden rounded-panel border border-line bg-surface shadow-panel"
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-6 py-4">
          <div>
            <h2 className="text-[18px] leading-tight font-semibold text-ink">Historial</h2>
            <p className="mt-0.5 text-[12.5px] text-ink-dim">Tareas y notas completadas</p>
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

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {tasks === null ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-ink-faint">
              <Spinner /> Cargando…
            </div>
          ) : tasks.length === 0 ? (
            <p className="py-12 text-center text-[13px] text-ink-faint">
              Todavía no hay nada completado.
            </p>
          ) : (
            <ul className="space-y-2">
              {tasks.map((task) => (
                <li
                  key={task.id}
                  className="rounded-card border border-line bg-raised px-3.5 py-3 transition-colors hover:border-line-strong"
                >
                  <div className="flex items-center gap-1.5 text-[11.5px] text-ink-dim">
                    <Dot color={courseDotColor(task.course)} />
                    <span className="truncate">{task.course}</span>
                    <span className="ml-auto shrink-0 text-ink-faint">
                      {task.source === 'classroom' ? 'Classroom' : 'Manual'}
                    </span>
                  </div>

                  <p className="mt-1 text-[13.5px] leading-snug font-medium text-ink line-through decoration-ink-faint/60">
                    {task.title}
                  </p>
                  <p className="mt-1 text-[11.5px] text-ink-faint first-letter:uppercase">
                    {formatFull(task.due_date)}
                  </p>

                  {task.source !== 'classroom' ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-2"
                      loading={busyId === task.id}
                      onClick={async () => {
                        setBusyId(task.id)
                        try {
                          await api.setStatus(task.id, 'pending')
                          await load()
                          onRestored()
                        } catch (e) {
                          onError(e instanceof Error ? e.message : 'No se pudo restaurar')
                        } finally {
                          setBusyId(null)
                        }
                      }}
                    >
                      <IconUndo className="size-3.5" />
                      Devolver a pendientes
                    </Button>
                  ) : (
                    <p className="mt-2 text-[11.5px] text-ink-faint italic">
                      Entregada en Classroom
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
