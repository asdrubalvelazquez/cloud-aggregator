# FIX: 500 Error en /auth/onedrive/callback (Ownership Transfer)

**Fecha:** 2026-01-18  
**Severidad:** CRITICAL (Production 500)  
**Afectado:** `GET /auth/onedrive/callback` después de Microsoft OAuth

---

## ROOT CAUSE ANALYSIS

### Problema Principal
El endpoint `/auth/onedrive/callback` lanza **500 Internal Server Error** cuando intenta guardar tokens en `ownership_transfer_requests` durante un ownership conflict o detección de orphan slot.

### Causas Identificadas

#### 1. **UNIQUE CONSTRAINT Missing (SQL Migration)**
**Archivo:** `backend/migrations/add_ownership_transfer_requests.sql`

**Problema:**
- La migración crea un **UNIQUE INDEX** pero NO un **UNIQUE CONSTRAINT**
- Supabase REST API requiere un constraint para el parámetro `on_conflict` en upsert
- Cuando el código ejecuta:
  ```python
  supabase.table("ownership_transfer_requests").upsert({...}, 
      on_conflict="provider,provider_account_id,requesting_user_id"
  ).execute()
  ```
- Supabase arroja error porque no encuentra un constraint con ese nombre

**SQL Original (INCORRECTO):**
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_ownership_transfer_unique
ON ownership_transfer_requests(provider, provider_account_id, requesting_user_id);
```

**SQL Corregido:**
```sql
CONSTRAINT ownership_transfer_unique_key UNIQUE (provider, provider_account_id, requesting_user_id)
```

#### 2. **Falta de Error Handling Granular**
**Archivo:** `backend/backend/main.py` (líneas ~5554-5578, ~5618-5642)

**Problemas:**
- `encrypt_token()` puede fallar si recibe `None` o datos inválidos
- `supabase.table().upsert()` puede fallar por:
  - Tabla no existe
  - Permisos insuficientes (service_role no configurado)
  - Constraint violation
  - Network errors
- Si falla, el try/except externo captura todo como `Exception`, pero sigue con el flujo
- Sin embargo, **NO había validación** para evitar `encrypt_token(None)` en `access_token`

**Código Original:**
```python
try:
    encrypted_access = encrypt_token(access_token)  # ❌ Puede ser None
    encrypted_refresh = encrypt_token(refresh_token) if refresh_token else None
    
    supabase.table("ownership_transfer_requests").upsert({...}).execute()
except Exception as save_err:
    logging.error(...)  # ❌ Solo logging.error, no logging.exception (pierde traceback)
```

#### 3. **Logging Insuficiente**
- `logging.error()` sin `logging.exception()` pierde el **full traceback**
- Tags no estandarizados (`[OWNERSHIP_TRANSFER][ONEDRIVE]` vs `[OWNERSHIP_TRANSFER][CALLBACK][ONEDRIVE]`)

---

## SOLUCIÓN IMPLEMENTADA

### 1. SQL Migration Fix
**Archivo:** `backend/migrations/add_ownership_transfer_requests.sql`

**Cambio:**
```diff
- CREATE UNIQUE INDEX IF NOT EXISTS idx_ownership_transfer_unique
- ON ownership_transfer_requests(provider, provider_account_id, requesting_user_id);
+ CONSTRAINT ownership_transfer_unique_key UNIQUE (provider, provider_account_id, requesting_user_id)
```

**Efecto:**
- Supabase REST API ahora reconoce el constraint para `on_conflict`
- `upsert()` funciona correctamente

---

### 2. Python Code Hardening
**Archivo:** `backend/backend/main.py`

#### Cambios Aplicados (2 bloques):

**A) Ownership Conflict (líneas ~5554-5612):**
```python
# Save encrypted tokens temporarily for ownership transfer (10 min TTL)
try:
    from backend.crypto import encrypt_token
    
    # ✅ Validate tokens before encryption
    if not access_token:
        logging.warning(
            f"[OWNERSHIP_TRANSFER][CALLBACK][ONEDRIVE] Missing access_token, skipping token storage. "
            f"provider_account_id={microsoft_account_id} user_id={user_id}"
        )
        raise ValueError("Missing access_token")
    
    # ✅ Encrypt tokens with granular error handling
    try:
        encrypted_access = encrypt_token(access_token)
    except Exception as enc_err:
        logging.exception(  # ✅ logging.exception para full traceback
            f"[OWNERSHIP_TRANSFER][CALLBACK][ONEDRIVE] encrypt_token(access_token) failed: {type(enc_err).__name__}"
        )
        raise
    
    encrypted_refresh = None
    if refresh_token:
        try:
            encrypted_refresh = encrypt_token(refresh_token)
        except Exception as enc_err:
            logging.exception(
                f"[OWNERSHIP_TRANSFER][CALLBACK][ONEDRIVE] encrypt_token(refresh_token) failed: {type(enc_err).__name__}"
            )
            # ✅ Continue without refresh_token (non-fatal)
    
    # ✅ UPSERT with granular error handling
    try:
        supabase.table("ownership_transfer_requests").upsert({
            "provider": "onedrive",
            "provider_account_id": microsoft_account_id,
            "requesting_user_id": user_id,
            "existing_owner_id": existing_user_id,
            "account_email": account_email,
            "access_token": encrypted_access,
            "refresh_token": encrypted_refresh,
            "token_expiry": expiry_iso,
            "status": "pending",
            "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
        }, on_conflict="provider,provider_account_id,requesting_user_id").execute()
        
        logging.info(
            f"[OWNERSHIP_TRANSFER][CALLBACK][ONEDRIVE] Tokens saved temporarily for transfer: "
            f"provider_account_id={microsoft_account_id} requesting_user={user_id}"
        )
    except Exception as upsert_err:
        logging.exception(  # ✅ logging.exception para diagnosticar DB errors
            f"[OWNERSHIP_TRANSFER][CALLBACK][ONEDRIVE] ownership_transfer_requests.upsert() failed: "
            f"{type(upsert_err).__name__} - {str(upsert_err)[:300]}"
        )
        raise
        
