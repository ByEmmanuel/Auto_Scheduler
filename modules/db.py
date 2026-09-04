import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scheduler.db')


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
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
            recurrence_group  TEXT    DEFAULT ''
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
    }
    for col, stmt in migrations.items():
        if col not in existing_cols:
            cursor.execute(stmt)

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
                        submission_state='', recurrence_group=''):
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
                status = 'pending'
            WHERE source_id = ?
        ''', (title, course_name, due_date, source, int(is_urgent),
              calendar_event_id, link, description, course_id, coursework_id,
              submission_id, submission_state, source_id))
    else:
        conn.execute('''
            INSERT INTO synced_tasks
                (source_id, title, course_name, due_date, source, is_urgent,
                 calendar_event_id, link, description, course_id, coursework_id,
                 submission_id, submission_state, recurrence_group)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (source_id, title, course_name, due_date, source, int(is_urgent),
              calendar_event_id, link, description, course_id, coursework_id,
              submission_id, submission_state, recurrence_group))

    conn.commit()
    conn.close()


def update_task_notes(source_id: str, notes: str):
    conn = get_connection()
    conn.execute(
        'UPDATE synced_tasks SET notes = ? WHERE source_id = ?', (notes, source_id)
    )
    conn.commit()
    conn.close()


def update_task_status(source_id: str, status: str):
    conn = get_connection()
    conn.execute(
        'UPDATE synced_tasks SET status = ? WHERE source_id = ?', (status, source_id)
    )
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
