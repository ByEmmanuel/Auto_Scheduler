import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { addDaysToKey, formatShortDate, todayKey } from '../lib/date'
import {
  describeRule,
  expandRule,
  WEEK_ORDER,
  WEEKDAY_LETTER,
  weekdayOf,
  type RepeatEnd,
  type RepeatKind,
  type RepeatRule,
} from '../lib/recurrence'
import { IconBell, IconCalendar, IconClock, IconRepeat } from './Icons'
import { MultiDatePicker } from './MultiDatePicker'
import { Button, Chip, cx, Label } from './ui'

/** Tope de eventos que crea una sola vez el compositor (igual que el backend). */
const MAX_DATES = 60

// Sin "Nota": eso ahora vive en la pestaña Notas (en Calendar como evento de
// día completo, sin alertas), no como una entrega con hora.
const TYPES = ['Tarea Manual', 'Clase', 'Estudio', 'Recordatorio', 'Lectura', 'Otro']
const TYPE_LABELS: Record<string, string> = {
  'Tarea Manual': 'Tarea',
  'Nota General': 'Nota',
  Clase: 'Clase',
  Estudio: 'Estudio',
  Recordatorio: 'Recordatorio',
  Lectura: 'Lectura',
  Otro: 'Otro',
}

const ALERTS: Array<{ value: number; label: string }> = [
  { value: 10, label: '10 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hora' },
  { value: 1440, label: '1 día' },
]

const REPEATS: Array<{ value: RepeatKind; label: string }> = [
  { value: 'none', label: 'No repetir' },
  { value: 'weekly', label: 'Semanal' },
  { value: 'daily', label: 'Diario' },
  { value: 'every', label: 'Cada N días' },
]

const END_KINDS: Array<{ value: RepeatEnd['kind']; label: string }> = [
  { value: 'weeks', label: 'Durante' },
  { value: 'count', label: 'Número de veces' },
  { value: 'until', label: 'Hasta' },
]

/** Fechas de la vista previa antes de resumir con "+N más". */
const PREVIEW_MAX = 10

interface Props {
  initialDate?: string
  onClose: () => void
  onCreated: (count: number, calendarFailed: number) => void
}

