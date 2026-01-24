# Technical Onboarding - Cloud Aggregator
**Documento para Auditor de Código Externo**  
**Fecha:** Enero 2026  
**Autor:** Asdrubal Velazquez (Senior Engineer)

---

## 1. Resumen del Proyecto

### 1.1 Propósito Principal
**Cloud Aggregator** es una plataforma SaaS que permite a los usuarios gestionar múltiples cuentas de almacenamiento en la nube (Google Drive y OneDrive) desde una única interfaz centralizada. El objetivo es facilitar la visualización, navegación y transferencia de archivos entre cuentas de diferentes proveedores.

### 1.2 Funcionalidades Core

#### Gestión de Cuentas Multi-Proveedor
- **Conexión OAuth2**: Google Drive y OneDrive (Microsoft).
- **Múltiples Slots**: Los usuarios pueden conectar hasta 10 cuentas según su plan (Free/Plus/Pro).
- **Reconexión Inteligente**: Sistema de refresh automático de tokens con manejo de errores 401 y re-autenticación.

#### Operaciones sobre Archivos
- **Visualización**: Explorador de archivos con estadísticas de almacenamiento.
- **Transferencias Cross-Provider**: Copiar archivos entre Google Drive ↔ OneDrive.
- **Renombrado**: Edición de nombres de archivos directamente desde la UI.
- **Tracking de Transferencias**: Sistema de cola con progreso en tiempo real.

#### Sistema de Facturación
- **Stripe Integration**: Gestión de suscripciones (Plus: $5/mes, Pro: $10/mes).
- **Webhook Handlers**: Procesamiento automático de eventos de pago.
- **Plan Management**: Upgrade/Downgrade automático con límites dinámicos.

#### Sistema de Cuotas
- **Billing Bytes**: Rastreo acumulado de GB transferidos por usuario.
- **Quota Limits**: Límites configurables por plan (Free: 20GB, Plus: 100GB, Pro: 500GB).
- **Rate Limiting**: Protección contra abuso del sistema.

---

## 2. Stack Tecnológico Exacto

### 2.1 Frontend

| Componente | Tecnología | Versión |
|-----------|------------|---------|
| **Framework** | Next.js (App Router) | 16.0.8 |
| **Lenguaje** | TypeScript | 5.x |
| **UI Library** | React | 19.0.0 |
| **Estilos** | Tailwind CSS | 3.4.1 |
| **State Management** | TanStack Query (React Query) | 5.90.16 |
| **Cliente HTTP** | Fetch API nativo con `authenticatedFetch` wrapper | N/A |
| **Iconos/Assets** | Custom SVG + PNG | N/A |

**Características Especiales:**
- **App Router** de Next.js 15+ (no Pages Router).
- **Server Components** + Client Components híbridos.
- **Path Aliases**: `@/*` mapea a `./src/*`.
- **Strict Mode**: TypeScript estricto habilitado.

### 2.2 Backend

| Componente | Tecnología | Versión |
|-----------|------------|---------|
| **Framework** | FastAPI | Latest |
| **Lenguaje** | Python | 3.12 |
| **Server** | Uvicorn (ASGI) | Latest |
| **Cliente HTTP** | httpx (async) | Latest |
| **Encriptación** | cryptography (Fernet) | Latest |
| **JWT** | PyJWT | Latest |

**Arquitectura:**
- Estructura modular por dominio:
  - `auth.py`: Autenticación OAuth y JWT.
  - `google_drive.py`: Integración con Google Drive API v3.
  - `onedrive.py`: Integración con Microsoft Graph API.
  - `stripe_utils.py`: Lógica de Stripe (sin llamadas API directas en utils).
  - `quota.py`: Sistema de cuotas y límites.
  - `transfer.py`: Lógica de transferencias cross-provider.
  - `db.py`: Cliente de Supabase.
  - `crypto.py`: Encriptación/desencriptación de tokens.

### 2.3 Base de Datos

| Componente | Tecnología |
|-----------|------------|
| **Database** | PostgreSQL (Supabase) |
| **ORM** | Supabase Python Client (no SQLAlchemy) |
| **Migraciones** | SQL Scripts manuales en `/backend/migrations` |

