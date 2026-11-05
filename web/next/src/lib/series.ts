import type { Task } from '../types'

/** Prefijo de las series importadas de un evento repetido de Google Calendar. */
const CALENDAR_SERIES = 'gcal_'

/**
 * Una tarea es parte de una serie si comparte `recurrence_group` con otras:
 * las creadas juntas desde el compositor, o las instancias de un evento
 * repetido de Google Calendar. Las de Classroom nunca lo son.
 */
export function inSeries(task: Task): boolean {
  return Boolean(task.recurrence_group) && task.source !== 'classroom'
}

export function isCalendarSeries(task: Task): boolean {
  return task.recurrence_group.startsWith(CALENDAR_SERIES)
}

/** Posición de la tarea dentro de lo que queda pendiente de su serie. */
export function seriesPosition(task: Task, all: Task[]): { index: number; total: number } | null {
  if (!inSeries(task)) return null
  const siblings = all
    .filter((t) => t.recurrence_group === task.recurrence_group)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
  if (siblings.length < 2) return null
  return { index: siblings.findIndex((t) => t.id === task.id) + 1, total: siblings.length }
}
