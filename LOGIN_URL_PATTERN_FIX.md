# LOGIN-URL PATTERN: Fix Crítico OAuth 401

**Fecha:** 22 Diciembre 2025  
**Prioridad:** 🔴 CRÍTICO - Bloquea producción  
**Issue:** window.location.href a endpoint protegido con JWT → 401 Unauthorized

---

## 🔴 PROBLEMA IDENTIFICADO

### Root Cause
`window.location.href` es una **navegación HTTP estándar del navegador**, NO incluye headers custom.

**Código problemático (auditoría anterior):**
```typescript
// Frontend
window.location.href = `${API_BASE_URL}/auth/google/login`;  // ❌

// Backend
@app.get("/auth/google/login")
def google_login(user_id: str = Depends(verify_supabase_jwt)):  // ❌ Requiere JWT
```

**¿Por qué falla?**
1. `window.location.href` hace GET request **sin** `Authorization: Bearer ...`
2. Backend requiere JWT con `Depends(verify_supabase_jwt)`
3. Resultado: **401 Unauthorized** en producción

**Nota:** `authenticatedFetch()` SÍ envía headers, pero no se puede usar con navegación a Google OAuth.

---

## ✅ SOLUCIÓN: Login-URL Pattern

### Arquitectura
```
Frontend                Backend                    Google OAuth
  |                        |                            |
  | fetch (JWT) ------>   /auth/google/login-url       |
  |                        |                            |
  |  <------ { url }       | (construye OAuth URL)      |
  |                        |                            |
  | window.location.href ----------------------->      |
  |                                                     |
  |  <----------------------- OAuth screen             |
  |                                                     |
  | (callback) -------------------------------->       |
  |                        |                            |
  |  <------ callback -->  /auth/google/callback       |
```

### Flujo Corregido
1. **Frontend:** `fetch` autenticado a `/auth/google/login-url` (envía JWT)
2. **Backend:** Construye OAuth URL con `state_token` (incluye user_id firmado)
3. **Backend:** Retorna JSON `{"url": "https://accounts.google.com/..."}`
4. **Frontend:** Redirect manual `window.location.href = url`
5. **Google:** Usuario autentica → callback a `/auth/google/callback`

---

## 🔧 IMPLEMENTACIÓN

### Backend: Nuevo Endpoint `/auth/google/login-url`

**Archivo:** `backend/backend/main.py`

```python
import hashlib  # Para logging seguro

@app.get("/auth/google/login-url")
def google_login_url(mode: Optional[str] = None, user_id: str = Depends(verify_supabase_jwt)):
    """
    Get Google OAuth URL for client-side redirect.
    
    CRITICAL FIX: window.location.href NO envía Authorization headers → 401 si endpoint protegido.
    SOLUCIÓN: Frontend hace fetch autenticado a ESTE endpoint → recibe URL → redirect manual.
    
    SEGURIDAD: user_id derivado de JWT (NO query param) para evitar PII en URL/logs.
    
    Args:
        mode: "reauth" para reconexión, "consent" para forzar consentimiento, None para nueva
        user_id: Derivado automáticamente de JWT (verify_supabase_jwt)
        
    Returns:
        {"url": "https://accounts.google.com/o/oauth2/v2/auth?..."}
    """
    if not GOOGLE_CLIENT_ID or not GOOGLE_REDIRECT_URI:
        raise HTTPException(status_code=500, detail="Missing GOOGLE_CLIENT_ID or GOOGLE_REDIRECT_URI")
    
    # OAuth Prompt Strategy (Google best practices)
    if mode == "consent":
        oauth_prompt = "consent"  # Casos excepcionales
    else:
        oauth_prompt = "select_account"  # Default recomendado
    
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": oauth_prompt,
    }
    
    # Crear state JWT con user_id (seguro, firmado)
    state_token = create_state_token(user_id)
    params["state"] = state_token

    from urllib.parse import urlencode
    url = f"{GOOGLE_AUTH_ENDPOINT}?{urlencode(params)}"
    
    # Log sin PII (solo hash parcial + mode)
    user_hash = hashlib.sha256(user_id.encode()).hexdigest()[:8]
    print(f"[OAuth URL Generated] user_hash={user_hash} mode={mode or 'new'} prompt={oauth_prompt}")
    
    return {"url": url}


@app.get("/auth/google/login")
def google_login_deprecated(mode: Optional[str] = None):
    """
    DEPRECATED: Use /auth/google/login-url instead.
    
    Reason: window.location.href does NOT send Authorization headers → 401 if protected.
    """
    raise HTTPException(
        status_code=410,
        detail="Endpoint deprecated. Use GET /auth/google/login-url (authenticated) instead."
    )
```

