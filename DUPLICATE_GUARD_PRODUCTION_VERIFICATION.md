# DUPLICATE GUARD - PRODUCTION VERIFICATION SUMMARY

**Date:** 2026-01-19  
**Deployment:** Fly.io v153 (commit c7c58d7)  
**Status:** ✅ Active since 03:23:43Z

---

## ✅ CONFIRMACIONES COMPLETADAS

### 1. Deployment Verificado

```
App: cloud-aggregator-api
Version: 153
Image: deployment-01KFA4EQ7FEEB96AJ9TCCRJDNV
State: started
Last Updated: 2026-01-19T03:23:43Z
```

**Git diff aplicado:**
```diff
+    # DUPLICATE GUARD: Prevent creating duplicate rows in cloud_provider_accounts
+    existing_check = supabase.table("cloud_provider_accounts").select("id, user_id").eq(
+        "provider", "onedrive"
+    ).eq("provider_account_id", microsoft_account_id).limit(1).execute()
+    
+    if existing_check.data and len(existing_check.data) > 0:
+        existing_owner_id = existing_check.data[0]["user_id"]
+        
+        if existing_owner_id != user_id:
+            logging.warning(
+                f"[ONEDRIVE] Duplicate prevention hit: provider_account_id={microsoft_account_id} "
+                f"owner={existing_owner_id} current={user_id}"
+            )
+            return RedirectResponse(
+                f"{frontend_origin}/app?error=ownership_conflict#transfer_token={quote(transfer_token)}"
+            )
+        else:
+            logging.info(
+                f"[ONEDRIVE] Idempotent update: provider_account_id={microsoft_account_id} user_id={user_id}"
+            )
```

✅ **Código desplegado confirmado**

---

### 2. Redirect Format Verificado

**Backend (backend/backend/main.py ~line 5938):**
```python
return RedirectResponse(
    f"{frontend_origin}/app?error=ownership_conflict#transfer_token={quote(transfer_token)}"
)
```

**Frontend (frontend/src/app/(dashboard)/app/page.tsx line 492):**
```tsx
const hashParams = new URLSearchParams(window.location.hash.slice(1));
const transferToken = hashParams.get("transfer_token");
```

✅ **Redirect usa `#transfer_token=...` (hash)** → Frontend parsea correctamente

---

## 📊 ANÁLISIS RETROSPECTIVO: Último Callback (v152)

**No hay callbacks en logs desde deploy de v153**, pero podemos analizar el último callback antes del deploy:

### Callback Timestamp: 2026-01-19T02:51:47Z

**Datos del evento:**
```
provider_account_id: 62c0cfcdf8b5bc8c
from_user_id: 56c67b18-9b0a-4743-bc28-1e8e86800435
to_user_id: 62bf37c1-6f50-46f2-9f57-7a0b5136ed1d
email_domain: gmail.com (verified match)
```

**Logs clave:**
```
WARNING:root:[SECURITY][RECLAIM][ONEDRIVE][CONNECT] 
Account reassignment authorized: provider_account_id=62c0cfcdf8b5bc8c
from_user_id=56c67b18-9b0a-4743-bc28-1e8e86800435 to_user_id=62bf37c1-6f50-46f2-9f57-7a0b5136ed1d
email_domain=gmail.com (verified match)

WARNING:root:[ONEDRIVE][FALLBACK][existing_slot_reclaim]    
Field 'created_at' not found, trying next fallback

WARNING:root:[ONEDRIVE][FALLBACK][existing_slot_reclaim]    
Field 'inserted_at' not found, trying next fallback

ERROR:root:[SECURITY][RECLAIM][ONEDRIVE][CONNECT] 
Ownership transfer failed: APIError

INFO: "GET /auth/onedrive/callback?code=M.C546... HTTP/1.1" 307 Temporary Redirect
```

**Resultado en v152:** Redirect a `/app?error=reconnect_failed`

---

### 💡 QUÉ HUBIERA PASADO CON v153

Con el duplicate guard, **la secuencia sería diferente**:

#### Escenario A: Cuenta pertenece a user diferente

**Ejecución del guard:**
```sql
SELECT id, user_id FROM cloud_provider_accounts 
WHERE provider='onedrive' AND provider_account_id='62c0cfcdf8b5bc8c' LIMIT 1;
-- Result: user_id = 56c67b18... (from_user)
```

**Comparación:**
- `existing_owner_id` (56c67b18...) != `user_id` (62bf37c1...)

