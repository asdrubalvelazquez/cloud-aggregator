# DEPLOYMENT CHECKLIST: Fix 500 en /auth/onedrive/callback

**IMPORTANTE:** Seguir pasos EN ORDEN. NO saltarse validaciones.

---

## Pre-Deploy: Backup

### 1. Backup de Datos (Opcional pero Recomendado)
```sql
-- En Supabase SQL Editor
-- Backup de ownership_transfer_requests (si ya existe)
CREATE TABLE ownership_transfer_requests_backup_20260118 AS 
SELECT * FROM ownership_transfer_requests;
```

---

## STEP 1: Aplicar Migración SQL (PRIMERO)

### 1.1. Verificar Estado Actual
```bash
# En Supabase Dashboard → SQL Editor
# Ejecutar validation script (sección 1-5 solamente)
```

Pegar desde: `backend/migrations/validate_ownership_transfer_requests.sql` (líneas 1-100)

**Verificar:**
- [ ] Tabla existe
- [ ] UNIQUE INDEX existe pero NO UNIQUE CONSTRAINT

### 1.2. Aplicar Migración
```bash
# En Supabase Dashboard → SQL Editor
# Ejecutar migración completa actualizada
```

Pegar desde: `backend/migrations/add_ownership_transfer_requests.sql` (completo)

**Resultado esperado:** Query ejecutado exitosamente (sin errores)

### 1.3. Validar Migración
```bash
# En Supabase Dashboard → SQL Editor
# Ejecutar sección 2 del validation script
SELECT 
    constraint_name, 
    constraint_type,
    table_name
FROM information_schema.table_constraints 
WHERE table_schema = 'public'
  AND table_name = 'ownership_transfer_requests' 
  AND constraint_type = 'UNIQUE';
```

**Esperado:**
```
constraint_name                    | constraint_type | table_name
-----------------------------------+-----------------+--------------------------------
ownership_transfer_unique_key      | UNIQUE          | ownership_transfer_requests
```

✅ Si aparece, continuar a Step 2  
❌ Si NO aparece, DETENER y revisar errores

### 1.4. Test UPSERT (CRÍTICO)
```bash
# En Supabase Dashboard → SQL Editor
# Ejecutar sección 6 del validation script (DO $$ block completo)
```

**Esperado:** `NOTICE: UPSERT test passed! constraint works correctly.`

✅ Si pasa, continuar a Step 2  
❌ Si falla, DETENER (constraint no funciona)

---

## STEP 2: Deploy Código Python (DESPUÉS)

### 2.1. Verificar Cambios Locales
```bash
cd backend
git status
```

**Esperado:**
```
modified:   backend/main.py
modified:   migrations/add_ownership_transfer_requests.sql
```

### 2.2. Verificar Sintaxis Python
```bash
# En VS Code
# Abrir backend/backend/main.py
# Verificar que NO haya errores de sintaxis (líneas ~5554-5710)
```

**Checklist:**
- [ ] Try/except anidados correctos
- [ ] `logging.exception()` con argumentos correctos
- [ ] No hay `encrypt_token(None)` sin validación

### 2.3. Commit (NO PUSH todavía)
```bash
git add backend/main.py backend/migrations/add_ownership_transfer_requests.sql
git commit -m "fix(onedrive): prevent 500 in callback during ownership transfer

- Convert UNIQUE INDEX to UNIQUE CONSTRAINT for on_conflict support
- Add granular try/except around encrypt_token and upsert
- Add validation to prevent encrypt_token(None) on access_token
- Use logging.exception for full traceback
- Degrade gracefully if token storage fails (non-fatal)
- Standardize logs with [OWNERSHIP_TRANSFER][CALLBACK][ONEDRIVE] tag

Fixes: 500_ONEDRIVE_CALLBACK"
```

### 2.4. Push (SOLO si SQL ya está aplicado)
```bash
# ⚠️ VERIFICAR que Step 1 esté completo ANTES de push
git push origin main
```

---

## STEP 3: Deploy a Fly.io

### 3.1. Deploy Backend
```bash
cd backend
fly deploy --app cloud-aggregator-backend
```

**Monitor en tiempo real:**
```bash
fly logs --app cloud-aggregator-backend
```

### 3.2. Verificar Health Check
```bash
# En navegador
https://api.cloudaggregatorapp.com/health
```

**Esperado:** `{"status": "ok"}` o similar

---

## STEP 4: Post-Deploy Validation

### 4.1. Test Normal Connect (Sin Conflicto)
**Escenario:** Conectar OneDrive con cuenta nueva (sin ownership conflict)

**Steps:**
1. Login en app
2. Conectar OneDrive con cuenta personal
3. Autorizar en Microsoft
4. Callback debe retornar 200 (redirect a `/app?connection=success`)

**Logs esperados:**
```
[ONEDRIVE][TOKEN_EXCHANGE] SUCCESS: Received tokens from Microsoft
[SLOT LINKED][ONEDRIVE] slot_id=...
```

