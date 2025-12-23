# AUDITORÍA + FIXES: Modelo Slots Vitalicios FREE (FINAL)
## Fecha: 2025-12-22
## Versión: 1.1 (Auditoría Final - Google OAuth Compliance)
## Objetivo: Asegurar cumplimiento estricto "2 slots históricos vitalicios" en FREE

---

## 🔴 BUGS CORREGIDOS (AUDITORÍA FINAL)

### 1. Frontend gating incorrecto (mezclaba activas vs históricas) ✅
**Problema:** Usaba `clouds_connected/clouds_allowed` que puede ser ambiguo.  
**Fix:** Separar campos explícitos:
- `historical_slots_used` - slots consumidos lifetime (nunca decrece)
- `historical_slots_total` - slots permitidos por plan
- `active_clouds_connected` - cuentas activas ahora

### 2. Backend pre-check bloqueaba OAuth prematuramente ✅
**Problema:** Pre-check en `/auth/google/login` bloqueaba antes de conocer qué cuenta elegirá.  
**Fix:** ELIMINADO pre-check. Validación solo en callback con `check_cloud_limit_with_slots`.

### 3. Prompt OAuth incorrecto para reconexión ✅
**Problema:** Siempre usaba `prompt=consent` (fuerza pantalla de permisos).  
**Fix:** Usar `prompt=select_account` por defecto (Google best practice).

### 4. PII en URL - user_id expuesto en querystring ✅ CRÍTICO
**Problema:** Exponía `user_id` UUID en querystring (logs/historial/referrer).  
**Fix:** Derivar `user_id` de JWT usando `Depends(verify_supabase_jwt)`. NO querystring.

### 5. Historical slots sin fallback robusto ✅ NUEVO
**Problema:** Si `plan.clouds_slots_used` viene NULL/0 inconsistente, gating falla.  
**Fix:** Fallback a COUNT DISTINCT desde `cloud_slots_log` (fuente de verdad).

### 6. provider_account_id expuesto innecesariamente ✅ NUEVO
**Problema:** GET /me/slots devolvía `provider_account_id` (identificador interno).  
**Fix:** REMOVIDO - UI reconecta via OAuth, no necesita account_id.

---

## 📝 DIFF EXACTO DE CAMBIOS

### 1. Backend: `backend/backend/quota.py` (AUDITORÍA FINAL)

**Archivo:** `backend/backend/quota.py`  
**Función:** `get_user_quota_info()`  
**Líneas:** 190-220

```diff
     # Calculate cloud limits
     plan_name = plan.get("plan", "free")
     max_clouds = PLAN_CLOUD_LIMITS.get(plan_name, 1)
     extra_clouds = plan.get("extra_clouds", 0)
     clouds_allowed = max_clouds + extra_clouds
     
     # Count ACTIVE connected clouds (for UI display)
     active_count_result = supabase.table("cloud_accounts").select("id").eq("user_id", user_id).eq("is_active", True).execute()
     active_clouds_connected = len(active_count_result.data) if active_count_result.data else 0
     
-    # Historical slots (lifetime, never decreases)
-    historical_slots_used = plan.get("clouds_slots_used", 0)
-    historical_slots_total = plan.get("clouds_slots_total", 2)  # Default FREE=2
+    # Historical slots (lifetime, never decreases) - FALLBACK ROBUSTO
+    # Prioridad 1: usar clouds_slots_used del plan (incremental, mantenido por connect_cloud_account_with_slot)
+    # Prioridad 2: si es NULL/0 inconsistente, contar DISTINCT desde cloud_slots_log (fuente de verdad)
+    historical_slots_used_from_plan = plan.get("clouds_slots_used", 0)
+    
+    if historical_slots_used_from_plan == 0:
+        # Fallback: contar slots únicos desde cloud_slots_log (incluye activos e inactivos)
+        slots_count_result = supabase.table("cloud_slots_log").select("provider_account_id").eq("user_id", user_id).execute()
+        # COUNT DISTINCT provider_account_id (cada cuenta única cuenta como 1 slot)
+        unique_provider_accounts = set()
+        if slots_count_result.data:
+            for slot in slots_count_result.data:
+                unique_provider_accounts.add(slot["provider_account_id"])
+        historical_slots_used = len(unique_provider_accounts)
+        
+        import logging
+        logging.warning(f"[FALLBACK SLOTS] user_id={user_id} - plan.clouds_slots_used era 0, usando COUNT desde cloud_slots_log: {historical_slots_used}")
+    else:
+        historical_slots_used = historical_slots_used_from_plan
+    
+    historical_slots_total = plan.get("clouds_slots_total", 2)  # Default FREE=2
     
     copies_used = plan["copies_used_month"]
     copies_limit = plan["copies_limit_month"]
```