**Cambios clave:**
- ✅ Retorna JSON `{"url": "..."}` en lugar de `RedirectResponse`
- ✅ Protegido con `Depends(verify_supabase_jwt)` (fetch sí envía JWT)
- ✅ Logging sin PII (hash parcial SHA256 de user_id)
- ✅ Deprecación explícita del endpoint antiguo (410 Gone)

---

### Frontend: API Client

**Archivo:** `frontend/src/lib/api.ts`

```typescript
/**
 * Google OAuth Login URL Response
 */
export type GoogleLoginUrlResponse = {
  url: string;
};

/**
 * Fetch Google OAuth URL (authenticated endpoint)
 * 
 * CRITICAL: window.location.href does NOT send Authorization headers.
 * This endpoint is protected with JWT, so we fetch it first,
 * then redirect manually to the returned OAuth URL.
 * 
 * @param mode - "reauth" for reconnecting slots, "consent" for forced consent, undefined for new
 * @returns OAuth URL to redirect user to Google
 */
export async function fetchGoogleLoginUrl(params?: {
  mode?: "reauth" | "consent" | "new";
}): Promise<GoogleLoginUrlResponse> {
  const queryParams = new URLSearchParams();
  if (params?.mode && params.mode !== "new") {
    queryParams.set("mode", params.mode);
  }
  
  const endpoint = `/auth/google/login-url${
    queryParams.toString() ? `?${queryParams.toString()}` : ""
  }`;
  
  const res = await authenticatedFetch(endpoint);
  if (!res.ok) {
    throw new Error(`Failed to get OAuth URL: ${res.status}`);
  }
  return await res.json();
}
```

**Cambios clave:**
- ✅ Usa `authenticatedFetch()` (envía `Authorization: Bearer ...`)
- ✅ Maneja query params correctamente (`mode` opcional)
- ✅ Type-safe con `GoogleLoginUrlResponse`

---

### Frontend: Dashboard (Conectar Nueva)

**Archivo:** `frontend/src/app/app/page.tsx`

```typescript
const handleConnectGoogle = async () => {
  if (!userId) {
    setError("No hay sesión de usuario activa. Recarga la página.");
    return;
  }
  
  try {
    // CRITICAL FIX: window.location.href NO envía Authorization headers → 401
    // SOLUCIÓN: Fetch autenticado a /auth/google/login-url → recibe URL → redirect manual
    // SEGURIDAD: user_id derivado de JWT en backend, NO en querystring
    const { fetchGoogleLoginUrl } = await import("@/lib/api");
    const { url } = await fetchGoogleLoginUrl({ mode: "new" });
    window.location.href = url;
  } catch (err) {
    setError(`Error al obtener URL de Google: ${err}`);
    console.error("handleConnectGoogle error:", err);
  }
};
```

**Cambios clave:**
- ✅ `fetchGoogleLoginUrl({ mode: "new" })` - indica cuenta nueva
- ✅ Manejo de errores (`try/catch`)
- ✅ NO más `window.location.href` directo a backend

---

### Frontend: ReconnectSlotsModal (Reconectar Slot)

**Archivo:** `frontend/src/components/ReconnectSlotsModal.tsx`

