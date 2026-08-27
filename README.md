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

El núcleo del proyecto funciona siguiendo este pipeline secuencial de 4 pasos:

### Paso 1: Extracción de Datos (Classroom)
*   **Módulo:** `classroom_api.py`
*   El sistema llama al endpoint de cursos para obtener las clases activas.
*   Luego, itera sobre cada clase y extrae el `courseWork` (las tareas).
*   Se filtran aquellas tareas cuyo estado sea `TURNED_IN` (Entregadas) o `RETURNED` (Calificadas), quedándonos únicamente con las pendientes.
*   **Transformación de Zona Horaria:** Google Classroom devuelve la fecha y hora de entrega (`dueDate`, `dueTime`) en **UTC estricto**. El script convierte inmediatamente esta fecha a la zona horaria local (`America/Mexico_City`) para evitar desfases en la lógica posterior.

### Paso 2: Base de Datos Local (Deduplicación)
*   **Módulo:** `db.py` (SQLite)
*   Para no inundar el Google Calendar creando la misma tarea múltiples veces, el sistema utiliza una base de datos local `scheduler.db` con una tabla `synced_tasks`.
*   Cada tarea de Classroom tiene un ID único. Antes de sincronizar, verificamos si ese ID ya existe en nuestra base de datos.
*   Si ya existe, se ignora.

### Paso 3: Limpieza Automática (Auto-Cleanup)
*   **Módulo:** `main.py`
*   El pipeline extrae todas las tareas guardadas previamente en la base de datos y las compara con la nueva lista de tareas pendientes descargadas en el Paso 1.
*   Si una tarea que estaba en la base de datos **ya no aparece en la lista de Classroom** (porque se entregó recientemente), el pipeline invoca la API de Calendar para **borrar el evento del calendario** y elimina el registro de la base de datos local.

### Paso 4: Inserción (Google Calendar)
*   **Módulo:** `calendar_sync.py`
*   Por cada tarea nueva, se calcula una hora de inicio (1 hora antes de la fecha de entrega).
*   Se empaqueta un objeto JSON con el título del curso, nombre de la tarea, enlace, y zona horaria local.
*   Se inyecta un color específico para diferenciar tareas normales (Azul) y tareas urgentes/saturadas (Rojo).
*   Se llama a la API de Calendar para insertar el evento.
*   El `eventId` generado por Google Calendar se devuelve y se guarda en la base de datos SQLite para permitir futuras manipulaciones (como edición de notas o eliminación en el Paso 3).

---

## 🚀 5. Ejecución del Pipeline

Una vez configurado `credentials.json`, el flujo completo se dispara ejecutando:

```bash
python main.py
```

Al hacerlo, la consola mostrará en tiempo real:
1. Cuántas tareas pendientes encontró en Classroom.
2. Cuántas tareas antiguas fueron limpiadas/borradas.
3. Cuántas tareas nuevas se están insertando en el Calendario.
4. El resumen de la ejecución.