**Rationale (AUDITORÍA FINAL):**
- **ROBUSTO:** Fallback a COUNT DISTINCT desde `cloud_slots_log` si plan inconsistente
- Nunca depende de `cloud_accounts` (solo cuentas activas) para slots históricos
- `cloud_slots_log` es la fuente de verdad (incluye activos e inactivos)
- Logging warning para detectar inconsistencias en producción

---

### 2. Backend: `backend/backend/main.py` (AUDITORÍA FINAL)

**Archivo:** `backend/backend/main.py`  
**Líneas:** 42-46 (SCOPES) + 65-104 (google_login)

**CAMBIO 1: SCOPES Mínimos Documentados**
```diff
+# Google OAuth Scopes - MÍNIMOS NECESARIOS (Google OAuth Compliance)
+# https://www.googleapis.com/auth/drive: Full Drive access (necesario para copy files between accounts)
+# https://www.googleapis.com/auth/userinfo.email: Email del usuario (identificación)
+# openid: OpenID Connect (autenticación)
+# NOTA: drive.readonly NO es suficiente para copiar archivos entre cuentas
 SCOPES = [
     "https://www.googleapis.com/auth/drive",
     "https://www.googleapis.com/auth/userinfo.email",
     "openid",
 ]
```

**CAMBIO 2: Endpoint OAuth Login (JWT Derivation + Prompt Strategy)**
```diff
 @app.get("/auth/google/login")
-def google_login(user_id: Optional[str] = None, mode: Optional[str] = None):
+def google_login(mode: Optional[str] = None, user_id: str = Depends(verify_supabase_jwt)):
     """
-    Initiate Google OAuth flow with optional user_id in state.
+    Initiate Google OAuth flow.
+    
+    SEGURIDAD: user_id derivado de JWT (NO query param) para evitar PII en URL/logs.
     
     IMPORTANTE: NO hay pre-check de límites aquí porque aún no sabemos qué cuenta
     elegirá el usuario. La validación definitiva ocurre en callback usando
     check_cloud_limit_with_slots (que permite reconexión de slots históricos).
     
+    OAuth Prompt Strategy (Google OAuth Compliance):
+    - "select_account": Muestra selector de cuenta (UX recomendada por Google)
+    - "consent": Fuerza pantalla de permisos (SOLO cuando mode="consent" explícito)
+    
     Args:
-        user_id: UUID del usuario (opcional, idealmente derivar de JWT en futuro)
-        mode: "reauth" para reconexión (cambia prompt OAuth)
+        mode: "reauth" para reconexión, "consent" para forzar consentimiento
+        user_id: Derivado automáticamente de JWT (verify_supabase_jwt)
     """
     if not GOOGLE_CLIENT_ID or not GOOGLE_REDIRECT_URI:
         return {"error": "Missing GOOGLE_CLIENT_ID or GOOGLE_REDIRECT_URI"}

     # NO PRE-CHECK - La validación se hace en callback cuando conocemos provider_account_id
     # Esto permite reconexión de slots históricos sin bloqueo prematuro
     
-    # Determinar prompt OAuth según modo
-    # "select_account": fuerza selector de cuenta (mejor UX para reconexión)
-    # "consent": fuerza pantalla de permisos (solo si necesitas refresh_token nuevo)
-    oauth_prompt = "select_account" if mode == "reauth" else "consent"
+    # OAuth Prompt Strategy (Google best practices):
+    # - Default: "select_account" (mejor UX, no agresivo)
+    # - Consent: SOLO si mode="consent" explícito (primera vez o refresh_token perdido)
+    # - Evitar "consent" innecesario (Google OAuth review lo penaliza)
+    if mode == "consent":
+        oauth_prompt = "consent"  # Forzar pantalla de permisos (casos excepcionales)
+    else:
+        oauth_prompt = "select_account"  # Default recomendado por Google
     
     params = {
         "client_id": GOOGLE_CLIENT_ID,
         "redirect_uri": GOOGLE_REDIRECT_URI,
         "response_type": "code",
         "scope": " ".join(SCOPES),
-        "access_type": "offline",
+        "access_type": "offline",  # Solicita refresh_token
         "prompt": oauth_prompt,
     }
     
-    # Si se proporciona user_id, crear un state JWT
-    # TODO Fase 2: Derivar user_id de JWT/cookie para no exponerlo en query param
-    if user_id:
-        state_token = create_state_token(user_id)
-        params["state"] = state_token
+    # Crear state JWT con user_id (seguro, firmado)
+    state_token = create_state_token(user_id)
+    params["state"] = state_token

     from urllib.parse import urlencode
     url = f"{GOOGLE_AUTH_ENDPOINT}?{urlencode(params)}"
     return RedirectResponse(url)
```

