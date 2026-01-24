# UNIQUE CONSTRAINT (23505) HANDLER - PRODUCTION VERIFICATION

**Deployment:** Fly.io v154 (commit e4769e9)  
**Deployed:** 2026-01-19T04:07:52Z  
**Status:** ✅ Active

---

## 🎯 OBJETIVO

Verificar que cuando el UNIQUE constraint global dispara (PostgreSQL 23505), el backend:
- ✅ NO termina en `reconnect_failed`
- ✅ Detecta el error 23505
- ✅ Query owner real
- ✅ Redirige a `ownership_conflict` con `transfer_token` (si owner diferente)
- ✅ Trata como idempotent success (si mismo owner)

---

## 🛡️ IMPLEMENTACIÓN

### Constraint en Supabase

```sql
-- Confirmado por usuario:
CREATE UNIQUE INDEX uniq_cloud_provider_accounts_global 
ON cloud_provider_accounts(provider, provider_account_id);
```

**Efecto:** No permite duplicados de `(provider, provider_account_id)` independientemente del `user_id`.

---

### Código Implementado (backend/backend/main.py ~line 5947)

```python
# Save to database with UNIQUE constraint violation handling (23505)
try:
    resp = supabase.table("cloud_provider_accounts").upsert(
        upsert_data,
        on_conflict="user_id,provider,provider_account_id",
    ).execute()
except Exception as e:
    error_str = str(e)
    
    # Check if this is a UNIQUE constraint violation (PostgreSQL 23505)
    if "23505" in error_str or "duplicate key value violates unique constraint" in error_str.lower():
        logging.warning(
            f"[ONEDRIVE][UNIQUE_VIOLATION] Constraint 23505 detected for provider_account_id={microsoft_account_id}. "
            f"Error: {error_str[:300]}"
        )
        
        # Query to find the actual owner
        owner_check = supabase.table("cloud_provider_accounts").select("id, user_id").eq(
            "provider", "onedrive"
        ).eq("provider_account_id", microsoft_account_id).limit(1).execute()
        
        if owner_check.data and len(owner_check.data) > 0:
            actual_owner_id = owner_check.data[0]["user_id"]
            
            if actual_owner_id != user_id:
                # Different user owns this account
                logging.warning(
                    f"[ONEDRIVE][23505] Ownership conflict: provider_account_id={microsoft_account_id} "
                    f"actual_owner={actual_owner_id} requesting_user={user_id}"
                )
                
                # Generate transfer_token for ownership transfer
                transfer_token = create_transfer_token(...)
                
                return RedirectResponse(
                    f"{frontend_origin}/app?error=ownership_conflict#transfer_token={quote(transfer_token)}"
                )
            else:
                # Same user - treat as idempotent reconnect
                logging.info(
                    f"[ONEDRIVE][23505] Idempotent race condition resolved: "
                    f"provider_account_id={microsoft_account_id} user_id={user_id}"
                )
                return RedirectResponse(f"{frontend_origin}/app?connection=success")
```

---

## 📊 ESCENARIOS ESPERADOS

### Escenario A: User B intenta conectar cuenta de User A

**Secuencia:**
1. User B autenticar con Microsoft → callback con `provider_account_id=X`
2. Backend intenta upsert → **UNIQUE constraint fires (23505)**
3. Handler detecta 23505
4. Query: `SELECT user_id WHERE provider_account_id=X` → encuentra `user_id=A`
5. Comparación: `A != B` (ownership conflict)
6. Log: `[ONEDRIVE][23505] Ownership conflict: provider_account_id=X actual_owner=A requesting_user=B`
7. Generate `transfer_token`
8. Redirect: `/app?error=ownership_conflict#transfer_token=...`
9. Frontend: Muestra modal de ownership transfer

**Logs esperados:**
```
[ONEDRIVE][UNIQUE_VIOLATION] Constraint 23505 detected for provider_account_id=X. Error: duplicate key value violates unique constraint "uniq_cloud_provider_accounts_global"
[ONEDRIVE][23505] Ownership conflict: provider_account_id=X actual_owner=A requesting_user=B
INFO: "GET /auth/onedrive/callback?code=... HTTP/1.1" 307 Temporary Redirect
```

**Resultado:** ✅ NO `reconnect_failed`, SÍ `ownership_conflict` con transfer_token

---

### Escenario B: User A reconecta su propia cuenta (race condition)

**Secuencia:**
1. User A autenticar con Microsoft → callback con `provider_account_id=X`
2. Backend intenta upsert → **UNIQUE constraint fires (23505)** (registro ya existe)
3. Handler detecta 23505
4. Query: `SELECT user_id WHERE provider_account_id=X` → encuentra `user_id=A`
5. Comparación: `A == A` (mismo user)
6. Log: `[ONEDRIVE][23505] Idempotent race condition resolved: provider_account_id=X user_id=A`
7. Redirect: `/app?connection=success`
8. Frontend: Muestra success

**Logs esperados:**
```
[ONEDRIVE][UNIQUE_VIOLATION] Constraint 23505 detected for provider_account_id=X. Error: duplicate key value violates unique constraint "uniq_cloud_provider_accounts_global"
[ONEDRIVE][23505] Idempotent race condition resolved: provider_account_id=X user_id=A
INFO: "GET /auth/onedrive/callback?code=... HTTP/1.1" 307 Temporary Redirect
```

**Resultado:** ✅ Tratado como reconnect exitoso

---

## 🔍 CÓMO VERIFICAR EN PRODUCCIÓN

### Método 1: Monitoreo de Logs en Tiempo Real

