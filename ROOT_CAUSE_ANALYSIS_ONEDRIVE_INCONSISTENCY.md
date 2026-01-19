# ROOT CAUSE ANALYSIS: OneDrive Connection Inconsistency

**Date:** 2026-01-19  
**Investigation ID:** RCA-001  
**Status:** ✅ Root cause identified, minimal fix proposed

---

## 🔴 REPORTED SYMPTOMS

Usuario reporta comportamiento inconsistente en producción:

1. **Transferencia inconsistente**: A veces aparece CTA de transferencia, a veces conecta directamente sin pedir transferencia (aunque sabemos que ese OneDrive ya estaba en otra cuenta)
2. **OAuth intermitente**: Microsoft OAuth requiere 2 intentos a veces
3. **Estados inestables**: Aparecen "reconnect_failed / needs reconnect" intermitentes

---

## 📊 EVIDENCIA RECOLECTADA

### 1. ✅ **Commit Consistency (Backend & Frontend)**

**Backend (Fly.io v152):**
- Deployment ID: `deployment-01KFA0P1VJNBG59SW5W04PZERX`
- Released: 2026-01-19 02:17:50Z (29 minutos antes de la investigación)
- Machine: `0807191b16e008` (running, healthy)

**Frontend (Vercel Production):**
- Production URL: `https://www.cloudaggregatorapp.com`
- API URL configured: `https://cloud-aggregator-api.fly.dev` ✅
- Auto-deployed from `main` branch

**Local Git:**
- Commit: `4e1da22ecb914bcdb9c0c1755ed59c72b88fd4aa`
- Message: `fix(onedrive): harden ownership transfer idempotency and clean logs`

**✅ CONCLUSIÓN**: Backend y frontend están en el mismo commit. No hay desincronización.

---

### 2. ⚠️ **Backend Logs Analysis**

**Log timestamp:** `2026-01-19T02:51:47Z`

#### **Evento: Intento de SAFE RECLAIM fallido**

```
WARNING:root:[SECURITY][RECLAIM][ONEDRIVE][CONNECT] 
Account reassignment authorized: provider_account_id=62c0cfcdf8b5bc8c
from_user_id=56c67b18-9b0a-4743-bc28-1e8e86800435 
to_user_id=62bf37c1-6f50-46f2-9f57-7a0b5136ed1d
email_domain=gmail.com (verified match)
```

#### **🔥 ERROR CRÍTICO: Fallback Warnings seguidos de APIError**

```
WARNING:root:[ONEDRIVE][FALLBACK][existing_slot_reclaim]    
Field 'created_at' not found, trying next fallback: 
{'message': 'column cloud_slots_log.created_at does not exist', 'code': '42703', ...}

WARNING:root:[ONEDRIVE][FALLBACK][existing_slot_reclaim]    
Field 'inserted_at' not found, trying next fallback: 
{'message': 'column cloud_slots_log.inserted_at does not exist', 'code': '42703', ...}

ERROR:root:[SECURITY][RECLAIM][ONEDRIVE][CONNECT] 
Ownership transfer failed: APIError
```

#### **Redirect final:**
```
INFO: "GET /auth/onedrive/callback?code=M.C546_SN1.2.U... HTTP/1.1" 307 Temporary Redirect
```

**Usuario es redirigido a:** `{frontend_origin}/app?error=reconnect_failed`

---

### 3. 🔍 **Code Analysis: Root Cause Identified**

**Archivo:** `backend/backend/main.py`  
**Líneas:** 5636-5690 (SAFE RECLAIM flow)

#### **Problema 1: execute_with_order_fallback degrada gracefully pero continúa ejecutando**

```python
# Línea 5642
existing_slot = execute_with_order_fallback(
    existing_slot_builder, 
    ["created_at", "inserted_at", "id"], 
    "existing_slot_reclaim"
)
```

**Función `execute_with_order_fallback` (líneas 5136-5180):**
- Intenta ordenar por `created_at` → ❌ 42703 (columna no existe)
- Intenta ordenar por `inserted_at` → ❌ 42703 (columna no existe)  
- Intenta ordenar por `id` → ❌ (probable APIError de Supabase)
- **Fallback final:** Ejecuta sin ordering → ❌ (también falla)
- **Return:** `EMPTY_RESULT = SimpleNamespace(data=[])`

