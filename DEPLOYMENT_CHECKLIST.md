# ✅ DEPLOYMENT CHECKLIST - Infinite Connections Fix

**Deploy Date:** _______________  
**Deployed By:** _______________  
**Commit:** `f26f092`

---

## PRE-DEPLOYMENT

- [ ] **Code pushed to GitHub:** `git push origin main` ✅
- [ ] **Vercel build triggered:** Check Vercel Dashboard (auto-deploy)
- [ ] **Backend changes reviewed:** `backend/backend/main.py` (líneas 241-268)
- [ ] **Frontend changes reviewed:** `frontend/src/app/app/page.tsx` (líneas 264-291)
- [ ] **Migration script reviewed:** `backend/migrations/BACKFILL_SLOT_LOG_ID.sql`

---

## STEP 1: DATABASE MIGRATION (Supabase)

⏱ **ETA:** 2-5 minutos

- [ ] **Open Supabase Dashboard** → SQL Editor
- [ ] **Paste migration:** `backend/migrations/BACKFILL_SLOT_LOG_ID.sql` (full file)
- [ ] **Execute:** Click "Run"
- [ ] **Check Logs panel:**
  - [ ] Message: `✓ Created unique index: idx_cloud_slots_log_unique_account`
  - [ ] Message: `Orphan accounts (slot_log_id = NULL): [X]`
  - [ ] Message: `✓ Created new slot (slot_id=...)` (for each orphan)
  - [ ] Message: `✅ SUCCESS: All cloud_accounts now have slot_log_id`
- [ ] **Run verification query:**
  ```sql
  SELECT COUNT(*) AS orphan_accounts FROM cloud_accounts WHERE slot_log_id IS NULL;
  ```
  - [ ] **Result:** `0` (zero orphan accounts)

**Time completed:** _______________

---

## STEP 2: BACKEND DEPLOYMENT (Fly.io)

⏱ **ETA:** 3-5 minutos

- [ ] **Navigate to backend folder:** `cd backend`
- [ ] **Deploy:** `fly deploy`
- [ ] **Wait for build:** Watch output for "Deployment successful"
- [ ] **Check status:** `fly status`
  - [ ] **Result:** `v[X] running` (new version number)
- [ ] **Check logs:** `fly logs -n`
  - [ ] Message: `INFO: Started server process`
  - [ ] Message: `INFO: Application startup complete.`
  - [ ] Message: `INFO: Uvicorn running on http://0.0.0.0:8080`
  - [ ] **NO errors:** No "column slot_log_id does not exist"

**Deployed Version:** v_____  
**Time completed:** _______________

---

## STEP 3: FRONTEND DEPLOYMENT (Vercel)

⏱ **ETA:** 2-3 minutos (auto-deploy)

- [ ] **Open Vercel Dashboard** → Deployments
- [ ] **Find latest deployment:** Commit `fix(critical): prevent infinite connections...`
- [ ] **Check status:** ✅ Ready (no build errors)
- [ ] **Click deployment URL:** Open preview
- [ ] **Verify page loads:** No 500 errors
- [ ] **Check browser console:** No TypeScript/React errors

**Deployment URL:** _______________  
**Time completed:** _______________

---

## STEP 4: SMOKE TESTS

### Test 1: New Connection (First Slot)
- [ ] **Login:** Test user with 0 connections
- [ ] **Click:** "Conectar nueva cuenta"
- [ ] **OAuth flow:** Authorize with Google account
- [ ] **Verify redirect:** `/app?auth=success`
- [ ] **Verify dashboard:** Shows "1/2 slots usados"
- [ ] **Check backend logs:** `fly logs -n | grep "SLOT LINKED"`
  - [ ] Message: `[SLOT LINKED] slot_id=..., is_new=True, reconnected=False`
- [ ] **Check database:**
  ```sql
  SELECT slot_log_id FROM cloud_accounts WHERE user_id = '[TEST_USER_ID]';
  ```
  - [ ] **Result:** NOT NULL (UUID present)

**Time completed:** _______________

---