```typescript
const handleReconnect = async (slot: CloudSlot) => {
  // Verificar que hay sesión activa (el token JWT se enviará automáticamente)
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.id) {
    setError("No hay sesión activa");
    return;
  }
  
  try {
    // CRITICAL FIX: window.location.href NO envía Authorization headers → 401
    // SOLUCIÓN: Fetch autenticado a /auth/google/login-url → recibe URL → redirect manual
    // SEGURIDAD: user_id derivado de JWT en backend, NO en querystring
    // mode=reauth → backend usa prompt=select_account (mejor UX)
    const { fetchGoogleLoginUrl } = await import("@/lib/api");
    const { url } = await fetchGoogleLoginUrl({ mode: "reauth" });
    window.location.href = url;
    
    // Callback opcional para lógica adicional
    if (onReconnect) {
      onReconnect(slot);
    }
  } catch (err) {
    setError(`Error al obtener URL de reconexión: ${err}`);
    console.error("handleReconnect error:", err);
  }
};
```

**Cambios clave:**
- ✅ `fetchGoogleLoginUrl({ mode: "reauth" })` - indica reconexión
- ✅ Backend usará `prompt=select_account` (mejor UX)
- ✅ Manejo de errores robusto

---

## 🧪 TESTING

### Caso 1: Nueva Conexión
1. Dashboard → Botón "Conectar Google Drive"
2. Verificar: `POST /auth/google/login-url` retorna 200 `{"url": "..."}`
3. Verificar: Redirect a Google OAuth (no 401)
4. Verificar logs backend: `[OAuth URL Generated] user_hash=abc12345 mode=new prompt=select_account`

### Caso 2: Reconexión Slot
1. Modal "Reconectar slots" → Click slot inactivo
2. Verificar: `POST /auth/google/login-url?mode=reauth` retorna 200
3. Verificar: Google muestra selector de cuenta (no pantalla permisos)
4. Verificar logs: `mode=reauth prompt=select_account`

### Caso 3: Error Handling
1. Simular backend down
2. Verificar: UI muestra error "Error al obtener URL de Google: ..."
3. NO debe haber redirect ni 401 silencioso

### Caso 4: Deprecated Endpoint (Compat)
1. `curl http://localhost:8000/auth/google/login`
2. Verificar: 410 Gone `{"detail": "Endpoint deprecated. Use GET /auth/google/login-url..."}`

---

## 📊 LOGS SIN PII

**Implementación:**
```python
# Backend: logging seguro
user_hash = hashlib.sha256(user_id.encode()).hexdigest()[:8]
print(f"[OAuth URL Generated] user_hash={user_hash} mode={mode or 'new'} prompt={oauth_prompt}")
```

**Log ejemplo:**
```
[OAuth URL Generated] user_hash=abc12345 mode=reauth prompt=select_account
```

**NO loggear:**
- ❌ `user_id` completo (UUID)
- ❌ `provider_email`
- ❌ `provider_account_id`

**SÍ loggear:**
- ✅ Hash parcial (primeros 8 chars SHA256)
- ✅ Mode (new/reauth/consent)
- ✅ Prompt strategy (select_account/consent)
- ✅ Resultado (allowed/blocked + reason code)

---

## ✅ CHECKLIST

### Implementación
- [x] Backend: `/auth/google/login-url` endpoint (retorna JSON)
- [x] Backend: Deprecar `/auth/google/login` (410 Gone)
- [x] Backend: Logging sin PII (hash parcial)
- [x] Frontend: `fetchGoogleLoginUrl()` en api.ts
- [x] Frontend: `handleConnectGoogle()` usa fetch + redirect
- [x] Frontend: `handleReconnect()` usa fetch + redirect
- [x] Import hashlib en main.py

### Testing (Pendiente Staging)
- [ ] Caso 1: Nueva conexión (mode=new)
- [ ] Caso 2: Reconexión (mode=reauth)
- [ ] Caso 3: Error handling
- [ ] Caso 4: Deprecated endpoint (410)
- [ ] Verificar logs sin PII

