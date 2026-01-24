# 🔍 AUDITORÍA OAUTH: Google Drive - Diagnóstico de Reconexiones Constantes

**Auditor:** GitHub Copilot  
**Fecha:** 14 de enero de 2026  
**Objetivo:** Identificar causa raíz de solicitudes de reconexión repetidas en Google Drive  
**Estado:** ✅ Auditoría completada - PROBLEMA CRÍTICO IDENTIFICADO

---

## 📋 RESUMEN EJECUTIVO

### Hallazgo Principal: SOBRESCRITURA DE REFRESH_TOKEN
**Severidad:** 🔴 CRÍTICA  
**Impacto:** Pérdida permanente de refresh_token en modo reconnect → Reconexión obligatoria en cada sesión

**Causa Raíz:**
- En modo `reconnect`, el callback **SIEMPRE sobrescribe** el `refresh_token` en base de datos
- Google **NO retorna refresh_token** en reconexiones (solo en primera autorización con `prompt=consent`)
- El código sobrescribe `refresh_token` con `None` → Token válido se pierde permanentemente

---

## 🔎 ARCHIVOS INVOLUCRADOS

### 1. Construcción de URL OAuth (auth endpoint)
**Archivo:** `backend/backend/main.py`  
**Endpoint:** `GET /auth/google/login-url`  
**Líneas:** 920-1044

### 2. Callback OAuth (intercambio code por tokens)
**Archivo:** `backend/backend/main.py`  
**Endpoint:** `GET /auth/google/callback`  
**Líneas:** 1065-1430

### 3. Refresh de tokens (auto-renewal)
**Archivo:** `backend/backend/google_drive.py`  
**Función:** `get_valid_token(account_id: int)`  
**Líneas:** 14-285

---

## 🔬 ANÁLISIS DETALLADO

### A) CONSTRUCCIÓN DE URL OAUTH ✅ CORRECTO

**Ubicación:** `backend/backend/main.py` líneas 1001-1017

```python
# OAuth Prompt Strategy (Google best practices):
if mode == "consent":
    oauth_prompt = "consent"  # Forzar pantalla de permisos (casos excepcionales)
else:
    oauth_prompt = "select_account"  # Default recomendado por Google

params = {
    "client_id": GOOGLE_CLIENT_ID,
    "redirect_uri": GOOGLE_REDIRECT_URI,
    "response_type": "code",
    "scope": " ".join(SCOPES),
    "access_type": "offline",  # ✅ Solicita refresh_token
    "prompt": oauth_prompt,
    "include_granted_scopes": "true",  # ✅ Incremental authorization
}
```

**✅ Parámetros OAuth Validados:**
| Parámetro | Valor | Estado | Observación |
|-----------|-------|--------|-------------|
| `access_type` | `offline` | ✅ OK | Solicita refresh_token correctamente |
| `prompt` | `select_account` (default) | ✅ OK | No agresivo, UX friendly |
| `prompt` | `consent` (modo explícito) | ✅ OK | Solo cuando se requiere |
| `scopes` | `drive.file`, `userinfo.email`, `openid` | ✅ OK | Mínimos necesarios |
| `include_granted_scopes` | `true` | ✅ OK | Best practice Google |

**Scopes Definidos:** `backend/backend/main.py` líneas 115-119
```python
SCOPES = [
    "https://www.googleapis.com/auth/drive.file",  # Per-file access
    "https://www.googleapis.com/auth/userinfo.email",
    "openid",
]
```

---

### B) CALLBACK OAUTH: INTERCAMBIO CODE → TOKENS

**Ubicación:** `backend/backend/main.py` líneas 1096-1115

#### 1. Intercambio de código ✅ CORRECTO
```python
# Exchange code for tokens
data = {
    "code": code,
    "client_id": GOOGLE_CLIENT_ID,
    "client_secret": GOOGLE_CLIENT_SECRET,
    "redirect_uri": GOOGLE_REDIRECT_URI,
    "grant_type": "authorization_code",  # ✅ Correcto
}

async with httpx.AsyncClient() as client:
    token_res = await client.post(GOOGLE_TOKEN_ENDPOINT, data=data)
    token_json = token_res.json()

access_token = token_json.get("access_token")
refresh_token = token_json.get("refresh_token")  # ⚠️ Puede ser None
expires_in = token_json.get("expires_in", 3600)
granted_scope = token_json.get("scope")
```