except Exception as save_err:
    logging.exception(  # ✅ logging.exception en outer try/except
        f"[OWNERSHIP_TRANSFER][CALLBACK][ONEDRIVE] Failed to save tokens (non-fatal, degrading gracefully): "
        f"{type(save_err).__name__} - {str(save_err)[:300]}"
    )
    # ✅ Non-fatal: continue with transfer_token generation WITHOUT tokens
```

**B) Orphan Slot Detection (líneas ~5618-5710):**
- Cambios idénticos al bloque A
- Tag adicional: `for orphan` en logs
- Mismo patrón de granularidad y degradación suave

---

### 3. Comportamiento de Degradación Suave

**ANTES:**
- Si falla `encrypt_token()` o `upsert()` → 500 Error (rompe todo)

**DESPUÉS:**
- Si falla cualquier operación con `ownership_transfer_requests`:
  1. Se loguea con `logging.exception()` (full traceback)
  2. **NO se lanza 500**
  3. Se continúa con el flujo normal:
     - Se genera `transfer_token` (JWT firmado)
     - Se redirige a frontend con `error=ownership_conflict#transfer_token=...`
     - Frontend muestra modal de confirmación
     - Si usuario acepta, usa `transfer_token` (sin necesidad de tokens guardados)

**Ventajas:**
- UX no se rompe (usuario puede continuar)
- Observability mejorada (logs detallados)
- Tokens guardados son **opcional enhancement** (no hard requirement)

---

## TESTING

### Pre-Deploy Checklist

#### 1. **Aplicar Migración SQL**
```bash
# En Supabase Dashboard → SQL Editor
-- Ejecutar migración actualizada
```

**Validación:**
```sql
-- Verificar que el constraint exista
SELECT constraint_name, constraint_type 
FROM information_schema.table_constraints 
WHERE table_name = 'ownership_transfer_requests' 
  AND constraint_type = 'UNIQUE';

-- Debe retornar:
-- constraint_name: ownership_transfer_unique_key
-- constraint_type: UNIQUE
```

#### 2. **Verificar Permisos Service Role**
```sql
-- Verificar que service_role tenga ALL permissions
SELECT grantee, privilege_type 
FROM information_schema.role_table_grants 
WHERE table_name = 'ownership_transfer_requests' 
  AND grantee = 'service_role';

-- Debe retornar: SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
```

#### 3. **Test Local (Ownership Conflict)**
**Escenario:**
1. Usuario A conecta OneDrive `user_a@example.com`
2. Usuario B intenta conectar la misma cuenta

**Esperado:**
- Backend intenta guardar en `ownership_transfer_requests`
- Si falla: log con `[OWNERSHIP_TRANSFER][CALLBACK][ONEDRIVE]` y continúa
- Frontend recibe `error=ownership_conflict#transfer_token=JWT...`
- Modal se muestra correctamente

**Logs a Buscar:**
```
[OWNERSHIP_TRANSFER][CALLBACK][ONEDRIVE] Tokens saved temporarily for transfer: provider_account_id=...
```

O si falla:
```
[OWNERSHIP_TRANSFER][CALLBACK][ONEDRIVE] Failed to save tokens (non-fatal, degrading gracefully): ...
```

#### 4. **Test Local (Orphan Slot)**
**Escenario:**
1. Slot huérfano en `cloud_slots_log` (usuario diferente)
2. Usuario intenta conectar misma cuenta

**Esperado:**
- Mismo flujo que ownership conflict
- Log incluye `for orphan`

#### 5. **Test Producción (Smoke Test)**
**CUIDADO:** No hacer hasta que yo (ChatGPT) autorice

**Steps:**
1. Deploy de migración SQL (primero)
2. Deploy de código Python (después)
3. Intentar conectar OneDrive con cuenta normal (sin conflicto) → debe funcionar
4. Intentar ownership conflict controlado → debe degradar gracefully

---

## DEPLOYMENT PLAN

### Orden ESTRICTO:

