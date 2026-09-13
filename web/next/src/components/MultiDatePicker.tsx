import { useState } from 'react'
import {
  WEEK_INITIALS,
  formatShortDate,
  isPastKey,
  keyToDate,
  monthGrid,
  monthLabel,
  shiftMonth,
  todayKey,
} from '../lib/date'
import { IconChevronLeft, IconChevronRight, IconClose } from './Icons'
import { cx } from './ui'

interface Props {
  /** Días marcados, en formato 'YYYY-MM-DD'. */
  selected: string[]
  onChange: (dates: string[]) => void
  /** Tope de días marcables; al llegar, el resto se deshabilita. */
  max?: number
}

/**
 * Calendario de selección múltiple: se marcan los días sueltos que se quieran
 * ("el 8, el 12, el 14 y el 20") y se crea un evento en cada uno.
 *
 * Es distinto de la repetición por intervalo, que genera un patrón regular:
 * aquí el usuario elige exactamente qué días, sin que tengan que guardar
 * ninguna relación entre sí. Se pueden marcar días de varios meses navegando
 * con las flechas; lo elegido no se pierde al cambiar de mes.
 */
export function MultiDatePicker({ selected, onChange, max = 60 }: Props) {
  const today = todayKey()

  // El mes que se muestra al abrir es el de la primera fecha ya marcada, para
  // no perder de vista lo elegido al reabrir el compositor.
  const [[year, month], setCursor] = useState<[number, number]>(() => {
    const anchor = keyToDate(selected[0] ?? today)
    return [anchor.getFullYear(), anchor.getMonth()]
  })

  const chosen = new Set(selected)
  const atLimit = selected.length >= max

  const toggle = (key: string) => {
    if (chosen.has(key)) {
      onChange(selected.filter((d) => d !== key))
    } else if (!atLimit) {
      onChange([...selected, key].sort())
    }
  }

  const weeks = monthGrid(year, month)

  return (
    <div className="rounded-lg border border-line bg-sunken p-2.5">
      <header className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="Mes anterior"
          onClick={() => setCursor(shiftMonth(year, month, -1))}
          className="rounded-md p-1.5 text-ink-faint transition-colors hover:bg-surface hover:text-ink"
        >
          <IconChevronLeft className="size-4" />
        </button>
        <span className="text-[13px] font-medium text-ink capitalize">
          {monthLabel(year, month)}
        </span>
        <button
          type="button"
          aria-label="Mes siguiente"
          onClick={() => setCursor(shiftMonth(year, month, 1))}
          className="rounded-md p-1.5 text-ink-faint transition-colors hover:bg-surface hover:text-ink"
        >
          <IconChevronRight className="size-4" />
        </button>
      </header>

      <div className="grid grid-cols-7 gap-0.5">
        {WEEK_INITIALS.map((initial, i) => (
          <div key={i} className="pb-1 text-center text-[10.5px] font-medium text-ink-faint">
            {initial}
          </div>
        ))}

        {weeks.flat().map((key, i) => {
          if (!key) return <div key={`gap-${i}`} />

          const isChosen = chosen.has(key)
          const isToday = key === today
          const past = isPastKey(key)

          return (
            <button
              key={key}
              type="button"
              aria-pressed={isChosen}
              // Al llegar al tope solo se puede desmarcar, nunca añadir más.
              disabled={!isChosen && atLimit}
              onClick={() => toggle(key)}
              className={cx(
                'tnum flex h-8 items-center justify-center rounded-md text-[12.5px]',
                'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-30',
                isChosen
                  ? 'bg-accent font-medium text-white'
                  : cx(
                      'hover:bg-surface',
                      isToday && 'font-medium text-accent',
                      !isToday && (past ? 'text-ink-faint' : 'text-ink-dim'),
                    ),
              )}
            >
              {keyToDate(key).getDate()}
            </button>
          )
        })}
      </div>

      {selected.length > 0 ? (
        <div className="mt-2.5 border-t border-line pt-2.5">
          <div className="flex flex-wrap gap-1">
            {selected.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => toggle(key)}
                aria-label={`Quitar ${formatShortDate(key)}`}
                className={cx(
                  'inline-flex items-center gap-1 rounded-full border border-line bg-surface',
                  'px-2 py-0.5 text-[11.5px] text-ink-dim capitalize',
                  'transition-colors duration-150 hover:border-danger/40 hover:text-danger',
                )}
              >
                {formatShortDate(key)}
                <IconClose className="size-2.5" />
              </button>
            ))}
          </div>
          {atLimit ? (
            <p className="mt-1.5 text-[11px] text-ink-faint">
              Máximo {max} fechas por tarea.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-2.5 border-t border-line pt-2.5 text-[11.5px] text-ink-faint">
          Marca los días que quieras. Se creará un evento en cada uno.
        </p>
      )}
    </div>
  )
}
