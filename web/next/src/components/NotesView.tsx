import { useState } from 'react'
import type { Note } from '../types'
import { dayLabel, formatShortDate, todayKey } from '../lib/date'
import { IconArchive, IconChevronDown, IconPlus, IconTrash, IconUndo } from './Icons'
import { Button, cx, Spinner } from './ui'

interface Props {
  notes: Note[]
  archived: Note[]
  loading: boolean
  query: string
  onNew: () => void
  onOpen: (note: Note) => void
  onRestore: (note: Note) => Promise<void>
  onDeleteForever: (note: Note) => Promise<void>
}

/** Quita acentos para que "matematicas" encuentre "Matemáticas". */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

function whenLabel(key: string): string {
  const { headline } = dayLabel(key)
  // "Hoy", "Mañana", "Ayer" se leen solos; el resto con su fecha concreta.
  return ['Hoy', 'Mañana', 'Ayer'].includes(headline) ? headline : formatShortDate(key)
}

function NoteCard({ note, onOpen }: { note: Note; onOpen: (note: Note) => void }) {
  const isToday = note.date === todayKey()
  return (
    <button
      type="button"
      onClick={() => onOpen(note)}
      className={cx(
        'group relative mb-3 block w-full break-inside-avoid overflow-hidden rounded-card border bg-raised p-4 text-left',
        'transition-colors duration-150 hover:border-line-strong hover:bg-[rgba(24,24,30,0.82)]',
        isToday ? 'border-note/40' : 'border-line',
      )}
    >
      <span aria-hidden className="absolute top-4 bottom-4 left-0 w-[2px] rounded-full bg-note/70" />
      <div className="flex items-center gap-1.5 text-[11.5px]">
        <span className={cx('tnum first-letter:uppercase', isToday ? 'text-note' : 'text-ink-dim')}>
          {whenLabel(note.date)}
        </span>
        {!note.calendar_synced ? (
          <span
            className="ml-auto rounded-full bg-sunken px-2 py-0.5 text-[10.5px] text-ink-faint"
            title="Aún no llegó a Google Calendar: se reintenta al sincronizar"
          >
            Solo local
          </span>
        ) : null}
      </div>
      <h3 className="mt-1.5 text-[15px] leading-snug font-semibold tracking-tight text-ink">
        {note.title}
      </h3>
      {note.body ? (
        <p className="mt-1.5 line-clamp-[8] text-[13px] leading-relaxed whitespace-pre-line text-ink-dim">
          {note.body}
        </p>
      ) : null}
    </button>
  )
}

function Section({ title, notes, onOpen }: { title: string; notes: Note[]; onOpen: (n: Note) => void }) {
  if (notes.length === 0) return null
  return (
    <section className="mt-8">
      <h2 className="mb-3 flex items-baseline gap-2 text-[13px] font-medium tracking-[0.08em] text-ink-faint uppercase">
        {title}
        <span className="tnum text-[12px] tracking-normal normal-case">{notes.length}</span>
      </h2>
      <div className="columns-1 gap-3 sm:columns-2 lg:columns-3 2xl:columns-4">
        {notes.map((note) => (
          <NoteCard key={note.id} note={note} onOpen={onOpen} />
        ))}
      </div>
    </section>
  )
}

export function NotesView({
  notes,
  archived,
  loading,
  query,
  onNew,
  onOpen,
  onRestore,
  onDeleteForever,
}: Props) {
  const [showArchived, setShowArchived] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const q = normalize(query.trim())
  const matches = (n: Note) => !q || normalize(`${n.title}\n${n.body}`).includes(q)
  const visible = notes.filter(matches)
  const today = todayKey()
  const upcoming = visible.filter((n) => n.date >= today).sort((a, b) => a.date.localeCompare(b.date))
  const past = visible.filter((n) => n.date < today).sort((a, b) => b.date.localeCompare(a.date))
  const archivedVisible = archived.filter(matches)

  const act = async (note: Note, fn: (n: Note) => Promise<void>) => {
    setBusyId(note.id)
    try {
      await fn(note)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] px-5 py-8 md:px-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-5xl font-semibold tracking-tighter text-white md:text-6xl">Notas</h1>
            <p className="mt-2 max-w-[62ch] text-[14px] leading-relaxed text-ink-dim">
              Cada nota vive en Google Calendar como un evento de día completo, sin alertas y sin
              ocupar tu horario. Desde el celular, empieza el título con «📝» o «Nota:» y aparecerá
              aquí.
            </p>
          </div>
          <Button variant="primary" size="lg" onClick={onNew}>
            <IconPlus className="size-[18px]" />
            Nueva nota
          </Button>
        </header>

        {loading ? (
          <div className="flex items-center justify-center gap-3 py-24 text-[15px] text-white/70">
            <Spinner className="size-4" /> Cargando notas…
          </div>
        ) : visible.length === 0 ? (
          <div className="py-24 text-center">
            <p className="text-3xl font-semibold tracking-tighter text-white md:text-4xl">
              {q ? 'Ninguna nota coincide' : 'Sin notas todavía'}
            </p>
            <p className="mt-3 text-[15px] text-ink-dim">
              {q ? 'Prueba con otra búsqueda.' : 'Apunta lo que no es una entrega: ideas, listas, recordatorios sueltos.'}
            </p>
          </div>
        ) : (
          <>
            <Section title="Hoy y próximas" notes={upcoming} onOpen={onOpen} />
            <Section title="Anteriores" notes={past} onOpen={onOpen} />
          </>
        )}

        {archived.length > 0 ? (
          <section className="mt-10 border-t border-line pt-6">
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              className="flex items-center gap-2 text-[13px] font-medium tracking-[0.08em] text-ink-faint uppercase transition-colors hover:text-ink-dim"
              aria-expanded={showArchived}
            >
              <IconArchive className="size-4" />
              Archivadas
              <span className="tnum text-[12px] tracking-normal normal-case">{archived.length}</span>
              <IconChevronDown
                className={cx('size-4 transition-transform', showArchived && 'rotate-180')}
              />
            </button>
            {showArchived ? (
              <>
                <p className="mt-2 text-[12.5px] text-ink-faint">
                  Ya no están en Google Calendar. Las que borres allá también llegan aquí.
                </p>
                <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {archivedVisible.map((note) => (
                    <li key={note.id} className="rounded-card border border-line bg-raised px-4 py-3">
                      <div className="text-[11.5px] text-ink-faint first-letter:uppercase">
                        {whenLabel(note.date)}
                      </div>
                      <p className="mt-1 truncate text-[14px] font-medium text-ink-dim">{note.title}</p>
                      <div className="mt-2 flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={busyId === note.id}
                          onClick={() => void act(note, onRestore)}
                        >
                          <IconUndo className="size-3.5" />
                          Recuperar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-auto hover:text-danger"
                          disabled={busyId === note.id}
                          onClick={() => void act(note, onDeleteForever)}
                        >
                          <IconTrash className="size-3.5" />
                          Borrar
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  )
}
