import type { BoardData, ManualTaskPayload, Note, NotePayload, SyncSummary, Task } from '../types'

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

  /** Completa (o devuelve a pendientes) varias tareas; responde una por una. */
  bulkStatus: (ids: string[], status: 'pending' | 'completed') =>
    request<{ results: { id: string; ok: boolean; error?: string }[] }>('/api/tasks/bulk_status', {
      method: 'POST',
      body: JSON.stringify({ ids, status }),
    }),

  remove: (id: string) =>
    request<{ success: boolean }>(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  /** Borra la serie completa (repetida) a la que pertenece la tarea. */
  removeSeries: (id: string) =>
    request<{ deleted: string[] }>(`/api/tasks/${encodeURIComponent(id)}/series`, {
      method: 'DELETE',
    }),

  createManual: (payload: ManualTaskPayload) =>
    request<{ created: string[]; calendar_failed: number }>('/api/manual_task', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  notes: () => request<{ notes: Note[]; archived: Note[] }>('/api/notes'),

  createNote: (payload: NotePayload) =>
    request<{ note: Note; calendar_synced: boolean }>('/api/notes', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateNote: (id: string, payload: Partial<NotePayload>) =>
    request<{ note: Note; calendar_synced: boolean }>(`/api/notes/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  archiveNote: (id: string) =>
    request<{ note: Note; calendar_synced: boolean }>(
      `/api/notes/${encodeURIComponent(id)}/archive`,
      { method: 'POST' },
    ),

  restoreNote: (id: string) =>
    request<{ note: Note; calendar_synced: boolean }>(
      `/api/notes/${encodeURIComponent(id)}/restore`,
      { method: 'POST' },
    ),

  deleteNote: (id: string) =>
    request<{ success: boolean }>(`/api/notes/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  /** Sincroniza Calendar y después Classroom. Lo llama el botón, y el tablero
   *  solo al abrirse y al volver a la pestaña. */
  verify: () => request<SyncSummary>('/api/verify', { method: 'POST' }),
}
