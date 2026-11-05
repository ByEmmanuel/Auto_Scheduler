import { useCallback, useEffect, useRef, useState } from 'react'
import { IconAlert, IconBell, IconCheck, IconClose, IconSync, IconUndo } from './Icons'
import { cx, Spinner } from './ui'

type RowState = { state: 'idle' | 'busy' | 'done' | 'error'; error?: string }

/** `reminder` = algo empieza pronto. */
export type ToastTone = 'ok' | 'error' | 'info' | 'reminder'

export interface ToastAction {
  label: string
  onClick: () => void
}

/**
 * Renglón de un aviso con lista (p. ej. las tareas completadas de golpe), con
 * su propia acción. La acción no cierra el aviso: el renglón queda marcado
 * como hecho y se pueden seguir usando los demás.
 */
export interface NoticeListItem {
  id: string
  title: string
  sub?: string
  /** Texto del botón del renglón y del renglón ya hecho. */
  actionLabel: string
  doneLabel: string
  run: () => Promise<void>
}

export interface ToastItem {
  id: number
  tone: ToastTone
  title: string
  body?: string
  /** Acción opcional del aviso, p. ej. deshacer una reprogramación. */
  action?: ToastAction
  /** Lista de renglones con acción propia. Con lista, `action` se ignora. */
  items?: NoticeListItem[]
  /** Botón que aplica la acción a todos los renglones que falten. */
  allLabel?: string
}

/**
 * Todas las notificaciones de la app se muestran igual: grandes y en el
 * centro de la pantalla. Solo hay una a la vez; la nueva reemplaza a la
 * anterior (al reprogramar varias tareas seguidas, la que queda visible es la
 * del último movimiento, con su "Deshacer").
 */
export function useNotices() {
  const [notice, setNotice] = useState<ToastItem | null>(null)
  const idRef = useRef(0)

  const notify = useCallback(
    (tone: ToastTone, title: string, body?: string, action?: ToastAction) => {
      setNotice({ id: ++idRef.current, tone, title, body, action })
    },
    [],
  )

  /** Aviso con lista de renglones, cada uno con su acción. */
  const notifyList = useCallback(
    (tone: ToastTone, title: string, body: string, items: NoticeListItem[], allLabel?: string) => {
      setNotice({ id: ++idRef.current, tone, title, body, items, allLabel })
    },
    [],
  )

  const closeNotice = useCallback(() => setNotice(null), [])

  return { notice, notify, notifyList, closeNotice }
}

type NoticeArgs = [tone: ToastTone, title: string, body?: string, action?: ToastAction]
/** Un aviso diferido puede calcular su contenido al mostrarse (o descartarse
 *  devolviendo null), p. ej. "empieza en N min" cuando ya pasó la hora. La
 *  bienvenida usa ese mismo turno para abrir su propio diálogo. */
type Deferred = NoticeArgs | (() => NoticeArgs | null)

/**
 * Avisos que el usuario no pidió (bienvenida, "empieza en 15 min"). No
 * se muestran encima de un diálogo abierto ni de otro aviso: esperan en fila
 * a que la pantalla quede libre, para no tapar lo que está escribiendo ni
 * reemplazar un aviso que todavía no leyó.
 */
export function useDeferredNotices(
  blocked: boolean,
  notify: (...args: NoticeArgs) => void,
) {
  const [queue, setQueue] = useState<Deferred[]>([])

  useEffect(() => {
    if (blocked || queue.length === 0) return
    // Una pausa breve entre avisos para que no parezca que uno "rebota".
    const t = window.setTimeout(() => {
      const head = queue[0]
      const args = typeof head === 'function' ? head() : head
      if (args) notify(...args)
      setQueue((q) => q.slice(1))
    }, 400)
    return () => window.clearTimeout(t)
  }, [blocked, queue, notify])

  return useCallback((item: Deferred) => setQueue((q) => [...q, item]), [])
}

/**
 * Cuánto dura un aviso en pantalla. Los errores y los que traen acción duran
 * más (hay que leerlos y decidir), y cada línea extra del cuerpo suma tiempo:
 * el resumen de sincronización trae varias.
 */