**Tablas Principales:**
- `users`: Datos de usuarios (Supabase Auth).
- `cloud_provider_accounts`: Cuentas conectadas (Google Drive / OneDrive).
- `copy_jobs`: Historial de transferencias.
- `user_quota`: Tracking de bytes consumidos.
- `user_slots`: Sistema de slots vitalicios (10 slots permanentes).

### 2.4 Autenticación y Servicios Externos

| Servicio | Uso | Protocolo |
|---------|-----|-----------|
| **Supabase Auth** | Autenticación de usuarios (login/signup) | JWT (HS256) |
| **Google OAuth 2.0** | Conexión de cuentas de Google Drive | Authorization Code Flow |
| **Microsoft OAuth 2.0** | Conexión de cuentas de OneDrive | Authorization Code Flow |
| **Stripe** | Pagos y suscripciones | Webhooks + Checkout Sessions |

**Flujo de Autenticación:**
1. Usuario se autentica en Supabase (email/password o social login).
2. Frontend obtiene `access_token` (JWT).
3. Backend valida JWT en cada request (`verify_supabase_jwt`).
4. Para conectar Google/OneDrive: OAuth2 flow con `state` token encriptado.

### 2.5 Hosting / Infraestructura

| Capa | Servicio | URL |
|------|---------|-----|
| **Backend** | Fly.io (Containerizado) | `https://cloud-aggregator-api.fly.dev` |
| **Frontend** | Vercel (Edge Network) | `https://www.cloudaggregatorapp.com` |
| **Database** | Supabase Cloud | `*.supabase.co` |
| **CDN/Assets** | Vercel Edge | N/A |

**Configuración:**
- **Backend**: Dockerfile con Python 3.12-slim, uvicorn en puerto 8080.
- **Frontend**: Build automático en Vercel con environment variables.
- **CORS**: Configurado para aceptar peticiones desde el dominio canonical y localhost.

---

## 3. Arquitectura y Estructura

### 3.1 Árbol de Directorios

```
cloud-aggregator/
├── backend/
│   ├── Dockerfile               # Imagen Docker para Fly.io
│   ├── fly.toml                 # Configuración de Fly.io
│   ├── requirements.txt         # Dependencias Python
│   ├── test_*.py                # Tests de integración
│   ├── backend/                 # Código fuente
│   │   ├── main.py              # Entry point FastAPI (5000+ líneas)
│   │   ├── auth.py              # Lógica OAuth y JWT
│   │   ├── db.py                # Cliente Supabase
│   │   ├── crypto.py            # Encriptación de tokens
│   │   ├── google_drive.py      # Integración Google Drive API
│   │   ├── onedrive.py          # Integración Microsoft Graph API
│   │   ├── stripe_utils.py      # Utilidades Stripe
│   │   ├── quota.py             # Sistema de cuotas
│   │   ├── transfer.py          # Lógica de transferencias
│   │   └── billing_plans.py     # Definición de planes
│   └── migrations/              # Scripts SQL manuales
│       ├── add_slots_system.sql
│       ├── add_quota_system.sql
│       └── ...
│
├── frontend/
│   ├── next.config.ts           # Configuración Next.js
│   ├── tsconfig.json            # Configuración TypeScript
│   ├── tailwind.config.ts       # Configuración Tailwind
│   ├── package.json             # Dependencias Node.js
│   ├── vercel.json              # Configuración Vercel
│   ├── public/                  # Assets estáticos
│   └── src/
│       ├── app/                 # App Router (Next.js 15+)
│       │   ├── layout.tsx       # Root layout
│       │   ├── page.tsx         # Home page
│       │   ├── (dashboard)/     # Dashboard group
│       │   ├── login/           # Página de login
│       │   ├── pricing/         # Página de precios
│       │   └── ...
│       ├── components/          # Componentes React
│       │   ├── sidebar/         # Sidebar navigation
│       │   ├── transfer-queue/  # Sistema de colas
│       │   ├── Toast.tsx        # Notificaciones
│       │   └── ...
│       ├── hooks/               # Custom React hooks
│       │   ├── useCloudStatus.ts
│       │   └── useTransferQueue.ts
│       ├── queries/             # React Query hooks
│       │   └── useCloudStatusQuery.ts
│       ├── lib/                 # Utilidades y helpers
│       │   ├── api.ts           # Cliente API con auth
│       │   ├── supabaseClient.ts # Cliente Supabase
│       │   └── formatStorage.ts # Formateadores
│       ├── types/               # TypeScript types
│       ├── context/             # React Context API
│       └── providers/           # React Query Provider
│
└── docs/                        # Documentación del proyecto
    ├── BILLING_PLAN.md
    └── ...
```

