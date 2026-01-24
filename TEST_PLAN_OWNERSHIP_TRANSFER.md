# 🧪 Test Plan: Ownership Conflict Resolution

## 📋 Overview
Plan de testing manual para validar el sistema de transferencia de ownership entre usuarios.

---

## 🎯 Test Cases

### ✅ Test Case 1: Nueva Cuenta (Sin Conflicto)
**Objetivo:** Verificar que el flujo normal de conexión NO se rompe.

**Pre-condiciones:**
- User A con cuenta activa
- OneDrive `new@example.com` nunca conectado antes

**Steps:**
1. User A inicia OAuth para OneDrive `new@example.com`
2. Microsoft retorna tokens
3. Backend procesa callback

**Expected Result:**
- ✅ Redirect: `/app?connection=success`
- ✅ Cuenta aparece en lista de User A
- ✅ `cloud_provider_accounts`: 1 row (user_id=User A)
- ✅ `cloud_slots_log`: 1 row (user_id=User A, is_active=true)
- ✅ `user_plans.clouds_slots_used`: +1 para User A

**Logs esperados:**
```
[ONEDRIVE][CONNECT] New account connection
[ONEDRIVE][CONNECT] Got refresh_token for slot_id={slot_id}
```

---

### ✅ Test Case 2: Mismo Usuario Reconecta
**Objetivo:** Verificar que SAFE RECLAIM automático NO se rompe.

**Pre-condiciones:**
- User A tiene OneDrive `shared@example.com` activo
- User A inicia reconexión del mismo OneDrive

**Steps:**
1. User A inicia OAuth para OneDrive `shared@example.com`
2. Backend detecta `existing_user_id == user_id`
3. Procesa reconnect flow

**Expected Result:**
- ✅ Redirect: `/app?connection=success`
- ✅ `cloud_provider_accounts`: 1 row (user_id=User A, tokens actualizados)
- ✅ `cloud_slots_log`: 1 row (is_active=true, disconnected_at=null)
- ✅ `user_plans.clouds_slots_used`: SIN CAMBIO

**Logs esperados:**
```
[RECONNECT][ONEDRIVE] Slot_id={slot_id} detected as reconnect
[RECONNECT SUCCESS][ONEDRIVE] cloud_provider_accounts UPSERT account_id={id}
```

---

### ✅ Test Case 3: SAFE RECLAIM Automático (Email Match)
**Objetivo:** Verificar que transferencia automática por email match funciona.

**Pre-condiciones:**
- User A tiene OneDrive `shared@example.com` activo
- User B intenta conectar el mismo OneDrive `shared@example.com`
- Emails coinciden (case-insensitive)

**Steps:**
1. User B inicia OAuth para OneDrive `shared@example.com`
2. Backend detecta `existing_user_id != user_id`
3. Backend valida `account_email == user_email` (match)
4. Ejecuta SAFE RECLAIM automático

**Expected Result:**
- ✅ Redirect: `/app?connection=success`
- ✅ `cloud_provider_accounts`: 1 row (user_id=User B, actualizado)
- ✅ `cloud_slots_log`: 1 row (user_id=User B, is_active=true)
- ✅ `user_plans.clouds_slots_used`: -1 para User A, cuenta existente para User B
- ✅ NO muestra modal de transferencia

**Logs esperados:**
```
[SECURITY][RECLAIM][ONEDRIVE][CONNECT] Account reassignment authorized
[SECURITY][RECLAIM][ONEDRIVE][CONNECT] Ownership transferred successfully
```

---

### 🆕 Test Case 4: Ownership Conflict → Modal → Transfer Exitoso
**Objetivo:** Validar flujo completo de transferencia explícita.

**Pre-condiciones:**
- User A tiene OneDrive `user.a@companyA.com` activo
- User B con email `user.b@companyB.com` intenta conectar el mismo OneDrive
- Emails NO coinciden (email mismatch)

**Steps:**
1. User B inicia OAuth para OneDrive `user.a@companyA.com`
2. Backend detecta `existing_user_id != user_id`
3. Backend valida `account_email != user_email` (mismatch)
4. Backend genera `transfer_token` JWT (TTL 10 min)
5. Redirect: `/app?error=ownership_conflict&transfer_token=eyJ...`
6. Frontend detecta query params y muestra modal
7. User B confirma transferencia
8. Frontend llama `POST /cloud/transfer-ownership {transfer_token}`
9. Backend valida JWT y llama RPC `transfer_provider_account_ownership`
10. RPC actualiza ownership en `cloud_provider_accounts` y `cloud_slots_log`