**Lógica del guard:**
```python
if existing_owner_id != user_id:
    logging.warning(
        f"[ONEDRIVE] Duplicate prevention hit: provider_account_id=62c0cfcdf8b5bc8c "
        f"owner=56c67b18-9b0a-4743-bc28-1e8e86800435 current=62bf37c1-6f50-46f2-9f57-7a0b5136ed1d"
    )
    return RedirectResponse(
        f"{frontend_origin}/app?error=ownership_conflict#transfer_token={quote(transfer_token)}"
    )
```

**Resultado esperado:**
- ✅ Log: `[ONEDRIVE] Duplicate prevention hit: ...`
- ✅ Redirect: `/app?error=ownership_conflict#transfer_token=...`
- ✅ Frontend: Muestra modal de transferencia
- ✅ **NO llega a SAFE RECLAIM** (evita APIError)
- ✅ **NO intenta UPDATE en cloud_slots_log**
- ✅ **NO crea fila duplicada**

#### Escenario B: Cuenta pertenece al mismo user (reconnect)

**Ejecución del guard:**
```sql
SELECT id, user_id FROM cloud_provider_accounts 
WHERE provider='onedrive' AND provider_account_id='62c0cfcdf8b5bc8c' LIMIT 1;
-- Result: user_id = 62bf37c1... (mismo user)
```

**Comparación:**
- `existing_owner_id` (62bf37c1...) == `user_id` (62bf37c1...)

**Lógica del guard:**
```python
else:
    logging.info(
        f"[ONEDRIVE] Idempotent update: provider_account_id=62c0cfcdf8b5bc8c user_id=62bf37c1-..."
    )
# Continúa con upsert normal
```

**Resultado esperado:**
- ✅ Log: `[ONEDRIVE] Idempotent update: ...`
- ✅ Procede con `upsert` (actualiza fila existente)
- ✅ Redirect: `/app?connection=success`
- ✅ Frontend: Muestra éxito

---

## 🎯 EVIDENCIA DISPONIBLE

### ✅ Confirmado con evidencia concreta:

1. **v153 desplegado y activo** (fly status)
2. **Código del guard presente** (git diff)
3. **Redirect format correcto** (#transfer_token, no query param)
4. **Frontend parsea correctamente** (window.location.hash.slice(1))

### ⏳ Pendiente de test manual:

5. **Log real: `[ONEDRIVE] Duplicate prevention hit: ...`**
6. **Log real: `[ONEDRIVE] Idempotent update: ...`**
7. **Verificar que NO se crea fila duplicada en DB**
8. **Verificar que frontend muestra modal de transferencia**

---

## 📋 PLAN DE TEST MANUAL

### Prerequisito: Identificar datos en Supabase

Ejecutar `verify_duplicate_guard_test.sql` para obtener:

```sql
-- 1. Check for existing duplicates
SELECT provider_account_id, COUNT(*) 
FROM cloud_provider_accounts 
WHERE provider='onedrive' 
GROUP BY provider_account_id 
HAVING COUNT(*) > 1;

-- 2. Get test case: active OneDrive account
SELECT provider_account_id, user_id, account_email 
FROM cloud_provider_accounts 
WHERE provider='onedrive' AND is_active=true 
LIMIT 1;

-- 3. Get 2 different user IDs
SELECT id, email FROM auth.users LIMIT 2;
```

### Test A: Duplicate Prevention

1. Login como **User B** (user_id diferente al owner)
2. Click "Conectar OneDrive"
3. Autenticar con cuenta de Microsoft que pertenece a **User A**
4. **Monitorear logs en tiempo real:**
   ```powershell
   fly logs --app cloud-aggregator-api | Select-String -Pattern 'Duplicate prevention hit'
   ```
5. **Verificar frontend:** Debe mostrar modal de ownership transfer
6. **Verificar DB:** NO debe haber nueva fila para User B

### Test B: Idempotent Update

1. Login como **User A** (owner actual)
2. Disconnect OneDrive account (opcional, si ya está conectado)
3. Click "Conectar OneDrive"
4. Autenticar con cuenta de Microsoft que pertenece a **User A**
5. **Monitorear logs:**
   ```powershell
   fly logs --app cloud-aggregator-api | Select-String -Pattern 'Idempotent update'
   ```
6. **Verificar frontend:** Debe mostrar success message
7. **Verificar DB:** Misma fila actualizada (updated_at cambia)

---

## 🚨 RESULTADO

**Estado actual:** ✅ Duplicate guard deployed y verificado en código  
**Estado de test:** ⏳ Pendiente de test manual con 2 usuarios

**Confianza:** 🟢 Alta (código correcto, redirect correcto, formato correcto)

**Next action:** Ejecutar test manual para capturar logs reales con mensajes:
- `[ONEDRIVE] Duplicate prevention hit: ...`
- `[ONEDRIVE] Idempotent update: ...`

---

**Verificación completada:** 2026-01-19  
**Próxima actualización:** Después de test manual