### 3.2 Descripción de Carpetas Clave

#### Frontend (`/frontend/src`)

| Carpeta | Descripción |
|---------|-------------|
| **app/** | Next.js App Router. Estructura basada en file-system routing. |
| **components/** | Componentes React reutilizables (UI, modales, menus contextuales). |
| **hooks/** | Custom hooks (gestión de estado local, lógica de UI). |
| **queries/** | React Query hooks (fetching, caching, sincronización con backend). |
| **lib/** | Funciones helper (API client, formatters, supabase client). |
| **types/** | Definiciones de tipos TypeScript compartidos. |
| **context/** | React Context para estado global (evita prop drilling). |
| **providers/** | Wrappers de providers (React Query, Theme, etc.). |

**Patrón de Arquitectura:**
- **Server Components** por defecto (pages/layouts).
- **Client Components** solo cuando se necesita interactividad (`'use client'`).
- **React Query** para cache y sincronización con backend.
- **Optimistic Updates** en operaciones críticas (rename, copy).

#### Backend (`/backend/backend`)

| Archivo | Responsabilidad |
|---------|-----------------|
| **main.py** | FastAPI app, endpoints, middleware CORS, lógica de negocio principal. |
| **auth.py** | Generación/validación de JWT, OAuth state tokens. |
| **db.py** | Configuración del cliente Supabase. |
| **google_drive.py** | Llamadas a Google Drive API v3 (list, copy, rename). |
| **onedrive.py** | Llamadas a Microsoft Graph API (list, copy, rename). |
| **stripe_utils.py** | Mapeo de price_ids a planes internos (pure functions). |
| **quota.py** | Verificación de límites, tracking de bytes consumidos. |
| **transfer.py** | Orquestación de transferencias cross-provider. |
| **crypto.py** | Encriptación simétrica de tokens OAuth (Fernet). |

**Convención:**
- Funciones prefijadas por dominio: `refresh_google_token`, `list_drive_files`.
- Separación clara entre lógica de negocio y llamadas HTTP.
- Logging extensivo para observabilidad.

---

## 4. Reglas y Convenciones

### 4.1 TypeScript Estricto

**Configuración:**
```json
{
  "strict": true,
  "noEmit": true,
  "esModuleInterop": true,
  "skipLibCheck": true
}
```

**Reglas Aplicadas:**
- `strict: true` → Todas las comprobaciones estrictas activadas.
- No se permite `any` implícito.
- Propiedades no opcionales deben inicializarse.
- Null checks obligatorios (`!` operator solo cuando es seguro).

### 4.2 Linter y Estilo

**ESLint:**
```json
{
  "extends": "next/core-web-vitals"
}
```

**Características:**
- Reglas de Next.js predeterminadas (optimizaciones, accesibilidad).
- No se usa Prettier (formato manual).
- Comando: `npm run lint`.

**Python (Backend):**
- No se usa linter formal (black/flake8) en este momento.
- Convención: PEP 8 manualmente aplicado.
- Imports organizados por: stdlib → third-party → local.

### 4.3 Variables de Entorno

#### Frontend (`process.env.NEXT_PUBLIC_*`)

| Variable | Uso |
|----------|-----|
| `NEXT_PUBLIC_SUPABASE_URL` | URL de Supabase (pública). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key de Supabase (pública). |
| `NEXT_PUBLIC_API_BASE_URL` | URL del backend (`https://cloud-aggregator-api.fly.dev`). |

**Ubicación:** Configuradas en Vercel (Environment Variables panel).

#### Backend (`os.getenv()`)

| Variable | Uso |
|----------|-----|
| `SUPABASE_URL` | URL de Supabase. |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (privada, para operaciones admin). |
| `SUPABASE_JWT_SECRET` | Secret para verificar JWT firmados por Supabase. |
| `GOOGLE_CLIENT_ID` | OAuth Client ID de Google Cloud Console. |
| `GOOGLE_CLIENT_SECRET` | OAuth Client Secret de Google. |
| `GOOGLE_REDIRECT_URI` | Callback URL para OAuth (`/auth/google/callback`). |
| `STRIPE_SECRET_KEY` | API Key de Stripe (modo test o producción). |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret de Stripe. |
| `STRIPE_PRICE_PLUS` | Price ID del plan Plus. |
| `STRIPE_PRICE_PRO` | Price ID del plan Pro. |
| `FRONTEND_URL` | URL del frontend para redirects. |

**Ubicación:** Archivo `.env` local (no commiteado). En producción: Fly.io secrets.

**Gestión de Secretos:**
```bash
# Fly.io
fly secrets set SUPABASE_SERVICE_ROLE_KEY="..."

# Vercel
vercel env add NEXT_PUBLIC_API_BASE_URL
```

### 4.4 Convenciones de Código

#### Naming Conventions

| Tipo | Convención | Ejemplo |
|------|-----------|---------|
| **Componentes React** | PascalCase | `AddCloudModal.tsx` |
| **Hooks** | camelCase con `use` prefix | `useCloudStatus.ts` |
| **Funciones/Variables** | camelCase | `authenticatedFetch` |
| **Tipos/Interfaces** | PascalCase | `CloudSlot`, `TransferJob` |
| **Constantes** | UPPER_SNAKE_CASE | `API_BASE_URL` |
| **Python funciones** | snake_case | `refresh_google_token` |
| **Python clases** | PascalCase | `BaseModel` (Pydantic) |

#### File Organization
- **Colocation**: Componentes relacionados cerca de donde se usan.
- **Index files**: Evitados (preferimos nombres explícitos).
- **Barrel exports**: No usados (imports directos).

#### Error Handling
- **Frontend**: Try-catch con toast notifications.
- **Backend**: HTTPException con status codes descriptivos (400, 401, 403, 500).

---

## 5. Dependencias Críticas

### 5.1 Frontend (package.json)

| Dependencia | Versión | Uso |
|-------------|---------|-----|
| **next** | 16.0.8 | Framework principal, App Router, SSR/SSG. |
| **react** | 19.0.0 | Librería de UI (última versión estable). |
| **@supabase/supabase-js** | 2.87.1 | Cliente de Supabase (auth, DB access). |
| **@tanstack/react-query** | 5.90.16 | Gestión de estado asíncrono, caching, refetching. |
| **tailwindcss** | 3.4.1 | Framework de estilos utility-first. |
| **typescript** | 5.x | Superset de JS con tipos estáticos. |

**¿Por qué estas dependencias?**

1. **Next.js 16**: 
   - Optimizaciones automáticas (code splitting, image optimization).
   - App Router con Server Components (mejor performance).
   - Vercel integration nativa.

2. **React 19**: 
   - React Server Components soporte completo.
   - Concurrent rendering para mejor UX.
   - Hooks modernos (`useTransition`, `useDeferredValue`).

3. **TanStack Query**: 
   - Reemplaza estado manual con cache inteligente.
   - Revalidación automática (focus, network reconnect).
   - Optimistic updates para UX fluida.
   - Gestión de loading/error states unificada.

4. **Supabase Client**: 
   - Auth helpers (`getSession`, `signIn`, `signOut`).
   - Realtime subscriptions (no usado actualmente).
   - Type-safe queries (TypeScript integration).

5. **Tailwind CSS**: 
   - Velocidad de desarrollo (no CSS custom).
   - Design system consistente.
   - Purge automático (bundles pequeños).

### 5.2 Backend (requirements.txt)

| Dependencia | Uso |
|-------------|-----|
| **fastapi** | Framework ASGI para APIs REST. |
| **uvicorn** | ASGI server (producción). |
| **supabase** | Cliente Python de Supabase (auth + DB). |
| **httpx** | Cliente HTTP async (llamadas a Google/OneDrive). |
| **python-dotenv** | Carga de variables desde `.env`. |
| **pyjwt** | Validación de JWT de Supabase. |
| **stripe** | SDK oficial de Stripe (webhooks, checkout). |
| **cryptography** | Encriptación de tokens (Fernet symmetric). |

**¿Por qué estas dependencias?**

1. **FastAPI**: 
   - Performance (async/await nativo).
   - Auto-documentación (OpenAPI/Swagger).
   - Validación con Pydantic.
   - Type hints nativos.

2. **httpx**: 
   - Async HTTP client (mejor que requests).
   - Timeouts configurables.
   - HTTP/2 support.

3. **Supabase Client**: 
   - Interacción directa con PostgreSQL.
   - Auth integration.
   - No necesita ORM (queries directas).

4. **cryptography**: 
   - Encriptación de tokens OAuth antes de guardar en DB.
   - Fernet: symmetric encryption (AES-128 CBC + HMAC).
   - Previene acceso directo a tokens desde DB.

5. **Stripe SDK**: 
   - Webhook signature verification (seguridad).
   - Checkout session creation.
   - Subscription management.

---

## 6. Información Adicional para Auditoría

### 6.1 Puntos de Atención

1. **Seguridad de Tokens:**
   - Tokens OAuth encriptados con Fernet antes de almacenar.
   - JWT verificados en cada request.
   - State tokens con TTL de 10 minutos.

2. **Rate Limiting:**
   - No implementado a nivel de framework (posible mejora).
   - Protección mediante cuotas de transferencia.

3. **Error Handling:**
   - Backend: Logging extensivo pero expone stack traces (revisar en producción).
   - Frontend: Toast notifications para UX pero sin logging centralizado.

4. **Testing:**
   - Backend: Tests manuales (`test_*.py`).
   - Frontend: Sin tests unitarios/e2e (área de mejora).

### 6.2 Áreas de Mejora Identificadas

1. **Observabilidad:**
   - Añadir Sentry o similar para error tracking.
   - Métricas de performance (APM).

2. **Testing:**
   - Cobertura de tests < 10%.
   - Necesario: Jest + React Testing Library (frontend).
   - Necesario: pytest + fixtures (backend).

3. **Documentación API:**
   - FastAPI genera docs automáticas (`/docs`).
   - Falta documentación de flujos de negocio.

4. **CI/CD:**
   - Vercel: Auto-deploy en push a `main`.
   - Fly.io: Deploy manual (`fly deploy`).
   - Falta: Tests automáticos pre-merge.

---

## 7. Comandos de Desarrollo

### Frontend

```bash
# Instalar dependencias
npm install

# Desarrollo local (puerto 3000)
npm run dev

# Build de producción
npm run build

# Linter
npm run lint
```

### Backend

```bash
# Crear entorno virtual
python -m venv .venv
source .venv/bin/activate  # Linux/Mac
.venv\Scripts\activate     # Windows

# Instalar dependencias
pip install -r requirements.txt

# Desarrollo local (puerto 8000)
uvicorn backend.main:app --reload

# Desplegar a Fly.io
fly deploy
```

---

## 8. Flujos Críticos

### 8.1 Flujo de Conexión de Cuenta

```
Usuario → Click "Añadir Cuenta" → Modal selección (Google/OneDrive)
  ↓
Frontend genera request a /auth/google/authorize
  ↓
Backend crea state token (user_id + metadata encriptado)
  ↓
Redirect a Google OAuth Consent Screen
  ↓
Usuario autoriza → Callback a /auth/google/callback?code=...&state=...
  ↓
Backend valida state, intercambia code por tokens
  ↓
Tokens encriptados → guardados en cloud_provider_accounts
  ↓
Redirect a frontend con success=true
```

### 8.2 Flujo de Transferencia Cross-Provider

```
Usuario selecciona archivo → Click "Copiar a OneDrive"
  ↓
Frontend abre modal de selección de destino
  ↓
POST /api/copy-cross-provider { source_provider, source_item_id, ... }
  ↓
Backend verifica cuota disponible
  ↓
Backend inicia job (status: "pending")
  ↓
Background task:
  - Download de Google Drive (stream)
  - Upload a OneDrive (stream)
  - Tracking de progreso (bytes transferidos)
  ↓
Job status: "completed" / "failed"
  ↓
Frontend polling o SSE para actualizar UI
```

---

## Conclusión

Este documento proporciona una visión técnica completa del proyecto **Cloud Aggregator**. Para profundizar en áreas específicas, revisar:
- `/docs/BILLING_PLAN.md`: Detalles del sistema de facturación.
- `/backend/migrations/*.sql`: Evolución del schema de DB.
- Documentos `AUDITORIA_*.md`: Informes de auditorías previas.

**Contacto:** Asdrubal Velazquez (Senior Engineer)

---
**Última actualización:** Enero 2026