### Test 2: Second Connection (Fill Slots)
- [ ] **Same user:** Connect with different Gmail account
- [ ] **OAuth flow:** Authorize second account
- [ ] **Verify redirect:** `/app?auth=success`
- [ ] **Verify dashboard:** Shows "2/2 slots usados"
- [ ] **Verify button:** "Conectar nueva cuenta" is DISABLED (gray, cursor-not-allowed)
- [ ] **Check backend logs:**
  - [ ] Message: `[SLOT LINKED] slot_id=..., is_new=True, reconnected=False`

**Time completed:** _______________

---

### Test 3: Limit Enforcement (Block Third)
- [ ] **Same user:** Try to click "Conectar nueva cuenta"
- [ ] **Verify button:** Cannot click (disabled state)
- [ ] **Hover button:** Tooltip shows "Has usado todos tus slots históricos..."
- [ ] **Expected:** NO OAuth redirect occurs

**Time completed:** _______________

---

### Test 4: Reconnection (Slot Reuse)
- [ ] **Disconnect:** Account 1 from dashboard
- [ ] **Verify dashboard:** Shows "1/2 activos" (historical stays 2/2)
- [ ] **Click:** "Ver mis cuentas" → Find inactive slot → "Reconectar"
- [ ] **OAuth flow:** Select SAME Google account → Authorize
- [ ] **Verify redirect:** `/app?auth=success`
- [ ] **Check backend logs:**
  - [ ] Message: `[RECONEXIÓN] Reactivando slot existente - slot_id=..., slot_number=1`
  - [ ] **NO** message: `[NUEVA CUENTA] Creando nuevo slot`
- [ ] **Verify dashboard:** Shows "2/2 activos", "2/2 históricos" (counter unchanged)

**Time completed:** _______________

---

### Test 5: Zero Orphans (CRITICAL)
- [ ] **Run query:**
  ```sql
  SELECT COUNT(*) AS orphan_accounts FROM cloud_accounts WHERE slot_log_id IS NULL;
  ```
  - [ ] **Result:** `0` (MUST be zero)
- [ ] **Run query:**
  ```sql
  SELECT 
      up.clouds_slots_used AS counter,
      COUNT(DISTINCT csl.provider_account_id) AS actual
  FROM user_plans up
  LEFT JOIN cloud_slots_log csl ON csl.user_id = up.user_id
  WHERE up.user_id = '[TEST_USER_ID]'
  GROUP BY up.clouds_slots_used;
  ```
  - [ ] **Result:** counter = actual (no mismatch)

**Time completed:** _______________

---

## STEP 5: MONITORING (First Hour)

- [ ] **Set timer:** Check in 1 hour
- [ ] **Check orphan count:**
  ```sql
  SELECT COUNT(*) FROM cloud_accounts WHERE slot_log_id IS NULL;
  ```
  - [ ] **Result:** Still `0`
- [ ] **Check backend errors:** `fly logs | grep "slot_creation_failed"`
  - [ ] **Result:** < 5 occurrences (if any)
- [ ] **Check reconnection logs:** `fly logs | grep "RECONEXIÓN"`
  - [ ] **Result:** Logs appear when users reconnect (if any activity)

**Time checked:** _______________

---

## ROLLBACK PLAN (If Issues)

### Backend Rollback
```powershell
cd backend
fly releases
fly releases rollback v[PREVIOUS]
```

### Frontend Rollback
- Vercel Dashboard → Deployments → Previous → Promote to Production

### Database Rollback
⚠️ **DO NOT ROLLBACK** (migration is safe and idempotent)

---

## SIGN-OFF

- [ ] **Database migration:** ✅ Complete
- [ ] **Backend deployment:** ✅ Complete
- [ ] **Frontend deployment:** ✅ Complete
- [ ] **All smoke tests:** ✅ Passing (5/5)
- [ ] **Zero orphans verified:** ✅ Confirmed
- [ ] **No production errors:** ✅ Confirmed

**Deployment Status:** 🟢 SUCCESS / 🔴 FAILED (circle one)

**Signed by:** _______________  
**Date/Time:** _______________

---

## POST-DEPLOYMENT NOTES

**Issues encountered:**
_______________________________________________________________________________
_______________________________________________________________________________

**Manual interventions required:**
_______________________________________________________________________________
_______________________________________________________________________________

**Follow-up actions:**
_______________________________________________________________________________
_______________________________________________________________________________