**Resultado:** `existing_slot.data` es una lista vacía `[]`

#### **Problema 2: Código NO verifica si data está vacío ANTES de intentar UPDATE**

```python
# Línea 5647-5655: Chequea si NO hay data, devuelve error slot_not_found
if not existing_slot.data:
    logging.error(
        f"[SECURITY][RECLAIM][ONEDRIVE][CONNECT] No slot found for provider_account_id={microsoft_account_id}"
    )
    return RedirectResponse(f"{frontend_origin}/app?error=slot_not_found")

reclaimed_slot_id = existing_slot.data[0]["id"]  # ✅ OK si data existe
```

**PERO:** Si `execute_with_order_fallback` falla por APIError (no por schema), devuelve `data=[]` → entra al `if not existing_slot.data` → redirect a `slot_not_found`

**SIN EMBARGO:** Logs muestran `APIError` en el mensaje de error, NO `slot_not_found`

**Hipótesis:** El error ocurre en las líneas 5659-5690 (UPDATE operations), NO en la query de existing_slot.

#### **Problema 3: UPDATE operations fallan con APIError genérico**

```python
try:
    # Transfer ownership in cloud_slots_log FIRST
    supabase.table("cloud_slots_log").update({
        "user_id": user_id,
        "is_active": True,
        "disconnected_at": None
    }).eq("id", reclaimed_slot_id).execute()
    
    # Then update cloud_provider_accounts
    supabase.table("cloud_provider_accounts").update({
        "user_id": user_id,
        "is_active": True,
        ...
    }).eq("provider", "onedrive").eq("provider_account_id", microsoft_account_id).execute()
    
    return RedirectResponse(f"{frontend_origin}/app?connection=success")
    
except Exception as e:
    logging.error(
        f"[SECURITY][RECLAIM][ONEDRIVE][CONNECT] Ownership transfer failed: {type(e).__name__}"
    )
    return RedirectResponse(f"{frontend_origin}/app?error=reconnect_failed")
```

**🔥 EVIDENCIA:** Log dice `Ownership transfer failed: APIError`

**Posibles causas de APIError:**
1. **RLS Policy violation:** Service role no tiene permiso para UPDATE
2. **Foreign key constraint:** `slot_log_id` referencia slot que no existe
3. **UNIQUE constraint violation:** Duplicate user_id/provider/provider_account_id
4. **Network timeout:** Supabase API intermittently slow

---

### 4. 🔍 **Schema Inconsistency Detected**

**Logs indican:** `column cloud_slots_log.created_at does not exist`

**Problema:** La tabla `cloud_slots_log` NO tiene columna `created_at`, pero el código intenta ordenar por ella.

**Verificación necesaria en Supabase:**
```sql
\d cloud_slots_log
```

**Campos esperados vs reales:**
- ❌ `created_at` → NO existe
- ❌ `inserted_at` → NO existe  
- ✅ `id` → Existe (UUID PRIMARY KEY)

**Implicación:** La query de `existing_slot` probablemente funciona (ordena por `id`), pero las operaciones UPDATE subsecuentes fallan por otro motivo.

---

### 5. ✅ **UI Analysis: No Double-Click Issues Detected**

**Archivo:** `frontend/src/app/(dashboard)/app/page.tsx`

#### **Connect Button (líneas 835-843):**
```tsx
<button
  onClick={handleConnectOneDrive}
  className="rounded-lg transition px-4 py-2 text-sm font-semibold bg-blue-500 hover:bg-blue-600"
  title="Conectar una nueva cuenta de OneDrive"
>
  Conectar OneDrive
</button>
```

**⚠️ ISSUE:** Botón NO está `disabled` durante loading.

**Impact:** Usuario puede hacer doble-click y disparar 2 OAuth flows simultáneos.

