#!/usr/bin/env bash
# start.sh – Un solo comando para arrancar Auto Scheduler:
#   1. Verifica/renueva la sesión de Google (abre el navegador a pedir
#      credenciales solo si hace falta iniciar sesión).
#   2. Corre el pipeline de sincronización completo (Calendar → Classroom → Calendar).
#   3. Levanta el dashboard web (si no está corriendo ya) y lo abre en el navegador.
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

if [ ! -d venv ]; then
    echo "❌ No se encontró el entorno virtual 'venv'."
    echo "   Créalo con: python3 -m venv venv && venv/bin/pip install -r requirements.txt"
    exit 1
fi

source venv/bin/activate

if [ ! -f credentials.json ]; then
    echo "❌ Falta credentials.json en la raíz del proyecto."
    echo ""
    echo "   Es el archivo de credenciales OAuth de tu proyecto en Google Cloud"
    echo "   (tipo 'Desktop app'). Pasos:"
    echo "     1. https://console.cloud.google.com/ → crea/usa un proyecto"
    echo "     2. APIs & Services > Library → habilita 'Google Classroom API' y 'Google Calendar API'"
    echo "     3. APIs & Services > OAuth consent screen → configúrala y agrega tu correo en Test users"
    echo "     4. APIs & Services > Credentials → Create Credentials > OAuth client ID > Desktop app"
    echo "     5. Descarga el JSON, renómbralo a 'credentials.json' y ponlo en: $DIR"
    echo ""
    echo "   (Detalle completo en README.md, sección 1.)"
    exit 1
fi

echo "🔐 Verificando sesión de Google…"
python auth.py

echo ""
echo "🔄 Sincronizando Classroom → Calendar…"
python main.py

PORT=5050
URL="http://localhost:${PORT}"

if curl -s -o /dev/null "$URL"; then
    echo ""
    echo "ℹ️  El servidor web ya está corriendo en $URL"
else
    echo ""
    echo "🚀 Iniciando el servidor web…"
    nohup python web/server.py > web_server.log 2>&1 &
    disown

    for i in $(seq 1 20); do
        curl -s -o /dev/null "$URL" && break
        sleep 0.5
    done
fi

echo "🌐 Abriendo $URL en el navegador…"
if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1 &
elif command -v open >/dev/null 2>&1; then
    open "$URL"
else
    echo "   Abre manualmente: $URL"
fi
