import type { Task } from '../types'
import { isOverdue, keyOfIso, timeOfDay, todayKey } from './date'
import { inSeries } from './series'

/**
 * Ayudas "para no olvidar": el resumen del día que aparece al abrir el
 * tablero y los recordatorios de lo que está por empezar.
 */

/** Minutos de anticipación del recordatorio dentro del dashboard. */
export const REMIND_BEFORE_MIN = 15

/** Hora que el backend usa como "fin del día" para las entregas sin hora. */
const END_OF_DAY = '23:59'

const WELCOME_KEY = 'as-welcome-day'
const REMINDED_KEY = 'as-reminded'

function greeting(now: Date): string {
  const h = now.getHours()
  if (h < 12) return 'Buenos días'
  if (h < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

/** Una tarea de la lista; `more` son las fechas siguientes de su serie. */
export interface WelcomeItem {
  task: Task
  more: number
}

/** Lo pendiente de un origen: el total, lo atrasado y lo que sigue después de hoy. */
export interface WelcomeSource {
  total: number
  overdueCount: number
  /** La más reciente primero: lo que venció ayer aún se puede rescatar. */
  overdue: WelcomeItem[]
  upcoming: WelcomeItem[]
}

export interface Welcome {
  greeting: string
  today: Task[]
  classroom: WelcomeSource
  /** Manuales + notas de Google Calendar: lo que escribió el usuario. */
  personal: WelcomeSource
  /** Por entregar de hoy en adelante (lo de hoy incluido); cada serie cuenta una vez. */
  dueCount: number
  overdue: number
  undated: number
}

/**
 * Una serie aparece una sola vez, en su próxima fecha: "Pagar Tarjetas" tiene
 * una fecha por mes y, sin esto, llenaría la lista y taparía las entregas.
 */
function collapseSeries(tasks: Task[]): WelcomeItem[] {
  const heads = new Map<string, WelcomeItem>()
  const items: WelcomeItem[] = []
  for (const task of tasks) {
    const head = inSeries(task) ? heads.get(task.recurrence_group) : undefined
    if (head) {
      head.more += 1
      continue
    }
    const item = { task, more: 0 }
    items.push(item)
    if (inSeries(task)) heads.set(task.recurrence_group, item)
  }
  return items
}

/**
 * Resumen de bienvenida. Cada tarea cae en un solo grupo con el mismo criterio
 * del tablero: atrasada (ya pasó su hora), por entregar o sin fecha.
 */
export function buildWelcome(tasks: Task[]): Welcome {
  const today = todayKey()
  const due = tasks
    .filter((t) => t.due_date && !isOverdue(t.due_date))
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
  const afterToday = due.filter((t) => keyOfIso(t.due_date) !== today)
  const late = tasks
    .filter((t) => isOverdue(t.due_date))
    .sort((a, b) => b.due_date.localeCompare(a.due_date))

  const summarize = (belongs: (t: Task) => boolean): WelcomeSource => ({
    total: tasks.filter(belongs).length,
    overdueCount: late.filter(belongs).length,
    overdue: collapseSeries(late.filter(belongs)),
    upcoming: collapseSeries(afterToday.filter(belongs)),
  })

  return {
    greeting: greeting(new Date()),
    today: due.filter((t) => keyOfIso(t.due_date) === today),
    classroom: summarize((t) => t.source === 'classroom'),
    personal: summarize((t) => t.source !== 'classroom'),
    dueCount: collapseSeries(due).length,
    overdue: late.length,
    undated: tasks.filter((t) => !t.due_date).length,
  }
}

/** 'Todo el día' para las entregas sin hora propia; si no, la hora. */
export function dueTimeLabel(iso: string): string {
  const time = timeOfDay(iso)
  return time === END_OF_DAY ? 'Todo el día' : time
}

/** True la primera vez que se pregunta en el día (y lo deja anotado). */
export function claimDailyWelcome(): boolean {
  const today = todayKey()
  try {
    if (localStorage.getItem(WELCOME_KEY) === today) return false
    localStorage.setItem(WELCOME_KEY, today)
  } catch {
    /* sin almacenamiento: se muestra en cada apertura, no pasa nada */
  }
  return true
}

/**
 * Tareas con hora propia (una clase a las 11:00, no una entrega a las 23:59)
 * que empiezan dentro de los próximos minutos y de las que aún no se avisó.
 * Lo avisado se anota en localStorage para no repetirlo al recargar.
 */
export function takeUpcoming(tasks: Task[], now = Date.now()): Task[] {
  let reminded: string[] = []
  try {
    reminded = JSON.parse(localStorage.getItem(REMINDED_KEY) ?? '[]')
  } catch {
    reminded = []
  }

  const due = tasks.filter((t) => {
    if (!t.due_date || timeOfDay(t.due_date) === END_OF_DAY) return false
    const at = new Date(t.due_date).getTime()
    const mins = (at - now) / 60_000
    return mins > 0 && mins <= REMIND_BEFORE_MIN && !reminded.includes(`${t.id}|${t.due_date}`)
  })

  if (due.length > 0) {
    const next = [...reminded, ...due.map((t) => `${t.id}|${t.due_date}`)].slice(-100)
    try {
      localStorage.setItem(REMINDED_KEY, JSON.stringify(next))
    } catch {
      /* sin almacenamiento: a lo sumo se repite el aviso al recargar */
    }
  }
  return due
}
