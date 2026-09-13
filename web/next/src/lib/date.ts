/**
 * Utilidades de fecha.
 *
 * El backend guarda `due_date` como ISO local sin zona (p. ej.
 * "2026-09-05T23:59:00"), interpretado siempre en America/Mexico_City. Como el
 * dashboard corre en la misma máquina del usuario, basta con dejar que el
 * navegador lo lea como hora local: no hay conversión de zonas aquí.
 */

const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const DAY_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

export const UNDATED = 'Sin fecha'

/** 'YYYY-MM-DD' de una fecha, en hora local (no usa toISOString: eso es UTC). */
export function dateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function todayKey(): string {
  return dateKey(new Date())
}

/** Convierte 'YYYY-MM-DD' a un Date a medianoche local. */
export function keyToDate(key: string): Date {
  return new Date(`${key}T00:00:00`)
}

export function addDaysToKey(key: string, days: number): string {
  const d = keyToDate(key)
  d.setDate(d.getDate() + days)
  return dateKey(d)
}

/** Días entre `key` y hoy: 0 = hoy, 1 = mañana, -2 = hace dos días. */
export function daysFromToday(key: string): number {
  const target = keyToDate(key).getTime()
  const today = keyToDate(todayKey()).getTime()
  return Math.round((target - today) / 86_400_000)
}

export function isPastKey(key: string): boolean {
  return key !== UNDATED && daysFromToday(key) < 0
}

/**
 * Etiqueta de columna. Lo grande es la referencia relativa ("Hoy", "Mañana",
 * "En 3 días") porque es lo que se lee de un vistazo; debajo va siempre la
 * fecha concreta, para no tener que acordarse de qué día es hoy.
 */
export function dayLabel(key: string): { headline: string; sub: string; isToday: boolean } {
  const d = keyToDate(key)
  const diff = daysFromToday(key)

  let headline: string
  if (diff === 0) headline = 'Hoy'
  else if (diff === 1) headline = 'Mañana'
  else if (diff === -1) headline = 'Ayer'
  else if (diff > 1 && diff <= 7) headline = `En ${diff} días`
  else if (diff < -1) headline = `Hace ${Math.abs(diff)} días`
  else headline = `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`

  return {
    headline,
    sub: `${DAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`,
    isToday: diff === 0,
  }
}

const MONTH_LONG = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

/** "jueves 3 de septiembre" — la fecha de hoy, escrita completa. */
export function todayLong(): string {
  const d = new Date()
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} de ${MONTH_LONG[d.getMonth()]}`
}

/** 'YYYY-MM-DD' de una tarea; hoy si la tarea no tiene fecha válida. */
export function keyOfIso(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? todayKey() : dateKey(d)
}

export function formatTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** 'HH:MM' tal como está guardada la tarea (para conservarla al reprogramar). */
export function timeOfDay(iso: string): string {
  if (!iso) return '23:59'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '23:59'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatFull(iso: string): string {
  if (!iso) return UNDATED
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return UNDATED
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} de ${MONTH_LONG[d.getMonth()]}, ${formatTime(iso)}`
}

/** Iniciales de la semana empezando en lunes, para la cabecera del calendario. */
export const WEEK_INITIALS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

/** "septiembre 2026" — cabecera del calendario de selección múltiple. */
export function monthLabel(year: number, month: number): string {
  return `${MONTH_LONG[month]} ${year}`
}

/** Mueve un par año/mes N meses adelante o atrás, normalizando el desbordamiento. */
export function shiftMonth(year: number, month: number, delta: number): [number, number] {
  const d = new Date(year, month + delta, 1)
  return [d.getFullYear(), d.getMonth()]
}

/**
 * Rejilla del mes en semanas de lunes a domingo.
 *
 * Las casillas anteriores al día 1 y posteriores al último van como `null`:
 * así la cuadrícula conserva su forma sin tener que pintar días de los meses
 * vecinos, que en un selector múltiple solo invitan a marcar por error un día
 * que no es el que se está mirando.
 */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  // getDay() es 0=domingo; la semana del calendario empieza en lunes.
  const lead = (new Date(year, month, 1).getDay() + 6) % 7

  const cells: (string | null)[] = Array<string | null>(lead).fill(null)
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(dateKey(new Date(year, month, day)))
  }
  while (cells.length % 7 !== 0) cells.push(null)

  const weeks: (string | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

export function formatShortDate(key: string): string {
  const d = keyToDate(key)
  return `${DAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`
}

/** Una tarea está atrasada si su fecha/hora límite ya pasó. */
export function isOverdue(iso: string): boolean {
  if (!iso) return false
  const d = new Date(iso)
  return !Number.isNaN(d.getTime()) && d.getTime() < Date.now()
}

/**
 * Hora a usar al mover una tarea al día `targetKey`: se conserva la hora
 * original, salvo que al hacerlo el evento naciera ya vencido (mover a "hoy"
 * una tarea que vencía a las 08:00), en cuyo caso se manda al final del día.
 */
export function timeForMove(iso: string, targetKey: string): string {
  const time = timeOfDay(iso)
  const candidate = new Date(`${targetKey}T${time}:00`)
  if (!Number.isNaN(candidate.getTime()) && candidate.getTime() <= Date.now()) return '23:59'
  return time
}
