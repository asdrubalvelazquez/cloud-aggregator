# Google Picker API - Configuración

## Variables de entorno requeridas

### Frontend (Next.js)

Agregar a `.env.local` (desarrollo) y configurar en Vercel (producción):

```bash
# Google API Key - Necesaria para cargar Google Picker API
NEXT_PUBLIC_GOOGLE_API_KEY="tu_google_api_key_aqui"

# Google OAuth Client ID - Ya existe, reutilizar el mismo
NEXT_PUBLIC_GOOGLE_CLIENT_ID="tu_google_client_id.apps.googleusercontent.com"
```

### Backend (FastAPI)

No requiere cambios adicionales. Usa las variables existentes:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

---

## Configuración en Google Cloud Console

### 1. Habilitar Google Picker API

1. Ir a [Google Cloud Console](https://console.cloud.google.com/)
2. Seleccionar tu proyecto
3. Ir a **APIs & Services** > **Library**
4. Buscar "Google Picker API"
5. Click en **Enable**

### 2. Crear API Key (si no existe)

1. Ir a **APIs & Services** > **Credentials**
2. Click en **+ CREATE CREDENTIALS** > **API Key**
3. Copiar el API Key generado
4. (Opcional pero recomendado) Click en **Restrict Key**:
   - **Application restrictions**: HTTP referrers
   - Agregar dominios permitidos:
     - `http://localhost:3000/*` (desarrollo)
     - `https://tu-dominio.vercel.app/*` (producción)
   - **API restrictions**: Restrict key
   - Seleccionar: **Google Picker API**
5. Click **Save**

### 3. Configurar OAuth Client ID (ya existente)

Tu OAuth Client ID existente ya tiene configurado:
- Authorized JavaScript origins
- Authorized redirect URIs

No requiere cambios adicionales. El Picker usa el mismo Client ID.

---

## Cómo funciona con scope `drive.file`

Con el scope reducido `https://www.googleapis.com/auth/drive.file`:

1. **Antes del Picker**: La app NO puede listar todo el Drive del usuario
2. **Usuario selecciona archivos**: Al usar Google Picker, el usuario **explícitamente** selecciona archivos
3. **Después del Picker**: Los archivos seleccionados quedan **accesibles** para la app
4. **Resultado**: La app solo accede a archivos que el usuario eligió, cumpliendo con OAuth policies

### Beneficios de esta implementación:

- ✅ **Compliance**: Cumple con Google OAuth restricted scopes
- ✅ **Privacy**: Usuario tiene control total de qué archivos comparte
- ✅ **Funcionalidad**: La app puede copiar archivos seleccionados
- ✅ **UX**: Picker nativo de Google (familiar para usuarios)

---

## Testing

### Desarrollo local:

```bash
# Frontend
cd frontend
npm run dev

# Backend ya debe estar corriendo
# Asegúrate de tener las variables configuradas
```

### Verificar funcionamiento:

1. Login a la app
2. Ir a una cuenta de Drive conectada
3. Click en "📁 Seleccionar archivos (Google Picker)"
4. Debería abrir el Picker nativo de Google
5. Seleccionar archivos
6. Ver archivos seleccionados listados en la UI

### Troubleshooting:

- **Error "Google API Key o Client ID no configurado"**: Verificar variables de entorno
- **Picker no abre**: Verificar que Google Picker API esté habilitada en Console
- **Token error**: Verificar que la cuenta de Drive tenga tokens válidos en backend

---

## Endpoints

### Backend

**GET /drive/picker-token**
- Query params: `account_id` (int)
- Headers: `Authorization: Bearer {supabase_jwt}`
- Response: `{ "access_token": "...", "expires_at": "..." }`
- Validación: Verifica que account pertenece al usuario autenticado

---

## Referencias

- [Google Picker API Documentation](https://developers.google.com/drive/picker)
- [OAuth 2.0 Scopes for Google APIs](https://developers.google.com/identity/protocols/oauth2/scopes#drive)
- [drive.file scope explanation](https://developers.google.com/drive/api/guides/api-specific-auth#drive.file)
