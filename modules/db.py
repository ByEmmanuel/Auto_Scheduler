import sqlite3
import os
import threading

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scheduler.db')


_init_lock = threading.Lock()


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    # Se llama desde varias peticiones a la vez: sin el candado, dos hilos
    # intentan añadir la misma columna y uno revienta con "duplicate column".
    with _init_lock:
        _init_db()


def _init_db():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.executescript('''
        CREATE TABLE IF NOT EXISTS synced_tasks (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            source_id         TEXT    UNIQUE NOT NULL,
            title             TEXT    NOT NULL,
            course_name       TEXT,
            due_date          TEXT,
            source            TEXT,
            is_urgent         INTEGER DEFAULT 0,
            calendar_event_id TEXT,
            link              TEXT    DEFAULT '',
            notes             TEXT    DEFAULT '',
            description       TEXT    DEFAULT '',
            synced_at         TEXT    DEFAULT (datetime('now')),
            status            TEXT    DEFAULT 'pending',
            course_id         TEXT    DEFAULT '',
            coursework_id     TEXT    DEFAULT '',
            submission_id     TEXT    DEFAULT '',
            submission_state  TEXT    DEFAULT '',
            attachments       TEXT    DEFAULT '[]',
            recurrence_group  TEXT    DEFAULT '',
            completed_by      TEXT    DEFAULT '',
            classroom_due     TEXT    DEFAULT ''
        );
    ''')

    # Migraciones de DB existente (agregar columnas si faltan)
    existing_cols = {row['name'] for row in cursor.execute('PRAGMA table_info(synced_tasks)').fetchall()}
    migrations = {
        'status':           "ALTER TABLE synced_tasks ADD COLUMN status TEXT DEFAULT 'pending'",
        'course_id':        "ALTER TABLE synced_tasks ADD COLUMN course_id TEXT DEFAULT ''",
        'coursework_id':    "ALTER TABLE synced_tasks ADD COLUMN coursework_id TEXT DEFAULT ''",
        'submission_id':    "ALTER TABLE synced_tasks ADD COLUMN submission_id TEXT DEFAULT ''",
        'submission_state': "ALTER TABLE synced_tasks ADD COLUMN submission_state TEXT DEFAULT ''",
        'attachments':      "ALTER TABLE synced_tasks ADD COLUMN attachments TEXT DEFAULT '[]'",
        'recurrence_group': "ALTER TABLE synced_tasks ADD COLUMN recurrence_group TEXT DEFAULT ''",
        'completed_by':     "ALTER TABLE synced_tasks ADD COLUMN completed_by TEXT DEFAULT ''",
        'classroom_due':    "ALTER TABLE synced_tasks ADD COLUMN classroom_due TEXT DEFAULT ''",
    }
    for col, stmt in migrations.items():
        if col not in existing_cols:
            cursor.execute(stmt)

    # Antes no se anotaba quién cerró una tarea, pero queda una huella: el botón
    # "Completar" limpiaba el id del evento y la sincronización no.
    if 'completed_by' not in existing_cols:
        cursor.execute("""
            UPDATE synced_tasks
            SET completed_by = CASE WHEN COALESCE(calendar_event_id, '') = '' THEN 'user' ELSE 'classroom' END
            WHERE status = 'completed'
        """)

    # Notas: no son tareas (no vencen, no se completan). Cada una vive en
    # Google Calendar como evento de día completo, sin alertas.
    #   status            'active' | 'archived' (borrada aquí o en Calendar)
    #   needs_push        1 si el último cambio local no llegó a Calendar: la
    #                     sincronización lo sube en vez de pisarlo con lo de allá
    #   calendar_updated  campo `updated` del evento la última vez que se
    #                     escribió o leyó: solo un evento más nuevo se trae
    cursor.executescript('''
        CREATE TABLE IF NOT EXISTS notes (
            id                TEXT PRIMARY KEY,
            title             TEXT NOT NULL,
            body              TEXT DEFAULT '',
            date              TEXT NOT NULL,
            calendar_event_id TEXT DEFAULT '',
            calendar_updated  TEXT DEFAULT '',
            status            TEXT DEFAULT 'active',
            needs_push        INTEGER DEFAULT 0,
            created_at        TEXT DEFAULT (datetime('now')),
            updated_at        TEXT DEFAULT (datetime('now'))
        );
    ''')

    conn.commit()
    conn.close()


# ── Notas ──────────────────────────────────────────────────────────────────────

NOTE_FIELDS = {'title', 'body', 'date', 'calendar_event_id', 'calendar_updated',
               'status', 'needs_push'}


