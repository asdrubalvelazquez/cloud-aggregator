# 🚀 DEPLOYMENT GUIDE - Infinite Connections Bug Fix

**Fecha:** 22 Diciembre 2025  
**Priority:** CRITICAL  
**Bug ID:** Infinite Connections (slot_log_id NULL orphans)

---

## 📋 RESUMEN DEL FIX

### Problema Identificado:
- **ROOT CAUSE:** cloud_accounts con `slot_log_id = NULL` (legacy) NO son contados por el sistema de slots
- **IMPACTO:** Usuarios pueden conectar cuentas ilimitadas bypasando el límite FREE (2 slots)
- **DISCOVERY:** System permite infinitas conexiones si hay registros legacy sin vincular a cloud_slots_log

### Solución Implementada:

**A) Migración DB:**
- Índice único: `cloud_slots_log(user_id, provider, provider_account_id)` (previene duplicados)
- Backfill: Todos los cloud_accounts con slot_log_id NULL → crear slot + vincular
- Sync: Actualizar contadores user_plans.clouds_slots_used con datos reales

**B) Backend Hardening:**
- OAuth callback: `connect_cloud_account_with_slot()` se ejecuta ANTES del upsert
- CRÍTICO: Si falla get/create slot → ABORTAR (no crear cloud_account orphan)
- Ahora: `upsert_data` SIEMPRE incluye `slot_log_id` (campo obligatorio)

**C) Frontend Fix:**
- TypeScript: Reemplazado `!!quota && ...` por variable explícita `limitReached: boolean`
- Elimina error: "Type 'boolean | null' is not assignable to type 'boolean | undefined'"

---

## 📂 ARCHIVOS MODIFICADOS

### 1. Backend - OAuth Callback Fix
**Archivo:** `backend/backend/main.py`  
**Líneas:** 241-268

```diff
+    # CRITICAL FIX: Get/create slot BEFORE upserting cloud_account
+    # This prevents creating orphan accounts with slot_log_id = NULL
+    # which causes "infinite connections" bug
+    try:
+        slot_result = quota.connect_cloud_account_with_slot(
+            supabase,
+            user_id,
+            "google_drive",
+            google_account_id,
+            account_email
+        )
+        slot_id = slot_result["id"]
+        import logging
+        logging.info(f"[SLOT LINKED] slot_id={slot_id}, is_new={slot_result.get('is_new')}, reconnected={slot_result.get('reconnected')}")
+    except Exception as slot_err:
+        import logging
+        logging.error(f"[CRITICAL] Failed to get/create slot for user {user_id}, account {account_email}: {slot_err}")
+        # ABORT: Do NOT create cloud_account without slot_id (prevents orphan accounts)
+        return RedirectResponse(f"{FRONTEND_URL}/app?error=slot_creation_failed")
+    
     # Preparar datos para guardar (incluye reactivación si es reconexión)
     upsert_data = {
         "account_email": account_email,
         "google_account_id": google_account_id,
         "access_token": access_token,
         "refresh_token": refresh_token,
         "token_expiry": expiry_iso,
         "user_id": user_id,
         "is_active": True,              # Reactivar cuenta si estaba soft-deleted
         "disconnected_at": None,        # Limpiar timestamp de desconexión
+        "slot_log_id": slot_id,         # CRITICAL: Link to slot (prevents orphan accounts)
     }

     # Save to database
     resp = supabase.table("cloud_accounts").upsert(
         upsert_data,
         on_conflict="google_account_id",
     ).execute()

-    # Vincular slot histórico tras guardar la cuenta
-    try:
-        quota.connect_cloud_account_with_slot(
-            supabase,
-            user_id,
-            "google_drive",
-            google_account_id,
-            account_email
-        )
-    except Exception as slot_err:
-        import logging
-        logging.error(f"[SLOT ERROR] Failed to link slot for user {user_id}, account {account_email}: {slot_err}")
-        # Continuar sin fallar la conexión (slot se puede vincular manualmente después)
```

**Cambios Clave:**
1. ✅ `connect_cloud_account_with_slot()` se ejecuta **ANTES** del upsert (era DESPUÉS)
2. ✅ Si falla slot creation → `return RedirectResponse(error)` (era continuar)
3. ✅ `upsert_data` incluye `slot_log_id: slot_id` (era missing)

---

### 2. Frontend - TypeScript Boolean Fix
**Archivo:** `frontend/src/app/app/page.tsx`  
**Líneas:** 264-291

