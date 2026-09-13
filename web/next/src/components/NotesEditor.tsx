import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { cx, Spinner } from './ui'

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

const AUTOSAVE_MS = 900

/**
 * Editor de notas con guardado automático.
 *
 * Antes había que abrir el modal, escribir y acordarse de pulsar "GUARDAR
 * NOTAS". Aquí el texto se guarda solo ~1s después de dejar de escribir (y al
 * salir del campo), con Ctrl/⌘+Enter para forzarlo y Esc para descartar lo no
 * guardado. El estado de guardado siempre está a la vista, incluido si la nota
 * llegó o no a Google Calendar.
 *
 * Ojo al montarlo: pásale `key={task.id}` para que el estado interno se
 * reinicie al cambiar de tarea y NO se pise lo que el usuario está tecleando
 * cuando el tablero se refresca de fondo.
 */
export function useNotesSaver(
  taskId: string,
  initialNotes: string,
  onSaved?: (notes: string, calendarSynced: boolean) => void,
) {
  const [value, setValue] = useState(initialNotes ?? '')
  const [state, setState] = useState<SaveState>('idle')
  const [calendarSynced, setCalendarSynced] = useState(true)

  const valueRef = useRef(initialNotes ?? '')
  const savedRef = useRef(initialNotes ?? '')
  const timerRef = useRef<number | undefined>(undefined)
  const savedCbRef = useRef(onSaved)
  savedCbRef.current = onSaved

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  const flush = useCallback(async () => {
    window.clearTimeout(timerRef.current)
    const next = valueRef.current
    if (next === savedRef.current) return
    setState('saving')
    try {
      const res = await api.saveNotes(taskId, next)
      savedRef.current = next
      setCalendarSynced(res.calendar_synced)
      setState('saved')
      savedCbRef.current?.(next, res.calendar_synced)
    } catch {
      setState('error')
    }
  }, [taskId])

  const change = useCallback(
    (next: string) => {
      setValue(next)
      valueRef.current = next
      setState(next === savedRef.current ? 'idle' : 'dirty')
      window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => void flush(), AUTOSAVE_MS)
    },
    [flush],
  )

  const revert = useCallback(() => {
    window.clearTimeout(timerRef.current)
    setValue(savedRef.current)
    valueRef.current = savedRef.current
    setState('idle')
  }, [])

  return { value, state, calendarSynced, change, flush, revert }
}

function StatusLine({ state, calendarSynced }: { state: SaveState; calendarSynced: boolean }) {
  if (state === 'saving') {
    return (
      <span className="flex items-center gap-1.5 text-ink-faint">
        <Spinner className="size-3" />
        Guardando…
      </span>
    )
  }
  if (state === 'saved') {
    return (
      <span className="text-ok">
        Guardado{calendarSynced ? ' · Calendar actualizado' : ' · solo local'}
      </span>
    )
  }
  if (state === 'dirty') return <span className="text-ink-faint">Sin guardar…</span>
  if (state === 'error') return <span className="text-danger">No se pudo guardar</span>
  return <span className="text-ink-faint">⌘/Ctrl + Enter para guardar ya</span>
}

interface Props {
  taskId: string
  initialNotes: string
  onSaved?: (notes: string, calendarSynced: boolean) => void
  onClose?: () => void
  autoFocus?: boolean
  compact?: boolean
  placeholder?: string
}

export function NotesEditor({
  taskId,
  initialNotes,
  onSaved,
  onClose,
  autoFocus,
  compact,
  placeholder = 'Escribe una nota…',
}: Props) {
  const { value, state, calendarSynced, change, flush, revert } = useNotesSaver(
    taskId,
    initialNotes,
    onSaved,
  )
  const areaRef = useRef<HTMLTextAreaElement>(null)

  // Alto automático: el campo crece con el texto en vez de mostrar scroll.
  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, compact ? 160 : 320)}px`
  }, [value, compact])

  useEffect(() => {
    if (autoFocus) {
      const el = areaRef.current
      el?.focus()
      el?.setSelectionRange(el.value.length, el.value.length)
    }
  }, [autoFocus])

  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        ref={areaRef}
        value={value}
        rows={compact ? 2 : 3}
        placeholder={placeholder}
        onChange={(e) => change(e.target.value)}
        onBlur={() => void flush()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void flush()
            onClose?.()
          }
          if (e.key === 'Escape') {
            // Escape descarta lo no guardado y suelta el foco; un segundo
            // Escape ya cierra el panel que contiene al editor.
            e.preventDefault()
            e.stopPropagation()
            revert()
            e.currentTarget.blur()
            onClose?.()
          }
        }}
        className={cx(
          'w-full resize-none rounded-lg border border-line bg-sunken text-ink placeholder:text-ink-faint',
          'transition-colors duration-150 outline-none focus:border-accent/50 focus:bg-surface',
          compact ? 'px-2.5 py-2 text-[12.5px] leading-relaxed' : 'px-3 py-2.5 text-[13.5px] leading-relaxed',
        )}
      />
      <div className="flex items-center justify-between gap-2 px-0.5 text-[11px]">
        <StatusLine state={state} calendarSynced={calendarSynced} />
        {onClose ? (
          <button
            type="button"
            onClick={() => {
              void flush()
              onClose()
            }}
            className="text-ink-faint transition-colors hover:text-ink"
          >
            Listo
          </button>
        ) : null}
      </div>
    </div>
  )
}
