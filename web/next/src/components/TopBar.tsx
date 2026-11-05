import { todayLong } from '../lib/date'
import { christmasGreeting } from '../lib/season'
import type { Christmas } from '../lib/season'
import { ChristmasTree, Garland, SantaHat, XmasEmoji } from './Christmas'
import { IconBoard, IconHistory, IconNote, IconPlus, IconSearch, IconSnow, IconSun, IconSync } from './Icons'
import { Button, cx } from './ui'

export type View = 'board' | 'notes'

interface Props {
  view: View
  onView: (view: View) => void
  notesCount: number
  total: number
  overdue: number
  urgent: number
  query: string
  onQuery: (value: string) => void
  syncing: boolean
  onSync: () => void
  onAdd: () => void
  onHistory: () => void
  onWelcome: () => void
  onTree: () => void
  christmas: Christmas
}

function Stat({ value, label, tone }: { value: number; label: string; tone?: 'danger' | 'accent' }) {
  if (value === 0 && tone) return null
  return (
    <span className="flex items-center gap-1.5 text-[12.5px] text-ink-dim">
      <span
        className={cx(
          'size-1.5 rounded-full',
          tone === 'danger' ? 'bg-danger' : tone === 'accent' ? 'bg-accent' : 'bg-ink-faint',
        )}
      />
      <span className="tnum text-ink">{value}</span>
      {label}
    </span>
  )
}

/** Tablero | Notas: dos pestañas, una sola a la vez. */
function ViewSwitch({ view, onView, notesCount }: Pick<Props, 'view' | 'onView' | 'notesCount'>) {
  const tabs: { key: View; label: string; Icon: typeof IconBoard; count?: number }[] = [
    { key: 'board', label: 'Tablero', Icon: IconBoard },
    { key: 'notes', label: 'Notas', Icon: IconNote, count: notesCount },
  ]
  return (
    <div role="tablist" aria-label="Vista" className="flex h-10 items-center rounded-full border border-line bg-sunken p-1">
      {tabs.map(({ key, label, Icon, count }) => {
        const active = view === key
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onView(key)}
            className={cx(
              'flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors duration-150',
              active ? 'bg-white text-black' : 'text-ink-dim hover:text-ink',
            )}
          >
            <Icon className="size-4" />
            <span className="hidden md:inline">{label}</span>
            {count ? (
              <span className={cx('tnum text-[11.5px]', active ? 'text-black/60' : 'text-ink-faint')}>
                {count}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

export function TopBar({
  view,
  onView,
  notesCount,
  total,
  overdue,
  urgent,
  query,
  onQuery,
  syncing,
  onSync,
  onAdd,
  onHistory,
  onWelcome,
  onTree,
  christmas,
}: Props) {
  const festive = christmas.active
  return (
    <header
      className={cx(
        'sticky top-0 z-30 grid h-16 shrink-0 grid-cols-[1fr_auto] items-center gap-4 px-5',
        'glass border-b border-line lg:grid-cols-[1fr_auto_1fr]',
      )}
    >
      {/* Izquierda: identidad + la fecha de hoy, escrita completa. */}
      <div className="flex min-w-0 items-center gap-4">
        <div className="flex items-center gap-2.5">
          <span className="relative flex size-7 shrink-0 items-center justify-center rounded-full border border-line-strong">
            <span className="size-2 rounded-full bg-white shadow-[0_0_10px_2px_rgba(127,180,255,0.9)]" />
            {festive ? <SantaHat className="absolute -top-3 -left-1.5 size-6 -rotate-12" /> : null}
          </span>
          <div className="min-w-0">
            <div className="text-[15px] leading-tight font-semibold tracking-tighter text-ink">
              Auto Scheduler
            </div>
            <div className="truncate text-[12.5px] leading-tight text-ink-dim first-letter:uppercase">
              {todayLong()}
              {festive ? ` · ${christmasGreeting()}` : ''}
            </div>
          </div>
        </div>

        <span className="hidden h-5 w-px bg-line 2xl:block" />
        <div className="hidden items-center gap-3.5 2xl:flex">
          <Stat value={total} label="pendientes" />
          <Stat value={overdue} label="atrasadas" tone="danger" />
          <Stat value={urgent} label="urgentes" tone="accent" />
        </div>
      </div>

      {/* Centro: búsqueda y acciones, todo al alcance sin cruzar la pantalla. */}
      <div className="flex items-center justify-center gap-2">
        <ViewSwitch view={view} onView={onView} notesCount={notesCount} />
        <div className="relative hidden sm:block">
          <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint" />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={view === 'notes' ? 'Buscar notas…' : 'Buscar…'}
            className={cx(
              'h-10 w-[168px] rounded-full border border-line bg-sunken pr-3 pl-9 text-[13.5px] text-ink',
              'placeholder:text-ink-faint outline-none transition-all duration-200',
              'focus:w-[228px] focus:border-line-strong focus:bg-black/40',
            )}
          />
        </div>

        <Button variant="ghost" size="icon" onClick={onHistory} aria-label="Ver historial">
          <IconHistory className="size-[18px]" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onWelcome} aria-label="Ver resumen de bienvenida">
          <IconSun className="size-[18px]" />
        </Button>
        {christmas.inSeason ? (
          // En el contenedor y no en el botón: `hidden` contra el `inline-flex`
          // propio de Button no se resuelve por orden de escritura.
          <span className="hidden sm:contents">
            <Button
              variant="ghost"
              size="icon"
              onClick={christmas.toggle}
              aria-label={festive ? 'Quitar tema navideño' : 'Poner tema navideño'}
              aria-pressed={festive}
              className={festive ? 'text-accent' : undefined}
            >
              <IconSnow className="size-[18px]" />
            </Button>
          </span>
        ) : null}
        <Button variant="subtle" size="lg" onClick={onAdd}>
          <IconPlus className="size-[18px]" />
          <span className="hidden sm:inline">{view === 'notes' ? 'Nueva nota' : 'Nueva tarea'}</span>
        </Button>
        <Button variant="primary" size="lg" onClick={onSync} loading={syncing} aria-label="Sincronizar">
          {syncing ? null : <IconSync className="size-[18px]" />}
          <span className="hidden sm:inline">{syncing ? 'Sincronizando…' : 'Sincronizar'}</span>
        </Button>
      </div>

      {/* Columna derecha vacía a propósito: es la que mantiene el grupo de
          acciones centrado respecto a la ventana, no respecto al hueco libre. */}
      <div className="hidden items-end justify-end gap-1 lg:flex">
        <XmasEmoji emoji="🎁" className="text-[15px]" />
        <XmasEmoji emoji="⛄" className="text-[18px]" />
        {festive ? (
          <button
            type="button"
            onClick={onTree}
            aria-label="Ver mi árbol de logros"
            title="Mi árbol: una esfera por cada tarea terminada"
            className="rounded-lg transition-transform duration-150 hover:scale-110"
          >
            <ChristmasTree className="h-12 w-auto" />
          </button>
        ) : null}
      </div>

      {festive ? <Garland /> : null}
    </header>
  )
}
