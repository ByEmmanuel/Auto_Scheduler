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
import type { Group, Task } from './types'
import { api } from './lib/api'
import {
  addDaysToKey,
  isOverdue,
  keyOfIso,
  timeForMove,
  timeOfDay,
  todayKey,
  formatShortDate,
} from './lib/date'
import { Board, boardIsEmpty } from './components/Board'
import { Composer } from './components/Composer'
import { HistoryDialog } from './components/HistoryDialog'
import { RescheduleDock } from './components/RescheduleDock'
import { TaskCard } from './components/TaskCard'
import { TaskDetail } from './components/TaskDetail'
import { TopBar } from './components/TopBar'
import { Notice, ToastStack, useToasts } from './components/Toasts'
import { IconCheck } from './components/Icons'
import { Spinner } from './components/ui'

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
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  const searchRef = useRef<HTMLDivElement>(null)
  const { toasts, push, dismiss, notice, announce, closeNotice } = useToasts()

  // ── Tema ────────────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    try {
      localStorage.setItem('as-theme', dark ? 'dark' : 'light')
    } catch {
      /* modo privado: el tema simplemente no se recuerda */
    }
  }, [dark])

  // ── Datos ───────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const data = await api.tasks()
      setTasks(data.columns.flatMap((c) => c.tasks))
    } catch (e) {
      push('error', 'No se pudo cargar el tablero', e instanceof Error ? e.message : undefined)
    } finally {
      setLoading(false)
    }
  }, [push])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * Al abrir el tablero se revisa Google Calendar antes que nada, para que las
   * notas que el usuario escribió desde el celular ya estén ahí sin tener que
   * pulsar nada. Classroom no entra aquí: es la consulta lenta y sigue detrás
   * del botón de sincronizar.
   */
  useEffect(() => {
    let cancelled = false

    const pullCalendar = async () => {
      try {
        const summary = await api.syncCalendar()
        if (cancelled) return
        const changed =
          summary.calendar_imported.length + summary.calendar_updated + summary.calendar_removed
        if (changed === 0) return

        await load()
        if (cancelled) return

        const imported = summary.calendar_imported
        if (imported.length > 0) {
          push(
            'ok',
            imported.length === 1
              ? 'Nota traída de Google Calendar'
              : `${imported.length} notas traídas de Google Calendar`,
            imported
              .slice(0, 3)
              .map((t) => `· ${t.title}`)
              .join('\n'),
          )
        }
      } catch {
        // Silencioso a propósito: es una sincronización de fondo que el usuario
        // no pidió. Si Calendar falla, el tablero se ve igual con lo que ya
        // había en la BD, y el botón de sincronizar sí reporta el error.
      }
    }

    void pullCalendar()
    return () => {
      cancelled = true
    }
  }, [load, push])

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
        push('ok', 'Tarea completada', 'Se movió al historial y salió del calendario.')
      } catch (e) {
        push('error', 'No se pudo completar', e instanceof Error ? e.message : undefined)
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

  const sync = useCallback(async () => {
    setSyncing(true)
    try {
      const summary = await api.verify()
      await load()
      const lines = [
        `${summary.classroom_total} tareas revisadas en Classroom.`,
        summary.new_synced > 0 ? `${summary.new_synced} nuevas al calendario.` : '',
        summary.completed_count > 0 ? `${summary.completed_count} entregadas retiradas.` : '',
        summary.calendar_healed > 0 ? `${summary.calendar_healed} eventos recreados.` : '',
        summary.calendar_imported.length > 0
          ? `${summary.calendar_imported.length} notas traídas de Calendar.`
          : '',
        summary.calendar_removed > 0
          ? `${summary.calendar_removed} notas borradas desde Calendar.`
          : '',
      ].filter(Boolean)
      // El resultado va grande y al centro, no en un toast: es justo lo que el
      // usuario está esperando después de pulsar el botón.
      announce('ok', 'Sincronización completa', lines.join('\n'))
    } catch (e) {
      const status = (e as { status?: number }).status
      if (status === 409) {
        announce('info', 'Ya hay una sincronización en curso', 'Espera a que termine.')
      } else {
        announce('error', 'Falló la sincronización', e instanceof Error ? e.message : undefined)
      }
    } finally {
      setSyncing(false)
    }
  }, [load, announce])

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
  const overlayOpen =
    selectedId !== null || composerDate !== null || historyOpen || notice !== null

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
        setComposerDate(todayKey())
      }
      if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.querySelector('input')?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [overlayOpen])

  /** Abrir el compositor cierra el panel de detalle: nunca dos capas a la vez. */
  const openComposer = useCallback((date: string) => {
    setSelectedId(null)
    setComposerDate(date)
  }, [])

  const empty = !loading && boardIsEmpty(groups)

  return (
    <div className="flex h-dvh flex-col bg-canvas">
      <div ref={searchRef} className="contents">
        <TopBar
          total={tasks.length}
          overdue={overdueCount}
          urgent={urgentCount}
          query={query}
          onQuery={setQuery}
          syncing={syncing}
          onSync={() => void sync()}
          onAdd={() => openComposer(todayKey())}
          onHistory={() => setHistoryOpen(true)}
          dark={dark}
          onToggleTheme={() => setDark((v) => !v)}
        />
      </div>

      <main className="min-h-0 flex-1">
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-[13px] text-ink-faint">
            <Spinner /> Cargando tablero…
          </div>
        ) : empty ? (
          <div className="anim-fade-up flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <span className="flex size-11 items-center justify-center rounded-full bg-accent-soft text-accent">
              <IconCheck className="size-5" />
            </span>
            <div>
              <p className="text-[15px] font-semibold text-ink">
                {query ? 'Sin resultados' : 'Todo al día'}
              </p>
              <p className="mt-1 text-[13px] text-ink-dim">
                {query
                  ? 'Ninguna tarea coincide con esa búsqueda.'
                  : 'No hay tareas pendientes. Sincroniza para traer lo nuevo de Classroom.'}
              </p>
            </div>
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
              onAdd={openComposer}
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
          onReschedule={reschedule}
        />
      ) : null}

      {composerDate !== null ? (
        <Composer
          initialDate={composerDate}
          onClose={() => setComposerDate(null)}
          onCreated={(count) => {
            setComposerDate(null)
            void load()
            push(
              'ok',
              count > 1 ? `${count} eventos creados` : 'Creado',
              'Ya está en tu Google Calendar.',
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

      <ToastStack toasts={toasts} onDismiss={dismiss} />
      <Notice notice={notice} onClose={closeNotice} />
    </div>
  )
}