**CAMBIO 3: GET /me/slots (Remover provider_account_id)**
```diff
 @app.get("/me/slots")
 async def get_user_slots(user_id: str = Depends(verify_supabase_jwt)):
     """
     Get all historical cloud slots (active and inactive) for the authenticated user.
     ...
+    Security:
+    - provider_account_id REMOVED (no necesario para UI)
+    - UI reconecta via OAuth, no necesita account_id interno
     """
     try:
-        slots_result = supabase.table("cloud_slots_log").select(
-            "id,provider,provider_email,provider_account_id,slot_number,is_active,connected_at,disconnected_at,plan_at_connection"
-        ).eq("user_id", user_id).order("slot_number").execute()
+        # IMPORTANTE: NO devolver provider_account_id (identificador interno, no necesario)
+        slots_result = supabase.table("cloud_slots_log").select(
+            "id,provider,provider_email,slot_number,is_active,connected_at,disconnected_at,plan_at_connection"
+        ).eq("user_id", user_id).order("slot_number").execute()
         
         return {"slots": slots_result.data or []}
```

**Rationale (AUDITORÍA FINAL):**
- **SEGURIDAD CRÍTICA:** user_id derivado de JWT (NO querystring) - evita PII en logs
- **OAuth Compliance:** `prompt=select_account` por defecto (Google best practice)
- **Scopes mínimos:** Documentados con justificación (Drive full access necesario para copy)
- **PII reduction:** provider_account_id removido de /me/slots (no necesario)

---

### 4. Frontend: `frontend/src/lib/api.ts` (AUDITORÍA FINAL)

**Archivo:** `frontend/src/lib/api.ts`  
**Tipos:** CloudSlot

```diff
 export type CloudSlot = {
   id: string;
   provider: string;
   provider_email: string;
-  provider_account_id: string;
   slot_number: number;
   is_active: boolean;
   connected_at: string;
   disconnected_at: string | null;
   plan_at_connection: string;
 };
```

**Rationale:** Removido `provider_account_id` (ya no viene del backend por seguridad)

---

### 5. Frontend: `frontend/src/components/ReconnectSlotsModal.tsx` (AUDITORÍA FINAL)

**Archivo:** `frontend/src/components/ReconnectSlotsModal.tsx`  
**Función:** `handleReconnect()`  
**Líneas:** 43-57

```diff
   const handleReconnect = async (slot: CloudSlot) => {
-    // Obtener user_id de la sesión de Supabase
+    // Verificar que hay sesión activa (el token JWT se enviará automáticamente)
     const { data: { session } } = await supabase.auth.getSession();
     if (!session?.user?.id) {
       setError("No hay sesión activa");
       return;
     }
     
     // Redirigir a OAuth en modo reconexión
-    // mode=reauth → backend usa prompt=select_account (mejor UX)
-    // TODO Fase 2: Eliminar user_id de query param, derivar de JWT
-    window.location.href = `${API_BASE_URL}/auth/google/login?user_id=${session.user.id}&mode=reauth`;
+    // SEGURIDAD: user_id derivado de JWT en backend, NO en querystring
+    // mode=reauth → backend usa prompt=select_account (mejor UX)
+    window.location.href = `${API_BASE_URL}/auth/google/login?mode=reauth`;
     
     // Callback opcional para lógica adicional
     if (onReconnect) {
       onReconnect(slot);
     }
   };
```