function durationOf(notice: ToastItem): number {
  // Con lista hay que leer y decidir renglón por renglón.
  if (notice.items?.length) return 30000
  const base =
    notice.tone === 'error' || notice.tone === 'reminder' || notice.action ? 10000 : 6000
  const extraLines = Math.max(0, (notice.body?.split('\n').length ?? 1) - 1)
  return Math.min(base + extraLines * 1200, 15000)
}

const TONE: Record<ToastTone, { Icon: typeof IconCheck; badge: string; glow: string; bar: string }> = {
  ok: {
    Icon: IconCheck,
    badge: 'border-ok/40 text-ok',
    glow: '0 0 48px -6px rgba(95, 227, 171, 0.55)',
    bar: 'bg-ok',
  },
  error: {
    Icon: IconAlert,
    badge: 'border-danger/40 text-danger',
    glow: '0 0 48px -6px rgba(255, 123, 123, 0.55)',
    bar: 'bg-danger',
  },
  info: {
    Icon: IconSync,
    badge: 'border-accent/40 text-accent',
    glow: '0 0 48px -6px rgba(127, 180, 255, 0.6)',
    bar: 'bg-accent',
  },
  reminder: {
    Icon: IconBell,
    badge: 'border-accent/40 text-accent',
    glow: '0 0 56px -4px rgba(127, 180, 255, 0.75)',
    bar: 'bg-accent',
  },
}

/**
 * Aviso grande centrado en pantalla. Se cierra solo (el tiempo se pausa con
 * el cursor encima), con Escape, con la ✕ o haciendo clic fuera.
 */
