import { useEffect, useMemo, useState } from 'react'
import type { Task } from '../types'
import { api } from '../lib/api'
import { courseDotColor } from '../lib/course'
import { daysFromToday, formatShortDate, keyOfIso, todayKey } from '../lib/date'
import { christmasKey } from '../lib/season'
import { sourceLabel } from '../lib/source'
import { IconClose } from './Icons'
import { Spinner } from './ui'

interface Props {
  tasks: Task[]
  overdue: number
  onClose: () => void
  onError: (message: string) => void
}

/** Filas de esferas: 2 arriba y una más en cada fila, de la punta a la base. */
const ROWS = 15
const CAPACITY = (ROWS * (ROWS + 3)) / 2

/** Número estable por tarea: la esfera no cambia de sitio entre aperturas. */
function seedOf(id: string): number {
  return [...id].reduce((sum, ch) => (sum * 31 + ch.codePointAt(0)!) >>> 0, 7)
}

/**
 * Sitio de cada esfera sobre el árbol. La n-ésima tarea siempre cae en el mismo
 * lugar, de modo que el árbol se llena de arriba abajo conforme se termina
 * trabajo y las esferas ya colgadas no se mueven.
 */
function ornamentSpot(index: number, seed: number): { x: number; y: number } {
  let row = 0
  let start = 0
  while (index >= start + row + 2) {
    start += row + 2
    row += 1
  }
  const slots = row + 2
  const halfWidth = 16 + row * 8
  const t = (index - start + 0.5) / slots
  return {
    x: 170 - halfWidth + t * 2 * halfWidth + ((seed % 7) - 3),
    y: 74 + row * 19 + ((seed >> 3) % 7) - 3,
  }
}

/**
 * "Mi árbol": cada tarea terminada es una esfera del color de su materia, y la
 * estrella solo se enciende sin atrasadas. Convierte el historial en algo que
 * da gusto llenar y deja a la vista cuánto falta para las vacaciones.
 */
export function TreeDialog({ tasks, overdue, onClose, onError }: Props) {
  const [done, setDone] = useState<Task[] | null>(null)
  const [hovered, setHovered] = useState<Task | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .completed()
      .then((data) => {
        // Las más antiguas primero: las nuevas se cuelgan más abajo.
        const oldestFirst = [...data.tasks].sort((a, b) => a.due_date.localeCompare(b.due_date))
        if (!cancelled) setDone(oldestFirst)
      })
      .catch((e) => {
        if (cancelled) return
        setDone([])
        onError(e instanceof Error ? e.message : 'No se pudo cargar el árbol')
      })
    return () => {
      cancelled = true
    }
  }, [onError])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const beforeChristmas = useMemo(() => {
    const today = todayKey()
    const christmas = christmasKey()
    return tasks
      .filter((t) => {
        if (!t.due_date) return false
        const key = keyOfIso(t.due_date)
        return key >= today && key < christmas
      })
      .sort((a, b) => a.due_date.localeCompare(b.due_date))
  }, [tasks])

  const daysLeft = daysFromToday(christmasKey())
  const last = beforeChristmas.at(-1)
  const lit = overdue === 0
  const shown = done?.slice(-CAPACITY) ?? []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="anim-fade-in absolute inset-0 bg-black/60" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Mi árbol de logros"
        className="glass-strong anim-pop relative grid max-h-[90dvh] w-full max-w-[820px] overflow-y-auto rounded-[1.75rem] border border-line-strong shadow-panel md:grid-cols-[1fr_300px]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute top-4 right-4 z-10 rounded-full p-2 text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
        >
          <IconClose className="size-5" />
        </button>

        <div className="relative flex min-h-[420px] items-center justify-center px-4 pt-6 pb-4">
          {done === null ? (
            <Spinner className="size-5" />
          ) : (
            <svg viewBox="0 0 340 420" className="h-full max-h-[64dvh] w-full">
              <title>Árbol con una esfera por cada tarea terminada</title>
              <rect x="155" y="362" width="30" height="36" rx="3" fill="#7a4e30" />
              <path d="M170 40 310 366Q170 392 30 366Z" fill="#105c33" />
              <path d="M170 40 262 256Q170 276 78 256Z" fill="#167a45" />
              <path d="M170 40 222 158Q170 170 118 158Z" fill="#1f9457" />
              <path
                d="M110 180q60 30 120 0M72 270q98 46 196 0"
                fill="none"
                stroke="#ffd166"
                strokeOpacity=".45"
                strokeWidth="2"
                strokeDasharray="1 7"
                strokeLinecap="round"
              />

              {shown.map((task, i) => {
                const seed = seedOf(task.id)
                const { x, y } = ornamentSpot(i, seed)
                return (
                  <circle
                    key={task.id}
                    cx={x}
                    cy={y}
                    r="6.5"
                    fill={courseDotColor(task.course)}
                    stroke="#fff"
                    strokeOpacity=".55"
                    className="as-ornament cursor-pointer"
                    onMouseEnter={() => setHovered(task)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <title>{task.title}</title>
                  </circle>
                )
              })}

              <path
                d="m170 8 8.2 18.8 20.4 1.9-15.4 13.5 4.5 20L170 51.8l-17.7 10.4 4.5-20-15.4-13.5 20.4-1.9Z"
                fill={lit ? '#ffd166' : '#5b5b63'}
                className={lit ? 'as-star-lit' : undefined}
              />
            </svg>
          )}
        </div>

        <div className="flex flex-col gap-5 border-t border-line p-6 md:border-t-0 md:border-l md:pt-10">
          <header className="pr-8">
            <h2 className="text-3xl leading-tight font-semibold tracking-tighter text-white">Mi árbol</h2>
            <p className="mt-1.5 text-[14px] leading-snug text-ink-dim">
              Cada esfera es una tarea terminada, del color de su materia.
            </p>
          </header>

          <div>
            <div className="tnum text-[44px] leading-none font-semibold tracking-tighter text-white">
              {done?.length ?? '–'}
            </div>
            <div className="mt-1 text-[13.5px] text-ink-dim">esferas colgadas</div>
          </div>

          <p className={lit ? 'text-[14px] leading-snug text-[#ffd166]' : 'text-[14px] leading-snug text-ink-dim'}>
            {lit
              ? 'La estrella brilla: no tienes nada atrasado.'
              : `Pon al día ${overdue === 1 ? 'tu atrasada' : `tus ${overdue} atrasadas`} para encender la estrella.`}
          </p>

          {daysLeft >= 0 ? (
            <div className="rounded-card border border-line bg-sunken px-4 py-3">
              <div className="text-[13.5px] font-medium text-ink">
                {daysLeft === 0 ? '¡Hoy es Navidad!' : `Faltan ${daysLeft} ${daysLeft === 1 ? 'día' : 'días'} para Navidad`}
              </div>
              <div className="mt-1 text-[13px] leading-snug text-ink-dim">
                {last
                  ? `${beforeChristmas.length} ${beforeChristmas.length === 1 ? 'pendiente' : 'pendientes'} antes. La última: ${formatShortDate(keyOfIso(last.due_date))}.`
                  : 'Nada pendiente antes de Navidad.'}
              </div>
            </div>
          ) : null}

          <p className="mt-auto min-h-10 text-[13px] leading-snug text-ink-faint">
            {hovered ? `${hovered.title} · ${sourceLabel(hovered.source)}` : 'Pasa el cursor por una esfera para ver su tarea.'}
          </p>
        </div>
      </div>
    </div>
  )
}