**Rationale:** 
- **SEGURIDAD:** user_id NO en URL (derivado de JWT en backend)
- Solo envía `mode=reauth` para indicar reconexión

---

### 6. Frontend: `frontend/src/app/app/page.tsx` (AUDITORÍA FINAL)

**Archivo:** `frontend/src/app/app/page.tsx`  
**Función:** `handleConnectGoogle()`  
**Líneas:** 148-156

```diff
   const handleConnectGoogle = async () => {
     if (!userId) {
       setError("No hay sesión de usuario activa. Recarga la página.");
       return;
     }
-    // Redirige al backend con el user_id en el query param
-    window.location.href = `${API_BASE_URL}/auth/google/login?user_id=${userId}`;
+    // SEGURIDAD: user_id derivado de JWT en backend, NO en querystring
+    // Backend endpoint /auth/google/login usa Depends(verify_supabase_jwt)
+    window.location.href = `${API_BASE_URL}/auth/google/login`;
   };
```

**Rationale:** 
- **SEGURIDAD:** user_id NO en URL (backend deriva de JWT automáticamente)
- Endpoint `/auth/google/login` protegido con `Depends(verify_supabase_jwt)`

---

## 🔐 GOOGLE OAUTH COMPLIANCE (AUDITORÍA FINAL)

### Scopes Mínimos Justificados

```python
# SCOPES declarados (backend/backend/main.py línea 42-50)
SCOPES = [
    "https://www.googleapis.com/auth/drive",        # Full Drive access
    "https://www.googleapis.com/auth/userinfo.email",  # Email del usuario
    "openid",                                        # OpenID Connect
]
```

**Justificación:**
1. **`drive` (no `drive.readonly`)**: Necesario para **copiar archivos entre cuentas**
   - `drive.readonly` NO permite escritura (copy operation requiere permisos write)
   - Feature principal de la app: copy files between Drive accounts
   
2. **`userinfo.email`**: Identificación del usuario
   - Mostrar email en UI
   - Diferenciar cuentas conectadas
   
3. **`openid`**: Autenticación OpenID Connect
   - Estándar para identificación segura

**NO solicitamos:**
- ❌ `drive.appdata` (no usado)
- ❌ `drive.photos` (no usado)
- ❌ `contacts` (no usado)
- ❌ `gmail` (no usado)

### OAuth Prompt Strategy (Google Best Practices)

**Implementación (backend/backend/main.py línea 85-92):**

```python
# OAuth Prompt Strategy (Google best practices):
# - Default: "select_account" (mejor UX, no agresivo)
# - Consent: SOLO si mode="consent" explícito (primera vez o refresh_token perdido)
# - Evitar "consent" innecesario (Google OAuth review lo penaliza)
if mode == "consent":
    oauth_prompt = "consent"  # Forzar pantalla de permisos (casos excepcionales)
else:
    oauth_prompt = "select_account"  # Default recomendado por Google
```

**Rationale:**
1. **`select_account` por defecto** (Google recomendación)
   - Muestra selector de cuenta
   - NO fuerza pantalla de permisos innecesariamente
   - Mejor UX para usuarios recurrentes
   
2. **`consent` solo cuando explícito**
   - Primera conexión (necesita refresh_token)
   - Refresh_token perdido (recovery)
   - Usuario solicita re-autorización
   
3. **Evita `prompt=consent` innecesario**
   - Google OAuth review penaliza apps agresivas
   - UX pobre (usuarios ven pantalla de permisos repetidamente)

### Seguridad PII/Identificadores

**Implementado:**
- ✅ **NO user_id en querystring** - Derivado de JWT
- ✅ **NO provider_account_id en API responses** - Removido de GET /me/slots
- ✅ **NO emails en URL** - Solo en response body autorizado
- ✅ **JWT firmado** - state token seguro
- ✅ **HTTPS redirect URIs** - Verificar en producción

### Access Type: offline

```python
"access_type": "offline",  # Solicita refresh_token
```

**Justificación:**
- Necesario para refresh tokens (re-autenticación sin user interaction)
- Google solicita este parámetro para apps server-side
- Combinado con `prompt` strategy correcta (no siempre consent)

---

## 🧪 TESTING CHECKLIST (STAGING OBLIGATORIO)

