import { todayLong } from '../lib/date'
import { IconHistory, IconMoon, IconPlus, IconSearch, IconSun, IconSync } from './Icons'
import { Button, cx } from './ui'

interface Props {
  total: number
  overdue: number
  urgent: number
  query: string
  onQuery: (value: string) => void
  syncing: boolean
  onSync: () => void
  onAdd: () => void
  onHistory: () => void
  dark: boolean
  onToggleTheme: () => void
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

export function TopBar({
  total,
  overdue,
  urgent,
  query,
  onQuery,
  syncing,
  onSync,
  onAdd,
  onHistory,
  dark,
  onToggleTheme,
}: Props) {
  return (
    <header
      className={cx(
        'sticky top-0 z-30 grid h-16 shrink-0 grid-cols-[1fr_auto] items-center gap-4 px-5',
        'border-b border-line bg-surface/80 backdrop-blur-xl lg:grid-cols-[1fr_auto_1fr]',
      )}
    >
      {/* Izquierda: identidad + la fecha de hoy, escrita completa. */}
      <div className="flex min-w-0 items-center gap-4">
        <div className="flex items-center gap-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent-soft">
            <span className="size-2 rounded-full bg-accent" />
          </span>
          <div className="min-w-0">
            <div className="text-[13.5px] leading-tight font-semibold tracking-tight text-ink">
              Auto Scheduler
            </div>
            <div className="truncate text-[12.5px] leading-tight text-ink-dim first-letter:uppercase">
              {todayLong()}
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
        <div className="relative hidden sm:block">
          <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint" />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Buscar…"
            className={cx(
              'h-10 w-[168px] rounded-lg border border-line bg-sunken pr-3 pl-9 text-[13.5px] text-ink',
              'placeholder:text-ink-faint outline-none transition-all duration-200',
              'focus:w-[228px] focus:border-accent/50 focus:bg-surface',
            )}
          />
        </div>

        <Button variant="ghost" size="icon" onClick={onToggleTheme} aria-label="Cambiar tema">
          {dark ? <IconSun className="size-[18px]" /> : <IconMoon className="size-[18px]" />}
        </Button>
        <Button variant="ghost" size="icon" onClick={onHistory} aria-label="Ver historial">
          <IconHistory className="size-[18px]" />
        </Button>
        <Button variant="subtle" size="lg" onClick={onAdd}>
          <IconPlus className="size-[18px]" />
          <span className="hidden sm:inline">Nueva tarea</span>
        </Button>
        <Button variant="primary" size="lg" onClick={onSync} loading={syncing}>
          {syncing ? null : <IconSync className="size-[18px]" />}
          {syncing ? 'Sincronizando…' : 'Sincronizar'}
        </Button>
      </div>

      {/* Columna derecha vacía a propósito: es la que mantiene el grupo de
          acciones centrado respecto a la ventana, no respecto al hueco libre. */}
      <div className="hidden lg:block" aria-hidden />
    </header>
  )
}