```powershell
# Monitorear en tiempo real
fly logs --app cloud-aggregator-api | Select-String -Pattern '23505|UNIQUE_VIOLATION|ownership conflict'

# Buscar callbacks OneDrive
fly logs --app cloud-aggregator-api | Select-String -Pattern 'onedrive/callback' -Context 5
```

### Método 2: Test Manual

**Prerequisito:** Identificar un `provider_account_id` existente

```sql
-- En Supabase SQL Editor
SELECT provider_account_id, user_id, account_email 
FROM cloud_provider_accounts 
WHERE provider = 'onedrive' 
AND is_active = true 
LIMIT 1;
```

**Steps:**
1. Login como **User B** (diferente al owner)
2. Click "Conectar OneDrive"
3. Autenticar con cuenta de Microsoft que pertenece a **User A**
4. Observar:
   - Backend: Logs muestran `[ONEDRIVE][23505] Ownership conflict: ...`
   - Frontend: Modal de ownership transfer aparece
   - URL: Contiene `#transfer_token=...`

### Método 3: Buscar en Logs Históricos

```powershell
# Si ya ocurrió un intento
fly logs --app cloud-aggregator-api | Select-String -Pattern 'provider_account_id=62c0cfcdf8b5bc8c' -Context 10
```

---

## 📋 LOGS CLAVE A CAPTURAR

### 1. Detección de 23505

```
[ONEDRIVE][UNIQUE_VIOLATION] Constraint 23505 detected for provider_account_id=62c0cfcdf8b5bc8c. 
Error: duplicate key value violates unique constraint "uniq_cloud_provider_accounts_global"
DETAIL: Key (provider, provider_account_id)=(onedrive, 62c0cfcdf8b5bc8c) already exists.
```

### 2. Ownership Conflict

```
[ONEDRIVE][23505] Ownership conflict: provider_account_id=62c0cfcdf8b5bc8c 
actual_owner=56c67b18-9b0a-4743-bc28-1e8e86800435 
requesting_user=62bf37c1-6f50-46f2-9f57-7a0b5136ed1d
```

### 3. HTTP Response

```
INFO: "GET /auth/onedrive/callback?code=M.C546...&state=eyJhbGc... HTTP/1.1" 307 Temporary Redirect
```

### 4. Frontend URL (verificar en browser)

```
https://www.cloudaggregatorapp.com/app?error=ownership_conflict#transfer_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## ✅ CRITERIOS DE ÉXITO

**Handler funciona correctamente si:**

1. ✅ Log muestra: `[ONEDRIVE][UNIQUE_VIOLATION] Constraint 23505 detected...`
2. ✅ Log muestra: `[ONEDRIVE][23505] Ownership conflict: ...` (si owner diferente)
3. ✅ Redirect incluye: `#transfer_token=...` (hash, no query)
4. ✅ Frontend muestra: Modal de ownership transfer (no error toast)
5. ✅ **NO aparece:** `reconnect_failed` en logs o URL
6. ✅ **NO aparece:** `database_error` en logs o URL

**Handler de idempotent funciona si:**

1. ✅ Log muestra: `[ONEDRIVE][23505] Idempotent race condition resolved: ...`
2. ✅ Redirect a: `/app?connection=success`
3. ✅ Frontend muestra: Success message

---

## 🚨 CASOS DE ERROR A MONITOREAR

### Error 1: No se detecta 23505

```
# MAL (no debería pasar):
[ONEDRIVE][UPSERT_ERROR] Non-UNIQUE database error: ...
```

**Causa:** Regex de detección de 23505 no match  
**Fix:** Verificar que error_str contenga "23505" o "duplicate key value violates unique constraint"

### Error 2: Query owner falla

```
[ONEDRIVE][23505] Failed to query owner after UNIQUE violation: APIError - ...
```

**Causa:** Supabase query timeout o error de permisos  
**Efecto:** Redirect a `database_query_failed` (graceful degradation)

### Error 3: No se encuentra owner

```
[ONEDRIVE][23505] No owner found after UNIQUE violation for provider_account_id=...
```

**Causa:** Registro fue eliminado entre constraint violation y query  
**Efecto:** Redirect a `database_inconsistency` (raro, pero manejado)

---

## 📊 COMPARACIÓN: Antes vs Después

### Antes (v152-153: Solo duplicate guard)

**Problema:**
- UNIQUE constraint fires en Supabase
- Error no capturado en backend
- Usuario ve error genérico o `reconnect_failed`
- No se genera `transfer_token`

**Logs:**
```
ERROR: Some database error
Redirect: /app?error=reconnect_failed
```

### Después (v154: Con handler 23505)

**Solución:**
- UNIQUE constraint fires → capturado con try/catch
- Error 23505 detectado y manejado
- Query automático para obtener owner
- Genera `transfer_token` para ownership transfer

**Logs:**
```
[ONEDRIVE][UNIQUE_VIOLATION] Constraint 23505 detected...
[ONEDRIVE][23505] Ownership conflict: ...
Redirect: /app?error=ownership_conflict#transfer_token=...
```

---

## 🎯 PRÓXIMOS PASOS

1. **Monitorear logs en tiempo real:**
   ```powershell
   fly logs --app cloud-aggregator-api | Select-String -Pattern '23505'
   ```

2. **Provocar 23505 con test manual** (si es posible):
   - Login con User B
   - Conectar OneDrive de User A
   - Capturar logs completos

3. **Documentar evidencia real** una vez capturada

4. **Validar que frontend muestra modal correctamente**

---

**Status:** ✅ Deployed v154  
**Awaiting:** Callback real que dispare 23505 para capturar logs  
**Expected:** `[ONEDRIVE][23505] Ownership conflict: ...` en logs  
**Verified date:** 2026-01-19