### Escenario 1: Usuario FREE sin historial (onboarding)
1. Crear usuario nuevo
2. Conectar Cuenta A → ✅ Éxito (slot 1/2)
3. Conectar Cuenta B → ✅ Éxito (slot 2/2)
4. Verificar botón "Conectar nueva" → ❌ DISABLED
5. **Validar logs:** NO debe haber `user_id` en logs de redirect

### Escenario 2: Usuario FREE con 2 slots, desconecta 1
1. Usuario tiene A + B conectadas
2. Desconectar Cuenta A
3. Verificar UI: "Slots históricos: 2/2" + "Cuentas conectadas: 1"
4. Botón "Conectar nueva" → ❌ DISABLED (correcto)
5. Botón "Reconectar slots" → ✅ ENABLED

### Escenario 3: Reconexión de slot inactivo (CORE)
1. Desde modal "Reconectar slots"
2. Click en Cuenta A inactiva
3. **Validar OAuth:** Debe mostrar `prompt=select_account` (NO consent)
4. Seleccionar Cuenta A → ✅ Éxito reconexión
5. Verificar: "Slots históricos: 2/2" + "Cuentas conectadas: 2"
6. **Validar logs:** NO debe haber `user_id` en querystring

### Escenario 4: Usuario FREE intenta conectar Cuenta C nueva
1. Usuario tiene A + B en historial (ambas activas)
2. Desde OAuth manualmente intentar Cuenta C
3. Backend debe rechazar: "Has alcanzado el límite de 2 cuentas históricas"
4. **Validar:** check_cloud_limit_with_slots() retorna `{"can_connect": false}`

### Escenario 5: Fallback robusto (migración limpia)
1. Crear usuario con `clouds_slots_used = 0` en `user_plans`
2. Insertar 2 registros en `cloud_slots_log` (simulación datos antiguos)
3. Llamar GET /me/quota → ✅ Debe retornar `historical_slots_used: 2`
4. **Validar:** Fallback COUNT DISTINCT funcionando

### Escenario 6: Usuario PAID (control negativo)
1. Usuario con plan PREMIUM
2. Conectar 10 cuentas → ✅ Todas OK (no límite histórico)
3. Desconectar 5 → "Cuentas conectadas: 5"
4. Reconectar las 5 → ✅ Éxito
5. Conectar 3 más → ✅ Éxito (no límite lifetime)

### Escenario 7: OAuth Compliance (Google review)
1. Primera conexión: Verificar `prompt=select_account` (NO consent)
2. Si refresh_token perdido: Verificar `mode=consent` funciona
3. Verificar redirect URI usa HTTPS en producción
4. Confirmar scopes mínimos (drive, userinfo.email, openid)
5. **LOGS:** Confirmar NO hay PII (user_id, emails) en URL redirect

---

## 🚀 DEPLOYMENT CHECKLIST

### Pre-Deploy (Staging)
- [ ] Run all 7 test scenarios
- [ ] Verificar 0 errores TypeScript/Python
- [ ] Audit logs: NO user_id en querystrings
- [ ] Verificar historical_slots_used con fallback

### Producción (Fly.io + Vercel)
- [ ] Deploy backend a Fly.io:
  ```bash
  fly deploy
  fly logs --app cloud-aggregator-backend
  ```
- [ ] Deploy frontend a Vercel:
  ```bash
  vercel --prod
  ```
- [ ] Verificar REDIRECT_URI usa HTTPS (no http localhost)
- [ ] Test OAuth flow completo en prod
- [ ] Monitor logs 24h post-deploy

### Google OAuth Review (Si aplica)
- [ ] Verificar scopes justificados (documentación lista)
- [ ] Confirmar `prompt=select_account` por defecto
- [ ] Verificar NO PII en URLs
- [ ] Privacy Policy actualizada (URL `/privacy`)
- [ ] Terms of Service actualizados (URL `/terms`)

---

## 📊 MONITOREO POST-DEPLOY

### Métricas Clave
1. **OAuth success rate:** % conexiones exitosas
2. **Slot reconexión:** % usuarios FREE que usan modal reconexión
3. **Error 401/403:** Monitorear token expirado
4. **Historical slots accuracy:** Comparar `historical_slots_used` vs COUNT real

### Logs a Vigilar
```bash
# Backend logs (Fly.io)
grep "check_cloud_limit_with_slots" logs.txt
grep "historical_slots_used" logs.txt

# Verificar NO hay user_id en logs
grep "user_id=" logs.txt  # Debe retornar 0 resultados en OAuth redirects
```