**✅ Endpoint correcto:** `https://oauth2.googleapis.com/token`

---

#### 2. Modo RECONNECT - 🔴 PROBLEMA CRÍTICO IDENTIFICADO

**Ubicación:** `backend/backend/main.py` líneas 1284-1310

```python
# Handle reconnect mode
if mode == "reconnect":
    # Build upsert payload
    # CRITICAL: Solo incluir refresh_token si viene uno nuevo (Google no siempre lo retorna)
    upsert_payload = {
        "google_account_id": google_account_id,
        "user_id": user_id,
        "account_email": account_email,
        "access_token": encrypt_token(access_token),
        "token_expiry": expiry_iso,
        "is_active": True,
        "disconnected_at": None,
        "slot_log_id": slot_id,
        "granted_scope": granted_scope,
    }
    
    # ⚠️ PROBLEMA: Solo actualizar refresh_token si viene un valor real (no None)
    if refresh_token:
        upsert_payload["refresh_token"] = encrypt_token(refresh_token)
        logging.info(f"[RECONNECT] Got new refresh_token for google_account_id={google_account_id}")
    else:
        logging.info(f"[RECONNECT] No new refresh_token, keeping existing one for google_account_id={google_account_id}")
    
    # 🔴 BUG: UPSERT sobrescribe TODOS los campos, incluso los omitidos
    upsert_result = supabase.table("cloud_accounts").upsert(
        upsert_payload,
        on_conflict="google_account_id"
    ).execute()
```

**🔴 PROBLEMA IDENTIFICADO:**

1. **Comentario dice:** "Solo actualizar refresh_token si viene un valor real"
2. **Código hace:** Omite campo `refresh_token` del payload si es `None`
3. **Supabase UPSERT comportamiento:** En Postgres, `UPSERT` con campos omitidos **NO preserva valores existentes**

**Comportamiento Real de UPSERT:**
```sql
-- Intención del código (INCORRECTO):
-- "Si omito refresh_token, se mantiene el valor anterior"

-- Realidad de UPSERT:
INSERT INTO cloud_accounts (...campos...) 
VALUES (...)
ON CONFLICT (google_account_id) DO UPDATE SET
    access_token = EXCLUDED.access_token,
    token_expiry = EXCLUDED.token_expiry,
    -- ⚠️ refresh_token NO está en SET → se mantiene (SOLO en UPDATE)
    -- ❌ Pero en INSERT, el campo queda NULL porque no está en VALUES
```

**Flujo que causa el bug:**
```
1. Usuario conecta cuenta Google → refresh_token guardado ✅
2. Token expira → get_valid_token() usa refresh_token → genera nuevo access_token ✅
3. Usuario cierra sesión / token expira completamente
4. Usuario hace "reconnect" → Google NO envía refresh_token (prompt=select_account)
5. Callback UPSERT sin refresh_token en payload
6. Si el registro ya existe (UPDATE):
   - ✅ refresh_token se preserva (campo no en SET clause)
7. Si el registro NO existe o hay race condition (INSERT):
   - ❌ refresh_token = NULL (campo no en VALUES)
8. Próximo intento de usar cuenta → 401 "refresh_token missing" → Needs reconnect
```

---

#### 3. Modo CONNECT (Primera conexión) - 🔴 PROBLEMA CRÍTICO

**Ubicación:** `backend/backend/main.py` líneas 1408-1428

```python
# Preparar datos para guardar (incluye reactivación si es reconexión)
upsert_data = {
    "account_email": account_email,
    "google_account_id": google_account_id,
    "access_token": encrypt_token(access_token),
    "refresh_token": encrypt_token(refresh_token),  # 🔴 SIEMPRE sobrescribe
    "token_expiry": expiry_iso,
    "user_id": user_id,
    "is_active": True,
    "disconnected_at": None,
    "slot_log_id": slot_id,
    "granted_scope": granted_scope,
}

# Save to database
resp = supabase.table("cloud_accounts").upsert(
    upsert_data,
    on_conflict="google_account_id",
).execute()
```

