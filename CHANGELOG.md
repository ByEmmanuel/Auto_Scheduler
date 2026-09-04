# Changelog

Historial de cambios del proyecto Auto Scheduler. Orden cronológico inverso (más reciente arriba).

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