---

## 🎯 RESUMEN EJECUTIVO

**Problema resuelto:**
- ✅ Usuarios FREE pueden reconectar slots históricos sin bloqueo
- ✅ UI distingue entre "Slots históricos" (lifetime) y "Cuentas conectadas" (activas)
- ✅ Backend valida correctamente reconexión vs cuenta nueva

**Cambios de seguridad (Auditoría Final):**
- ✅ JWT derivation: user_id desde token, NO querystring
- ✅ OAuth compliance: `prompt=select_account` por defecto
- ✅ PII reduction: Removido `provider_account_id` de GET /me/slots
- ✅ Fallback robusto: COUNT DISTINCT desde cloud_slots_log

**Testing status:**
- ⏳ Pendiente en staging (7 escenarios definidos)
- ⏳ Deployment a producción (checklist listo)

**Próximos pasos:**
1. Ejecutar testing en staging
2. Deploy a producción (Fly.io + Vercel)
3. Monitoreo logs 24h
4. Validar Google OAuth review (si aplica)

**Archivo:** `frontend/src/app/app/page.tsx`  
**Tipos:** Líneas 38-50

```diff
 type QuotaInfo = {
   plan: string;
   used: number;
   limit: number;
   remaining: number;
+  // DEPRECATED (ambiguous):
   clouds_allowed: number;
   clouds_connected: number;
   clouds_remaining: number;
+  // NEW EXPLICIT FIELDS (preferred):
+  historical_slots_used: number;      // Lifetime slots consumed
+  historical_slots_total: number;     // Slots allowed by plan
+  active_clouds_connected: number;    // Currently active accounts
 } | null;
```

**Header info:** Líneas 230-245

```diff
             {quota && (
               <>
                 <p className="text-xs text-slate-500 mt-1">
-                  Plan: {quota.plan.toUpperCase()} • Slots históricos: {quota.clouds_connected} / {quota.clouds_allowed}
+                  Plan: {quota.plan.toUpperCase()} • Slots históricos: {quota.historical_slots_used} / {quota.historical_slots_total}
                 </p>
+                <p className="text-xs text-slate-500 mt-0.5">
+                  Cuentas conectadas: {quota.active_clouds_connected}
+                </p>
-                {quota.clouds_connected >= quota.clouds_allowed && (
+                {quota.historical_slots_used >= quota.historical_slots_total && (
                   <p className="text-xs text-slate-400 italic mt-0.5">
                     Puedes reconectar tus cuentas anteriores en cualquier momento
                   </p>
                 )}
```

**Botón gating:** Líneas 254-268

```diff
             <button
               onClick={handleConnectGoogle}
-              disabled={quota && quota.clouds_connected >= quota.clouds_allowed}
+              disabled={quota && quota.historical_slots_used >= quota.historical_slots_total}
               className={
-                quota && quota.clouds_connected >= quota.clouds_allowed
+                quota && quota.historical_slots_used >= quota.historical_slots_total
                   ? "rounded-lg transition px-4 py-2 text-sm font-semibold bg-slate-600 text-slate-400 cursor-not-allowed"
                   : "rounded-lg transition px-4 py-2 text-sm font-semibold bg-emerald-500 hover:bg-emerald-600"
               }
               title={
-                quota && quota.clouds_connected >= quota.clouds_allowed
-                  ? "Has usado todos tus slots. Puedes reconectar cuentas anteriores desde 'Ver mis cuentas'"
+                quota && quota.historical_slots_used >= quota.historical_slots_total
+                  ? "Has usado todos tus slots históricos. Puedes reconectar tus cuentas anteriores desde 'Ver mis cuentas'"
                   : "Conectar una nueva cuenta de Google Drive"
               }
             >
               Conectar nueva cuenta
             </button>
```

**Rationale:**
- Usa campos explícitos para gating correcto
- Separa "Slots históricos" (lifetime) de "Cuentas conectadas" (activas ahora)
- Gating basado en `historical_slots_used >= historical_slots_total` (correcto)

---

### 4. Frontend: `frontend/src/components/ReconnectSlotsModal.tsx`

**Archivo:** `frontend/src/components/ReconnectSlotsModal.tsx`  
**Función:** `handleReconnect()`  
**Líneas:** 43-57