```diff
           <div className="flex gap-3">
             <button
               onClick={() => setShowReconnectModal(true)}
               className="rounded-lg transition px-4 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700"
             >
               📊 Ver mis cuentas
             </button>
-            <button
-              onClick={handleConnectGoogle}
-              disabled={!!quota && quota.historical_slots_used >= quota.historical_slots_total}
-              className={
-                !!quota && quota.historical_slots_used >= quota.historical_slots_total
-                  ? "rounded-lg transition px-4 py-2 text-sm font-semibold bg-slate-600 text-slate-400 cursor-not-allowed"
-                  : "rounded-lg transition px-4 py-2 text-sm font-semibold bg-emerald-500 hover:bg-emerald-600"
-              }
-              title={
-                !!quota && quota.historical_slots_used >= quota.historical_slots_total
-                  ? "Has usado todos tus slots históricos. Puedes reconectar tus cuentas anteriores desde 'Ver mis cuentas'"
-                  : "Conectar una nueva cuenta de Google Drive"
-              }
-            >
-              Conectar nueva cuenta
-            </button>
+            {(() => {
+              // FIX: Explicit boolean to avoid TS error (boolean | null not assignable)
+              const limitReached = quota ? quota.historical_slots_used >= quota.historical_slots_total : false;
+              return (
+                <button
+                  onClick={handleConnectGoogle}
+                  disabled={limitReached}
+                  className={
+                    limitReached
+                      ? "rounded-lg transition px-4 py-2 text-sm font-semibold bg-slate-600 text-slate-400 cursor-not-allowed"
+                      : "rounded-lg transition px-4 py-2 text-sm font-semibold bg-emerald-500 hover:bg-emerald-600"
+                  }
+                  title={
+                    limitReached
+                      ? "Has usado todos tus slots históricos. Puedes reconectar tus cuentas anteriores desde 'Ver mis cuentas'"
+                      : "Conectar una nueva cuenta de Google Drive"
+                  }
+                >
+                  Conectar nueva cuenta
+                </button>
+              );
+            })()}
```

**Cambios Clave:**
1. ✅ Variable `limitReached: boolean` explícita (elimina `boolean | null`)
2. ✅ IIFE wrapper para scope local
3. ✅ Props reciben `limitReached` (boolean puro, no expresión con null)

---

### 3. Database - Backfill Migration
**Archivo:** `backend/migrations/BACKFILL_SLOT_LOG_ID.sql`  
**Nuevo archivo** (246 líneas)

**Qué hace:**
1. ✅ Crea índice único: `idx_cloud_slots_log_unique_account` (user_id + provider + provider_account_id)
2. ✅ Encuentra todos los `cloud_accounts` con `slot_log_id = NULL`
3. ✅ Para cada orphan:
   - INSERT slot en `cloud_slots_log` (ON CONFLICT DO NOTHING = idempotent)
   - UPDATE `cloud_accounts.slot_log_id` con el slot_id
4. ✅ Sync contadores: `user_plans.clouds_slots_used` = COUNT(DISTINCT provider_account_id)
5. ✅ Post-check: Verifica 0 orphan accounts remaining

**Idempotente:** Safe to run multiple times (usa ON CONFLICT, checks de existencia)

---

## 🚀 DEPLOYMENT STEPS

### STEP 1: Database Migration (Supabase)

**⏱ ETA:** 2-5 minutos (depends on data volume)

1. Abre **Supabase Dashboard** → **SQL Editor**
2. Copia y pega TODO el contenido de `backend/migrations/BACKFILL_SLOT_LOG_ID.sql`
3. Click **"Run"**
4. Verifica output en **Logs** panel:
   ```
   ✓ Created unique index: idx_cloud_slots_log_unique_account
   Orphan accounts (slot_log_id = NULL): [X]
   Processing [X] accounts...
   ✓ Created new slot (slot_id=..., slot_number=...)
   ✓ Updated cloud_accounts.slot_log_id (account_id=...)
   ✅ SUCCESS: All cloud_accounts now have slot_log_id
   ✅ Infinite connections bug is FIXED
   ```

5. **Verification Query** (ejecutar después):
   ```sql
   -- Should return 0 orphan accounts
   SELECT COUNT(*) AS orphan_accounts
   FROM cloud_accounts
   WHERE slot_log_id IS NULL;
   ```

**Expected result:** `0` (cero orphan accounts)

---

