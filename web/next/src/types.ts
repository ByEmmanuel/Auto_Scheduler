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

/** Resultado del paso Calendar → local (importar lo escrito a mano allá). */
export interface CalendarSyncSummary {
  calendar_checked: number
  calendar_scanned: number
  calendar_healed: number
  calendar_removed: number
  calendar_imported: { title: string; due_date: string }[]
  calendar_updated: number
  message: string
}

export interface SyncSummary extends CalendarSyncSummary {
  classroom_total: number
  already_synced: number
  new_synced: number
  completed_count: number
}
