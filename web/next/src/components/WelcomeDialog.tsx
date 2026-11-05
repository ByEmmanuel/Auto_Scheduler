import { useEffect, useMemo } from 'react'
import type { Task } from '../types'
import { buildWelcome, dueTimeLabel } from '../lib/agenda'
import type { WelcomeItem, WelcomeSource } from '../lib/agenda'
import { courseDotColor } from '../lib/course'
import { dayLabel, keyOfIso, todayLong } from '../lib/date'
import { christmasGreeting } from '../lib/season'
import { sourceLabel } from '../lib/source'
import { XmasEmoji } from './Christmas'
import { IconAlert, IconClose } from './Icons'
import { Button, cx, Dot, Label } from './ui'

interface Props {
  tasks: Task[]
  festive: boolean
  onClose: () => void
}

/** Filas por tramo: si hay que hacer mucho scroll deja de ser un resumen. */
const MAX_ROWS = 6
/** Las manuales atrasadas son sobre todo notas viejas: no deben tapar lo demás. */
const MAX_MANUAL_OVERDUE = 3

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function Stat({ value, label, detail, accent }: { value: number; label: string; detail: string; accent?: boolean }) {
  return (
    <div className={cx('rounded-card border px-4 py-3', accent ? 'border-accent/45 bg-accent-soft' : 'border-line bg-sunken')}>
      <div className="tnum text-[32px] leading-none font-semibold tracking-tighter text-ink">{value}</div>
      <div className="mt-2 text-[13.5px] font-medium text-ink">{label}</div>
      <div className="mt-0.5 text-[12px] text-ink-dim">{detail}</div>
    </div>
  )
}

function Row({ task, when, note, late }: { task: Task; when: string; note?: string; late?: boolean }) {
  return (
    <li className="flex items-start gap-3 rounded-lg border border-line bg-sunken px-3 py-2">
      <Dot color={courseDotColor(task.course)} className="mt-[7px]" />
      <div className="min-w-0 flex-1">
        <div className="text-[14.5px] leading-snug text-ink">{task.title}</div>
        <div className="mt-0.5 truncate text-[12.5px] text-ink-dim">
          <span className={late ? 'text-danger' : 'text-ink'}>{when}</span>
          {' · '}
          {note ?? task.course}
        </div>
      </div>
    </li>
  )
}

/** Tramo de una columna: hasta `limit` filas y, si hay más, cuántas quedan. */
function Rows({ items, limit, late }: { items: WelcomeItem[]; limit: number; late?: boolean }) {
  const hidden = items.length - limit
  return (
    <ul className="flex flex-col gap-1.5">
      {items.slice(0, limit).map(({ task, more }) => (
        <Row
          key={task.id}
          task={task}
          late={late}
          when={dayLabel(keyOfIso(task.due_date)).headline}
          note={more > 0 ? `se repite, ${plural(more, 'fecha', 'fechas')} más` : undefined}
        />
      ))}
      {hidden > 0 ? (
        <li className="px-3 pt-0.5 text-[12.5px] text-ink-faint">…y {hidden} más en el tablero</li>
      ) : null}
    </ul>
  )
}

function SourceColumn({ title, source, overdueLimit }: { title: string; source: WelcomeSource; overdueLimit: number }) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <Label>
        {title} <XmasEmoji seed={title} />
      </Label>
      {source.overdue.length > 0 ? (
        <>
          <div className="text-[13px] font-medium text-danger">Atrasadas</div>
          <Rows items={source.overdue} limit={overdueLimit} late />
        </>
      ) : null}
      <div className="mt-1 text-[13px] font-medium text-ink-dim">Después de hoy</div>
      {source.upcoming.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-3 text-center text-[13px] text-ink-faint">
          Nada por ahora
        </p>
      ) : (
        <Rows items={source.upcoming} limit={MAX_ROWS} />
      )}
    </section>
  )
}

/**
 * Bienvenida: cuánto hay pendiente, qué toca hoy y qué sigue. Se calcula de la
 * lista viva de tareas y no se cierra sola: es para leerla con calma.
 */
export function WelcomeDialog({ tasks, festive, onClose }: Props) {
  const data = useMemo(() => buildWelcome(tasks), [tasks])
  const { classroom, personal } = data

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="anim-fade-in absolute inset-0 bg-black/60" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Resumen de bienvenida"
        className="glass-strong anim-pop relative flex max-h-[90dvh] w-full max-w-[820px] flex-col overflow-hidden rounded-[1.75rem] border border-line-strong shadow-panel"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute top-4 right-4 z-10 rounded-full p-2 text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
        >
          <IconClose className="size-5" />
        </button>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-8 pb-6 sm:px-9">
          <header className="pr-10">
            <h2 className="text-4xl leading-[1.05] font-semibold tracking-tighter text-white md:text-5xl">
              {data.greeting} <XmasEmoji emoji="🎄" className="text-[0.8em]" />
            </h2>
            <p className="mt-2 text-[15px] text-ink-dim first-letter:uppercase">
              {todayLong()}
              {festive ? ` · ${christmasGreeting()}` : ''}
            </p>
          </header>

          <div className="mt-6 grid grid-cols-2 gap-2.5 md:grid-cols-4">
            <Stat value={data.today.length} label="Para hoy" detail="sin vencer todavía" accent />
            <Stat value={data.dueCount} label="Por entregar" detail="de hoy en adelante" />
            <Stat
              value={classroom.total}
              label={sourceLabel('classroom')}
              detail={classroom.overdueCount > 0 ? plural(classroom.overdueCount, 'atrasada', 'atrasadas') : 'pendientes'}
            />
            <Stat
              value={personal.total}
              label="Manuales"
              detail={personal.overdueCount > 0 ? plural(personal.overdueCount, 'atrasada', 'atrasadas') : 'pendientes'}
            />
          </div>

          {data.overdue > 0 ? (
            <p className="mt-3 flex items-center gap-2 rounded-lg bg-danger-soft px-3 py-2 text-[13.5px] text-danger">
              <IconAlert className="size-4 shrink-0" />
              {plural(data.overdue, 'atrasada', 'atrasadas')}: arrástralas a un día en el tablero.
            </p>
          ) : null}

          <section className="mt-6">
            <Label>
              Para hoy <XmasEmoji emoji="🎅" />
            </Label>
            {data.today.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line px-3 py-3 text-center text-[14px] text-ink-dim">
                Hoy no tienes nada pendiente.
              </p>
            ) : (
              <ul className="grid gap-1.5 md:grid-cols-2">
                {data.today.map((task) => (
                  <Row key={task.id} task={task} when={dueTimeLabel(task.due_date)} />
                ))}
              </ul>
            )}
          </section>

          <div className="mt-6 grid gap-6 md:grid-cols-2 md:gap-4">
            <SourceColumn title="Classroom" source={classroom} overdueLimit={MAX_ROWS} />
            <SourceColumn title="Manuales" source={personal} overdueLimit={MAX_MANUAL_OVERDUE} />
          </div>

          {data.undated > 0 ? (
            <p className="mt-4 text-[13px] text-ink-faint">
              {plural(data.undated, 'tarea sin fecha', 'tareas sin fecha')}
            </p>
          ) : null}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-line px-6 py-4 sm:px-9">
          <span className="text-[12.5px] text-ink-faint">«Manuales» incluye las notas de Google Calendar.</span>
          <Button variant="primary" size="lg" onClick={onClose}>
            Ir al tablero
          </Button>
        </footer>
      </div>
    </div>
  )
}
