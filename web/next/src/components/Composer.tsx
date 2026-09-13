import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { addDaysToKey, formatShortDate, todayKey } from '../lib/date'
import { IconBell, IconCalendar, IconClock, IconRepeat } from './Icons'
import { MultiDatePicker } from './MultiDatePicker'
import { Button, Chip, cx, Label } from './ui'

/** Tope de eventos que crea una sola vez el compositor (igual que el backend). */
const MAX_DATES = 60

const TYPES = ['Tarea Manual', 'Nota General', 'Recordatorio', 'Lectura', 'Otro']
const TYPE_LABELS: Record<string, string> = {
  'Tarea Manual': 'Tarea',
  'Nota General': 'Nota',
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

const REPEATS = [
  { value: '0', label: 'No repetir' },
  { value: '1', label: 'Diario' },
  { value: '7', label: 'Semanal' },
  { value: 'custom', label: 'Personalizado' },
]

interface Props {
  initialDate?: string
  onClose: () => void
  onCreated: (count: number) => void
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
  const [alerts, setAlerts] = useState<number[]>([])
  const [repeat, setRepeat] = useState('0')
  const [interval, setIntervalDays] = useState(1)
  const [count, setCount] = useState(5)
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
  // La repetición por intervalo solo tiene sentido en el modo de un día: con
  // días marcados a mano, el usuario ya dijo exactamente cuáles quiere.
  const repeats = !multi && repeat !== '0'
  const totalEvents = multi
    ? dates.length
    : repeats
      ? Math.max(1, Math.min(count, MAX_DATES))
      : 1

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
    setSaving(true)
    setError('')
    try {
      const res = await api.createManual({
        title: title.trim(),
        // En el modo de varios días, `dates` manda y el backend ignora el resto.
        date: multi ? dates[0] : date,
        dates: multi ? dates : null,
        time,
        type,
        notes: notes.trim(),
        reminder_minutes: alerts,
        repeat_interval_days: repeats ? interval : null,
        repeat_count: repeats ? totalEvents : 1,
      })
      onCreated(res.created?.length ?? 1)
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
      <div className="anim-fade-in absolute inset-0 bg-black/40 backdrop-blur-[3px]" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Añadir tarea o nota"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
        }}
        className="anim-pop relative w-full max-w-[520px] overflow-hidden rounded-panel border border-line bg-surface shadow-panel"
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
                  active={repeat === r.value}
                  onClick={() => {
                    setRepeat(r.value)
                    if (r.value !== '0' && r.value !== 'custom') setIntervalDays(Number(r.value))
                  }}
                >
                  {r.label}
                </Chip>
              ))}
            </div>
            {repeats ? (
              <div className="mt-2.5 flex items-center gap-2 text-[12.5px] text-ink-dim">
                <span>cada</span>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={interval}
                  onChange={(e) => setIntervalDays(Math.max(1, Number(e.target.value) || 1))}
                  className={cx(inputCls, 'tnum w-16 text-center')}
                />
                <span>días,</span>
                <input
                  type="number"
                  min={2}
                  max={60}
                  value={count}
                  onChange={(e) => setCount(Math.max(2, Number(e.target.value) || 2))}
                  className={cx(inputCls, 'tnum w-16 text-center')}
                />
                <span>veces</span>
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
              className="w-full resize-none rounded-lg border border-line bg-sunken px-3 py-2.5 text-[13px] leading-relaxed text-ink placeholder:text-ink-faint outline-none transition-colors focus:border-accent/50 focus:bg-surface"
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
                    : formatShortDate(date)}
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