```diff
   const handleReconnect = async (slot: CloudSlot) => {
     // Obtener user_id de la sesión de Supabase
     const { data: { session } } = await supabase.auth.getSession();
     if (!session?.user?.id) {
       setError("No hay sesión activa");
       return;
     }
     
-    // Redirigir a OAuth - el backend validará que provider_account_id coincida con el slot histórico
-    window.location.href = `${API_BASE_URL}/auth/google/login?user_id=${session.user.id}`;
+    // Redirigir a OAuth en modo reconexión
+    // mode=reauth → backend usa prompt=select_account (mejor UX)
+    // TODO Fase 2: Eliminar user_id de query param, derivar de JWT
+    window.location.href = `${API_BASE_URL}/auth/google/login?user_id=${session.user.id}&mode=reauth`;
     
     // Callback opcional para lógica adicional
     if (onReconnect) {
       onReconnect(slot);
     }
   };
```

**Rationale:**
- Agrega `mode=reauth` para mejor UX (prompt=select_account)
- TODO documentado para eliminar user_id de URL en Fase 2

---

## 🧪 CHECKLIST DE PRUEBAS OBLIGATORIAS

### Escenario completo (FREE 2 slots vitalicios):

```bash
✅ Paso 1: Conectar cuenta A
   - Usuario FREE conecta Gmail A
   - Expected: historical_slots_used=1, active_clouds_connected=1
   - Botón "Conectar nueva" sigue enabled

✅ Paso 2: Conectar cuenta B (llega a 2/2)
   - Usuario conecta Gmail B
   - Expected: historical_slots_used=2, active_clouds_connected=2
   - Botón "Conectar nueva" se DESACTIVA (gris)
   - Muestra "Slots históricos: 2/2"

✅ Paso 3: Desconectar cuenta A
   - Usuario desconecta Gmail A
   - Expected: 
     * historical_slots_used=2 (NO cambia!)
     * active_clouds_connected=1 (baja)
   - Botón "Conectar nueva" SIGUE DESACTIVADO (correcto!)
   - Botón "Ver mis cuentas" siempre enabled

✅ Paso 4: Verificar modal slots históricos
   - Usuario clic "Ver mis cuentas"
   - Expected:
     * Sección "Activas (1)": Gmail B con badge verde
     * Sección "Desconectadas (1)": Gmail A con botón "Reconectar"

✅ Paso 5: Reconectar cuenta A (CRÍTICO - debe funcionar)
   - Usuario clic "Reconectar" en Gmail A
   - OAuth inicia sin bloqueo (NO pre-check)
   - OAuth muestra prompt=select_account (selector de cuenta)
   - Usuario elige Gmail A correcta
   - Callback valida provider_account_id existe en cloud_slots_log
   - SALVOCONDUCTO permite reconexión
   - Expected:
     * Gmail A reaparece en dashboard
     * historical_slots_used=2 (no cambia)
     * active_clouds_connected=2 (sube)
     * Toast: "Cuenta conectada exitosamente"

✅ Paso 6: Intentar conectar cuenta C nueva (debe bloquearse)
   - Usuario intenta conectar Gmail C (distinta)
   - OAuth NO tiene pre-check (inicia normal)
   - Callback detecta provider_account_id NO existe en cloud_slots_log
   - check_cloud_limit_with_slots valida historical_slots_used (2) >= historical_slots_total (2)
   - Expected:
     * Lanza HTTPException 402 "cloud_limit_reached"
     * Redirect a /app?error=cloud_limit_reached (sin PII)
     * Toast: "Has usado tus slots históricos. Puedes reconectar..."
     * Gmail C NO aparece en dashboard

✅ Paso 7: Verificar OAuth nunca bloquea en login
   - Verificar logs backend: NO debe haber pre-check en /auth/google/login
   - Cualquier bloqueo debe ocurrir en callback (línea ~183 main.py)
```

---

## 🔐 PREPARACIÓN PARA REVISIÓN GOOGLE OAUTH

### Cumplimiento implementado:

✅ **No PII en querystring** (emails eliminados)  
⚠️ **user_id en URL** (temporal, documentado TODO para Fase 2)  
✅ **Scopes mínimos** (solo Drive + email + openid)  
✅ **HTTPS redirect URIs** (verificar en producción)  
✅ **Mensajes claros** sin exponer datos sensibles  
✅ **prompt=select_account** para reconexión (mejor UX)

