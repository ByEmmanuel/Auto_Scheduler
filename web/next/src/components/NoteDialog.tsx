import { useEffect, useRef, useState } from 'react'
import type { Note } from '../types'
import { api } from '../lib/api'
import { addDaysToKey, todayKey } from '../lib/date'
import { IconArchive, IconCalendar, IconClose } from './Icons'
import { Button, Chip, cx, Label } from './ui'

interface Props {
  /** Nota a editar; sin ella el diálogo crea una nueva. */
  note?: Note
  onClose: () => void
  onSaved: (note: Note, calendarSynced: boolean, created: boolean) => void
  onArchive: (note: Note) => void
}

/**
 * Crear o editar una nota. Solo tiene título, texto y día: no hay hora ni
 * alertas porque en Calendar es un evento de día completo, sin recordatorios.
 */
export function NoteDialog({ note, onClose, onSaved, onArchive }: Props) {
  const [title, setTitle] = useState(note?.title ?? '')
  const [body, setBody] = useState(note?.body ?? '')
  const [date, setDate] = useState(note?.date ?? todayKey())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (note) bodyRef.current?.focus()
    else titleRef.current?.focus()
  }, [note])

  // Alto automático del texto.
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 360)}px`
  }, [body])

  const dirty =
    !note || title.trim() !== note.title || body.trim() !== note.body || date !== note.date

  async function save() {
    if (!title.trim()) {
      setError('Ponle un título a la nota.')
      titleRef.current?.focus()
      return
    }
    if (!dirty) {
      onClose()
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = { title: title.trim(), body: body.trim(), date }
      const res = note ? await api.updateNote(note.id, payload) : await api.createNote(payload)
      onSaved(res.note, res.calendar_synced, !note)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la nota.')
      setSaving(false)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void save()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  const today = todayKey()
  const presets = [
    { label: 'Hoy', key: today },
    { label: 'Mañana', key: addDaysToKey(today, 1) },
    { label: 'En 3 días', key: addDaysToKey(today, 3) },
    { label: 'Próx. semana', key: addDaysToKey(today, 7) },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center">
      <div className="anim-fade-in absolute inset-0 bg-black/60" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={note ? 'Editar nota' : 'Nueva nota'}
        className="anim-pop relative w-full max-w-[560px] overflow-hidden glass-strong rounded-panel border border-line shadow-panel"
      >
        <span aria-hidden className="absolute top-0 left-0 h-[3px] w-full bg-note/80" />

        <div className="flex items-start gap-3 px-6 pt-6 pb-4">
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              if (error) setError('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                e.preventDefault()
                bodyRef.current?.focus()
              }
            }}
            placeholder="Título de la nota"
            maxLength={200}
            className="min-w-0 flex-1 bg-transparent text-[20px] leading-snug font-semibold tracking-tight text-ink placeholder:text-ink-faint focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="-mt-1 -mr-2 rounded-lg p-2 text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
          >
            <IconClose className="size-[18px]" />
          </button>
        </div>

        <div className="px-6 pb-5">
          <textarea
            ref={bodyRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            placeholder="Escribe lo que quieras recordar…"
            className="w-full resize-none rounded-lg border border-line bg-sunken px-3 py-2.5 text-[14px] leading-relaxed text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-note/50 focus:bg-black/40"
          />
        </div>

        <div className="border-t border-line px-6 py-5">
          <Label>Día en Calendar</Label>
          <div className="flex flex-wrap items-center gap-1.5">
            {presets.map((p) => (
              <Chip key={p.key} active={date === p.key} onClick={() => setDate(p.key)}>
                {p.label}
              </Chip>
            ))}
            <div className="relative">
              <IconCalendar className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-faint" />
              <input
                type="date"
                value={date}
                onChange={(e) => e.target.value && setDate(e.target.value)}
                className="h-8 rounded-full border border-line bg-sunken pr-2.5 pl-8 text-[12.5px] text-ink outline-none transition-colors focus:border-note/50"
              />
            </div>
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-ink-faint">
            En Google Calendar aparece arriba de ese día como «📝 {title.trim() || 'Título'}», de día
            completo, sin alertas y sin ocupar tu horario.
          </p>
        </div>

        <footer className="flex items-center gap-2 border-t border-line px-6 py-4">
          {note ? (
            <Button variant="ghost" onClick={() => onArchive(note)} disabled={saving}>
              <IconArchive className="size-4" />
              Archivar
            </Button>
          ) : null}
          {error ? <p className="min-w-0 flex-1 truncate text-[12.5px] text-danger">{error}</p> : null}
          <div className={cx('flex items-center gap-2', !error && 'ml-auto')}>
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button variant="primary" size="lg" onClick={() => void save()} loading={saving}>
              {note ? 'Guardar' : 'Crear nota'}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  )
}
