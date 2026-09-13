# Changelog

Historial de cambios del proyecto Auto Scheduler. Orden cronológico inverso (más reciente arriba).

## [Sin publicar] — 2026-09-13

El dashboard de React pasa a ser la página principal y el resultado de la
sincronización se muestra grande y centrado.

- **Cambiado:** `GET /` sirve ahora el dashboard de React
  (`web/static/next/`). `/next` redirige a `/` para no romper marcadores, y el
  dashboard anterior queda en `GET /clasico` por si hace falta volver a él.
  El build sigue saliendo en `web/static/next/`: compilar directo a
  `web/static/` vaciaría la carpeta y se llevaría el dashboard anterior.
- **Cambiado:** el aviso con el resultado de "Sincronizar" (Classroom +
  Calendar) ya no es un toast pequeño abajo: aparece grande y centrado en
  pantalla, con un velo tenue detrás. Se cierra solo a los 9 s (12 s si es un
  error), con Escape, con la ✕ o haciendo clic fuera. Los demás avisos (tarea
  completada, movida, eliminada, notas traídas al abrir) siguen siendo toasts
  discretos abajo.

## [Sin publicar] — 2026-09-06

Sincronización en los dos sentidos con Google Calendar, selección de días
sueltos al crear una nota y arreglo del drag & drop, que solo dejaba mover una
tarea una vez.

- **Añadido (feature):** **elegir varios días concretos** al crear una tarea o
  nota. La sección "Cuándo" del compositor tiene ahora dos modos: **Un día**
  (el de siempre, con repetición opcional por intervalo) y **Varios días**, un
  calendario de selección múltiple donde se marcan los días que se quieran —el
  8, el 12, el 14 y el 20— y se crea un evento en cada uno, todos a la misma
  hora y con las mismas alertas.
  - Se pueden marcar días de meses distintos navegando con las flechas: lo ya
    elegido no se pierde al cambiar de mes. Cada fecha marcada aparece como
    una píldora bajo el calendario y se quita con un clic.
  - Es distinto de la repetición por intervalo, que genera un patrón regular;
    aquí los días no guardan ninguna relación entre sí. Por eso los dos modos
    son excluyentes y la sección "Repetición" se oculta en el modo de varios
    días.
  - Al cambiar a "Varios días" se hereda el día que ya estaba elegido, porque
    el compositor suele abrirse desde una columna concreta del tablero.
- **Cambiado:** `POST /api/manual_task` acepta `dates`, la lista de días
  concretos. Cuando viene, manda sobre `date` y sobre la repetición. Valida
  formato y existencia de cada fecha (`2026-02-30` se rechaza), ordena y
  descarta repetidas —marcar dos veces el mismo día no crea dos eventos— y
  aplica el mismo tope de 60 ocurrencias que la repetición por intervalo
  (`MAX_MANUAL_OCCURRENCES`). Todas las ocurrencias creadas de una vez
  comparten `recurrence_group`, vengan de un intervalo o de días marcados.
  El endpoint también valida ya el formato de la hora.

- **Añadido (feature):** **las notas escritas a mano en Google Calendar ya
  entran al tablero**. Hasta ahora el pipeline solo *verificaba* en Calendar
  los eventos que él mismo había creado, así que una nota añadida desde el
  celular no aparecía nunca en la computadora. El nuevo Paso 1b
  (`sync_pipeline.import_from_calendar()`) lee el calendario principal y guarda
  esos eventos como tareas con `source='calendar'`.
  - La llave local es el id del evento (`calendar_<eventId>`), que es estable
    entre dispositivos: reimportar actualiza, nunca duplica. Si editas el
    evento en el celular (título, hora, descripción), el tablero se pone al día
    en la siguiente sincronización sin perder las notas que escribiste aquí.
  - Se descartan los eventos que creó la propia app, las invitaciones de otras
    personas y los cancelados. Para reconocer lo suyo, la app ahora firma cada
    evento que crea con la propiedad privada `autoScheduler=task`.
  - De las **series repetidas** solo se importan las instancias de las próximas
    dos semanas (`RECURRING_HORIZON_DAYS`). Sin ese recorte, un evento cada dos
    días expandía 56 tarjetas en la ventana completa y dejaba el tablero
    ilegible; las siguientes entran solas conforme avanzan los días.
  - Borrar el evento en Calendar (desde donde sea) también quita la nota del
    tablero: esas notas viven en Calendar, no en la BD.
- **Añadido:** `POST /api/sync/calendar` — media sincronización, solo
  Calendar → local. **El dashboard la dispara al abrirse**, así que las notas
  del celular ya están ahí sin tener que pulsar nada. Deja fuera Classroom a
  propósito: esa es la consulta lenta y sigue detrás del botón "Sincronizar".
  Si Calendar falla, el aviso se calla (es una sincronización de fondo que el
  usuario no pidió) y el tablero se ve igual con lo que ya había en la BD.