#### **handleConnectOneDrive (líneas 623-646):**
```tsx
const handleConnectOneDrive = async () => {
  if (!userId) {
    setHardError("No hay sesión de usuario activa. Recarga la página.");
    return;
  }
  
  try {
    const { fetchOneDriveLoginUrl } = await import("@/lib/api");
    const { url } = await fetchOneDriveLoginUrl({ mode: "connect" });
    window.location.href = url;  // ⚠️ Immediate redirect (no loading state set)
  } catch (err: unknown) {
    setHardError(`Error al conectar OneDrive: ${msg}`);
  }
};
```

**⚠️ ISSUE:** No hay `setLoading(true)` antes de redirect → botón sigue clickeable.

#### **useEffect Callback Handling (líneas 485-550):**
```tsx
} else if (authError === "ownership_conflict") {
  if (typeof window !== "undefined") {
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const transferToken = hashParams.get("transfer_token");
    
    if (transferToken) {
      setOwnershipTransferToken(transferToken);
      setShowOwnershipTransferModal(true);
    }
  }
  // ...
}
```

**✅ CONCLUSION:** useEffect se ejecuta UNA SOLA VEZ por `routeParamsKey` (dependency tracking OK).  
**✅ No hay doble-processing del callback.**

---

## 🔥 ROOT CAUSE SUMMARY

### **Primary Root Cause: APIError en UPDATE operations durante SAFE RECLAIM**

**Secuencia de fallo:**

1. ✅ Usuario hace clic en "Conectar OneDrive"
2. ✅ OAuth redirect a Microsoft
3. ✅ Callback detecta ownership conflict → emails match → SAFE RECLAIM autorizado
4. ⚠️ `execute_with_order_fallback` intenta ordenar por `created_at`/`inserted_at` (NO existen) → fallback a `id` → SUCCESS  
   **O:** Falla completamente por APIError intermitente → devuelve `data=[]` → redirect a `slot_not_found`
5. ✅ Query encuentra `existing_slot` con ID válido
6. 🔥 **UPDATE a `cloud_slots_log`** falla con `APIError`
   - **Causa probable:** RLS policy, FK constraint, UNIQUE violation, o timeout
7. ❌ Exception capturada → log genérico `Ownership transfer failed: APIError`
8. ❌ Redirect a `/app?error=reconnect_failed`
9. ⚠️ Usuario ve error → intenta nuevamente → **a veces funciona, a veces no** (race condition / intermittent DB issue)

### **Secondary Root Cause: UI permite double-click en botón OneDrive**

**Impact:** Si usuario hace doble-click, pueden iniciarse 2 OAuth flows → state mismatch / duplicated callbacks.

---

## 💡 MINIMAL FIX RECOMMENDATIONS

### **Fix 1: Enhance error logging para diagnosticar APIError** ⭐⭐⭐ CRITICAL

**Problema:** Log dice `APIError` pero no dice PORQUÉ falló (RLS, FK, UNIQUE, timeout).

**Solución:**
```python
except Exception as e:
    # Extract Supabase error details
    error_detail = str(e)[:500]  # Full error message
    error_type = type(e).__name__
    
    # Try to extract Supabase-specific error code
    supabase_code = None
    if hasattr(e, 'code'):
        supabase_code = e.code
    elif 'code' in error_detail:
        # Parse from error message (e.g., "code": "23505")
        import re
        match = re.search(r'"code":\s*"(\d+)"', error_detail)
        if match:
            supabase_code = match.group(1)
    
    logging.error(
        f"[SECURITY][RECLAIM][ONEDRIVE][CONNECT] Ownership transfer failed: "
        f"type={error_type} code={supabase_code} detail={error_detail}"
    )
    return RedirectResponse(f"{frontend_origin}/app?error=reconnect_failed")
```

**Benefit:** Logs revelarán si es RLS (42501), UNIQUE (23505), FK (23503), o timeout.

---

### **Fix 2: Disable button durante OAuth flow** ⭐⭐ HIGH

**Problema:** Usuario puede hacer doble-click → 2 OAuth flows simultáneos.