def create_note(note_id: str, title: str, body: str, date: str,
                calendar_event_id: str = '', calendar_updated: str = '',
                needs_push: bool = False) -> dict:
    conn = get_connection()
    conn.execute('''
        INSERT INTO notes (id, title, body, date, calendar_event_id, calendar_updated, needs_push)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ''', (note_id, title, body, date, calendar_event_id, calendar_updated, int(needs_push)))
    conn.commit()
    conn.close()
    return get_note(note_id)


def get_note(note_id: str) -> dict | None:
    conn = get_connection()
    row = conn.execute('SELECT * FROM notes WHERE id = ?', (note_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def list_notes(status: str | None = 'active') -> list[dict]:
    conn = get_connection()
    if status is None:
        rows = conn.execute('SELECT * FROM notes').fetchall()
    else:
        rows = conn.execute('SELECT * FROM notes WHERE status = ?', (status,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def update_note(note_id: str, touch: bool = True, **fields) -> dict | None:
    """Actualiza los campos dados. `touch=False` para cambios que no hizo el
    usuario (la sincronización anotando el id o la versión del evento)."""
    fields = {k: v for k, v in fields.items() if k in NOTE_FIELDS}
    if 'needs_push' in fields:
        fields['needs_push'] = int(bool(fields['needs_push']))
    if not fields:
        return get_note(note_id)
    sets = ', '.join(f'{k} = ?' for k in fields)
    if touch:
        sets += ", updated_at = datetime('now')"
    conn = get_connection()
    conn.execute(f'UPDATE notes SET {sets} WHERE id = ?', (*fields.values(), note_id))
    conn.commit()
    conn.close()
    return get_note(note_id)


def delete_note(note_id: str):
    conn = get_connection()
    conn.execute('DELETE FROM notes WHERE id = ?', (note_id,))
    conn.commit()
    conn.close()


def is_task_synced(source_id: str) -> bool:
    conn = get_connection()
    row = conn.execute(
        'SELECT 1 FROM synced_tasks WHERE source_id = ?', (source_id,)
    ).fetchone()
    conn.close()
    return row is not None


def mark_task_as_synced(source_id, title, course_name, due_date, source,
                        calendar_event_id, is_urgent=False, link='', description='',
                        course_id='', coursework_id='', submission_id='',
                        submission_state='', recurrence_group='', classroom_due=''):
    """
    Inserta la tarea si es nueva, o actualiza sus datos de sincronización si
    ya existía (p. ej. cuando el pipeline re-crea un evento borrado a mano en
    Calendar). A propósito NO se usa INSERT OR REPLACE: esa estrategia borra
    y reinserta la fila, lo que resetea a su valor por defecto cualquier
    columna no pasada aquí (notes, attachments) y perdería las notas del
    usuario en cada re-sincronización.
    """
    conn = get_connection()
    existing = conn.execute(
        'SELECT 1 FROM synced_tasks WHERE source_id = ?', (source_id,)
    ).fetchone()

    if existing:
        conn.execute('''
            UPDATE synced_tasks SET
                title = ?, course_name = ?, due_date = ?, source = ?, is_urgent = ?,
                calendar_event_id = ?, link = ?, description = ?, course_id = ?,
                coursework_id = ?, submission_id = ?, submission_state = ?,
                classroom_due = ?, status = 'pending', completed_by = ''
            WHERE source_id = ?
        ''', (title, course_name, due_date, source, int(is_urgent),
              calendar_event_id, link, description, course_id, coursework_id,
              submission_id, submission_state, classroom_due, source_id))
    else:
        conn.execute('''
            INSERT INTO synced_tasks
                (source_id, title, course_name, due_date, source, is_urgent,
                 calendar_event_id, link, description, course_id, coursework_id,
                 submission_id, submission_state, recurrence_group, classroom_due)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (source_id, title, course_name, due_date, source, int(is_urgent),
              calendar_event_id, link, description, course_id, coursework_id,
              submission_id, submission_state, recurrence_group, classroom_due))

    conn.commit()
    conn.close()


def update_task_notes(source_id: str, notes: str):
    conn = get_connection()
    conn.execute(
        'UPDATE synced_tasks SET notes = ? WHERE source_id = ?', (notes, source_id)
    )
    conn.commit()
    conn.close()


def update_task_due_date(source_id: str, due_date: str):
    """Reprograma una tarea (drag & drop del dashboard nuevo).

    Solo toca la fecha local: mover el evento en Google Calendar es
    responsabilidad de quien llama (`calendar_sync.update_calendar_event_datetime`).
    """
    conn = get_connection()
    conn.execute(
        'UPDATE synced_tasks SET due_date = ? WHERE source_id = ?', (due_date, source_id)
    )
    conn.commit()
    conn.close()


def update_task_status(source_id: str, status: str, completed_by: str = ''):
    """Cambia el estado. `completed_by` dice quién cerró la tarea: 'user' es una
    decisión del usuario que la sincronización respeta; 'classroom' la deshace
    si Classroom vuelve a darla por pendiente."""
    conn = get_connection()
    conn.execute(
        'UPDATE synced_tasks SET status = ?, completed_by = ? WHERE source_id = ?',
        (status, completed_by, source_id)
    )
    conn.commit()
    conn.close()


def update_classroom_task(source_id: str, title: str, course_name: str, description: str,
                          link: str, classroom_due: str, due_date: str | None = None):
    """Refresca lo que manda Classroom. `due_date` solo llega si el profesor
    cambió la fecha: la del tablero puede haberla movido el usuario."""
    conn = get_connection()
    conn.execute('''
        UPDATE synced_tasks SET
            title = ?, course_name = ?, description = ?, link = ?, classroom_due = ?,
            due_date = COALESCE(?, due_date)
        WHERE source_id = ?
    ''', (title, course_name, description, link, classroom_due, due_date, source_id))
    conn.commit()
    conn.close()

def update_calendar_event_id(source_id: str, calendar_event_id: str):
    conn = get_connection()
    conn.execute(
        'UPDATE synced_tasks SET calendar_event_id = ? WHERE source_id = ?', 
        (calendar_event_id, source_id)
    )
    conn.commit()
    conn.close()


def get_known_event_ids() -> set:
    """
    Todos los `calendar_event_id` que la BD ya conoce, sin filtrar por estado.

    La importación desde Google Calendar (Paso 0 del pipeline) los usa para
    saber qué eventos son suyos y cuáles escribió el usuario a mano en su
    celular; se incluyen los completados para no reimportar como nota algo que
    ya se archivó.
    """
    conn = get_connection()
    rows = conn.execute(
        "SELECT calendar_event_id FROM synced_tasks WHERE calendar_event_id != ''"
    ).fetchall()
    conn.close()
    return {r['calendar_event_id'] for r in rows if r['calendar_event_id']}


def update_imported_task(source_id: str, title: str, due_date: str,
                         description: str, link: str, calendar_event_id: str):
    """
    Refresca una tarea importada de Google Calendar con lo que dice el evento.

    Solo toca los campos que manda Calendar: `notes`, `status` y la urgencia
    son del dashboard y se conservan, para que reeditar el evento en el celular
    no borre lo que el usuario escribió aquí.
    """
    conn = get_connection()
    conn.execute('''
        UPDATE synced_tasks SET
            title = ?, due_date = ?, description = ?, link = ?, calendar_event_id = ?
        WHERE source_id = ?
    ''', (title, due_date, description, link, calendar_event_id, source_id))
    conn.commit()
    conn.close()


def get_task_by_source_id(source_id: str):
    conn = get_connection()
    row = conn.execute(
        'SELECT * FROM synced_tasks WHERE source_id = ?', (source_id,)
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def get_all_synced(source_id_prefix: str = None, status: str = 'pending'):
    conn = get_connection()
    query = 'SELECT * FROM synced_tasks WHERE 1=1'
    params = []
    
    if status is not None:
        query += ' AND status = ?'
        params.append(status)
        
    if source_id_prefix:
        query += ' AND source_id LIKE ?'
        params.append(f'{source_id_prefix}%')
        
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_tasks_in_group(recurrence_group: str, status: str | None = 'pending'):
    """Todas las ocurrencias de una serie (creadas juntas o importadas de una
    serie repetida de Google Calendar), opcionalmente filtradas por estado."""
    if not recurrence_group:
        return []
    conn = get_connection()
    query = 'SELECT * FROM synced_tasks WHERE recurrence_group = ?'
    params = [recurrence_group]
    if status is not None:
        query += ' AND status = ?'
        params.append(status)
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def set_recurrence_group(source_id: str, recurrence_group: str):
    conn = get_connection()
    conn.execute('UPDATE synced_tasks SET recurrence_group = ? WHERE source_id = ?',
                 (recurrence_group, source_id))
    conn.commit()
    conn.close()


def delete_task(source_id: str):
    conn = get_connection()
    conn.execute('DELETE FROM synced_tasks WHERE source_id = ?', (source_id,))
    conn.commit()
    conn.close()


def clear_all():
    conn = get_connection()
    conn.execute('DELETE FROM synced_tasks')
    conn.commit()
    conn.close()


if __name__ == '__main__':
    init_db()
    print(f"✅ Base de datos inicializada en: {DB_PATH}")