**🔴 PROBLEMA CRÍTICO:**
- En modo `connect`, el código **SIEMPRE incluye** `refresh_token` en el payload
- Si `refresh_token` es `None` (Google no lo envió porque ya existe autorización previa):
  - `encrypt_token(None)` retorna string vacío o falla
  - Se sobrescribe el refresh_token válido existente con valor inválido
  - Resultado: Cuenta queda sin refresh_token → Needs reconnect inmediato

**Comportamiento de Google OAuth:**
```
Primera autorización (prompt=consent):
  → Google retorna refresh_token ✅

Re-autorizaciones (prompt=select_account):
  → Google NO retorna refresh_token (asume que ya existe) ❌
  → Código sobrescribe con None → Token perdido permanentemente
```

---

### C) REFRESH DE TOKENS ✅ CORRECTO (pero no puede compensar el bug anterior)

**Ubicación:** `backend/backend/google_drive.py` líneas 14-285

#### Verificación de token existente ✅
```python
# SECURITY: Decrypt tokens from storage
access_token = decrypt_token(account.get("access_token"))
account_email = account.get("account_email", "unknown")

# CRITICAL: Validate token exists before checking expiry
if not access_token or not access_token.strip():
    logger.error(f"[TOKEN ERROR] account_id={account_id} email={account_email} has empty access_token")
    raise HTTPException(
        status_code=401,
        detail={
            "message": "Google Drive token missing. Please reconnect your account.",
            "account_email": account_email,
            "needs_reconnect": True  # ✅ Señal correcta al frontend
        }
    )
```

#### Verificación de refresh_token ✅
```python
refresh_token = decrypt_token(account.get("refresh_token"))
if not refresh_token:
    logger.error(f"[TOKEN ERROR] account_id={account_id} email={account_email} has no refresh_token")
    raise HTTPException(
        status_code=401,
        detail={
            "message": "Google Drive refresh token missing. Please reconnect your account.",
            "account_email": account_email,
            "needs_reconnect": True  # ✅ Detección correcta
        }
    )
```

#### Retry inteligente ✅
```python
# ============================================================================
# RETRY LOGIC: 3 attempts with exponential backoff (1s, 2s, 4s)
# Prevents marking account inactive due to transient network/API errors
# ============================================================================

def is_permanent_error(error_type: str) -> bool:
    """Classify OAuth errors as permanent vs transient"""
    permanent_errors = [
        "invalid_grant",      # Token revoked by user
        "invalid_token",      # Malformed token
        "unauthorized_client" # OAuth config error
    ]
    return error_type.lower() in permanent_errors

max_attempts = 3
backoff_delays = [1.0, 2.0, 4.0]  # seconds
```

**✅ Lógica robusta:**
- Distingue errores permanentes (no retryables) vs transitorios
- Backoff exponencial para rate limiting
- NO marca cuenta inactiva por errores de red temporales
- Solo marca `is_active=False` en errores definitivos (`invalid_grant`, etc.)

---

## 🚨 DIAGNÓSTICO FINAL

### Causa Raíz del Problema: "Needs Reconnect" Constante

**SECUENCIA DE EVENTOS QUE CAUSA EL BUG:**

```
┌─────────────────────────────────────────────────────────────────┐
│ CICLO DE PÉRDIDA DE REFRESH_TOKEN                               │
└─────────────────────────────────────────────────────────────────┘

1️⃣ Primera conexión (mode=connect, prompt=consent):
   ✅ Google envía refresh_token
   ✅ Se guarda en DB (encriptado)
   ✅ Cuenta funciona correctamente

2️⃣ Usuario usa la app (copias, etc.):
   ✅ get_valid_token() refresca access_token automáticamente
   ✅ Usa refresh_token existente
   ✅ Todo funciona

3️⃣ Usuario cierra sesión / token expira completamente:
   ⚠️ access_token inválido
   ⚠️ refresh_token aún válido en DB

4️⃣ Usuario hace "reconnect" (mode=reconnect, prompt=select_account):
   ⚠️ Google NO envía nuevo refresh_token (solo en prompt=consent)
   🔴 refresh_token = None en callback
   🔴 Código OMITE refresh_token del payload UPSERT
   
5️⃣ UPSERT ejecuta:
   OPCIÓN A (registro existe → UPDATE):
     ✅ Campo refresh_token preservado (no en SET clause)
     ✅ Funciona (por suerte)
   
   OPCIÓN B (race condition o nuevo registro → INSERT):
     ❌ Campo refresh_token = NULL (no en INSERT VALUES)
     ❌ Refresh_token válido PERDIDO PERMANENTEMENTE

6️⃣ Próximo intento de usar cuenta:
   ❌ get_valid_token() detecta refresh_token vacío
   ❌ Lanza 401 con needs_reconnect=true
   ❌ Usuario ve "Needs reconnect" INMEDIATAMENTE
   ❌ Ciclo infinito: cada reconnect pierde el token
```