### Deployment
- [ ] Staging: Validar flujo completo
- [ ] Producción: Deploy backend + frontend
- [ ] Monitor logs 24h

---

## 🎯 RESUMEN

**Problema:** `window.location.href` NO envía JWT → 401 en endpoint protegido  
**Solución:** Patrón "login-url" - fetch autenticado retorna URL, redirect manual  
**Impacto:** ✅ NO 401, ✅ JWT derivado, ✅ Sin PII en logs

**Archivos modificados:**
- `backend/backend/main.py` (nuevo endpoint + deprecación)
- `frontend/src/lib/api.ts` (fetchGoogleLoginUrl)
- `frontend/src/app/app/page.tsx` (handleConnectGoogle)
- `frontend/src/components/ReconnectSlotsModal.tsx` (handleReconnect)

**Status:** ✅ Implementado - Pendiente testing staging

---

## 📜 GOOGLE OAUTH COMPLIANCE

### Scopes Mínimos (Google API Services User Data Policy)

**Implementación Backend:**
```python
# backend/backend/main.py líneas 42-50
SCOPES = [
    "https://www.googleapis.com/auth/drive",        # Full Drive access
    "https://www.googleapis.com/auth/userinfo.email",  # Email del usuario
    "openid",                                        # OpenID Connect
]
```

**Justificación (Limited Use Requirements):**

| Scope | Uso | Alternativa Evaluada | Por qué NO alternativa |
|-------|-----|---------------------|----------------------|
| `drive` | Copiar archivos entre cuentas Drive | `drive.readonly` | Read-only NO permite escritura (copy requiere create) |
| `userinfo.email` | Identificar usuario, mostrar email en UI | `profile` solo | Email necesario para diferenciar cuentas múltiples |
| `openid` | Autenticación OpenID Connect | OAuth 2.0 básico | OIDC es estándar recomendado (security best practice) |

**Scopes NO solicitados:**
- ❌ `drive.appdata` - No usado (app no guarda config en Drive AppData)
- ❌ `drive.photos` - No usado (no gestión de fotos)
- ❌ `drive.file` - Muy limitado (solo archivos creados por app)
- ❌ `gmail.*` - No usado (no acceso email)
- ❌ `contacts.*` - No usado (no acceso contactos)

### Google API Services User Data Policy Compliance

**Limited Use Disclosure:**
```
Cloud Aggregator's use of information received from Google APIs adheres to the
Google API Services User Data Policy, including the Limited Use requirements.

Data Collection:
- Google Drive file metadata (name, size, MIME type) - for file browsing
- User email address - for account identification
- OAuth tokens (access + refresh) - for authenticated API calls

Data Usage:
- Display user's Drive files in dashboard
- Copy files between user's connected Drive accounts
- No data shared with third parties
- No data used for advertising
- No data sold

Data Retention:
- OAuth tokens: Stored encrypted in database, revoked on disconnect
- File metadata: NOT stored (fetched real-time on demand)
- User email: Stored for account identification only

Data Security:
- HTTPS only (no plaintext transmission)
- Tokens encrypted at rest (Supabase encryption)
- No client-side storage of tokens
```

**Documentation URLs (preparar para Google review):**
- Privacy Policy: `/privacy` (frontend route ya existe)
- Terms of Service: `/terms` (frontend route ya existe)
- Limited Use Disclosure: Incluir en ambos documentos

### Consent Screen Configuration (Google Cloud Console)

**Checklist OAuth Consent Screen:**
- [ ] App name: "Cloud Aggregator" (user-friendly, no "test" o "dev")
- [ ] User support email: Email válido del desarrollador
- [ ] Developer contact: Email público para usuarios
- [ ] App logo: 120x120 px (opcional pero recomendado)
- [ ] App domain: Dominio verificado (ej. `cloudaggregator.com`)
- [ ] Authorized domains: Lista completa
  - `cloudaggregator.com` (frontend)
  - `api.cloudaggregator.com` (backend)
  - `vercel.app` (si aplica)
