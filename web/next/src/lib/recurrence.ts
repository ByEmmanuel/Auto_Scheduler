import { addDaysToKey, keyToDate } from './date'

/**
 * Reglas de repetición del compositor ("cada viernes a las 11, solo 5
 * semanas").
 *
 * La serie se expande aquí, en el navegador, a una lista de fechas concretas
 * que viaja al backend como `dates`: cada ocurrencia es un evento suelto de
 * Calendar (una tarjeta = un día), y todas comparten `recurrence_group`. No se
 * crean series RRULE de Google Calendar, y nunca una sin fin: siempre hay un
 * final explícito y un tope de ocurrencias.
 */

export type RepeatKind = 'none' | 'daily' | 'weekly' | 'every'

export type RepeatEnd =
  | { kind: 'weeks'; weeks: number }
  | { kind: 'count'; count: number }
  | { kind: 'until'; date: string }

export interface RepeatRule {
  kind: RepeatKind
  /** Días de la semana, 0 = domingo … 6 = sábado (solo `weekly`). */
  weekdays: number[]
  /** Cada cuántos días (solo `every`). */
  everyDays: number
  end: RepeatEnd
}

/** Orden de la semana en México: empieza en lunes. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]
export const WEEKDAY_LETTER: Record<number, string> = {
  0: 'D',
  1: 'L',
  2: 'M',
  3: 'X',
  4: 'J',
  5: 'V',
  6: 'S',
}
export const WEEKDAY_NAME_PLURAL: Record<number, string> = {
  0: 'domingos',
  1: 'lunes',
  2: 'martes',
  3: 'miércoles',
  4: 'jueves',
  5: 'viernes',
  6: 'sábados',
}

export function weekdayOf(key: string): number {
  return keyToDate(key).getDay()
}

/** Último día que puede tener la serie, o null si el final es por número. */
function lastDay(start: string, end: RepeatEnd): string | null {
  if (end.kind === 'weeks') return addDaysToKey(start, Math.max(1, end.weeks) * 7 - 1)
  if (end.kind === 'until') return end.date
  return null
}

/**
 * Fechas ('YYYY-MM-DD') de la serie a partir de `start`, en orden. La
 * primera es el primer día que cumple la regla desde `start` (inclusive): con
 * "cada viernes" y `start` en martes, arranca el viernes siguiente.
 *
 * Con `time` se saltan las fechas cuya hora ya pasó: "cada viernes a las 11"
 * pedido un viernes por la tarde empieza el viernes siguiente, en vez de
 * nacer ya atrasado (y no cuenta para el número de veces).
 *
 * Devuelve también si hubo que recortar por el tope `max`.
 */
export function expandRule(
  start: string,
  rule: RepeatRule,
  max: number,
  time?: string,
  now: number = Date.now(),
): { dates: string[]; truncated: boolean } {
  if (rule.kind === 'none') return { dates: [start], truncated: false }

  // "Durante N semanas" cuenta desde la primera ocurrencia real, no desde el
  // día en que se abrió el compositor: "cada viernes, 5 semanas" son 5
  // viernes aunque el primero se haya saltado por ya haber pasado la hora.
  let until = rule.end.kind === 'weeks' ? null : lastDay(start, rule.end)
  const wanted = rule.end.kind === 'count' ? Math.max(1, rule.end.count) : Infinity
  // Límite duro de recorrido para que una regla rara (sin días marcados, una
  // fecha final absurda) nunca cuelgue la pestaña.
  const horizon = addDaysToKey(start, 3 * 366)

  const matches = (key: string, offset: number) => {
    if (rule.kind === 'daily') return true
    if (rule.kind === 'every') return offset % Math.max(1, rule.everyDays) === 0
    return rule.weekdays.includes(weekdayOf(key))
  }

  const dates: string[] = []
  let truncated = false
  for (let offset = 0, key = start; ; offset++, key = addDaysToKey(start, offset)) {
    if (until && key > until) break
    if (key > horizon) break
    if (dates.length >= wanted) break
    if (!matches(key, offset)) continue
    if (time && new Date(`${key}T${time}:00`).getTime() <= now) continue
    if (dates.length >= max) {
      truncated = true
      break
    }
    dates.push(key)
    if (dates.length === 1 && rule.end.kind === 'weeks') until = lastDay(key, rule.end)
  }
  return { dates, truncated }
}

/** Frase corta que describe la regla: "Cada viernes · 5 semanas". */
export function describeRule(rule: RepeatRule): string {
  let what: string
  if (rule.kind === 'daily') what = 'Todos los días'
  else if (rule.kind === 'every') what = `Cada ${rule.everyDays} días`
  else if (rule.kind === 'weekly') {
    const days = WEEK_ORDER.filter((d) => rule.weekdays.includes(d)).map((d) => WEEKDAY_NAME_PLURAL[d])
    what =
      days.length === 0
        ? 'Elige los días'
        : `Los ${days.length > 1 ? `${days.slice(0, -1).join(', ')} y ${days[days.length - 1]}` : days[0]}`
  } else return 'Una sola vez'

  const end = rule.end
  const until =
    end.kind === 'weeks'
      ? `${end.weeks} semana${end.weeks === 1 ? '' : 's'}`
      : end.kind === 'count'
        ? `${end.count} ${end.count === 1 ? 'vez' : 'veces'}`
        : 'hasta la fecha elegida'
  return `${what} · ${until}`
}