✅ Si funciona, continuar  
❌ Si 500, revisar logs y rollback

### 4.2. Test Ownership Conflict (Con Tokens)
**Escenario:** Usuario A tiene OneDrive conectado, Usuario B intenta conectar misma cuenta

**Steps:**
1. Login como Usuario B
2. Conectar OneDrive con cuenta de Usuario A
3. Autorizar en Microsoft
4. Callback debe retornar 307 redirect a `/app?error=ownership_conflict#transfer_token=JWT...`

**Logs esperados (success path):**
```
[SECURITY][ONEDRIVE][CONNECT] Ownership conflict detected: provider_account_id=...
[OWNERSHIP_TRANSFER][CALLBACK][ONEDRIVE] Tokens saved temporarily for transfer: provider_account_id=...
```

**O (degradation path si falla DB):**
```
[SECURITY][ONEDRIVE][CONNECT] Ownership conflict detected: provider_account_id=...
[OWNERSHIP_TRANSFER][CALLBACK][ONEDRIVE] Failed to save tokens (non-fatal, degrading gracefully): ...
```

**Frontend:** Modal debe mostrarse con botón "Transfer Ownership"

✅ Si funciona (con o sin tokens guardados), fix exitoso  
❌ Si 500, ROLLBACK inmediato

### 4.3. Verificar Tabla ownership_transfer_requests
```sql
-- En Supabase SQL Editor
SELECT 
    id,
    provider,
    provider_account_id,
    requesting_user_id,
    status,
    created_at,
    expires_at
FROM ownership_transfer_requests
ORDER BY created_at DESC
LIMIT 5;
```

**Verificar:**
- Requests con `status = 'pending'`
- `expires_at` ≈ 10 minutos después de `created_at`
- NO tokens en texto plano (access_token debe ser encrypted hash largo)

---

## STEP 5: Monitoring (24h)

### 5.1. Logs a Buscar

**Success (tokens guardados):**
```bash
fly logs --app cloud-aggregator-backend | grep "OWNERSHIP_TRANSFER"
```

Buscar:
```
[OWNERSHIP_TRANSFER][CALLBACK][ONEDRIVE] Tokens saved temporarily for transfer
```

**Degradation (tokens NO guardados, pero flujo continúa):**
```
[OWNERSHIP_TRANSFER][CALLBACK][ONEDRIVE] Failed to save tokens (non-fatal, degrading gracefully)
```

**Error (NO debe aparecer):**
```
500 Internal Server Error
```

### 5.2. Queries de Salud
```sql
-- Ejecutar cada 6 horas en las primeras 24h
SELECT 
    status, 
    COUNT(*) AS total,
    MIN(created_at) AS oldest,
    MAX(created_at) AS newest
FROM ownership_transfer_requests
GROUP BY status;
```

**Verificar:**
- `pending` aumenta gradualmente (normal)
- `used` aumenta cuando usuarios completan transfer (normal)
- `expired` aumenta si hay requests abandonados (normal)

### 5.3. Alertas a Configurar (Opcional)
- Más de 100 requests con `expires_at < now()` y `status = 'pending'` → Cleanup necesario
- Errores con tag `[OWNERSHIP_TRANSFER][CALLBACK][ONEDRIVE]` → Revisar traceback

---

## ROLLBACK (Si algo sale mal)

### Rollback Código (Inmediato)
```bash
cd backend
git revert HEAD
git push origin main
fly deploy --app cloud-aggregator-backend
```

### Rollback SQL (NO recomendado, solo si es necesario)
```sql
-- SOLO si el constraint causa problemas (muy improbable)
ALTER TABLE ownership_transfer_requests 
DROP CONSTRAINT ownership_transfer_unique_key;

-- Restaurar unique index (opcional)
CREATE UNIQUE INDEX IF NOT EXISTS idx_ownership_transfer_unique
ON ownership_transfer_requests(provider, provider_account_id, requesting_user_id);
```

**NOTA:** No deberías necesitar rollback SQL si la validación (Step 1.4) pasó.

---

## SIGN-OFF

**Para autorizar deploy, responder:**
```
✅ Step 1 completo (SQL migrado y validado)
✅ Step 2 completo (código pushed)
✅ Step 3 completo (deployed a Fly.io)
✅ Step 4.1 completo (test normal connect OK)
✅ Step 4.2 completo (test ownership conflict OK)
```

**O si algo falla:**
```
❌ Step X failed: [descripción del error]
🔄 Ejecutando rollback...
```

---

## Contacto
- **Logs en tiempo real:** `fly logs --app cloud-aggregator-backend`
- **Supabase Dashboard:** https://supabase.com/dashboard/project/[PROJECT_ID]
- **Frontend:** https://cloudaggregatorapp.com

**NO DEPLOY HASTA QUE YO (ChatGPT) LO AUTORICE**
