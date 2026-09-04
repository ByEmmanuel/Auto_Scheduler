# Auto Scheduler — Revisión de código (2026-09-02)

Revisión completa del repositorio (`auth.py`, `main.py`, `modules/`,
`web/`, `cli_add.py`, `cleanup.py`, `deep_cleanup.py`, `deploy/`).
Cada hallazgo tiene severidad, estado y el archivo/línea de referencia.
Este documento está pensado para poder pegarse como contexto en un futuro
prompt al modelo si aparecen bugs relacionados.

Severidades: 🔴 Alta · 🟡 Media · 🟢 Baja

---

## Corregidos en esta revisión

### 🔴 `modules/db.py` — `mark_task_as_synced` podía borrar las notas del usuario
`INSERT OR REPLACE` borra la fila existente y la vuelve a insertar completa.
Cualquier columna no pasada explícitamente (`notes`, `attachments`) vuelve a
su valor por defecto. Antes esto nunca se disparaba porque el pipeline viejo
jamás volvía a llamar `mark_task_as_synced` sobre un `source_id` ya
existente. Con el pipeline nuevo (paso 1: reconciliación con Calendar) sí
puede volver a llamarse sobre una tarea existente cuando se "sana" un evento
borrado a mano — y eso habría borrado las notas guardadas por el usuario.
**Fix:** se separó en `UPDATE` (si ya existe, preserva `notes`/`attachments`)
o `INSERT` (si es nueva).

### 🔴 `web/server.py` — `/api/verify` sin protección de concurrencia
El botón "Verificar y Sincronizar" no deshabilitaba el `<button>` (solo
cambiaba una clase CSS), y el endpoint no tenía ningún candado. Dos clics
rápidos, o dos pestañas abiertas, podían disparar el pipeline dos veces en
paralelo: ambas ejecuciones podían no ver todavía la tarea que la otra
estaba a punto de insertar y crear el mismo evento duplicado en Calendar —
justo el problema de duplicados que se pidió verificar.
**Fix:** `threading.Lock()` no bloqueante en el endpoint (responde `409` si
ya hay una sincronización en curso) + el botón ahora se deshabilita
(`btn.disabled`) mientras la petición está en vuelo.

### 🟡 `deep_cleanup.py` — el filtro de búsqueda de Calendar no es exacto
`service.events().list(q='ENTREGAR:')` usa búsqueda de texto libre de
Google (matchea título, descripción, ubicación, etc.), no un filtro exacto
de título. Un evento ajeno del usuario que simplemente mencionara esa
palabra en su descripción podía borrarse por error en una limpieza masiva.
**Fix:** se añadió un filtro local (`'ENTREGAR:' not in summary → skip`)
antes de borrar cualquier evento devuelto por la búsqueda.

---

## Documentados, sin corregir (requieren decisión de producto o son de bajo impacto)

### 🔴 Seguridad: el dashboard no tiene autenticación
`web/server.py` corre con `host='0.0.0.0'` y ningún endpoint (`/api/verify`,
`/api/manual_task`, `DELETE /api/tasks/<id>`, etc.) valida quién llama.
Cualquiera en la misma red (o con acceso a ese puerto, p. ej. si el equipo
tiene el puerto expuesto o el servicio systemd corre en un servidor
compartido) puede crear/borrar tareas y eventos en el Google Calendar del
usuario sin iniciar sesión. Si el dashboard es solo para uso local en tu
propia máquina esto es aceptable; si se piensa exponer en red o dejar
corriendo en un servidor, necesita autenticación (aunque sea básica) o
bindear a `127.0.0.1`.

### 🟡 `modules/classroom_api.py` — sin paginación
`courses().list()`, `courseWork().list()` y `studentSubmissions().list()` no
manejan `nextPageToken`. Si el usuario tiene más cursos/tareas que el tamaño
de página por defecto de la API, las tareas de más allá de esa página se
pierden silenciosamente (no aparecen ni se sincronizan, tampoco se listan
como error). Bajo riesgo con pocos cursos, pero es una limitación real de
escala.