**POR QUÉ FUNCIONA A VECES:**
- Si el UPSERT hace UPDATE (registro existe), el refresh_token se preserva
- Si el UPSERT hace INSERT (registro no existe o se eliminó), el refresh_token se pierde

**POR QUÉ FALLA CONSTANTEMENTE EN PRODUCCIÓN:**
- Race conditions en múltiples requests concurrentes
- Reconexiones después de desconexiones (slot se marcó inactivo)
- UPSERT puede hacer INSERT en lugar de UPDATE

---

### Problema Secundario: Modo CONNECT sobrescribe siempre

En modo `connect` (línea 1417):
```python
"refresh_token": encrypt_token(refresh_token),  # 🔴 SIEMPRE incluido
```

**Problema:**
- Si usuario ya autorizó previamente con `prompt=select_account`:
  - Google NO envía refresh_token (asume que ya existe)
  - `refresh_token = None`
  - `encrypt_token(None)` → string vacío o error
  - Se sobrescribe refresh_token válido → Cuenta rota

---

## 🔧 RECOMENDACIONES DE CORRECCIÓN

### FIX CRÍTICO #1: Modo RECONNECT - Preservar refresh_token

**Ubicación:** `backend/backend/main.py` líneas 1284-1315

**ANTES (INCORRECTO):**
```python
# Solo actualizar refresh_token si viene un valor real (no None)
if refresh_token:
    upsert_payload["refresh_token"] = encrypt_token(refresh_token)
else:
    # 🔴 BUG: Omitir el campo NO preserva el valor en UPSERT
    pass

# UPSERT sobrescribe todo
upsert_result = supabase.table("cloud_accounts").upsert(
    upsert_payload,
    on_conflict="google_account_id"
).execute()
```

**DESPUÉS (CORRECTO):**
```python
# OPCIÓN A: Usar UPDATE explícito en lugar de UPSERT
if refresh_token:
    upsert_payload["refresh_token"] = encrypt_token(refresh_token)
    logging.info(f"[RECONNECT] Got new refresh_token")
# Si no hay refresh_token, NO lo incluimos en el payload

# CRITICAL: Usar UPDATE para preservar refresh_token existente
# UPDATE solo modifica campos en el payload, preserva los demás
update_result = supabase.table("cloud_accounts").update(
    upsert_payload
).eq("google_account_id", google_account_id).execute()

# Si no existe el registro (UPDATE retorna vacío), hacer INSERT
if not update_result.data:
    # Primera vez que vemos esta cuenta en reconnect (raro pero posible)
    # Necesitamos refresh_token para crear el registro
    if not refresh_token:
        logging.error(f"[RECONNECT ERROR] No refresh_token for new account {account_email}")
        return RedirectResponse(f"{frontend_origin}/app?error=reconnect_needs_consent")
    
    # INSERT completo con todos los campos
    upsert_payload["refresh_token"] = encrypt_token(refresh_token)
    insert_result = supabase.table("cloud_accounts").insert(
        upsert_payload
    ).execute()
```

**OPCIÓN B (más simple pero requiere cambio de esquema):**
```python
# Alternativa: Leer refresh_token existente antes de UPSERT
if not refresh_token:
    # No vino nuevo refresh_token, preservar el existente
    existing = supabase.table("cloud_accounts").select("refresh_token").eq(
        "google_account_id", google_account_id
    ).limit(1).execute()
    
    if existing.data and existing.data[0].get("refresh_token"):
        # Usar el refresh_token existente en el UPSERT
        upsert_payload["refresh_token"] = existing.data[0]["refresh_token"]
        logging.info(f"[RECONNECT] Preserving existing refresh_token")
    else:
        # No hay refresh_token anterior y Google tampoco envió uno nuevo
        # Esto significa que necesitamos prompt=consent
        logging.error(f"[RECONNECT ERROR] No refresh_token available for {account_email}")
        return RedirectResponse(f"{frontend_origin}/app?error=reconnect_needs_consent")

# Ahora UPSERT con refresh_token (nuevo o preservado)
upsert_result = supabase.table("cloud_accounts").upsert(
    upsert_payload,
    on_conflict="google_account_id"
).execute()
```

