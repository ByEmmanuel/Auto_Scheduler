import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { CollisionDetection, DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import type { Group, Note, SyncSummary, Task } from './types'
import { api } from './lib/api'
import {
  addDaysToKey,
  isOverdue,
  keyOfIso,
  timeForMove,
  timeOfDay,
  todayKey,
  formatShortDate,
  formatTime,
} from './lib/date'
import { Board, boardIsEmpty } from './components/Board'
import type { Selection } from './components/Board'
import { SleighFlight, Snowfall } from './components/Christmas'
import { TreeDialog } from './components/TreeDialog'
import { Composer } from './components/Composer'
import { HistoryDialog } from './components/HistoryDialog'
import { RescheduleDock } from './components/RescheduleDock'
import { TaskCard } from './components/TaskCard'
import { TaskDetail } from './components/TaskDetail'
import { TopBar } from './components/TopBar'
import type { View } from './components/TopBar'
import { NoteDialog } from './components/NoteDialog'
import { NotesView } from './components/NotesView'
import { Notice, useDeferredNotices, useNotices } from './components/Toasts'
import { WelcomeDialog } from './components/WelcomeDialog'
import { claimDailyWelcome, takeUpcoming } from './lib/agenda'
import { useChristmas } from './lib/season'
import { seriesPosition } from './lib/series'
import { Spinner } from './components/ui'

/** Espacio mínimo entre sincronizaciones al volver a la pestaña. */
const SYNC_EVERY_MS = 2 * 60_000
/** Lo más que la bienvenida espera a la sincronización antes de mostrarse. */
const SYNC_WAIT_MS = 8000

/** Lo que cambió en una sincronización, una línea por tema. */
function syncChanges(s: SyncSummary): string[] {
  // Un servidor sin reiniciar responde sin los campos nuevos: un resumen corto
  // no debe convertirse en un error falso.
  const reopened = s.reopened ?? []
  const rescheduled = s.rescheduled ?? []
  const boardOnly = s.board_only ?? []
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
  const titles = (list: { title: string }[]) =>
    list
      .slice(0, 3)
      .map((t) => `«${t.title}»`)
      .join(', ')
  return [
    s.completed_count > 0 ? `${n(s.completed_count, 'entregada retirada', 'entregadas retiradas')}.` : '',
    reopened.length > 0
      ? `${n(reopened.length, 'volvió', 'volvieron')} a pendientes: ${titles(reopened)}.`
      : '',
    rescheduled.length > 0
      ? `${n(rescheduled.length, 'fecha cambió', 'fechas cambiaron')} en Classroom: ${titles(rescheduled)}.`
      : '',
    s.new_synced > 0 ? `${n(s.new_synced, 'nueva', 'nuevas')} en el calendario.` : '',
    boardOnly.length > 0 ? `${n(boardOnly.length, 'nueva', 'nuevas')} sin evento: ya vencieron o no tienen fecha.` : '',
    s.calendar_imported.length > 0
      ? `${n(s.calendar_imported.length, 'nota traída', 'notas traídas')} de Calendar.`
      : '',
    s.calendar_updated > 0 ? `${n(s.calendar_updated, 'cambio traído', 'cambios traídos')} de Calendar.` : '',
    s.calendar_removed > 0 ? `${n(s.calendar_removed, 'borrada', 'borradas')} desde Calendar.` : '',
    (s.notes_imported ?? 0) > 0
      ? `${n(s.notes_imported ?? 0, 'nota nueva', 'notas nuevas')} desde Calendar.`
      : '',
    (s.notes_updated ?? 0) > 0
      ? `${n(s.notes_updated ?? 0, 'nota editada', 'notas editadas')} en Calendar.`
      : '',
    (s.notes_archived ?? 0) > 0
      ? `${n(s.notes_archived ?? 0, 'nota borrada', 'notas borradas')} en Calendar: ${(s.notes_archived ?? 0) === 1 ? 'quedó' : 'quedaron'} en Archivadas.`
      : '',
  ].filter(Boolean)
}

/** Lo que no se pudo sincronizar. Vacío si todo salió bien. */
function syncProblems(s: SyncSummary): string[] {
  const failedCourses = s.failed_courses ?? []
  const errors = s.errors ?? []
  return [
    failedCourses.length > 0
      ? `Classroom no dejó leer: ${failedCourses.join(', ')}. Sus tareas quedan como estaban.`
      : '',
    errors.length > 0
      ? `${errors.length} sin evento en Calendar; se reintentará en la próxima sincronización.`
      : '',
    s.notes_failed ? 'No se pudieron revisar las notas en Calendar; quedan como estaban.' : '',
  ].filter(Boolean)
}

/** Quita acentos para que "matematicas" encuentre "Matemáticas". */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

/**
 * Las columnas del tablero se derivan de la fecha de cada tarea (no del
 * agrupamiento que manda el backend) para que un movimiento optimista de
 * drag & drop se refleje al instante, antes de que responda el servidor.
 */
function buildGroups(tasks: Task[], query: string): Group[] {
  const q = normalize(query.trim())
  const visible = q
    ? tasks.filter((t) =>
        [t.title, t.course, t.notes].some((field) => normalize(field ?? '').includes(q)),
      )
    : tasks

  const overdue: Task[] = []
  const undated: Task[] = []
  const byDay = new Map<string, Task[]>()

  // Siempre hay columna de hoy y mañana aunque estén vacías: son el destino
  // natural al arrastrar una tarea atrasada.
  const today = todayKey()
  byDay.set(today, [])
  byDay.set(addDaysToKey(today, 1), [])

  for (const task of visible) {
    if (!task.due_date) {
      undated.push(task)
    } else if (isOverdue(task.due_date)) {
      overdue.push(task)
    } else {
      const key = keyOfIso(task.due_date)
      const bucket = byDay.get(key)
      if (bucket) bucket.push(task)
      else byDay.set(key, [task])
    }
  }

  const byTime = (a: Task, b: Task) =>
    a.due_date.localeCompare(b.due_date) || a.course.localeCompare(b.course)

  const groups: Group[] = []
  if (overdue.length > 0) {
    groups.push({ key: 'overdue', kind: 'overdue', tasks: overdue.sort(byTime) })
  }
  for (const key of [...byDay.keys()].sort()) {
    groups.push({ key, kind: 'day', tasks: byDay.get(key)!.sort(byTime) })
  }
  if (undated.length > 0) {
    groups.push({ key: 'undated', kind: 'undated', tasks: undated })
  }
  return groups
}

/** El dock flotante gana sobre las columnas que quedan debajo de él. */
const collisionDetection: CollisionDetection = (args) => {
  const isDock = (id: string) => id.startsWith('dock:')
  const dock = args.droppableContainers.filter((c) => isDock(String(c.id)))
  const dockHits = pointerWithin({ ...args, droppableContainers: dock })
  if (dockHits.length > 0) return dockHits

  const columns = args.droppableContainers.filter((c) => !isDock(String(c.id)))
  const hits = pointerWithin({ ...args, droppableContainers: columns })
  return hits.length > 0 ? hits : rectIntersection({ ...args, droppableContainers: columns })
}

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [composerDate, setComposerDate] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [dragging, setDragging] = useState<Task | null>(null)
  const [welcomeOpen, setWelcomeOpen] = useState(false)
  const christmas = useChristmas()
  const [treeOpen, setTreeOpen] = useState(false)
  const [view, setView] = useState<View>('board')
  const [notes, setNotes] = useState<Note[]>([])
  const [archivedNotes, setArchivedNotes] = useState<Note[]>([])
  const [notesLoading, setNotesLoading] = useState(true)
  /** Nota abierta en el diálogo: 'new' para crear una. */
  const [noteEditing, setNoteEditing] = useState<Note | 'new' | null>(null)
  // Selección de varias atrasadas para completarlas de una vez.
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  // Cada vuelo es un montaje nuevo; 0 = ninguno en el aire.
  const [flight, setFlight] = useState(0)
  const celebrate = useCallback(() => setFlight((n) => n + 1), [])

  const searchRef = useRef<HTMLDivElement>(null)
  // Todas las notificaciones (confirmaciones, errores, resumen de
  // sincronización) van al mismo aviso grande y centrado.
  const { notice, notify: push, notifyList, closeNotice } = useNotices()
  // Diálogo o aviso en pantalla: los avisos no pedidos esperan su turno.
  const overlayOpen =
    selectedId !== null ||
    composerDate !== null ||
    historyOpen ||
    notice !== null ||
    welcomeOpen ||
    treeOpen ||
    noteEditing !== null
  const later = useDeferredNotices(overlayOpen || dragging !== null, push)

  // ── Datos ───────────────────────────────────────────────────────────────
  /** Recarga el tablero y devuelve las tareas (null si falló). */
  const load = useCallback(async (): Promise<Task[] | null> => {
    try {
      const data = await api.tasks()
      const list = data.columns.flatMap((c) => c.tasks)
      setTasks(list)
      return list
    } catch (e) {
      push('error', 'No se pudo cargar el tablero', e instanceof Error ? e.message : undefined)
      return null
    } finally {
      setLoading(false)
    }
  }, [push])

  /** Recarga las notas (activas y archivadas). */
  const loadNotes = useCallback(async () => {
    try {
      const data = await api.notes()
      setNotes(data.notes)
      setArchivedNotes(data.archived)
    } catch (e) {
      push('error', 'No se pudieron cargar las notas', e instanceof Error ? e.message : undefined)
    } finally {
      setNotesLoading(false)
    }
  }, [push])

  /**
   * Sincronización que el usuario no pidió: al abrir y al volver a la pestaña.
   * Solo avisa si algo cambió; un 409 es otra sincronización en curso, que ya
   * deja el tablero al día. Los fallos solo se avisan al abrir: al cambiar de
   * ventana serían una interrupción repetida por algo que no se pidió.
   */
  const backgroundSync = useCallback(
    async (reportFailure: boolean) => {
      const warn = (detail: string) =>
        later(['error', 'No se pudo verificar todo', `El tablero puede estar desactualizado. ${detail}`])
      try {
        const summary = await api.verify()
        await Promise.all([load(), loadNotes()])
        const changes = syncChanges(summary)
        if (changes.length > 0) later(['ok', 'Tablero actualizado', changes.join('\n')])
        if (summary.completed_count > 0) celebrate()
        const problems = syncProblems(summary)
        if (problems.length > 0 && reportFailure) warn(problems.join('\n'))
      } catch (e) {
        if ((e as { status?: number }).status === 409 || !reportFailure) return
        warn(e instanceof Error ? e.message : '')
      }
    },
    [celebrate, later, load, loadNotes],
  )

  /**
   * Arranque: se pinta el tablero con lo que hay en la BD y se sincroniza en
   * segundo plano (primero Calendar, después Classroom). La bienvenida espera
   * unos segundos para no saludar con datos viejos; si tarda más, igual se
   * actualiza sola porque lee las tareas en vivo.
   */
  useEffect(() => {
    let cancelled = false

    const boot = async () => {
      const synced = backgroundSync(true)
      void loadNotes()
      const list = await load()
      await Promise.race([
        synced,
        new Promise<void>((r) => window.setTimeout(r, SYNC_WAIT_MS)),
      ])
      if (cancelled || !list) return
      if (claimDailyWelcome()) {
        later(() => {
          setWelcomeOpen(true)
          return null
        })
      }
    }

    void boot()
    return () => {
      cancelled = true
    }
    // Solo al abrir el tablero.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Con la pestaña abierta, entregar en Classroom o apuntar algo en el celular
   * y volver debe reflejarse sin recargar. El espacio mínimo evita una
   * sincronización por cada cambio de ventana.
   */
  useEffect(() => {
    let last = Date.now()
    const onFocus = () => {
      if (Date.now() - last < SYNC_EVERY_MS) return
      last = Date.now()
      void backgroundSync(false)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [backgroundSync])

  /**
   * Recordatorio dentro del dashboard: lo que tiene hora propia (una clase a
   * las 11:00) avisa en grande 15 minutos antes, además de las alertas de
   * Calendar en el celular.
   */
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks
  useEffect(() => {
    const check = () => {
      for (const t of takeUpcoming(tasksRef.current)) {
        // El texto se arma al mostrarse: si el aviso esperó detrás de un
        // diálogo, los minutos siguen siendo ciertos, y si la hora ya pasó se
        // anuncia como "ya empezó" en vez de un "en 15 min" falso.
        later(() => {
          const mins = Math.round((new Date(t.due_date).getTime() - Date.now()) / 60_000)
          if (mins < -30) return null
          return [
            'reminder',
            mins > 0 ? `En ${mins} min: ${t.title}` : `Ya empezó: ${t.title}`,
            `${t.course} · ${formatTime(t.due_date)}`,
          ]
        })
      }
    }
    check()
    const id = window.setInterval(check, 30_000)
    return () => window.clearInterval(id)
  }, [later])

  const groups = useMemo(() => buildGroups(tasks, query), [tasks, query])
  const selected = useMemo(() => tasks.find((t) => t.id === selectedId) ?? null, [tasks, selectedId])
  const overdueCount = useMemo(() => tasks.filter((t) => isOverdue(t.due_date)).length, [tasks])
  const urgentCount = useMemo(
    () => tasks.filter((t) => t.is_urgent && !isOverdue(t.due_date)).length,
    [tasks],
  )

  // ── Acciones ────────────────────────────────────────────────────────────
  const patchTask = useCallback((id: string, patch: Partial<Task>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }, [])

  /**
   * Mueve una tarea de día.
   *
   * `announce` es lo que distingue un movimiento del usuario de la vuelta
   * atrás: al deshacer no se ofrece otro "Deshacer", para no dejar al usuario
   * rebotando entre dos avisos.
   */
  const reschedule: (
    task: Task,
    date: string,
    time: string,
    announce?: boolean,
  ) => Promise<void> = useCallback(
    async (task: Task, date: string, time: string, announce = true) => {
      const previous = task.due_date
      patchTask(task.id, { due_date: `${date}T${time}:00` })
      try {
        const res = await api.reschedule(task.id, date, time)
        patchTask(task.id, res.task)
        if (!announce) return
        push(
          'ok',
          `Movida a ${formatShortDate(date)}`,
          res.calendar_synced
            ? `«${task.title}» · el evento de Calendar también se movió.`
            : `«${task.title}» · sin evento en Calendar que mover.`,
          // Volver al día original es imposible de hacer arrastrando cuando ese
          // día ya pasó (el tablero no tiene columnas para el pasado), así que
          // el propio aviso es la salida para revertir el movimiento.
          previous
            ? {
                label: 'Deshacer',
                onClick: () => {
                  void reschedule(
                    { ...task, due_date: `${date}T${time}:00` },
                    keyOfIso(previous),
                    timeOfDay(previous),
                    false,
                  )
                },
              }
            : undefined,
        )
      } catch (e) {
        patchTask(task.id, { due_date: previous })
        push('error', 'No se pudo reprogramar', e instanceof Error ? e.message : undefined)
      }
    },
    [patchTask, push],
  )

  const complete = useCallback(
    async (task: Task) => {
      try {
        await api.setStatus(task.id, 'completed')
        setTasks((prev) => prev.filter((t) => t.id !== task.id))
        setSelectedId(null)
        celebrate()
        push(
          'ok',
          'Tarea completada',
          `«${task.title}» se movió al historial y salió del calendario.`,
          // Completar desde la tarjeta es un solo clic: se puede errar.
          {
            label: 'Deshacer',
            onClick: () => {
              void api
                .setStatus(task.id, 'pending')
                .then(() => load())
                .catch((e) =>
                  push('error', 'No se pudo deshacer', e instanceof Error ? e.message : undefined),
                )
            },
          },
        )
      } catch (e) {
        push('error', 'No se pudo completar', e instanceof Error ? e.message : undefined)
      }
    },
    [celebrate, push, load],
  )

  // Una tarea que desapareció del tablero (sincronización de fondo, completada
  // desde el detalle) ya no puede seguir marcada.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev
      const alive = new Set(tasks.filter((t) => prev.has(t.id) && isOverdue(t.due_date)).map((t) => t.id))
      return alive.size === prev.size ? prev : alive
    })
  }, [tasks])

  const cancelSelection = useCallback(() => {
    setSelecting(false)
    setSelectedIds(new Set())
  }, [])

  /**
   * Completa de una vez las atrasadas marcadas. El aviso lista cada una con su
   * propio "Devolver", para rehacer solo la que se marcó de más.
   */
  const completeSelected = useCallback(async () => {
    const chosen = tasks.filter((t) => selectedIds.has(t.id))
    if (chosen.length === 0) return
    setBulkBusy(true)
    try {
      const { results } = await api.bulkStatus(
        chosen.map((t) => t.id),
        'completed',
      )
      const okIds = new Set(results.filter((r) => r.ok).map((r) => r.id))
      const done = chosen.filter((t) => okIds.has(t.id))
      const failed = chosen.length - done.length
      setTasks((prev) => prev.filter((t) => !okIds.has(t.id)))
      cancelSelection()
      if (done.length === 0) {
        push('error', 'No se pudo completar', results.find((r) => !r.ok)?.error)
        return
      }
      celebrate()
      notifyList(
        failed > 0 ? 'info' : 'ok',
        done.length === 1 ? '1 tarea completada' : `${done.length} tareas completadas`,
        failed > 0
          ? `Pasaron al historial. ${failed === 1 ? 'Una no se pudo' : `${failed} no se pudieron`} completar y sigue${failed === 1 ? '' : 'n'} en Atrasadas.`
          : 'Pasaron al historial. ¿Marcaste una de más? Devuélvela desde aquí.',
        done.map((t) => ({
          id: t.id,
          title: t.title,
          sub: `${t.course} · ${formatShortDate(keyOfIso(t.due_date))}`,
          actionLabel: 'Devolver',
          doneLabel: 'De vuelta',
          run: async () => {
            await api.setStatus(t.id, 'pending')
            await load()
          },
        })),
        'Deshacer todas',
      )
    } catch (e) {
      push('error', 'No se pudo completar', e instanceof Error ? e.message : undefined)
    } finally {
      setBulkBusy(false)
    }
  }, [cancelSelection, celebrate, load, notifyList, push, selectedIds, tasks])

  const selection: Selection = {
    active: selecting,
    ids: selectedIds,
    busy: bulkBusy,
    onStart: () => setSelecting(true),
    onCancel: cancelSelection,
    onToggle: (task) =>
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (next.has(task.id)) next.delete(task.id)
        else next.add(task.id)
        return next
      }),
    onToggleAll: (list) =>
      setSelectedIds((prev) =>
        list.every((t) => prev.has(t.id)) ? new Set() : new Set(list.map((t) => t.id)),
      ),
    onComplete: () => void completeSelected(),
  }

  // ── Notas ───────────────────────────────────────────────────────────────
  const archiveNote = useCallback(
    async (note: Note) => {
      try {
        const res = await api.archiveNote(note.id)
        setNoteEditing(null)
        await loadNotes()
        push(
          'ok',
          'Nota archivada',
          res.calendar_synced
            ? `«${note.title}» salió de Google Calendar. La tienes en Archivadas.`
            : `«${note.title}» está en Archivadas. Calendar no respondió: se quitará de allá al sincronizar.`,
          {
            label: 'Deshacer',
            onClick: () => {
              void api
                .restoreNote(note.id)
                .then(() => loadNotes())
                .catch((e) =>
                  push('error', 'No se pudo deshacer', e instanceof Error ? e.message : undefined),
                )
            },
          },
        )
      } catch (e) {
        push('error', 'No se pudo archivar', e instanceof Error ? e.message : undefined)
      }
    },
    [loadNotes, push],
  )

  const restoreNote = useCallback(
    async (note: Note) => {
      try {
        const res = await api.restoreNote(note.id)
        await loadNotes()
        push(
          'ok',
          'Nota recuperada',
          res.calendar_synced
            ? `«${note.title}» volvió a Google Calendar.`
            : `«${note.title}» volvió. Calendar no respondió: se subirá al sincronizar.`,
        )
      } catch (e) {
        push('error', 'No se pudo recuperar', e instanceof Error ? e.message : undefined)
      }
    },
    [loadNotes, push],
  )

  const deleteNoteForever = useCallback(
    async (note: Note) => {
      try {
        await api.deleteNote(note.id)
        setArchivedNotes((prev) => prev.filter((n) => n.id !== note.id))
        push('ok', 'Nota borrada', `«${note.title}» se borró para siempre.`)
      } catch (e) {
        push('error', 'No se pudo borrar', e instanceof Error ? e.message : undefined)
      }
    },
    [push],
  )

  const remove = useCallback(
    async (task: Task) => {
      try {
        await api.remove(task.id)
        setTasks((prev) => prev.filter((t) => t.id !== task.id))
        setSelectedId(null)
        push('ok', 'Tarea eliminada', 'También se borró su evento de Calendar.')
      } catch (e) {
        push('error', 'No se pudo eliminar', e instanceof Error ? e.message : undefined)
      }
    },
    [push],
  )

  const removeSeries = useCallback(
    async (task: Task) => {
      try {
        const res = await api.removeSeries(task.id)
        const gone = new Set(res.deleted)
        setTasks((prev) => prev.filter((t) => !gone.has(t.id)))
        setSelectedId(null)
        push(
          'ok',
          'Serie eliminada',
          `«${task.title}» ya no se repite: se ${gone.size === 1 ? 'quitó 1 fecha' : `quitaron ${gone.size} fechas`} del tablero y de Google Calendar.`,
        )
      } catch (e) {
        push('error', 'No se pudo borrar la serie', e instanceof Error ? e.message : undefined)
      }
    },
    [push],
  )

  const sync = useCallback(async () => {
    setSyncing(true)
    try {
      const summary = await api.verify()
      const problems = syncProblems(summary)
      if (summary.completed_count > 0) celebrate()
      const lines = [
        `${summary.classroom_total} pendientes revisadas en Classroom.`,
        ...syncChanges(summary),
        ...problems,
      ]
      if (problems.length > 0) push('error', 'Sincronización incompleta', lines.join('\n'))
      else push('ok', 'Sincronización completa', lines.join('\n'))
    } catch (e) {
      const status = (e as { status?: number }).status
      if (status === 409) {
        push('info', 'Ya hay una sincronización en curso', 'Espera a que termine.')
      } else {
        push('error', 'Falló la sincronización', e instanceof Error ? e.message : undefined)
      }
    } finally {
      // Aunque falle Classroom, lo que alcanzó a cambiar debe verse.
      await Promise.all([load(), loadNotes()])
      setSyncing(false)
    }
  }, [celebrate, load, loadNotes, push])

  // ── Drag & drop ─────────────────────────────────────────────────────────
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const onDragStart = (event: DragStartEvent) => {
    setDragging((event.active.data.current?.task as Task) ?? null)
  }

  const onDragEnd = (event: DragEndEvent) => {
    const task = (event.active.data.current?.task as Task) ?? null
    setDragging(null)
    if (!task || !event.over) return

    const targetKey = String(event.over.id).replace(/^(day|dock):/, '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetKey)) return
    if (targetKey === keyOfIso(task.due_date) && !isOverdue(task.due_date)) return

    void reschedule(task, targetKey, timeForMove(task.due_date, targetKey))
  }

  // ── Atajos de teclado ───────────────────────────────────────────────────

  useEffect(() => {
    // Los atajos solo aplican sobre el tablero: con un panel abierto, la tecla
    // pertenece a ese panel (p. ej. escribir una nota, cerrar con Escape).
    if (overlayOpen) return

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === 'n') {
        e.preventDefault()
        if (view === 'notes') setNoteEditing('new')
        else setComposerDate(todayKey())
      }
      if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.querySelector('input')?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [overlayOpen, view])

  /** Abrir el compositor cierra el panel de detalle: nunca dos capas a la vez. */
  const openComposer = useCallback((date: string) => {
    setSelectedId(null)
    setComposerDate(date)
  }, [])

  const empty = !loading && boardIsEmpty(groups)

  return (
    <div className="flex h-dvh flex-col">
      <div ref={searchRef} className="contents">
        <TopBar
          view={view}
          onView={(v) => {
            setView(v)
            cancelSelection()
          }}
          notesCount={notes.length}
          total={tasks.length}
          overdue={overdueCount}
          urgent={urgentCount}
          query={query}
          onQuery={setQuery}
          syncing={syncing}
          onSync={() => void sync()}
          onAdd={() => (view === 'notes' ? setNoteEditing('new') : openComposer(todayKey()))}
          onHistory={() => setHistoryOpen(true)}
          onWelcome={() => setWelcomeOpen(true)}
          onTree={() => setTreeOpen(true)}
          christmas={christmas}
        />
      </div>

      {christmas.active ? <Snowfall /> : null}
      {christmas.active && flight > 0 ? (
        <SleighFlight key={flight} onDone={() => setFlight(0)} />
      ) : null}

      <main className="min-h-0 flex-1">
        {view === 'notes' ? (
          <NotesView
            notes={notes}
            archived={archivedNotes}
            loading={notesLoading}
            query={query}
            onNew={() => setNoteEditing('new')}
            onOpen={(note) => setNoteEditing(note)}
            onRestore={restoreNote}
            onDeleteForever={deleteNoteForever}
          />
        ) : loading ? (
          <div className="flex h-full items-center justify-center gap-3 text-[15px] text-white/70">
            <Spinner className="size-4" /> Cargando tablero…
          </div>
        ) : empty ? (
          // Sin tareas el tablero se convierte en el "hero" del estilo light
          // ripple: titular enorme en blanco directamente sobre el shader.
          <div className="anim-fade-up flex h-full flex-col items-center justify-center gap-6 px-8 text-center">
            <h1 className="text-6xl font-semibold tracking-tighter text-white md:text-8xl">
              {query ? 'Sin resultados' : 'Todo al día'}
            </h1>
            <p className="max-w-2xl text-lg text-white/80 md:text-xl">
              {query
                ? 'Ninguna tarea coincide con esa búsqueda.'
                : 'No hay tareas pendientes. Sincroniza para traer lo nuevo de Classroom.'}
            </p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragCancel={() => setDragging(null)}
          >
            <Board
              groups={groups}
              dragging={dragging !== null}
              onOpen={(task) => setSelectedId(task.id)}
              onNotesSaved={(id, notes) => patchTask(id, { notes })}
              onComplete={(task) => void complete(task)}
              onAdd={openComposer}
              selection={selection}
            />

            <RescheduleDock visible={dragging !== null} />

            <DragOverlay dropAnimation={null}>
              {dragging ? <TaskCard task={dragging} overlay /> : null}
            </DragOverlay>
          </DndContext>
        )}
      </main>

      {selected ? (
        <TaskDetail
          task={selected}
          onClose={() => setSelectedId(null)}
          onNotesSaved={(id, notes) => patchTask(id, { notes })}
          onComplete={complete}
          onDelete={remove}
          onDeleteSeries={removeSeries}
          series={seriesPosition(selected, tasks)}
          onReschedule={reschedule}
        />
      ) : null}

      {composerDate !== null ? (
        <Composer
          initialDate={composerDate}
          onClose={() => setComposerDate(null)}
          onCreated={(count, calendarFailed) => {
            setComposerDate(null)
            void load()
            push(
              calendarFailed > 0 ? 'info' : 'ok',
              count > 1 ? `${count} eventos creados` : 'Creado',
              calendarFailed > 0
                ? 'Ya está en el tablero. Calendar no respondió: se reintentará al sincronizar.'
                : 'Ya está en tu Google Calendar.',
            )
          }}
        />
      ) : null}

      {noteEditing !== null ? (
        <NoteDialog
          note={noteEditing === 'new' ? undefined : noteEditing}
          onClose={() => setNoteEditing(null)}
          onArchive={(note) => void archiveNote(note)}
          onSaved={(note, calendarSynced, created) => {
            setNoteEditing(null)
            void loadNotes()
            push(
              calendarSynced ? 'ok' : 'info',
              created ? 'Nota creada' : 'Nota guardada',
              calendarSynced
                ? `«${note.title}» está en Google Calendar el ${formatShortDate(note.date)}, sin alertas.`
                : 'Quedó guardada aquí. Calendar no respondió: se subirá al sincronizar.',
            )
          }}
        />
      ) : null}

      {historyOpen ? (
        <HistoryDialog
          onClose={() => setHistoryOpen(false)}
          onRestored={() => void load()}
          onError={(message) => push('error', 'Historial', message)}
        />
      ) : null}

      {treeOpen ? (
        <TreeDialog
          tasks={tasks}
          overdue={overdueCount}
          onClose={() => setTreeOpen(false)}
          onError={(message) => push('error', 'Mi árbol', message)}
        />
      ) : null}

      {welcomeOpen ? (
        <WelcomeDialog
          tasks={tasks}
          festive={christmas.active}
          onClose={() => setWelcomeOpen(false)}
        />
      ) : null}

      <Notice notice={notice} onClose={closeNotice} />
    </div>
  )
}