#### Step 1: SQL Migration (PRIMERO)
```bash
# En Supabase Dashboard
1. SQL Editor → Paste migración actualizada
2. Run
3. Verificar constraint con query de validación
```

#### Step 2: Backend Deploy (DESPUÉS)
```bash
cd backend
git add backend/main.py backend/migrations/add_ownership_transfer_requests.sql
git commit -m "fix(onedrive): prevent 500 in callback during ownership transfer

- Convert UNIQUE INDEX to UNIQUE CONSTRAINT for on_conflict support
- Add granular try/except around encrypt_token and upsert
- Add validation to prevent encrypt_token(None) on access_token
- Use logging.exception for full traceback
- Degrade gracefully if token storage fails (non-fatal)
- Standardize logs with [OWNERSHIP_TRANSFER][CALLBACK][ONEDRIVE] tag

Fixes: #500_ONEDRIVE_CALLBACK"

# NO PUSH hasta que yo autorice
```

#### Step 3: Deploy a Producción
```bash
# Fly.io
fly deploy --app cloud-aggregator-backend

# Verificar logs en tiempo real
fly logs --app cloud-aggregator-backend
```

---

## OBSERVABILITY

### Logs a Monitorear

#### Success Path:
```
[OWNERSHIP_TRANSFER][CALLBACK][ONEDRIVE] Tokens saved temporarily for transfer: provider_account_id=abc123 requesting_user=uuid-xyz
```

#### Degradation Path (Non-Fatal):
```
[OWNERSHIP_TRANSFER][CALLBACK][ONEDRIVE] Failed to save tokens (non-fatal, degrading gracefully): <ClassName> - <Error Message>
```

#### Error Path (Con Traceback):
```
[OWNERSHIP_TRANSFER][CALLBACK][ONEDRIVE] encrypt_token(access_token) failed: <ClassName>
Traceback (most recent call last):
  ...
```

### Queries de Validación Post-Deploy

```sql
-- 1. Verificar requests creados
SELECT 
    provider, 
    provider_account_id, 
    requesting_user_id, 
    status, 
    created_at, 
    expires_at 
FROM ownership_transfer_requests 
ORDER BY created_at DESC 
LIMIT 10;

-- 2. Verificar TTL (ninguno debe tener expires_at > 10 min)
SELECT 
    id, 
    created_at, 
    expires_at, 
    EXTRACT(EPOCH FROM (expires_at - created_at)) / 60 AS ttl_minutes 
FROM ownership_transfer_requests 
WHERE status = 'pending';

-- 3. Detectar requests expirados
SELECT COUNT(*) 
FROM ownership_transfer_requests 
WHERE status = 'pending' 
  AND expires_at < now();
```

---

## ROLLBACK PLAN

Si el fix causa problemas en producción:

### Rollback Código (Inmediato):
```bash
git revert HEAD
fly deploy --app cloud-aggregator-backend
```

### Rollback SQL (Manual):
```sql
-- Eliminar constraint (no recomendado, mejor arreglar el código)
ALTER TABLE ownership_transfer_requests 
DROP CONSTRAINT ownership_transfer_unique_key;

-- Restaurar unique index (si es necesario)
CREATE UNIQUE INDEX IF NOT EXISTS idx_ownership_transfer_unique
ON ownership_transfer_requests(provider, provider_account_id, requesting_user_id);
```

**NOTA:** No deberías necesitar rollback SQL si el constraint funciona correctamente.

---

## SECURITY CONSIDERATIONS

✅ **Validaciones Implementadas:**
1. Tokens encriptados con `encrypt_token()` ANTES de storage
2. TTL de 10 minutos en `expires_at`
3. Service role only (PUBLIC/ANON/AUTHENTICATED revocados)
4. Tokens nunca se loguean (solo IDs y status)
5. Fragment (`#transfer_token=...`) no viaja al servidor

✅ **No se rompe:**
- Safe Reclaim (no tocado)
- Flujos normales OneDrive/Google Drive (no tocados)
- Reconnect mode (no tocado)

---

## SUMMARY

| Aspecto | Antes | Después |
|---------|-------|---------|
| **Unique Constraint** | ❌ UNIQUE INDEX (no funciona con on_conflict) | ✅ UNIQUE CONSTRAINT |
| **Error Handling** | ❌ Generic try/except, logging.error | ✅ Granular try/except, logging.exception |
| **Token Validation** | ❌ No valida access_token != None | ✅ Valida antes de encrypt |
| **500 Error** | ❌ Se propaga si falla upsert | ✅ Degrada gracefully (non-fatal) |
| **Observability** | ❌ Logs sin traceback | ✅ Full traceback + tags estandarizados |

---

## NEXT STEPS

1. **Revisar este documento** (tú apruebas)
2. **Aplicar migración SQL** en Supabase Dashboard
3. **Deploy código** a producción (cuando autorices)
4. **Monitorear logs** por 24h
5. **Cleanup** requests expirados (cron job opcional)

---

**NO DEPLOY HASTA QUE YO (CHATGPT) LO AUTORICE**