### 🟡 Cambios de fecha en Classroom no se reflejan en Calendar
Si un profesor cambia la fecha de entrega de una tarea ya sincronizada, el
pipeline (pasos 2-3) la trata como "ya sincronizada" (tiene
`calendar_event_id` vivo) y no actualiza ni el registro local ni el evento
de Calendar con la nueva fecha. El evento en Calendar queda con la fecha
vieja hasta que la tarea se entregue/borre y se vuelva a crear. Esto ya
existía antes de esta sesión; no es nuevo, pero es relevante para el
objetivo de "sincronización correcta".

### 🟡 `modules/calendar_sync.py` — `update_calendar_event_notes` puede fallar si el evento fue editado a mano
La función busca la substring exacta `separator + marker` para reemplazar
notas previas. Si el usuario edita el evento manualmente en Google Calendar
y rompe ese formato exacto (pero deja la palabra "Mis notas:"), `.index()`
lanza `ValueError`. Queda atrapado por el `try/except` general de la función
(no rompe el servidor), pero el guardado de notas falla silenciosamente esa
vez.

### 🟢 `modules/classroom_api.py` / `cli_add.py` — inconsistencia de scopes con el README
`auth.py` pide `classroom.coursework.me` (lectura+escritura) y
`drive.file`; el README (sección 1) documenta `classroom.coursework.me.readonly`
y no menciona `drive.file`. La app nunca usa Drive (no hay subida de
adjuntos implementada), así que ese scope es más amplio de lo necesario —
vale la pena reducirlo si en algún momento se audita el consentimiento OAuth.

### 🟢 `cli_add.py` — las notas no llegan a la base de datos local
`add_manual_task()` pasa `notes` al evento de Calendar (vía `description`
del dict `task`) pero no se lo pasa a `db.mark_task_as_synced(...)`, así que
el campo `description` quedaría vacío en el dashboard para tareas creadas
por este script (a diferencia del modal "Añadir Tarea/Nota" de la web, que
sí lo hace bien). `cli_add.py` parece una herramienta secundaria/heredada
frente al modal manual de la web.

### 🟢 `cli_add.py` — hora `00:00` se reinterpreta como `23:59`
Si el usuario pasa explícitamente una fecha a medianoche, el script asume
que "no puso hora" y la cambia a las 23:59. Ambigüedad menor, de baja
frecuencia de uso.

### 🟢 Columnas de BD sin usar / feature incompleta
`synced_tasks.attachments` existe en el esquema (`db.py`) pero nunca se lee
ni se escribe en ningún lado — código muerto. `recurrence_group` sí se
escribe al crear tareas manuales repetidas, pero nada en la API ni en el
frontend lo usa para agrupar/editar/borrar la serie completa — la función
de "repetir" crea N tareas independientes sin vínculo funcional entre sí
más allá del dato guardado.

### 🟢 `deploy/auto-scheduler.service` — rutas obsoletas
Referencia `/home/byemmanuel/Desktop/Workspace/IA/Auto_Scheduler` y
`User=byemmanuel`, que no coinciden con la ruta actual del proyecto en esta
máquina (`/home/yo/Workspace/Auto-Scheduler`). Si se quiere instalar este
servicio aquí, hay que actualizar `WorkingDirectory`, `ExecStart` y `User`
antes de copiarlo a `/etc/systemd/system/`.

### 🟢 `web/static/originales/` son archivos de respaldo servidos públicamente
No es una falla de seguridad (es contenido estático sin datos sensibles),
pero la ruta catch-all `/<path:path>` de Flask los sirve igual que
`index.html`/`styles.css` si alguien pide `/originales/index.html`
directamente. Cosmético/organizacional.

---

## Confirmado correcto (verificación pedida sobre duplicados)

El pipeline de 4 pasos (`modules/sync_pipeline.py`) fue revisado línea por
línea para el caso de ejecución secuencial normal: una tarea de Classroom
solo se crea en Calendar si no existe ya un registro local con
`calendar_event_id` no vacío (`sync_from_classroom`), y `mark_task_as_synced`
usa `source_id` como clave única — no se generan eventos duplicados en un
ciclo normal de sincronización. El único vector real de duplicación era la
falta de protección ante ejecuciones concurrentes, ya corregida arriba.
