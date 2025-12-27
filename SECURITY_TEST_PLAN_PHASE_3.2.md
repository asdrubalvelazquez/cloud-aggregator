# 🔒 SECURITY TEST PLAN - PHASE 3.2: Account Takeover Prevention

## Test Environment
- **Backend:** Local (`python -m uvicorn backend.main:app --reload`)
- **Frontend:** Vercel production
- **Database:** Supabase production

---

## ✅ TEST CASE 1: Normal Reconnect (Happy Path)

### Preconditions
- User A logged in with user_id: `62bf37c1-6f50-46f2-9f57-7a0b5136ed1d`
- User A has Google account connected: `101434092597261545394`
- Account is currently disconnected (is_active=false)

### Test Steps
1. Navigate to `/app` dashboard
2. Click "Reconnect" button on disconnected Google account
3. Complete Google OAuth flow with **same account** (`101434092597261545394`)
4. Observe redirect and dashboard state

### Expected Results
- ✅ OAuth completes successfully
- ✅ Backend logs show: `[SECURITY] Ownership verified during reconnect`
- ✅ Redirect to: `/app?auth=success` (or no error param)
- ✅ Account shows as connected in dashboard
- ✅ No error messages displayed

### Actual Results
- [ ] Pass / [ ] Fail
- Notes: _______________________

---

## � TEST CASE 2: Slot Not Found (Invalid reconnect_account_id)

### Preconditions
- User A is logged in
- User A attempts reconnect with non-existent `reconnect_account_id`

### Test Steps
1. User A manipulates reconnect URL with fake ID: `999999999999999999`
2. Complete OAuth flow
3. Observe backend response

### Expected Results
- 🔴 Backend logs: `[SECURITY] Reconnect failed: slot not found`
- 🔴 Redirect to: `/app?error=slot_not_found`
- ✅ No database changes

### Actual Results
- [ ] Pass / [ ] Fail
- Notes: _______________________

---

## 🚨 TEST CASE 3: Account Takeover Attempt (Security Block)

### Preconditions
- User A (user_id: `62bf37c1-6f50-46f2-9f57-7a0b5136ed1d`) has slot/account: `101434092597261545394`
- User B (different user_id) is logged in

### Test Steps
**METHOD 1: Browser DevTools Manipulation**
1. User B logs in to `/app`
2. User B clicks "Reconnect" on their own account
3. Open Browser DevTools > Network tab
4. User B completes OAuth (gets redirected to callback)
5. **INTERCEPT** the callback request in DevTools
6. **MODIFY** the URL parameter: Change `reconnect_account_id` to User A's slot ID: `101434092597261545394`
7. Replay the modified request
8. Observe response

**METHOD 2: Direct Database Query (Safer)**
1. Find an account that belongs to another user:
   ```sql
   SELECT id, user_id, google_account_id, account_email 
   FROM cloud_accounts 
   WHERE user_id != '62bf37c1-6f50-46f2-9f57-7a0b5136ed1d'
   AND is_active = true
   LIMIT 1;
   ```
2. Note the `google_account_id` (e.g., `113791848601069789870`)
3. As User B, attempt to reconnect by constructing malicious URL
4. Observe backend logs and response

### Expected Results
- 🔴 OAuth callback BLOCKED at ownership check
- 🔴 Backend logs show:
  ```
  [SECURITY] Account takeover attempt blocked!
  Slot reconnect_account_id=101434092597261545394
  belongs_to_user_id=<User A UUID> but
  current_user_id=<User B UUID> attempted reconnect
  ```
- 🔴 Redirect to: `/app?error=ownership_violation`
- 🔴 Frontend shows error message
- ✅ **CRITICAL:** User A's slot remains unchanged in database
  ```sql
  -- Verify User A's slot NOT hijacked
  SELECT user_id, provider_account_id
  FROM cloud_slots_log
  WHERE provider_account_id = '101434092597261545394';
  -- Should still show User A's user_id
  ```

### Actual Results
- [ ] Pass / [ ] Fail
- Attack blocked: [ ] Yes / [ ] No
- Database integrity verified: [ ] Yes / [ ] No
- Notes: _______________________

---

## 🆕 TEST CASE 4: First-Time Connection via Reconnect Flow (Edge Case)

### Preconditions
- User C is logged in
- User C has a slot assigned in cloud_slots_log but no cloud_account record exists yet
- This can happen if slot was created but OAuth never completed

### Test Steps
1. User C triggers reconnect flow (even though account doesn't exist)
2. Complete Google OAuth with new account
3. Observe backend behavior

### Expected Results
- ✅ Slot ownership verified (user_id matches)
- ✅ Backend logs show: `[SECURITY] Reconnect ownership verified`
- ✅ UPSERT creates new account (INSERT operation)
- ✅ Account successfully created and linked
- ✅ No security errors

### Actual Results
- [ ] Pass / [ ] Fail
- Notes: _______________________

---

## 🔍 TEST CASE 5: Reconnect with Wrong Google Account (Mismatch)

### Preconditions
- User A has account: `101434092597261545394` (`asdrubal@gmail.com`)
- User A also has another Google account: `999999999999999999` (`other@gmail.com`)

### Test Steps
1. User A clicks "Reconnect" for `asdrubal@gmail.com`
2. During OAuth, User A **accidentally authenticates with wrong account** (`other@gmail.com`)
3. Observe response

### Expected Results
- 🔴 Blocked by **existing mismatch check** (line 777)
- 🔴 Backend logs: `[RECONNECT ERROR] Account mismatch`
- 🔴 Redirect to: `/app?error=account_mismatch&expected=asdrubal@gmail.com`
- ✅ Security check is NOT triggered (blocked earlier)

### Actual Results
- [ ] Pass / [ ] Fail
- Notes: _______________________

---

## 📊 Security Verification Checklist

After running all tests, verify:

- [ ] **No False Positives:** User can reconnect their own account without issues
- [ ] **Attack Prevention:** Cross-user takeover attempts are blocked
- [ ] **Logging:** All security events logged with `[SECURITY]` prefix
- [ ] **No Token Leaks:** Logs don't contain access_token or refresh_token
- [ ] **Database Integrity:** No unauthorized user_id changes in cloud_accounts
- [ ] **UX:** Error messages are user-friendly (redirect params, not 403 JSON)
- [ ] **Performance:** No noticeable latency added (<50ms for SELECT query)

---

## 🚀 Deployment Checklist (DO NOT DEPLOY YET)

When authorized to deploy:

1. [ ] Run all test cases above
2. [ ] Verify commit: `git log -1 --oneline`
3. [ ] Push to GitHub: `git push origin main`
4. [ ] Deploy to Fly.io: `flyctl deploy --app cloud-aggregator-api`
5. [ ] Monitor logs: `flyctl logs --app cloud-aggregator-api`
6. [ ] Re-run Test Case 1 in production
7. [ ] Check for `[SECURITY] Ownership verified` in production logs

---

## 📝 Test Results Summary

**Date:** _____________  
**Tester:** _____________  
**Test Case 1 (Normal Reconnect):** [ ] Pass / [ ] Fail  
**Test Case 2 (Slot Not Found):** [ ] Pass / [ ] Fail  
**Test Case 3 (Takeover Attempt):** [ ] Pass / [ ] Fail  
**Test Case 4 (Edge Case):** [ ] Pass / [ ] Fail  
**Test Case 5 (Mismatch):** [ ] Pass / [ ] Fail  
**Ready for Production:** [ ] Yes / [ ] No  

**Notes:**
_______________________________________________________
_______________________________________________________
_______________________________________________________
