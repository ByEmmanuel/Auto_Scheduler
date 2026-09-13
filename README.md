# Auto Scheduler: Classroom to Calendar Sync Pipeline

Este repositorio documenta el pipeline y la configuración necesaria para crear un sistema automatizado que extrae tareas pendientes de **Google Classroom** y las sincroniza automáticamente como eventos en **Google Calendar**, evitando duplicados y gestionando las zonas horarias.

> **Nota:** Este documento se centra exclusivamente en el proceso de configuración del entorno, la integración con las APIs de Google y el pipeline de sincronización de datos backend.

---

## 🏗️ 1. Configuración de Google Cloud Console

Para que el script pueda interactuar con las cuentas de Google, es estrictamente necesario configurar un proyecto en Google Cloud y habilitar las APIs correspondientes.

### Habilitar las APIs
1. Dirígete a [Google Cloud Console](https://console.cloud.google.com/).
2. Crea un nuevo proyecto (ej. `AutoScheduler`).
3. Ve a **APIs & Services > Library**.
4. Busca y habilita las siguientes dos APIs:
   * **Google Classroom API**
   * **Google Calendar API**

### Configurar la Pantalla de Consentimiento (OAuth Consent Screen)
1. Ve a **APIs & Services > OAuth consent screen**.
2. Selecciona **External** (o Internal si usas Google Workspace).
3. Llena los datos obligatorios (Nombre de la App, Correo de soporte).
4. En la sección de **Scopes** (Permisos), debes agregar los siguientes:
   * `https://www.googleapis.com/auth/classroom.courses.readonly` (Para leer la lista de clases).
   * `https://www.googleapis.com/auth/classroom.coursework.me.readonly` (Para leer las tareas del usuario).
   * `https://www.googleapis.com/auth/calendar.events` (Para crear y modificar eventos en el calendario).
5. Agrega tu correo electrónico personal en la sección de **Test users** (Usuarios de prueba) si la app no está verificada.

### Crear Credenciales OAuth 2.0
1. Ve a **APIs & Services > Credentials**.
2. Haz clic en **Create Credentials > OAuth client ID**.
3. Selecciona **Desktop app** como tipo de aplicación.
4. Una vez creado, descarga el archivo JSON generado.
5. Renombra este archivo como `credentials.json` y guárdalo en la raíz de este proyecto.

---

## ⚙️ 2. Entorno Local y Dependencias

El proyecto está construido en Python y utiliza las librerías oficiales de Google.

1. **Clonar el repositorio y preparar el entorno:**
   ```bash
   git clone git@github.com:ByEmmanuel/Auto_Scheduler.git
   cd Auto_Scheduler
   python3 -m venv venv
   source venv/bin/activate
   ```

2. **Instalar las dependencias:**
   ```bash
   pip install -r requirements.txt
   ```
   *Dependencias clave:* `google-api-python-client`, `google-auth-httplib2`, `google-auth-oauthlib`, `python-dateutil`.

---

## 🔐 3. Flujo de Autenticación (OAuth)

El archivo `auth.py` gestiona la autenticación inicial.
La primera vez que ejecutas cualquier script del pipeline (como `main.py`), sucederá lo siguiente:

1. El script lee `credentials.json`.
2. Se abrirá una pestaña en tu navegador web pidiéndote que inicies sesión con tu cuenta de Google y aceptes los permisos (Scopes) configurados.
3. Al aceptar, Google devuelve un token de acceso y un token de actualización.
4. El script guarda estos tokens en un nuevo archivo generado automáticamente llamado `token.json`.
5. **En futuras ejecuciones**, el script simplemente leerá `token.json` en segundo plano sin pedirte iniciar sesión nuevamente. Si el token expira, se refrescará automáticamente.

---

## 🔄 4. El Pipeline de Sincronización

**Módulo:** `modules/sync_pipeline.py` (usado por igual desde `main.py` y desde
el endpoint `POST /api/verify` del dashboard, para que ambos flujos se
comporten exactamente igual). El pipeline sigue este orden — **Calendar
primero, Classroom después** — precisamente para no duplicar tareas que ya
tienen un evento vivo en el calendario:

### Paso 1a: Calendar → local (reconciliación)
*   **Función:** `reconcile_calendar_with_local()` / `calendar_sync.event_exists()`
*   Antes de tocar Classroom, el sistema recorre la base de datos local
    (`scheduler.db`, tabla `synced_tasks`) y confirma en Google Calendar que
    cada evento guardado (`calendar_event_id`) **sigue existiendo**.
*   Si el evento de una tarea de Classroom o manual fue borrado a mano en
    Calendar, se limpia **solo** su `calendar_event_id` (nunca se crea ni se
    borra nada en este paso), dejándolo marcado para que el Paso 3 lo vuelva a
    crear sin duplicar el registro.
*   Si el que desapareció era una nota importada del propio Calendar
    (`source='calendar'`), se borra el registro local: esa nota vive en
    Calendar, así que borrarla allá —por ejemplo desde el celular— también la
    quita del tablero.

### Paso 1b: Calendar → local (importación)
*   **Función:** `import_from_calendar()` / `calendar_sync.list_primary_events()`
*   Trae al tablero los eventos que el usuario escribió **a mano en Google
    Calendar** (típicamente desde el celular) y que la app no conoce. Se
    guardan con `source='calendar'` y `source_id = "calendar_<eventId>"`, que
    es estable entre dispositivos: reimportar el mismo evento lo actualiza en
    vez de duplicarlo.
*   Se descartan los eventos que creó la propia app (llevan la marca privada
    `autoScheduler=task`, o su id ya está en la BD), las invitaciones de otras
    personas y los cancelados.
*   La fecha local de una nota importada es la de **inicio** del evento (si
    apuntaste algo a las 15:00, eso es lo que ves); un evento de día completo
    se ancla a las 23:59 de ese día.
*   Ventana: 7 días hacia atrás y 120 hacia adelante. De las **series
    repetidas** solo entran las instancias de las próximas dos semanas
    (`RECURRING_HORIZON_DAYS`): una clase cada dos días expandiría 56 tarjetas
    y dejaría el tablero ilegible. Las siguientes se importan solas conforme
    avanzan los días.
*   El dashboard dispara este paso **solo** (`POST /api/sync/calendar`) cada
    vez que se abre, sin tocar Classroom, que es la consulta lenta.

### Paso 2: Local → Classroom (extracción)
*   **Módulo:** `classroom_api.py`
*   El sistema llama al endpoint de cursos para obtener las clases activas,
    itera sobre cada una y extrae el `courseWork` (las tareas).
*   Se filtran las tareas cuyo estado sea `TURNED_IN` (Entregadas) o
    `RETURNED` (Calificadas), quedándonos solo con las pendientes.
*   **Transformación de Zona Horaria:** Classroom devuelve `dueDate`/`dueTime`
    en **UTC estricto**; el script las convierte de inmediato a
    `America/Mexico_City`.

### Paso 3: Diff Classroom vs. local (deduplicación + limpieza)
*   **Función:** `sync_from_classroom()`
*   Todo lo que está en Classroom y **ya tiene un evento vivo en local**
    (sobrevivió al Paso 1) se deja intacto — así nunca se duplica una tarea.
*   Todo lo que está en Classroom y **no** tiene evento vivo en local (tarea
    nueva, o sanada en el Paso 1) se inserta en Google Calendar: se calcula
    la hora de inicio (1 hora antes de vencer), se arma el evento con
    título/curso/enlace/zona horaria y un color según urgencia (🔵 normal /
    🔴 varias entregas el mismo día), y el `eventId` resultante se guarda en
    `synced_tasks`.
*   Lo que estaba en local pero **ya no aparece pendiente en Classroom**
    (se entregó/calificó) se borra de Calendar y se marca `completed` en
    local.

### Paso 4: Refresco y reporte
*   El pipeline devuelve un resumen (`run_full_sync()`); tanto la terminal
    (`main.py`) como el dashboard (toast en la web tras `/api/verify`)
    muestran ese resumen terminando con el mensaje de confirmación
    **"Sincronización completa: Calendar y Classroom están al día."**

> La lógica completa de este pipeline también vive en
> `memory/classroom-calendar-sync-pipeline.md` como referencia rápida para
> depurar problemas de sincronización sin tener que releer todo el código.

---

## 🚀 5. Ejecución

### Un solo comando (recomendado)

```bash
./start.sh
```

Esto: (1) verifica/renueva la sesión de Google — abre el navegador a pedir
credenciales solo si hace falta iniciar sesión —, (2) corre el pipeline de
sincronización de 4 pasos completo, y (3) levanta el dashboard web (si no
está corriendo ya) y lo abre automáticamente en el navegador.

### Manual / paso a paso

```bash
python main.py          # corre el pipeline por consola
python web/server.py    # levanta el dashboard en http://localhost:5050
```

### Dashboard — `http://localhost:5050`

La página principal es la app de React (Vite + React + TypeScript + Tailwind
v4 + dnd-kit), cuyo código está en `web/next/`. Tiene drag & drop para
reprogramar las tareas atrasadas, notas con guardado automático (editables
desde la propia tarjeta) y tema claro/oscuro. La antigua dirección `/next`
redirige a `/`, y el dashboard anterior (HTML + JS sin compilar) sigue
disponible en `http://localhost:5050/clasico`.

```bash
cd web/next
npm install          # solo la primera vez
npm run build        # compila a web/static/next (lo que Flask sirve en /)
npm run dev          # opcional: front en :5173 con recarga en caliente,
                     # hablando con el Flask de :5050
```

El resultado del build se versiona, así que tras un `git clone` el dashboard
funciona sin necesidad de Node; solo hace falta recompilar si se toca el
código de `web/next/`.

Al correr el pipeline (por `start.sh`, `main.py` o el botón "Sincronizar" del
dashboard) la consola/web mostrará en tiempo real:
1. Cuántos eventos de Calendar se verificaron y cuántos hubo que sanar.
2. Cuántas tareas pendientes se encontraron en Classroom.
3. Cuántas tareas nuevas se sincronizaron y cuántas se limpiaron por entregadas.
4. El mensaje final de sincronización completa.