export function Notice({
  notice,
  onClose,
}: {
  notice: ToastItem | null
  onClose: () => void
}) {
  const [hovered, setHovered] = useState(false)
  // Estado de cada renglón de la lista: se reinicia con cada aviso nuevo.
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const busy = Object.values(rows).some((r) => r.state === 'busy')
  // Mientras algo se está deshaciendo el aviso no se cierra solo.
  const paused = hovered || busy
  const remainingRef = useRef(0)

  useEffect(() => {
    if (!notice) return
    // En fase de captura y sin propagar: si el aviso aparece encima del
    // compositor o del detalle, Escape cierra solo el aviso, no el diálogo de
    // abajo (y no se pierde lo que el usuario estaba escribiendo).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [notice, onClose])

  // Cada aviso nuevo arranca su propio tiempo completo.
  useEffect(() => {
    if (!notice) return
    remainingRef.current = durationOf(notice)
    setHovered(false)
    setRows({})
  }, [notice])

  useEffect(() => {
    if (!notice || paused) return
    const startedAt = Date.now()
    const timer = window.setTimeout(onClose, remainingRef.current)
    return () => {
      window.clearTimeout(timer)
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAt))
    }
  }, [notice, paused, onClose])

  if (!notice) return null
  const { Icon, badge, glow, bar } = TONE[notice.tone]
  const items = notice.items ?? []
  const pending = items.filter((it) => rows[it.id]?.state !== 'done')

  const runRow = async (item: NoticeListItem) => {
    const current = rows[item.id]?.state
    if (current === 'busy' || current === 'done') return
    setRows((r) => ({ ...r, [item.id]: { state: 'busy' } }))
    try {
      await item.run()
      setRows((r) => ({ ...r, [item.id]: { state: 'done' } }))
      return true
    } catch (e) {
      setRows((r) => ({
        ...r,
        [item.id]: { state: 'error', error: e instanceof Error ? e.message : 'No se pudo' },
      }))
      return false
    }
  }

  const runAll = async () => {
    const results = await Promise.all(pending.map((it) => runRow(it)))
    if (results.every(Boolean)) onClose()
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="anim-fade-in absolute inset-0 bg-black/55" onClick={onClose} />

      <div
        key={notice.id}
        role={notice.tone === 'error' ? 'alert' : 'status'}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="glass-strong anim-pop relative w-full max-w-[640px] overflow-hidden rounded-[1.75rem] border border-line-strong px-8 pt-12 pb-11 text-center shadow-panel sm:px-14"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar aviso"
          className="absolute top-4 right-4 rounded-full p-2 text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
        >
          <IconClose className="size-5" />
        </button>

        <span
          className={cx('mx-auto grid size-20 place-items-center rounded-full border bg-black/40', badge)}
          style={{ boxShadow: glow }}
        >
          <Icon className="size-10" />
        </span>

        <h2 className="mt-7 text-4xl leading-[1.05] font-semibold tracking-tighter text-white md:text-5xl">
          {notice.title}
        </h2>

        {notice.body ? (
          <p className="mx-auto mt-4 max-w-[48ch] text-lg leading-relaxed whitespace-pre-line text-white/75 md:text-xl">
            {notice.body}
          </p>
        ) : null}

        {items.length > 0 ? (
          <>
            <ul className="mx-auto mt-7 max-h-[38vh] max-w-[520px] space-y-2 overflow-y-auto pr-1 text-left">
              {items.map((item) => {
                const row = rows[item.id] ?? { state: 'idle' }
                const done = row.state === 'done'
                return (
                  <li
                    key={item.id}
                    className={cx(
                      'flex items-center gap-3 rounded-card border px-4 py-3 transition-colors',
                      done ? 'border-ok/30 bg-ok/5' : 'border-line bg-raised',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p
                        className={cx(
                          'truncate text-[15px] font-medium',
                          done ? 'text-ink-dim' : 'text-ink line-through decoration-ink-faint/60',
                        )}
                      >
                        {item.title}
                      </p>
                      {row.state === 'error' ? (
                        <p className="mt-0.5 truncate text-[12.5px] text-danger">{row.error}</p>
                      ) : item.sub ? (
                        <p className="mt-0.5 truncate text-[12.5px] text-ink-faint">{item.sub}</p>
                      ) : null}
                    </div>
                    {done ? (
                      <span className="flex shrink-0 items-center gap-1.5 text-[13px] text-ok">
                        <IconCheck className="size-4" />
                        {item.doneLabel}
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={row.state === 'busy'}
                        onClick={() => void runRow(item)}
                        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-line-strong px-4 text-[13px] font-medium text-ink transition-colors hover:bg-white hover:text-black disabled:opacity-60"
                      >
                        {row.state === 'busy' ? <Spinner /> : <IconUndo className="size-3.5" />}
                        {row.state === 'error' ? 'Reintentar' : item.actionLabel}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
            {notice.allLabel && pending.length > 1 ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void runAll()}
                className="mt-6 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-8 text-[16px] font-semibold text-black transition-[background-color,box-shadow] duration-150 hover:bg-white/85 hover:shadow-[0_0_28px_rgba(127,180,255,0.5)] disabled:opacity-60"
              >
                {notice.allLabel}
              </button>
            ) : pending.length === 0 ? (
              <button
                type="button"
                onClick={onClose}
                className="mt-6 inline-flex h-12 items-center justify-center rounded-full border border-line-strong px-8 text-[16px] font-semibold text-ink transition-colors hover:bg-sunken"
              >
                Listo
              </button>
            ) : null}
          </>
        ) : notice.action ? (
          <button
            type="button"
            onClick={() => {
              notice.action?.onClick()
              onClose()
            }}
            className="mt-8 inline-flex h-12 items-center justify-center rounded-full bg-white px-8 text-[16px] font-semibold text-black transition-[background-color,box-shadow] duration-150 hover:bg-white/85 hover:shadow-[0_0_28px_rgba(127,180,255,0.5)]"
          >
            {notice.action.label}
          </button>
        ) : null}

        {/* Tiempo restante: se detiene mientras el cursor está encima. */}
        <span
          key={`bar-${notice.id}`}
          aria-hidden
          className={cx('absolute bottom-0 left-0 h-[3px] opacity-70', bar)}
          style={{
            animation: `as-countdown ${durationOf(notice)}ms linear forwards`,
            animationPlayState: paused ? 'paused' : 'running',
          }}
        />
      </div>
    </div>
  )
}