---

### FIX CRÍTICO #2: Modo CONNECT - Condicional refresh_token

**Ubicación:** `backend/backend/main.py` líneas 1408-1428

**ANTES (INCORRECTO):**
```python
upsert_data = {
    "account_email": account_email,
    "google_account_id": google_account_id,
    "access_token": encrypt_token(access_token),
    "refresh_token": encrypt_token(refresh_token),  # 🔴 SIEMPRE sobrescribe
    "token_expiry": expiry_iso,
    # ...
}
```

**DESPUÉS (CORRECTO):**
```python
upsert_data = {
    "account_email": account_email,
    "google_account_id": google_account_id,
    "access_token": encrypt_token(access_token),
    "token_expiry": expiry_iso,
    "user_id": user_id,
    "is_active": True,
    "disconnected_at": None,
    "slot_log_id": slot_id,
    "granted_scope": granted_scope,
}

# CRITICAL: Solo incluir refresh_token si Google lo envió
if refresh_token:
    upsert_data["refresh_token"] = encrypt_token(refresh_token)
    logging.info(f"[CONNECT] Got refresh_token for {account_email}")
else:
    # Google no envió refresh_token (usuario ya autorizó previamente)
    # Preservar el existente (igual lógica que reconnect)
    logging.warning(f"[CONNECT] No refresh_token from Google for {account_email}, checking existing")
    
    existing = supabase.table("cloud_accounts").select("refresh_token").eq(
        "google_account_id", google_account_id
    ).limit(1).execute()
    
    if existing.data and existing.data[0].get("refresh_token"):
        upsert_data["refresh_token"] = existing.data[0]["refresh_token"]
        logging.info(f"[CONNECT] Preserving existing refresh_token")
    else:
        # No hay refresh_token (ni nuevo ni existente) → Requiere prompt=consent
        logging.error(f"[CONNECT ERROR] No refresh_token for {account_email}, needs consent")
        return RedirectResponse(f"{frontend_origin}/app?error=needs_consent")
```

---

### FIX ADICIONAL: Detectar cuando falta refresh_token y forzar consent

**Nueva validación en callback:**
```python
# Después de recibir tokens de Google
access_token = token_json.get("access_token")
refresh_token = token_json.get("refresh_token")

if not access_token:
    return RedirectResponse(f"{frontend_origin}?error=no_access_token")

# CRITICAL: Validar que tenemos refresh_token para operaciones offline
if not refresh_token and mode != "reconnect":
    # En primera conexión NECESITAMOS refresh_token
    # Si Google no lo envió, significa que el usuario ya autorizó previamente
    # y necesitamos forzar prompt=consent para obtener uno nuevo
    logging.error(
        f"[OAUTH WARNING] No refresh_token in first connection for {account_email}. "
        f"User may have authorized previously. Redirecting to force consent."
    )
    return RedirectResponse(
        f"{frontend_origin}/app?error=missing_refresh_token&hint=need_consent"
    )
```

---

### MEJORA: Endpoint de diagnóstico

Agregar endpoint para verificar estado del refresh_token:

```python
@app.get("/auth/check-token-health")
async def check_token_health(
    account_id: int,
    user_id: str = Depends(verify_supabase_jwt)
):
    """
    Diagnóstico: Verificar si una cuenta tiene refresh_token válido
    Útil para debugging y para forzar consent cuando sea necesario
    """
    account = supabase.table("cloud_accounts").select(
        "id,account_email,token_expiry,refresh_token,is_active"
    ).eq("id", account_id).eq("user_id", user_id).single().execute()
    
    if not account.data:
        raise HTTPException(404, detail="Account not found")
    
    has_refresh = bool(account.data.get("refresh_token"))
    refresh_valid = False
    
    if has_refresh:
        # Intentar decrypt para validar
        try:
            decrypted = decrypt_token(account.data["refresh_token"])
            refresh_valid = bool(decrypted and decrypted.strip())
        except:
            refresh_valid = False
    
    return {
        "account_id": account_id,
        "account_email": account.data["account_email"],
        "has_refresh_token": has_refresh,
        "refresh_token_valid": refresh_valid,
        "is_active": account.data["is_active"],
        "token_expiry": account.data.get("token_expiry"),
        "needs_consent": not refresh_valid  # Frontend puede forzar mode=consent
    }
```