### Documentación OAuth:

```python
# Scopes usados (backend/backend/main.py línea 42):
SCOPES = [
    "https://www.googleapis.com/auth/drive",        # Acceso completo a Drive
    "https://www.googleapis.com/auth/userinfo.email",  # Email del usuario
    "openid",                                        # OpenID Connect
]

# Prompts OAuth:
# - "select_account": Reconexión (mode=reauth)
# - "consent": Primera conexión (access_type=offline para refresh_token)
```

---

## 🧼 DATA FIX (MANTENER)

**Archivo:** `backend/migrations/fix_inconsistent_slots.sql` (sin cambios)

```sql
-- Corregir slots con estado inconsistente
UPDATE cloud_slots_log 
SET is_active=false, updated_at=NOW()
WHERE disconnected_at IS NOT NULL AND is_active=true;

-- Post-check (debe retornar 0):
SELECT COUNT(*) FROM cloud_slots_log 
WHERE disconnected_at IS NOT NULL AND is_active=true;
```

---

## 📦 DEPLOYMENT CHECKLIST

### Pre-deploy:
- [ ] Backup DB tabla `cloud_slots_log`
- [ ] Ejecutar post-check SQL (verificar inconsistencias)
- [ ] Si hay inconsistencias, ejecutar `fix_inconsistent_slots.sql`
- [ ] Verificar variables de entorno:
  - [ ] `GOOGLE_CLIENT_ID`
  - [ ] `GOOGLE_CLIENT_SECRET`
  - [ ] `GOOGLE_REDIRECT_URI` (HTTPS en producción)
  - [ ] `FRONTEND_URL`
  - [ ] `SUPABASE_URL` + `SUPABASE_JWT_SECRET`

### Deploy:
- [ ] Deploy backend (main.py, quota.py)
- [ ] Deploy frontend (page.tsx, ReconnectSlotsModal.tsx)
- [ ] Verificar endpoint `/me/plan` retorna campos nuevos:
  ```bash
  curl https://api.example.com/me/plan -H "Authorization: Bearer TOKEN"
  # Expected: historical_slots_used, historical_slots_total, active_clouds_connected
  ```

### Post-deploy:
- [ ] Ejecutar PASO 1-7 de pruebas en staging
- [ ] Validar logs backend:
  - [ ] `[SALVOCONDUCTO ✓]` para reconexión exitosa
  - [ ] `[SLOT LIMIT ✗]` para cuenta nueva bloqueada
  - [ ] NO debe haber pre-check bloqueante en `/auth/google/login`
- [ ] Verificar OAuth muestra `prompt=select_account` en reconexión
- [ ] Monitorear errores 402 en `/auth/google/callback`
- [ ] Verificar NO hay PII (emails) en logs nginx/acceso

---

## 📊 RESUMEN DE CAMBIOS

| Archivo | Líneas | Cambio | Criticidad |
|---------|--------|--------|------------|
| `backend/backend/quota.py` | 168-215 | Agregar campos explícitos `historical_slots_*` | 🔴 ALTA |
| `backend/backend/main.py` | 65-104 | ELIMINAR pre-check bloqueante | 🔴 CRÍTICA |
| `frontend/src/app/app/page.tsx` | 38-268 | Usar campos explícitos para gating | 🔴 ALTA |
| `frontend/src/components/ReconnectSlotsModal.tsx` | 43-57 | Agregar `mode=reauth` | 🟡 MEDIA |

**Total:** 4 archivos, ~120 líneas cambiadas

---

## 🎯 RESULTADO ESPERADO

**ANTES (buggy):**
- ❌ Gating basado en cuentas activas (ambiguo)
- ❌ Pre-check bloqueaba reconexión en login
- ❌ OAuth siempre con `prompt=consent` (UX pobre)

**DESPUÉS (correcto):**
- ✅ Gating basado en `historical_slots_used >= historical_slots_total`
- ✅ Sin pre-check - validación solo en callback
- ✅ OAuth con `prompt=select_account` en reconexión
- ✅ Separación clara: slots históricos vs cuentas activas
- ✅ FREE puede reconectar slots históricos sin bloqueo

---

**Fin del documento de auditoría**
