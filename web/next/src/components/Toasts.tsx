import { useCallback, useEffect, useRef, useState } from 'react'
import { IconAlert, IconCheck, IconClose, IconSync } from './Icons'
import { cx } from './ui'

export type ToastTone = 'ok' | 'error' | 'info'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastItem {
  id: number
  tone: ToastTone
  title: string
  body?: string
  /** Acción opcional del aviso, p. ej. deshacer una reprogramación. */
  action?: ToastAction
}

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [notice, setNotice] = useState<ToastItem | null>(null)
  const idRef = useRef(0)

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const push = useCallback(
    (tone: ToastTone, title: string, body?: string, action?: ToastAction) => {
      const id = ++idRef.current
      setToasts((prev) => [...prev.slice(-2), { id, tone, title, body, action }])
      // Un aviso con acción dura más: hay que darle tiempo al usuario a leerlo
      // y decidir si deshace lo que acaba de hacer.
      const ms = tone === 'error' ? 7000 : action ? 8000 : 4500
      window.setTimeout(() => dismiss(id), ms)
    },
    [dismiss],
  )

  /**
   * Aviso destacado, grande y en el centro de la pantalla. Es para el
   * resultado de algo que el usuario pidió y está esperando (la sincronización
   * con Classroom y Calendar); las confirmaciones de rutina siguen siendo
   * toasts discretos abajo. Solo hay uno a la vez: el nuevo reemplaza al
   * anterior.
   */
  const announce = useCallback((tone: ToastTone, title: string, body?: string) => {
    const id = ++idRef.current
    setNotice({ id, tone, title, body })
    // Trae varias líneas de resumen, así que dura más que un toast. El
    // temporizador solo cierra su propio aviso, no uno que llegó después.
    const ms = tone === 'error' ? 12000 : 9000
    window.setTimeout(() => setNotice((current) => (current?.id === id ? null : current)), ms)
  }, [])

  const closeNotice = useCallback(() => setNotice(null), [])

  return { toasts, push, dismiss, notice, announce, closeNotice }
}

const TONE_DOT: Record<ToastTone, string> = {
  ok: 'bg-ok',
  error: 'bg-danger',
  info: 'bg-accent',
}

const NOTICE_ICON: Record<ToastTone, { Icon: typeof IconCheck; badge: string }> = {
  ok: { Icon: IconCheck, badge: 'bg-ok/10 text-ok' },
  error: { Icon: IconAlert, badge: 'bg-danger-soft text-danger' },
  info: { Icon: IconSync, badge: 'bg-accent-soft text-accent' },
}

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[]
  onDismiss: (id: number) => void
}) {
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] flex w-[360px] max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col items-stretch gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="anim-pop pointer-events-auto flex gap-2.5 rounded-card border border-line bg-surface/90 px-3.5 py-3 shadow-panel backdrop-blur-xl"
        >
          <span className={cx('mt-1.5 size-1.5 shrink-0 rounded-full', TONE_DOT[t.tone])} />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-ink">{t.title}</p>
            {t.body ? (
              <p className="mt-0.5 text-[12px] leading-relaxed whitespace-pre-line text-ink-dim">
                {t.body}
              </p>
            ) : null}
            {t.action ? (
              <button
                type="button"
                onClick={() => {
                  t.action?.onClick()
                  onDismiss(t.id)
                }}
                className="mt-1.5 rounded-md bg-sunken px-2 py-1 text-[12px] font-medium text-accent-ink transition-colors hover:bg-accent-soft"
              >
                {t.action.label}
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => onDismiss(t.id)}
            aria-label="Cerrar aviso"
            className="h-fit rounded p-0.5 text-ink-faint transition-colors hover:text-ink"
          >
            <IconClose className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}

/**
 * Aviso destacado centrado en pantalla (ver `announce`). Se cierra solo, con
 * Escape, con la ✕ o haciendo clic fuera.
 */
export function Notice({
  notice,
  onClose,
}: {
  notice: ToastItem | null
  onClose: () => void
}) {
  useEffect(() => {
    if (!notice) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [notice, onClose])

  if (!notice) return null
  const { Icon, badge } = NOTICE_ICON[notice.tone]

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div
        className="anim-fade-in absolute inset-0 bg-black/25 backdrop-blur-[2px]"
        onClick={onClose}
      />

      <div
        key={notice.id}
        role={notice.tone === 'error' ? 'alert' : 'status'}
        className="anim-pop relative w-full max-w-[520px] rounded-panel border border-line bg-surface px-10 pt-10 pb-9 text-center shadow-panel"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar aviso"
          className="absolute top-3 right-3 rounded-lg p-2 text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
        >
          <IconClose className="size-[18px]" />
        </button>

        <span className={cx('mx-auto grid size-14 place-items-center rounded-full', badge)}>
          <Icon className="size-7" />
        </span>
        <h2 className="mt-5 text-[24px] leading-tight font-semibold text-ink">{notice.title}</h2>
        {notice.body ? (
          <p className="mt-3 text-[16px] leading-relaxed whitespace-pre-line text-ink-dim">
            {notice.body}
          </p>
        ) : null}
      </div>
    </div>
  )
}