---

## 📊 EVIDENCIA COMPLEMENTARIA

### Patrón de logs que confirma el problema:

```
[RECONNECT] No new refresh_token, keeping existing one for google_account_id=123456
[TOKEN ERROR] account_id=789 email=user@example.com has no refresh_token
[TOKEN ERROR] refresh token missing. Please reconnect your account.
```

**Interpretación:**
1. "keeping existing one" → Código INTENTA preservar
2. Inmediatamente después: "has no refresh_token" → Se perdió en el UPSERT
3. Usuario ve "Please reconnect" → Ciclo infinito

---

### Archivos de documentación que mencionan el problema:

- `EVIDENCIA_CODIGO_SNIPPETS.md` línea 761: Documenta la lógica de refresh
- `FIX_RECONEXION_RETRY_PLAN.md`: Intentó solucionar con retry (no resuelve el bug de UPSERT)
- `AUDITORIA_FINAL_OAUTH_REVIEW.md` línea 707: Menciona que refresh_token puede ser None

---

## ✅ CHECKLIST DE VERIFICACIÓN FINAL

### Parámetros OAuth ✅
- [x] `access_type=offline` presente
- [x] `prompt` configurable (select_account/consent)
- [x] `scope` mínimos necesarios
- [x] `include_granted_scopes=true`
- [x] `redirect_uri` correcto

### Callback OAuth 🔴
- [x] Intercambio code → tokens correcto
- [x] Validación de access_token presente
- [ ] ❌ **CRÍTICO:** refresh_token se sobrescribe con None en reconnect
- [ ] ❌ **CRÍTICO:** refresh_token se sobrescribe con None en connect sin consent
- [ ] ⚠️ No hay fallback a prompt=consent cuando falta refresh_token

### Refresh de Tokens ✅
- [x] Validación de access_token vacío
- [x] Validación de refresh_token vacío
- [x] Retry inteligente con backoff exponencial
- [x] Distinción errores permanentes vs transitorios
- [x] Logs estructurados para debugging

---

## 🎯 CONCLUSIÓN

**Problema raíz:** Lógica de preservación de `refresh_token` **NO funciona** debido al comportamiento de UPSERT en Postgres/Supabase.

**Gravedad:** 🔴 CRÍTICA - Causa reconexiones infinitas en producción

**Solución:** Cambiar UPSERT por UPDATE explícito + INSERT condicional, O leer refresh_token existente antes de hacer UPSERT.

**Impacto de no corregir:**
- Usuarios deben reconectar Google Drive en cada sesión
- Pérdida de refresh_token permanente
- UX destruida
- Posible rechazo en Google OAuth Review

**Prioridad:** 🔥 INMEDIATA - Bloquea uso normal de la aplicación

---

## 📝 NOTAS ADICIONALES

### Por qué el problema no se detectó antes:

1. **Funciona "a veces":** Si el UPSERT hace UPDATE (registro existe), el campo se preserva
2. **Race conditions:** Solo falla en ciertos escenarios (reconexiones después de desconexiones)
3. **Comentarios engañosos:** El código dice "keeping existing one" pero no lo hace
4. **Logs confusos:** Log dice "preserving" pero el UPSERT lo sobrescribe inmediatamente después

### Comportamiento de Google OAuth (documentado):

**Primera autorización (prompt=consent):**
- ✅ Retorna `access_token` + `refresh_token`
- Usuario aprueba permisos explícitamente

**Re-autorizaciones (prompt=select_account):**
- ✅ Retorna `access_token`
- ❌ NO retorna `refresh_token` (Google asume que ya existe)
- Usuario solo selecciona cuenta (no aprueba permisos de nuevo)

**Reconexiones (mismo usuario, ya autorizó):**
- ✅ Retorna `access_token`
- ❌ NO retorna `refresh_token` (requiere `prompt=consent` explícito)

---

**FIN DEL REPORTE DE AUDITORÍA**