**Expected Result:**
- ✅ Modal aparece con mensaje: "Account Already Connected"
- ✅ Botón "Transfer Account" visible
- ✅ POST /cloud/transfer-ownership: Status 200
- ✅ Response: `{"success": true, "account_id": "uuid"}`
- ✅ Modal se cierra automáticamente
- ✅ Query params limpiados
- ✅ Lista de cuentas actualizada (aparece cuenta transferida)
- ✅ `cloud_provider_accounts`: 1 row (user_id=User B)
- ✅ `cloud_slots_log`: 1 row (user_id=User B)
- ✅ `user_plans.clouds_slots_used`: -1 para User A, SIN CAMBIO para User B (se incrementa en próxima conexión completa)

**Logs esperados:**
```
[SECURITY][ONEDRIVE][CONNECT] Ownership conflict detected
[TRANSFER OWNERSHIP] Initiating transfer: from_user={User A} to_user={User B}
[TRANSFER OWNERSHIP] RPC success: account_id={id} slot_log_id={slot_id}
[TRANSFER OWNERSHIP] Decremented clouds_slots_used for old owner {User A}
[TRANSFER OWNERSHIP] Transfer completed successfully
```

**DB State después:**
```sql
-- cloud_provider_accounts
SELECT user_id, provider_account_id, is_active FROM cloud_provider_accounts;
-- user_id={User B}, provider_account_id=xyz, is_active=true

-- cloud_slots_log
SELECT user_id, provider_account_id, is_active FROM cloud_slots_log;
-- user_id={User B}, provider_account_id=xyz, is_active=true

-- user_plans
SELECT user_id, clouds_slots_used FROM user_plans WHERE user_id IN ({User A}, {User B});
-- User A: clouds_slots_used decrementado (-1)
-- User B: clouds_slots_used SIN CAMBIO (se incrementará al completar OAuth)
```

---

### 🆕 Test Case 5: Transfer Token Expirado
**Objetivo:** Validar que tokens expirados se rechazan.

**Pre-condiciones:**
- User B tiene modal de transferencia abierto
- Han pasado >10 minutos desde generación del `transfer_token`

**Steps:**
1. User B confirma transferencia después de 10+ minutos
2. Frontend llama `POST /cloud/transfer-ownership {transfer_token}`
3. Backend intenta decodificar JWT expirado

**Expected Result:**
- ❌ Status 400: `{"detail": "Transfer token expired"}`
- ✅ Modal muestra error: "Transfer link expired. Please reconnect again."
- ✅ Usuario debe reiniciar OAuth flow desde inicio

**Logs esperados:**
```
[TRANSFER OWNERSHIP] Invalid transfer_token: Transfer token expired
```

---

### 🆕 Test Case 6: Concurrent Ownership Change
**Objetivo:** Validar protección contra race conditions.

**Pre-condiciones:**
- User A tiene OneDrive `shared@example.com` activo
- User B recibe `transfer_token` (T1)
- User C transfiere la misma cuenta antes que User B (T2, T2 < T1)

**Steps:**
1. User B intenta transferir usando token T1 (expected_old_user_id=User A)
2. Pero User C ya transfirió (actual_user_id=User C)
3. RPC detecta `v_old_user_id != p_expected_old_user_id`

**Expected Result:**
- ❌ Status 409: `{"detail": "Account ownership changed. Please retry the connection."}`
- ✅ Modal muestra error: "Account ownership changed. Please retry."
- ✅ RPC NO ejecuta UPDATE (protección contra race condition)

**Logs esperados:**
```
[TRANSFER OWNERSHIP] Concurrent ownership change detected: expected_owner={User A} actual_owner={User C}
```

**DB State:**
```sql
-- cloud_provider_accounts permanece con user_id={User C}
-- NO cambia a User B
```

---

### ✅ Test Case 7: Cancel Modal
**Objetivo:** Validar que cancelar NO ejecuta transferencia.

**Pre-condiciones:**
- User B tiene modal abierto con `transfer_token`

**Steps:**
1. User B hace clic en "Cancel"
2. Frontend cierra modal
3. Frontend limpia query params

**Expected Result:**
- ✅ Modal se cierra
- ✅ Query params limpiados (`?error=ownership_conflict&transfer_token=...` removido)
- ✅ NO se llama API `/cloud/transfer-ownership`
- ✅ Ownership NO cambia en DB

---

### ✅ Test Case 8: Usuario Sin Sesión
**Objetivo:** Validar que endpoint requiere autenticación.

**Pre-condiciones:**
- Token JWT inválido/expirado

**Steps:**
1. Llamar `POST /cloud/transfer-ownership` sin Authorization header
2. O con token inválido

**Expected Result:**
- ❌ Status 401/403: Unauthorized
- ✅ Mensaje: "Authentication required"