### STEP 2: Backend Deploy (Fly.io)

**⏱ ETA:** 3-5 minutos

```powershell
# 1. Commit changes
git add backend/backend/main.py backend/migrations/BACKFILL_SLOT_LOG_ID.sql
git commit -m "fix(critical): prevent infinite connections bug with slot_log_id enforcement"

# 2. Push to GitHub (trigger Vercel auto-deploy frontend)
git push origin main

# 3. Deploy backend to Fly.io
cd backend
fly deploy

# 4. Verify deployment
fly status
# Expected: v[X] running (1 machine iad)

# 5. Check logs for errors
fly logs -n
# Look for: "INFO: Application startup complete."
# NO errors about slot_log_id
```

**Post-Deploy Verification:**
```powershell
# Test OAuth callback still works (no 500 errors)
curl https://api.cloudaggregator.com/health
# Expected: {"status": "ok"}
```

---

### STEP 3: Frontend Deploy (Vercel)

**⏱ ETA:** 2-3 minutos (auto-deploy on git push)

Vercel auto-deploy triggered by `git push origin main` en Step 2.

**Manual check:**
1. Abre **Vercel Dashboard** → **Deployments**
2. Verifica último deployment: `fix(critical): prevent infinite connections...`
3. Status: ✅ **Ready** (no TypeScript errors)

**Post-Deploy Verification:**
```powershell
# Test frontend build succeeded
curl https://cloudaggregator.vercel.app
# Expected: 200 OK (HTML page loads)
```

---

## 🧪 SMOKE TESTS (Post-Deployment)

### Test 1: New Connection (First Slot)
**Scenario:** Usuario nuevo conecta primera cuenta

1. Login con usuario test (0 cuentas conectadas)
2. Dashboard → Click "Conectar nueva cuenta"
3. OAuth flow → Select Google account → Authorize
4. **Expected:**
   - Redirect: `/app?auth=success`
   - Backend logs: `[SLOT LINKED] slot_id=..., is_new=True, reconnected=False`
   - Dashboard shows: **1/2 slots usados**
   - Verify DB:
     ```sql
     SELECT slot_log_id FROM cloud_accounts WHERE user_id = '[TEST_USER_ID]';
     -- Expected: NOT NULL (UUID)
     ```

### Test 2: Second Connection (Fill Slots)
**Scenario:** Mismo usuario conecta segunda cuenta (different Gmail)

1. Dashboard → Click "Conectar nueva cuenta"
2. OAuth → Select different Google account → Authorize
3. **Expected:**
   - Redirect: `/app?auth=success`
   - Backend logs: `[SLOT LINKED] slot_id=..., is_new=True, reconnected=False`
   - Dashboard shows: **2/2 slots usados**
   - Button "Conectar nueva cuenta" → **DISABLED** (gray, cursor-not-allowed)

### Test 3: Limit Enforcement (Block Third Connection)
**Scenario:** Usuario intenta conectar 3ra cuenta (should be blocked)

1. Dashboard → Button "Conectar nueva cuenta" → **DISABLED** (cannot click)
2. Hover button → Tooltip: "Has usado todos tus slots históricos..."
3. **Expected:**
   - Button remains disabled
   - No OAuth redirect occurs
   - System enforces 2-slot limit correctly

### Test 4: Reconnection (Slot Reuse)
**Scenario:** Usuario desconecta cuenta 1, luego reconecta misma cuenta

1. Dashboard → Account 1 → Disconnect
2. Dashboard shows: **1/2 activos** (pero historial sigue en 2/2)
3. "Ver mis cuentas" → Inactive slots list → Click "Reconectar"
4. OAuth → Select same Google account → Authorize
5. **Expected:**
   - Redirect: `/app?auth=success`
   - Backend logs: `[RECONEXIÓN] Reactivando slot existente - slot_id=..., slot_number=1`
   - Backend logs: **NO** `[NUEVA CUENTA] Creando nuevo slot`
   - Dashboard shows: **2/2 activos**, **2/2 slots históricos** (counter unchanged)
   - Verify DB:
     ```sql
     SELECT slot_number, is_active FROM cloud_slots_log WHERE user_id = '[TEST_USER_ID]' ORDER BY slot_number;
     -- Expected: 
     -- slot_number=1, is_active=true (reconnected)
     -- slot_number=2, is_active=true
     ```

### Test 5: Orphan Prevention (Critical)
**Scenario:** Verify NO orphan accounts can be created