- **Arreglado (bug):** **una tarea movida se podía volver a mover.** Solo eran
  arrastrables las tarjetas de la columna "Atrasadas" (`canDrag = group.kind
  === 'overdue'`), de modo que al soltar una tarea vencida en un día quedaba
  clavada ahí: ni se podía deshacer el movimiento ni cambiarla de día otra vez.
  Ahora **todas** las tarjetas se arrastran, estén en la columna que estén,
  incluidas las de "Sin fecha".
- **Añadido:** botón **"Deshacer"** en el aviso que confirma una
  reprogramación. El tablero no tiene columnas para días pasados, así que
  devolver una tarea a su fecha original era imposible arrastrando; el aviso es
  ahora la vía directa. Los avisos con acción duran 8 s en vez de 4,5.
- **Cambiado:** `calendar_sync.update_calendar_event_datetime()` **conserva la
  forma del evento** al moverlo. Antes lo reescribía siempre como un bloque de
  una hora que terminaba en la fecha límite; ahora mantiene la duración
  original, deja los eventos de día completo como de día completo, y acepta
  `anchor='start'` para las notas importadas de Calendar (donde la fecha
  guardada es la de inicio, no la de vencimiento).
- **Cambiado:** las tarjetas y el detalle distinguen tres orígenes —
  Classroom, Calendar y Manual — en vez de agrupar todo lo que no era
  Classroom bajo "Manual".
- **Añadido:** `db.get_known_event_ids()` y `db.update_imported_task()`. La
  segunda refresca solo lo que manda Calendar (título, fecha, descripción,
  enlace) y **no toca** `notes`, `status` ni la urgencia, para que reeditar el
  evento en el celular no borre lo que el usuario escribió en el dashboard.

## [Sin publicar] — 2026-09-03

Dashboard nuevo en `/next`, construido en paralelo al actual. **La página
principal (`/`) no se tocó**: sigue sirviendo `web/static/index.html` tal cual
hasta que se decida promover la nueva.

- **Añadido:** `web/next/` — aplicación nueva en **Vite + React 19 +
  TypeScript + Tailwind CSS v4 + dnd-kit**. Estética minimalista: superficies
  casi monocromas, un solo acento, tipografía Inter, bordes de 1px y
  movimiento discreto. Incluye tema claro/oscuro conmutable (se recuerda en
  `localStorage`), búsqueda, atajos (`n` nueva tarea, `/` buscar) y estados de
  carga/vacío. Se compila a `web/static/next/` (versionado, para que `/next`
  funcione sin tener Node instalado).
- **Añadido:** ruta `GET /next` en `web/server.py`, que sirve el dashboard
  nuevo. Si no está compilado, responde con instrucciones en vez de un 404 seco.
- **Añadido (feature):** **drag & drop de tareas atrasadas**. Todas las tareas
  cuya fecha/hora ya venció se agrupan en una columna "Atrasadas" y se pueden
  arrastrar a cualquier día del tablero. Como el tablero solo tiene columna
  para los días con tareas, al arrastrar aparece un *dock* flotante con
  atajos (Hoy / Mañana / En 3 días / Próxima semana) para mover a días vacíos.
  Se conserva la hora original de la tarea, salvo que eso la dejara vencida de
  nuevo (entonces pasa a las 23:59). El panel de detalle tiene además un campo
  fecha+hora con botón "Mover", que es la vía accesible por teclado.
- **Añadido:** `PUT /api/tasks/<source_id>/schedule` — reprograma una tarea:
  actualiza `due_date` en la BD y **mueve el evento en Google Calendar**
  (incluida la línea "📅 Fecha límite" de su descripción). Valida formato de
  fecha (`YYYY-MM-DD`) y hora (`HH:MM`); sin hora explícita conserva la que ya
  tenía la tarea. Apoyado en dos funciones nuevas:
  `db.update_task_due_date()` y `calendar_sync.update_calendar_event_datetime()`.
  Nota: la fecha de entrega real en Google Classroom no cambia (su API no lo
  permite); esto reorganiza el calendario y el tablero del usuario.
