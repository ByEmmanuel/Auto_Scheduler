import type { BoardData, CalendarSyncSummary, ManualTaskPayload, SyncSummary, Task } from '../types'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init?.headers } : init?.headers,
  })

  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    /* respuesta sin cuerpo JSON */
  }

  if (!res.ok) {
    const message =
      (data as { error?: string } | null)?.error ?? `El servidor respondió ${res.status}`
    const error = new Error(message) as Error & { status?: number }
    error.status = res.status
    throw error
  }

  return data as T
}

export const api = {
  tasks: () => request<BoardData>('/api/tasks'),

  completed: () => request<{ tasks: Task[] }>('/api/tasks/completed'),

  saveNotes: (id: string, notes: string) =>
    request<{ calendar_synced: boolean }>(`/api/tasks/${encodeURIComponent(id)}/notes`, {
      method: 'PUT',
      body: JSON.stringify({ notes }),
    }),

  /** Mueve una tarea de día (drag & drop y campo "reprogramar"). */
  reschedule: (id: string, date: string, time?: string) =>
    request<{ task: Task; calendar_synced: boolean }>(
      `/api/tasks/${encodeURIComponent(id)}/schedule`,
      { method: 'PUT', body: JSON.stringify({ date, time }) },
    ),

  setStatus: (id: string, status: 'pending' | 'completed') =>
    request<{ status: string }>(`/api/tasks/${encodeURIComponent(id)}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    }),

  remove: (id: string) =>
    request<{ success: boolean }>(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  createManual: (payload: ManualTaskPayload) =>
    request<{ created: string[] }>('/api/manual_task', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  verify: () => request<SyncSummary>('/api/verify', { method: 'POST' }),

  /**
   * Solo Calendar → local. El tablero la llama al abrirse para traer las notas
   * que el usuario escribió desde el celular; no consulta Classroom, que es la
   * parte lenta y vive en el botón de sincronizar.
   */
  syncCalendar: () => request<CalendarSyncSummary>('/api/sync/calendar', { method: 'POST' }),
}
