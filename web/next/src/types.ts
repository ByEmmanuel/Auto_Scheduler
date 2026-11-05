export type TaskSource = 'classroom' | 'manual' | string

export interface Task {
  id: string
  title: string
  course: string
  due_date: string
  source: TaskSource
  is_urgent: boolean
  link: string
  notes: string
  description: string
  status: string
  recurrence_group: string
}

export interface BoardColumn {
  date: string
  tasks: Task[]
}

export interface BoardData {
  columns: BoardColumn[]
  total: number
}

/** Grupos que realmente se pintan: las vencidas se juntan en una sola columna. */
export interface Group {
  /** Clave del droppable: 'overdue' | 'undated' | 'YYYY-MM-DD' */
  key: string
  kind: 'overdue' | 'day' | 'undated'
  tasks: Task[]
}

export interface ManualTaskPayload {
  title: string
  date: string
  /**
   * Días sueltos marcados en el calendario del compositor ("el 8, 12, 14 y
   * 20"). Cuando viene, manda sobre `date` y sobre la repetición: se crea un
   * evento en cada fecha, todos a la misma hora.
   */
  dates?: string[] | null
  time: string
  type: string
  notes: string
  reminder_minutes: number[]
  repeat_interval_days: number | null
  repeat_count: number
}

/** Resultado del pipeline: Calendar primero, después Classroom. */
export interface SyncSummary {
  calendar_checked: number
  calendar_scanned: number
  calendar_healed: number
  calendar_removed: number
  calendar_imported: { title: string; due_date: string }[]
  calendar_updated: number
  /** Notas: lo opcional es por si el servidor aún no se reinició. */
  notes_imported?: number
  notes_updated?: number
  notes_archived?: number
  notes_failed?: boolean
  message: string
  classroom_total: number
  already_synced: number
  new_synced: number
  completed_count: number
  reopened?: { title: string }[]
  rescheduled?: { title: string }[]
  board_only?: { title: string }[]
  /** Tareas a las que Calendar no les dejó crear evento (se reintenta). */
  errors: { title: string; course: string }[]
  /** Cursos que Classroom no dejó leer: sus tareas quedan como estaban. */
  failed_courses?: string[]
}

/**
 * Nota: no vence ni se completa. En Google Calendar es un evento de día
 * completo, sin alertas y marcado como "disponible" (no ocupa la agenda).
 */
export interface Note {
  id: string
  title: string
  body: string
  /** 'YYYY-MM-DD': el día en que aparece en Calendar. */
  date: string
  status: 'active' | 'archived'
  /** False si el último cambio no llegó a Calendar (se reintenta al sincronizar). */
  calendar_synced: boolean
  updated_at: string
}

export interface NotePayload {
  title: string
  body: string
  date: string
}