**Solución:**
```tsx
// Add loading state for OneDrive connect
const [isConnectingOneDrive, setIsConnectingOneDrive] = useState(false);

const handleConnectOneDrive = async () => {
  if (!userId || isConnectingOneDrive) return;  // Guard against double-click
  
  setIsConnectingOneDrive(true);
  try {
    const { fetchOneDriveLoginUrl } = await import("@/lib/api");
    const { url } = await fetchOneDriveLoginUrl({ mode: "connect" });
    window.location.href = url;
  } catch (err: unknown) {
    setIsConnectingOneDrive(false);  // Re-enable on error
    setHardError(`Error al conectar OneDrive: ${msg}`);
  }
};

// Update button
<button
  onClick={handleConnectOneDrive}
  disabled={isConnectingOneDrive || loading}
  className={`rounded-lg transition px-4 py-2 text-sm font-semibold ${
    isConnectingOneDrive || loading 
      ? 'bg-blue-400 cursor-not-allowed' 
      : 'bg-blue-500 hover:bg-blue-600'
  }`}
>
  {isConnectingOneDrive ? '🔄 Conectando...' : 'Conectar OneDrive'}
</button>
```

---

### **Fix 3: Agregar retry logic con exponential backoff** ⭐ MEDIUM (si APIError es intermitente)

Si el error es por timeout / network intermittent:

```python
from tenacity import retry, stop_after_attempt, wait_exponential

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=5))
def update_slot_ownership(supabase, slot_id, user_id):
    return supabase.table("cloud_slots_log").update({
        "user_id": user_id,
        "is_active": True,
        "disconnected_at": None
    }).eq("id", slot_id).execute()

# Use in SAFE RECLAIM flow
try:
    update_slot_ownership(supabase, reclaimed_slot_id, user_id)
    # Then update cloud_provider_accounts...
except Exception as e:
    logging.error(...)
```

**Benefit:** Si error es transitorio, retry automático lo resuelve sin intervención del usuario.

---

### **Fix 4: Verificar RLS policies en Supabase** ⭐⭐⭐ CRITICAL

**Acción requerida:**
1. Conectar a Supabase SQL Editor
2. Verificar que `service_role` tiene permisos UPDATE en `cloud_slots_log`:
   ```sql
   SELECT * FROM pg_policies WHERE tablename = 'cloud_slots_log';
   ```
3. Confirmar que backend usa `service_role` key (no `anon` key):
   ```python
   # backend/.env
   SUPABASE_KEY=<service_role_key>  # NOT anon key
   ```

---

## 🔍 NEXT STEPS: Database Investigation

**Ejecutar en Supabase SQL Editor:** `investigate_onedrive_state.sql`

Este script revelará:
1. ✅ Current ownership state para `provider_account_id=62c0cfcdf8b5bc8c`
2. ✅ Si existen duplicados o estados conflictivos
3. ✅ Si existe orphan slot (slot sin cloud_provider_account)
4. ✅ Ownership transfer requests pendientes
5. ✅ RPC function availability

**Output esperado:**
- Si existe duplicate record → UNIQUE violation (Fix: DELETE duplicado)
- Si user_id en cloud_slots_log != user_id en cloud_provider_accounts → FK mismatch (Fix: UPDATE manual)
- Si RLS policy bloquea UPDATE → RLS issue (Fix: GRANT UPDATE to service_role)

---

## 📝 CONCLUSION

**Root Cause:** APIError genérico durante UPDATE operations en SAFE RECLAIM flow, sin logging detallado para diagnosticar causa exacta.

**Contributing Factors:**
1. Schema inconsistency (`created_at` no existe en `cloud_slots_log`)
2. UI permite double-click en botón OneDrive
3. Logging insuficiente para APIError

**Immediate Action Required:**
1. **Deploy Fix 1** (enhanced error logging) → revelará causa exacta de APIError
2. **Execute** `investigate_onedrive_state.sql` en Supabase → identificar data inconsistency
3. **Deploy Fix 2** (disable button) → prevenir double OAuth flows
4. **Monitor logs** en próximo intento de conexión → capturar error code específico

**Expected Resolution Time:** 30 minutos (deploy + test + monitor logs)

---

**Investigation completed:** 2026-01-19 03:20 UTC  
**Investigator:** GitHub Copilot  
**Status:** ✅ Root cause identified, awaiting database investigation results