export function Composer({ initialDate, onClose, onCreated }: Props) {
  const today = todayKey()
  const [title, setTitle] = useState('')
  const [type, setType] = useState(TYPES[0])
  const [date, setDate] = useState(initialDate && initialDate !== 'Sin fecha' ? initialDate : today)
  const [time, setTime] = useState('23:59')
  // 'single' = un día (con repetición opcional por intervalo);
  // 'multi'  = varios días sueltos marcados en el calendario.
  const [mode, setMode] = useState<'single' | 'multi'>('single')
  const [dates, setDates] = useState<string[]>([])
  // Una alerta de fábrica: la app es para no olvidarse de las cosas, así que
  // lo seguro es avisar; quitarla es un clic.
  const [alerts, setAlerts] = useState<number[]>([60])
  const [repeatKind, setRepeatKind] = useState<RepeatKind>('none')
  const [weekdays, setWeekdays] = useState<number[]>([])
  const [everyDays, setEveryDays] = useState(2)
  const [endKind, setEndKind] = useState<RepeatEnd['kind']>('weeks')
  const [endWeeks, setEndWeeks] = useState(5)
  const [endCount, setEndCount] = useState(5)
  const [endDate, setEndDate] = useState(() => addDaysToKey(today, 34))
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = window.setTimeout(() => titleRef.current?.focus(), 60)
    return () => window.clearTimeout(t)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const multi = mode === 'multi'
  // La repetición solo tiene sentido en el modo de un día: con días marcados a
  // mano, el usuario ya dijo exactamente cuáles quiere.
  const repeats = !multi && repeatKind !== 'none'

  const rule: RepeatRule = {
    kind: repeatKind,
    // Semanal sin días marcados usa el día de la fecha de inicio.
    weekdays: weekdays.length > 0 ? weekdays : [weekdayOf(date)],
    everyDays,
    end:
      endKind === 'weeks'
        ? { kind: 'weeks', weeks: endWeeks }
        : endKind === 'count'
          ? { kind: 'count', count: endCount }
          : { kind: 'until', date: endDate },
  }
  const series = repeats ? expandRule(date, rule, MAX_DATES, time) : null
  const totalEvents = multi ? dates.length : series ? series.dates.length : 1

  async function submit() {
    if (!title.trim()) {
      setError('Ponle un título para poder guardarlo.')
      titleRef.current?.focus()
      return
    }
    if (multi && dates.length === 0) {
      setError('Marca al menos un día en el calendario.')
      return
    }
    if (series && series.dates.length === 0) {
      setError('Con esa regla no cae ninguna fecha. Revisa los días o el final.')
      return
    }
    setSaving(true)
    setError('')
    try {
      // Tanto los días marcados a mano como una serie repetida viajan como
      // lista de fechas concretas: el backend crea un evento en cada una.
      const list = multi ? dates : series ? series.dates : null
      const res = await api.createManual({
        title: title.trim(),
        date: list ? list[0] : date,
        dates: list,
        time,
        type,
        notes: notes.trim(),
        reminder_minutes: alerts,
        repeat_interval_days: null,
        repeat_count: 1,
      })
      onCreated(res.created?.length ?? 1, res.calendar_failed ?? 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar')
    } finally {
      setSaving(false)
    }
  }

  const presets = [
    { label: 'Hoy', key: today },
    { label: 'Mañana', key: addDaysToKey(today, 1) },
    { label: 'En 3 días', key: addDaysToKey(today, 3) },
    { label: 'Próx. semana', key: addDaysToKey(today, 7) },
  ]

  const inputCls =
    'h-9 rounded-lg border border-line bg-sunken px-2.5 text-[13px] text-ink outline-none transition-colors focus:border-accent/50'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center">
      <div className="anim-fade-in absolute inset-0 bg-black/60" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Añadir tarea o nota"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
        }}
        className="anim-pop relative w-full max-w-[520px] overflow-hidden glass-strong rounded-panel border border-line shadow-panel"
      >
        {/* Título: campo sin marco, el foco visual entra directo al texto. */}
        <div className="px-6 pt-6 pb-4">
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              if (error) setError('')
            }}
            placeholder="¿Qué necesitas recordar?"
            className="w-full bg-transparent text-[19px] leading-snug font-medium text-ink placeholder:text-ink-faint focus:outline-none"
          />

          <div className="mt-4 flex flex-wrap gap-1.5">
            {TYPES.map((t) => (
              <Chip key={t} active={type === t} onClick={() => setType(t)}>
                {TYPE_LABELS[t]}
              </Chip>
            ))}
          </div>
        </div>

        <div className="space-y-5 border-t border-line px-6 py-5">
          {/* ── Cuándo ─────────────────────────────────────────────────── */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <Label>Cuándo</Label>
              {/* Los dos modos son excluyentes: un día suelto (con repetición
                  opcional) o varios días marcados uno por uno. */}
              <div className="mb-2 flex gap-1">
                <Chip active={!multi} onClick={() => setMode('single')} className="h-7 px-2.5">
                  Un día
                </Chip>
                <Chip
                  active={multi}
                  onClick={() => {
                    // El compositor suele abrirse desde una columna concreta:
                    // ese día se hereda como primera marca en vez de empezar
                    // con el calendario vacío.
                    setDates((prev) => (prev.length === 0 ? [date] : prev))
                    setMode('multi')
                  }}
                  className="h-7 px-2.5"
                >
                  Varios días
                </Chip>
              </div>
            </div>

            {multi ? (
              <MultiDatePicker selected={dates} onChange={setDates} max={MAX_DATES} />
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {presets.map((p) => (
                  <Chip key={p.key} active={date === p.key} onClick={() => setDate(p.key)}>
                    {p.label}
                  </Chip>
                ))}
              </div>
            )}

            <div className="mt-2.5 flex items-center gap-2">
              {/* En "varios días" el calendario ya dice qué días son; aquí solo
                  queda la hora, que es la misma para todos. */}
              {multi ? null : (
                <div className="relative flex-1">
                  <IconCalendar className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-faint" />
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className={cx(inputCls, 'w-full pl-8')}
                  />
                </div>
              )}
              <div className={cx('relative', multi && 'flex-1')}>
                <IconClock className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-faint" />
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className={cx(inputCls, 'tnum pl-8', multi ? 'w-full' : 'w-[142px]')}
                  aria-label={multi ? 'Hora para todas las fechas' : 'Hora'}
                />
              </div>
            </div>
          </section>

          {/* ── Alertas ────────────────────────────────────────────────── */}
          <section>
            <Label>
              <span className="inline-flex items-center gap-1.5">
                <IconBell className="size-3" /> Alertas
              </span>
            </Label>
            <div className="flex flex-wrap gap-1.5">
              <Chip active={alerts.length === 0} onClick={() => setAlerts([])}>
                Sin alerta
              </Chip>
              {ALERTS.map((a) => (
                <Chip
                  key={a.value}
                  active={alerts.includes(a.value)}
                  onClick={() =>
                    setAlerts((prev) =>
                      prev.includes(a.value)
                        ? prev.filter((v) => v !== a.value)
                        : [...prev, a.value].sort((x, y) => x - y),
                    )
                  }
                >
                  {a.label} antes
                </Chip>
              ))}
            </div>
          </section>

          {/* ── Repetición ─────────────────────────────────────────────── */}
          {/* Sin sentido cuando ya se marcaron días concretos: el usuario acaba
              de decir exactamente cuáles quiere. */}
          <section hidden={multi}>
            <Label>
              <span className="inline-flex items-center gap-1.5">
                <IconRepeat className="size-3" /> Repetición
              </span>
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {REPEATS.map((r) => (
                <Chip
                  key={r.value}
                  active={repeatKind === r.value}
                  onClick={() => {
                    setRepeatKind(r.value)
                    if (r.value === 'weekly' && weekdays.length === 0) setWeekdays([weekdayOf(date)])
                  }}
                >
                  {r.label}
                </Chip>
              ))}
            </div>

            {repeats ? (
              <div className="mt-3 space-y-3 rounded-card border border-line bg-sunken p-3">
                {repeatKind === 'weekly' ? (
                  <div className="flex items-center gap-1.5">
                    {WEEK_ORDER.map((d) => {
                      const on = rule.weekdays.includes(d)
                      return (
                        <button
                          key={d}
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            setWeekdays((prev) => {
                              const base = prev.length > 0 ? prev : [weekdayOf(date)]
                              return base.includes(d) ? base.filter((x) => x !== d) : [...base, d]
                            })
                          }
                          className={cx(
                            'grid size-9 place-items-center rounded-full border text-[13px] font-medium transition-colors duration-150',
                            on
                              ? 'border-white bg-white text-black'
                              : 'border-line text-ink-dim hover:border-line-strong hover:text-ink',
                          )}
                        >
                          {WEEKDAY_LETTER[d]}
                        </button>
                      )
                    })}
                  </div>
                ) : null}

                {repeatKind === 'every' ? (
                  <div className="flex items-center gap-2 text-[12.5px] text-ink-dim">
                    <span>cada</span>
                    <input
                      type="number"
                      min={2}
                      max={60}
                      value={everyDays}
                      onChange={(e) => setEveryDays(Math.max(2, Number(e.target.value) || 2))}
                      className={cx(inputCls, 'tnum w-16 text-center')}
                    />
                    <span>días</span>
                  </div>
                ) : null}

                {/* Siempre con final: una serie sin fin es justo lo que llena
                    el calendario de eventos que ya no aplican. */}
                <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-dim">
                  <select
                    value={endKind}
                    onChange={(e) => setEndKind(e.target.value as RepeatEnd['kind'])}
                    className={cx(inputCls, 'pr-2')}
                    aria-label="Cuándo termina"
                  >
                    {END_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                  {endKind === 'weeks' ? (
                    <>
                      <input
                        type="number"
                        min={1}
                        max={52}
                        value={endWeeks}
                        onChange={(e) => setEndWeeks(Math.max(1, Number(e.target.value) || 1))}
                        className={cx(inputCls, 'tnum w-16 text-center')}
                        aria-label="Número de semanas"
                      />
                      <span>semanas</span>
                    </>
                  ) : endKind === 'count' ? (
                    <>
                      <input
                        type="number"
                        min={1}
                        max={MAX_DATES}
                        value={endCount}
                        onChange={(e) => setEndCount(Math.max(1, Number(e.target.value) || 1))}
                        className={cx(inputCls, 'tnum w-16 text-center')}
                        aria-label="Número de veces"
                      />
                      <span>veces</span>
                    </>
                  ) : (
                    <input
                      type="date"
                      min={date}
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className={inputCls}
                      aria-label="Fecha final"
                    />
                  )}
                </div>

                {/* Vista previa: exactamente las fechas que se van a crear. */}
                {series ? (
                  <div className="border-t border-line pt-3">
                    <p className="text-[12.5px] font-medium text-ink">
                      {describeRule(rule)} ·{' '}
                      <span className="tnum">
                        {series.dates.length} evento{series.dates.length === 1 ? '' : 's'}
                      </span>
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {series.dates.slice(0, PREVIEW_MAX).map((d) => (
                        <span
                          key={d}
                          className="rounded-full border border-line px-2 py-0.5 text-[11.5px] text-ink-dim capitalize"
                        >
                          {formatShortDate(d)}
                        </span>
                      ))}
                      {series.dates.length > PREVIEW_MAX ? (
                        <span className="px-1 py-0.5 text-[11.5px] text-ink-faint">
                          +{series.dates.length - PREVIEW_MAX} más
                        </span>
                      ) : null}
                    </div>
                    {series.truncated ? (
                      <p className="mt-2 text-[11.5px] text-danger">
                        Se recortó a {MAX_DATES} eventos, el máximo por serie.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          {/* ── Detalle ────────────────────────────────────────────────── */}
          <section>
            <Label>Detalle</Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Notas opcionales que viajan al evento de Calendar…"
              className="w-full resize-none rounded-lg border border-line bg-sunken px-3 py-2.5 text-[13px] leading-relaxed text-ink placeholder:text-ink-faint outline-none transition-colors focus:border-accent/50 focus:bg-black/40"
            />
          </section>
        </div>

        <footer className="flex items-center gap-3 border-t border-line bg-sunken/60 px-6 py-4">
          <p className="min-w-0 flex-1 text-[12px] leading-snug text-ink-dim">
            {error ? (
              <span className="text-danger">{error}</span>
            ) : (
              <>
                <span className="capitalize">
                  {multi
                    ? dates.length === 0
                      ? 'Sin fechas marcadas'
                      : dates.length === 1
                        ? formatShortDate(dates[0])
                        : `${formatShortDate(dates[0])} → ${formatShortDate(dates[dates.length - 1])}`
                    : series && series.dates.length > 1
                      ? `${formatShortDate(series.dates[0])} → ${formatShortDate(series.dates[series.dates.length - 1])}`
                      : formatShortDate(series?.dates[0] ?? date)}
                </span>
                <span className="tnum"> · {time}</span>
                {totalEvents > 1 ? ` · ${totalEvents} eventos` : ''}
                {alerts.length > 0
                  ? ` · ${alerts.length} alerta${alerts.length > 1 ? 's' : ''}`
                  : ''}
              </>
            )}
          </p>
          <Button variant="ghost" size="lg" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" size="lg" loading={saving} onClick={() => void submit()}>
            Crear
          </Button>
        </footer>
      </div>
    </div>
  )
}