- **Cambiado (feature):** **edición de notas**. Antes había que abrir el modal,
  escribir y acordarse de pulsar "GUARDAR NOTAS". Ahora las notas se guardan
  solas ~1s después de dejar de escribir (y al salir del campo), con
  Ctrl/⌘+Enter para forzar el guardado y Esc para descartar lo no guardado. El
  estado siempre está a la vista ("Guardando…" / "Guardado · Calendar
  actualizado"). Además se pueden editar **desde la propia tarjeta** del
  tablero, sin abrir el detalle.
- **Cambiado (feature):** **tarjeta de "añadir recordatorio/nota"** rediseñada:
  título como campo sin marco, chips de tipo, atajos de fecha (Hoy / Mañana /
  En 3 días / Próx. semana) junto a los campos de fecha y hora, alertas
  múltiples, repetición con configuración en línea y una línea de resumen en el
  pie que dice exactamente qué se va a crear ("Vie 4 Sep · 23:59 · 2 alertas").
- **Cambiado:** el detalle de una tarea se abre como **diálogo centrado** (no
  como panel lateral): al seleccionar una tarea la atención se queda en el
  centro de la pantalla, donde el usuario ya estaba mirando, en vez de saltar a
  una orilla y perder el foco. Incluye confirmación de borrado en línea (sin
  `window.confirm`).
- **Cambiado:** las cabeceras de columna ponen en grande la referencia relativa
  ("Hoy", "Mañana", "En 3 días") con la fecha concreta debajo ("jue 3 sep"), y
  la columna de hoy va marcada con el color de acento. La barra superior
  muestra además la fecha de hoy escrita completa ("jueves 3 de septiembre").
  Todo esto para no tener que acordarse de qué día es hoy.
- **Cambiado:** nada de la interfaz vive ya pegado al borde derecho. La
  búsqueda y los botones de acción (tema, historial, "Nueva tarea",
  "Sincronizar") están **centrados** en la barra superior y son más grandes
  (40px de alto); el historial pasó de panel lateral a diálogo centrado; y los
  avisos emergentes salen abajo al centro en vez de en la esquina. La barra
  superior es una rejilla de tres columnas con la tercera vacía a propósito:
  es lo que mantiene el grupo centrado respecto a la ventana y no respecto al
  hueco libre. Los tamaños de botón se eligen con una prop `size` en vez de
  clases sueltas, porque dos utilidades de alto en el mismo elemento no se
  resuelven por orden de escritura.

Probado de punta a punta contra el backend real: creación, arrastre de una
tarjeta atrasada a otro día (verificando que el evento se movió en Google
Calendar), autoguardado de notas, borrado y cambio de tema.

## [Sin publicar] — 2026-09-02

Revisión de código completa (ver `KNOWN_ISSUES.md`) con los siguientes fixes y cambios:

- **Añadido:** `KNOWN_ISSUES.md` — documento de revisión de código con hallazgos por severidad (🔴 alta, 🟡 media, 🟢 baja).
- **Añadido:** `modules/sync_pipeline.py` — consolida la lógica de sincronización que antes estaba repartida entre `main.py` y `web/server.py`.
- **Añadido:** `start.sh` — script de arranque del proyecto.
- **Corregido** 🔴 `modules/db.py`: `mark_task_as_synced` usaba `INSERT OR REPLACE`, lo que podía borrar `notes`/`attachments` del usuario al re-sincronizar una tarea existente. Se separó en `UPDATE` (preserva esos campos) vs `INSERT`.
- **Corregido** 🔴 `web/server.py`: el endpoint `/api/verify` no tenía protección de concurrencia — dos clics o pestañas abiertas podían disparar el pipeline en paralelo y duplicar eventos en Calendar. Se agregó un `threading.Lock()` no bloqueante (responde `409` si ya hay una sincronización en curso) y el botón del frontend ahora se deshabilita mientras la petición está en vuelo.
- **Corregido** 🟡 `deep_cleanup.py`: el filtro de búsqueda en Calendar (`q='ENTREGAR:'`) usaba texto libre de Google (matchea título, descripción, ubicación, etc.), no coincidencia exacta de título, con riesgo de borrar eventos ajenos que solo mencionaran esa palabra. Se añadió un filtro local que descarta cualquier evento cuyo título no contenga exactamente `'ENTREGAR:'` antes de borrarlo.
- **Modificado:** `main.py` y `web/server.py` reducidos y simplificados al mover la lógica de sync a `modules/sync_pipeline.py`.
- **Modificado:** `modules/calendar_sync.py`, `README.md`, `.gitignore`, `web/static/index.html` — ajustes menores asociados a los cambios anteriores.

## [b44006b] — 2026-08-31

feat: add deploy config and refine calendar sync, classroom API, and dashboard UI

## [18e3249] — 2026-08-27

feat: Add completed tasks history, minimal manual modal, and calendar push reminders

## [5501b4e] — 2026-08-27

docs: add pipeline documentation

## [43d4da4] — 2026-08-27

Initial commit: Auto Scheduler with Dashboard and Brutalist Dark Theme