---

### ✅ Test Case 9: Token Manipulado (Invalid Signature)
**Objetivo:** Validar que tokens alterados se rechazan.

**Pre-condiciones:**
- User B obtiene `transfer_token`
- User B modifica el payload (ej: cambia `existing_owner_id`)

**Steps:**
1. Frontend llama API con token manipulado
2. Backend intenta verificar firma JWT

**Expected Result:**
- ❌ Status 400: `{"detail": "Invalid transfer token: Signature verification failed"}`
- ✅ Modal muestra error

**Logs esperados:**
```
[TRANSFER OWNERSHIP] Invalid transfer_token: Invalid transfer token
```

---

### ✅ Test Case 10: Business Logic Intacta (No Rompe SAFE RECLAIM)
**Objetivo:** Verificar que cambios NO afectan lógica existente.

**Validaciones:**
1. ✅ Conexión nueva (sin conflicto) → Funciona igual
2. ✅ Reconexión mismo usuario → Funciona igual
3. ✅ SAFE RECLAIM automático (email match) → Funciona igual
4. ✅ Desconexión de cuentas → Funciona igual
5. ✅ Slots vitalicios → Funciona igual

**Regression Testing:**
- Ejecutar Test Cases 1, 2, 3 después de desplegar cambios
- Validar que NO hay regresiones en flujos existentes

---

## 📊 Test Matrix

| Test Case | Pre-requisito | Expected Status | Ownership Change | Modal Shown |
|-----------|--------------|-----------------|------------------|-------------|
| TC1: Nueva cuenta | N/A | ✅ Success | N/A → User A | ❌ No |
| TC2: Mismo usuario | User A activo | ✅ Success | User A → User A | ❌ No |
| TC3: SAFE RECLAIM | User A activo, email match | ✅ Success | User A → User B | ❌ No |
| TC4: Transfer explícito | User A activo, email mismatch | ✅ Success | User A → User B | ✅ Yes |
| TC5: Token expirado | >10 min | ❌ 400 | No change | ✅ Yes (error) |
| TC6: Concurrent change | User C transfiere primero | ❌ 409 | No change | ✅ Yes (error) |
| TC7: Cancel modal | Modal abierto | N/A | No change | ✅ Yes → Close |
| TC8: Sin sesión | No JWT | ❌ 401 | No change | N/A |
| TC9: Token manipulado | Token alterado | ❌ 400 | No change | ✅ Yes (error) |
| TC10: Regression | Flujos existentes | ✅ Success | Varies | Varies |

---

## 🔍 Validation Queries

### Verificar Ownership
```sql
SELECT 
    cpa.id,
    cpa.user_id,
    cpa.provider_account_id,
    cpa.account_email,
    cpa.is_active,
    csl.slot_number,
    csl.is_active AS slot_active
FROM cloud_provider_accounts cpa
LEFT JOIN cloud_slots_log csl ON csl.id = cpa.slot_log_id
WHERE cpa.provider = 'onedrive'
ORDER BY cpa.updated_at DESC;
```

### Verificar Slots Used
```sql
SELECT 
    user_id,
    clouds_slots_used,
    clouds_slots_total,
    plan_type
FROM user_plans
WHERE user_id IN ('user-a-uuid', 'user-b-uuid');
```

### Verificar Logs
```sql
SELECT 
    id,
    user_id,
    provider,
    provider_account_id,
    is_active,
    connected_at,
    disconnected_at
FROM cloud_slots_log
WHERE provider = 'onedrive'
ORDER BY updated_at DESC
LIMIT 10;
```

---

## ✅ Checklist Final

### Pre-Deploy
- ✅ Migración SQL ejecutada: `transfer_provider_account_ownership.sql`
- ✅ PyJWT instalado: `pip install PyJWT`
- ✅ Variable de entorno: `SUPABASE_SERVICE_ROLE_KEY` configurada
- ✅ Código backend testeado localmente
- ✅ Frontend modal implementado y testeado

### Post-Deploy
- ✅ Ejecutar TC1-TC3 (regression tests)
- ✅ Ejecutar TC4 (happy path ownership transfer)
- ✅ Monitorear logs: `fly logs | grep "TRANSFER OWNERSHIP"`
- ✅ Validar que no hay errores 500
- ✅ Validar que SAFE RECLAIM automático sigue funcionando

### Rollback Plan
Si algo falla:
1. Revertir commit de backend
2. Migración SQL NO necesita rollback (RPC es idempotente)
3. Frontend: remover detección de `ownership_conflict` (fallback a error genérico)

---

**Creado por:** Backend Engineer  
**Fecha:** 2026-01-18  
**Versión:** 1.0
