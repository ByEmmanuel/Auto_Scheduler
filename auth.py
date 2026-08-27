import os

# Evitar errores si Google devuelve los permisos en distinto orden o falta alguno temporalmente
os.environ['OAUTHLIB_RELAX_TOKEN_SCOPE'] = '1'

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow

# Permisos necesarios: leer cursos, leer tareas, leer entregas (para saber si ya se hizo) y acceso al calendario.
SCOPES = [
    'https://www.googleapis.com/auth/classroom.courses.readonly',
    'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
    'https://www.googleapis.com/auth/classroom.student-submissions.me.readonly',
    'https://www.googleapis.com/auth/calendar'
]

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TOKEN_PATH = os.path.join(BASE_DIR, 'token.json')
CREDS_PATH = os.path.join(BASE_DIR, 'credentials.json')

def get_credentials():
    """Obtiene las credenciales válidas o inicia el flujo OAuth2 en el navegador."""
    creds = None
    # El archivo token.json almacena los tokens de acceso y actualización de la sesión.
    if os.path.exists(TOKEN_PATH):
        creds = Credentials.from_authorized_user_file(TOKEN_PATH, SCOPES)
    
    # Si no hay credenciales válidas, solicitar inicio de sesión.
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists(CREDS_PATH):
                raise FileNotFoundError(f"El archivo credentials.json no se encuentra en: {CREDS_PATH}")
            flow = InstalledAppFlow.from_client_secrets_file(
                CREDS_PATH, SCOPES)
            # Abre el navegador para autenticarse
            creds = flow.run_local_server(port=0)
        
        # Guardar las credenciales para futuras ejecuciones
        with open(TOKEN_PATH, 'w') as token:
            token.write(creds.to_json())
            
    return creds

if __name__ == '__main__':
    print("Iniciando flujo de autenticación...")
    creds = get_credentials()
    if creds and creds.valid:
        print("\n✅ ¡Autenticación exitosa! Se ha generado el archivo 'token.json'.")
    else:
        print("\n❌ Hubo un error en la autenticación.")
