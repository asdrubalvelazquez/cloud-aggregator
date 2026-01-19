# DUPLICATE GUARD VERIFICATION TEST

**Deployment:** Fly.io v153 (commit c7c58d7)  
**Deployed:** 2026-01-19T03:23:43Z  
**Status:** ✅ Active

---

## 🔍 VERIFICATION PLAN

### Step 1: Verify v153 is Running

```powershell
fly status --app cloud-aggregator-api
```

**Expected output:**
```
VERSION  153
IMAGE    deployment-01KFA4EQ7FEEB96AJ9TCCRJDNV
STATE    started
```

✅ **CONFIRMED:** v153 active since 2026-01-19T03:23:43Z

---

### Step 2: Check for Existing Duplicates in Database

Execute `verify_duplicate_guard_test.sql` in Supabase SQL Editor.

**Query 1 - Find duplicates:**
```sql
SELECT 
    provider,
    provider_account_id,
    COUNT(*) as duplicate_count,
    array_agg(DISTINCT user_id) as different_users
FROM public.cloud_provider_accounts
WHERE provider = 'onedrive'
GROUP BY provider, provider_account_id
HAVING COUNT(*) > 1;
```

**Expected results:**
- If duplicates exist → need cleanup before testing
- If no duplicates → ready for manual test

---

### Step 3: Manual Test - Reproduce Duplicate Prevention

#### Test Case A: Different User Tries to Connect Owned Account

**Setup:**
1. Identify OneDrive `provider_account_id` owned by User A
2. Login as User B (different user)
3. Click "Conectar OneDrive"
4. Authenticate with Microsoft (same account as User A)

**Expected behavior:**
- Backend detects: `existing_owner_id != current_user_id`
- Log message: `[ONEDRIVE] Duplicate prevention hit: provider_account_id=... owner=A current=B`
- Response: `307 Redirect` to `/app?error=ownership_conflict#transfer_token=...`
- Frontend: Shows ownership transfer modal with CTA

**Verification commands:**
```powershell
# Monitor logs in real-time
fly logs --app cloud-aggregator-api | Select-String -Pattern 'Duplicate prevention hit'

# After test, search logs
fly logs --app cloud-aggregator-api | Select-String -Pattern 'provider_account_id=62c0cfcdf8b5bc8c' -Context 5
```

---

#### Test Case B: Same User Reconnects (Idempotent)

**Setup:**
1. Login as User A
2. Disconnect OneDrive account
3. Click "Conectar OneDrive"
4. Authenticate with Microsoft (same account as before)

**Expected behavior:**
- Backend detects: `existing_owner_id == current_user_id`
- Log message: `[ONEDRIVE] Idempotent update: provider_account_id=... user_id=A`
- Response: `307 Redirect` to `/app?connection=success`
- Frontend: Shows success message, account reconnected

**Verification commands:**
```powershell
# Monitor logs in real-time
fly logs --app cloud-aggregator-api | Select-String -Pattern 'Idempotent update'

# After test, search logs
fly logs --app cloud-aggregator-api | Select-String -Pattern 'Idempotent update.*provider_account_id' -Context 3
```

---

### Step 4: Verify Redirect Format

**Frontend expects:** `#transfer_token=...` (hash, not query param)

**Code reference:** `frontend/src/app/(dashboard)/app/page.tsx` line 492
```tsx
const hashParams = new URLSearchParams(window.location.hash.slice(1));
const transferToken = hashParams.get("transfer_token");
```

**Backend redirect:** `backend/backend/main.py` line ~5938
```python
return RedirectResponse(
    f"{frontend_origin}/app?error=ownership_conflict#transfer_token={quote(transfer_token)}"
)
```

✅ **CONFIRMED:** Redirect format matches frontend expectation.

---

## 📋 EVIDENCE COLLECTION

### Logs to Capture

1. **Duplicate prevention hit:**
```
[ONEDRIVE] Duplicate prevention hit: provider_account_id=62c0cfcdf8b5bc8c owner=56c67b18-... current=62bf37c1-...
```

2. **Idempotent update:**
```
[ONEDRIVE] Idempotent update: provider_account_id=62c0cfcdf8b5bc8c user_id=62bf37c1-...
```

3. **HTTP Response:**
```
INFO: "GET /auth/onedrive/callback?code=...&state=... HTTP/1.1" 307 Temporary Redirect
```

### Database Query to Verify No Upsert Happened

After duplicate prevention triggers, verify no new row was created:

```sql
SELECT 
    id,
    user_id,
    provider_account_id,
    created_at,
    updated_at
FROM public.cloud_provider_accounts
WHERE provider = 'onedrive'
  AND provider_account_id = '<test_account_id>'
ORDER BY created_at DESC;
```

**Expected:** Only 1 row exists (original owner), no new row for requesting user.

---

## 🎯 SUCCESS CRITERIA

✅ **Duplicate prevention works if:**
1. Log shows: `[ONEDRIVE] Duplicate prevention hit: ...`
2. Frontend shows ownership transfer modal (not error toast)
3. Database has NO new row for requesting user
4. Redirect includes `#transfer_token=...` in URL

✅ **Idempotent update works if:**
1. Log shows: `[ONEDRIVE] Idempotent update: ...`
2. Frontend shows success message
3. Database row updated (same `id`, updated `updated_at`)
4. Redirect to `/app?connection=success`

---

## 🚨 FALLBACK: If No Manual Test Available

**Alternative verification using existing logs:**

Search for previous callback attempts (before v153):
```powershell
Get-Content "$env:TEMP\flylogs_guard.txt" | Select-String -Pattern 'RECLAIM|ownership_conflict' -Context 5
```

Look for patterns:
- `[SECURITY][RECLAIM][ONEDRIVE][CONNECT] Account reassignment authorized`
- `Ownership transfer failed: APIError`

These would NOW trigger duplicate guard instead (if same scenario occurs).

---

## 📊 CURRENT STATUS

**Last callback seen in logs:** 2026-01-19T02:51:47Z (before v153 deploy)
- That callback had: SAFE RECLAIM → APIError → reconnect_failed
- With v153, same scenario would trigger: Duplicate Guard → ownership_conflict

**Next steps:**
1. Execute `verify_duplicate_guard_test.sql` to find test candidates
2. Manually test with 2 different user accounts
3. Capture logs and confirm guard triggers
4. Document evidence in this file

---

**Investigation date:** 2026-01-19  
**Verified by:** Awaiting manual test execution