- [ ] Application homepage: URL pública accesible
- [ ] Privacy policy: `https://cloudaggregator.com/privacy`
- [ ] Terms of service: `https://cloudaggregator.com/terms`
- [ ] Scopes: Solo los 3 listados arriba (NO agregar innecesarios)

**Verification Status:**
- Internal testing: Hasta 100 usuarios (sin verificación)
- Production: Requiere verificación Google (7-14 días)
- Sensitive scopes (`drive`): Requiere security assessment si >10k users

### OAuth Best Practices (Google Security)

**✅ Implementado:**
- [x] HTTPS redirect URIs (verificar en prod)
- [x] State parameter firmado (JWT con secret)
- [x] Token storage server-side (no localStorage)
- [x] Token encryption at rest
- [x] Refresh token rotation (Google maneja automático)
- [x] Prompt strategy correcta (`select_account` default)
- [x] No PII en URLs
- [x] Logging sin PII (hash parcial)

**🔒 Validaciones Adicionales:**
```python
# backend/backend/main.py (callback)
# TODO: Agregar estas validaciones si no existen

# 1. Validar state token (anti-CSRF)
decoded_state = verify_state_token(state_param)  # Ya implementado

# 2. Validar redirect_uri match (anti-hijacking)
if request.url.scheme != "https" and not is_local_dev():
    raise HTTPException(403, "HTTPS required")

# 3. Rate limiting (anti-abuse)
# TODO: Implementar rate limit por IP/user_id (10 req/min)

# 4. Token expiry check antes de uso
if is_token_expired(access_token):
    refresh_access_token(refresh_token)
```

**📋 Security Checklist:**
- [ ] HTTPS enforced (no http en prod)
- [ ] Redirect URI whitelist estricto
- [ ] State token validado en callback
- [ ] Rate limiting implementado
- [ ] Token refresh automático
- [ ] Revoke token on disconnect

---

## 🔍 DEBUGGING

### Logs Backend (Sin PII)

**Formato seguro:**
```python
user_hash = hashlib.sha256(user_id.encode()).hexdigest()[:8]
print(f"[OAuth URL Generated] user_hash={user_hash} mode={mode or 'new'} prompt={oauth_prompt}")
print(f"[OAuth Callback] user_hash={user_hash} provider={provider} result={result} reason={reason_code}")
```

**Ejemplo output:**
```
[OAuth URL Generated] user_hash=abc12345 mode=new prompt=select_account
[OAuth Callback] user_hash=abc12345 provider=google result=allowed reason=NEW_SLOT_AVAILABLE
[OAuth Callback] user_hash=def67890 provider=google result=blocked reason=HISTORICAL_LIMIT_REACHED
```

### Testing Local (Sin HTTPS)

**Configuración desarrollo:**
```bash
# .env.local
GOOGLE_REDIRECT_URI=http://localhost:8000/auth/google/callback  # OK en dev
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000  # OK en dev
```

**Producción:**
```bash
# Fly.io / Vercel
GOOGLE_REDIRECT_URI=https://api.cloudaggregator.com/auth/google/callback  # HTTPS obligatorio
NEXT_PUBLIC_API_BASE_URL=https://api.cloudaggregator.com
```

### Common Errors

**1. "redirect_uri_mismatch"**
- **Causa:** URI no autorizada en Google Cloud Console
- **Fix:** Agregar URI exacta en Authorized redirect URIs

**2. "invalid_grant" en callback**
- **Causa:** Code ya usado o expirado (5 min)
- **Fix:** No hacer doble submit del form, usar code inmediatamente

**3. 401 Unauthorized en /auth/google/login-url**
- **Causa:** Token JWT expirado o inválido
- **Fix:** Frontend debe refrescar sesión Supabase antes de llamar

**4. "access_denied" por usuario**
- **Causa:** Usuario canceló OAuth o negó permisos
- **Fix:** Mostrar mensaje amigable, permitir reintentar

---
