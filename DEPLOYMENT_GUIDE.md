# Cloud Aggregator - Configuración Completa

## 📋 Resumen de Cambios

Se implementó autenticación completa con Supabase OAuth, incluyendo:

- ✅ Landing page en `/` (público)
- ✅ Login con Google OAuth vía Supabase en `/login`
- ✅ Dashboard protegido en `/app` (requiere autenticación)
- ✅ Middleware que protege rutas `/app/*`
- ✅ Backend con filtrado por usuario usando JWT
- ✅ OAuth con parámetro `state` para vincular cuentas a usuarios

## 🔧 Configuración Requerida

### 1. Supabase Setup

#### a) Crear proyecto en Supabase
1. Ve a [https://supabase.com](https://supabase.com)
2. Crea un nuevo proyecto
3. Anota las credenciales:
   - **Project URL**: `https://xxxxx.supabase.co`
   - **Anon key**: Encuentra en Settings > API > anon/public
   - **Service role key**: Encuentra en Settings > API > service_role (¡mantén secreta!)
   - **JWT Secret**: Encuentra en Settings > API > JWT Settings

#### b) Configurar Google OAuth Provider en Supabase
1. Ve a Authentication > Providers en Supabase
2. Habilita Google provider
3. Configura con las credenciales de Google Cloud (las mismas de la consola)
   - **Client ID**: Tu Client ID de Google Cloud Console
   - **Client Secret**: Tu Client Secret de Google Cloud Console
4. Configura la Redirect URL en Supabase:
   - Production: `https://cloud-aggregator-iota.vercel.app/login`
   - Dev: `http://localhost:3000/login`

#### c) Ejecutar migración SQL
1. Ve a SQL Editor en Supabase
2. Ejecuta el archivo `backend/migrations/add_user_id_column.sql`:

```sql
ALTER TABLE cloud_accounts
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_cloud_accounts_user_id ON cloud_accounts(user_id);
```

### 2. Frontend - Variables de Entorno en Vercel

Ve a tu proyecto en Vercel > Settings > Environment Variables y agrega:

```bash
# Supabase (reemplaza con tus valores reales)
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...tu-anon-key-aqui

# Backend API
NEXT_PUBLIC_API_BASE_URL=https://cloud-aggregator-api.fly.dev
```

**Importante**: Redeploy después de agregar variables.

### 3. Backend - Variables de Entorno en Fly.io

Ejecuta estos comandos localmente:

```bash
cd backend

# Supabase
fly secrets set SUPABASE_URL=https://xxxxx.supabase.co
fly secrets set SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...tu-service-role-key
fly secrets set SUPABASE_JWT_SECRET=tu-jwt-secret-de-supabase

# Google OAuth
fly secrets set GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
fly secrets set GOOGLE_CLIENT_SECRET=your-client-secret
fly secrets set GOOGLE_REDIRECT_URI=https://cloud-aggregator-api.fly.dev/auth/google/callback

# Frontend URL
fly secrets set FRONTEND_URL=https://cloud-aggregator-iota.vercel.app
```

### 4. Google Cloud Console - Actualizar Redirect URIs

Ve a [Google Cloud Console](https://console.cloud.google.com/apis/credentials):

1. Selecciona tu OAuth 2.0 Client ID
2. En "Authorized redirect URIs", agrega **ambas** URLs:
   - **Supabase**: `https://xxxxx.supabase.co/auth/v1/callback`
   - **Backend**: `https://cloud-aggregator-api.fly.dev/auth/google/callback`

## 🚀 Deployment

### Frontend (Vercel)
```bash
cd frontend
git add .
git commit -m "feat: Supabase auth con OAuth state y filtrado por usuario"
git push origin main
# Auto-deploy en Vercel
```

### Backend (Fly.io)
```bash
cd backend
pip install -r requirements.txt  # Incluye pyjwt
fly deploy
```

## 📊 Flujo de Autenticación

### 1. Login de Usuario (Supabase OAuth)
```
Usuario → /login → Click "Google"
→ Supabase Auth → Google Consent
→ Redirect a /app (autenticado)
```

### 2. Conectar Cuenta de Drive (Backend OAuth con State)
```
Usuario autenticado en /app → Click "Conectar cuenta"
→ Frontend obtiene user_id de sesión Supabase
→ Redirect a backend: /auth/google/login?user_id=xxx
→ Backend crea JWT con user_id como 'state'
→ Google OAuth con state param
→ Callback: backend decodifica state, guarda user_id en cloud_accounts
→ Redirect a /app?auth=success
```

### 3. Endpoints Protegidos
```
Frontend → fetch con header: Authorization: Bearer <supabase-jwt>
→ Backend verifica JWT con SUPABASE_JWT_SECRET
→ Extrae user_id del token
→ Filtra datos por user_id
→ Retorna solo datos del usuario autenticado
```

## 🧪 Testing Local

### Frontend
```bash
cd frontend
# Crea .env.local con valores de Supabase
npm run dev
```

Abre: [http://localhost:3000](http://localhost:3000)

### Backend
```bash
cd backend
# Crea .env con valores reales (copia de .env.example)
pip install -r requirements.txt
uvicorn backend.main:app --reload
```

## 🔒 Seguridad

- ✅ **JWT Secret**: Mismo en Supabase y backend (`SUPABASE_JWT_SECRET`)
- ✅ **Service Role Key**: Solo en backend (nunca en frontend)
- ✅ **Anon Key**: Solo en frontend (pública, sin riesgo)
- ✅ **State param**: JWT firmado para evitar CSRF en OAuth
- ✅ **Filtrado por usuario**: Todos los endpoints verifican ownership

## 📝 Notas Importantes

1. **Cuentas existentes**: Las cuentas de Drive creadas antes de esta migración tendrán `user_id = NULL`. Deben reconectarse con OAuth para asociarse a un usuario.

2. **Development vs Production**: 
   - Dev: OAuth redirect a `http://localhost:3000`
   - Prod: OAuth redirect a `https://cloud-aggregator-iota.vercel.app`
   - Configura ambas URLs en Google Cloud Console

3. **CORS**: El backend permite requests desde:
   - `http://localhost:3000`
   - `https://*.vercel.app`
   - La URL configurada en `FRONTEND_URL`

## 🆘 Troubleshooting

### "Invalid token" en endpoints
→ Verifica que `SUPABASE_JWT_SECRET` en backend coincida con el de Supabase

### "Account not found or doesn't belong to you"
→ La cuenta no tiene `user_id` o no coincide. Reconecta con OAuth.

### OAuth redirect falla
→ Verifica que las URLs en Google Cloud Console incluyan Supabase y backend.

### Variables no se actualizan
→ Vercel: Redeploy después de cambiar env vars
→ Fly.io: Las secrets se aplican automáticamente, pero puede requerir restart