**Pre-test check:**
```sql
-- Should return 0 BEFORE test
SELECT COUNT(*) AS orphan_accounts FROM cloud_accounts WHERE slot_log_id IS NULL;
```

**Test:**
1. Trigger new connection via OAuth
2. Monitor backend logs for `[SLOT LINKED]` message BEFORE upsert
3. Verify cloud_accounts insert includes `slot_log_id`

**Post-test check:**
```sql
-- Should STILL return 0 AFTER test
SELECT COUNT(*) AS orphan_accounts FROM cloud_accounts WHERE slot_log_id IS NULL;
```

**Expected:** `0` (zero) ALWAYS

---

## 🐛 ROLLBACK PLAN (If Issues)

### Backend Rollback (Fly.io)

```powershell
# Rollback to previous version
cd backend
fly releases

# Identify last working version (e.g. v30)
fly releases rollback v30

# Verify rollback
fly status
fly logs -n
```

### Frontend Rollback (Vercel)

1. **Vercel Dashboard** → **Deployments**
2. Find previous working deployment (antes del fix)
3. Click **"⋯"** → **"Promote to Production"**
4. Confirm rollback

### Database Rollback (NOT RECOMMENDED)

⚠️ **WARNING:** La migración BACKFILL_SLOT_LOG_ID.sql es **idempotent** y **safe**.

**NO revertir a menos que:**
- Unique index causa deadlocks (improbable)
- Backfill introduce data corruption (improbable)

**Si es absolutamente necesario:**
```sql
-- Remove unique index (allows duplicate slots again - NOT RECOMMENDED)
DROP INDEX IF EXISTS idx_cloud_slots_log_unique_account;

-- Reset slot_log_id to NULL (RE-INTRODUCES BUG - DANGER)
-- DO NOT RUN unless absolutely critical
-- UPDATE cloud_accounts SET slot_log_id = NULL WHERE ...;
```

---

## 📊 MONITORING POST-DEPLOY

### Metrics to Watch (First 24h)

1. **Orphan Accounts Count (should stay 0):**
   ```sql
   SELECT COUNT(*) AS orphan_accounts FROM cloud_accounts WHERE slot_log_id IS NULL;
   ```
   - Alert if > 0

2. **Connection Failures (error=slot_creation_failed):**
   ```powershell
   fly logs -n | grep "slot_creation_failed"
   ```
   - Alert if > 5 occurrences/hour

3. **Reconnection Success Rate:**
   ```powershell
   fly logs -n | grep "RECONEXIÓN"
   ```
   - Should see `[RECONEXIÓN]` logs when users reconnect
   - Alert if 0 (indicates reconnection broken)

4. **User_Plans Sync (counters accurate):**
   ```sql
   SELECT 
       up.user_id,
       up.clouds_slots_used AS counter_value,
       COUNT(DISTINCT csl.provider_account_id) AS actual_slots
   FROM user_plans up
   LEFT JOIN cloud_slots_log csl ON csl.user_id = up.user_id
   GROUP BY up.user_id, up.clouds_slots_used
   HAVING up.clouds_slots_used != COUNT(DISTINCT csl.provider_account_id);
   ```
   - Alert if mismatches found

---

## ✅ SUCCESS CRITERIA

- ✅ **Migration:** 0 orphan accounts (slot_log_id NULL)
- ✅ **Backend:** No 500 errors in OAuth callback
- ✅ **Frontend:** Vercel build succeeds (no TypeScript errors)
- ✅ **Smoke Tests:** All 5 tests pass
- ✅ **Monitoring:** No orphan accounts created in first 24h
- ✅ **User Experience:** Limit enforcement works (2 slots FREE)

---

## 📞 SUPPORT

**If deployment fails:**
1. Check Fly.io logs: `fly logs -n`
2. Check Vercel build logs: Vercel Dashboard → Deployment → Build Logs
3. Check Supabase SQL execution: SQL Editor → Logs panel

**Rollback immediately if:**
- Backend returns 500 errors on OAuth callback
- Orphan accounts counter increases after deploy
- Users cannot connect new accounts (legitimate < limit)

**Contact:**
- DevOps: [Slack #deployments]
- On-call: [PagerDuty rotation]

---

**Status:** 🟢 READY FOR PRODUCTION  
**Risk Level:** MEDIUM (tested, idempotent migration, has rollback plan)  
**Deploy Window:** ASAP (critical bug fix)
