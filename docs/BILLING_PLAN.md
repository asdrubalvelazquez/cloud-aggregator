# 💳 Billing Plan Specification v1.0

## Official Plans

| Feature | FREE | PLUS ($5/mo) | PRO ($10/mo) |
|---------|------|--------------|--------------|
| **Cloud Slots** | 2 historical | 5 historical | 10 historical |
| **Copy Quota** | 20 lifetime | 1,000/month | 5,000/month |
| **Transfer Bandwidth** | 5GB lifetime | 200GB/month | 1TB/month |
| **Max File Size** | 1GB | 10GB | 50GB |
| **Priority Support** | ❌ | ✅ | ✅ |
| **API Access** | ❌ | ❌ | ✅ (future) |

## Business Rules

### FREE Plan
- **Lifetime limits:** 20 copies, 5GB transfer (never reset)
- **Slots:** 2 historical (reconnection allowed, no new accounts after 2 consumed)
- **File size:** Max 1GB per file
- **Downgrade:** Users cannot downgrade from FREE (it's base tier)
- **Source of truth:** `plan = 'free'` in database

### PAID Plans (PLUS/PRO)
- **Monthly limits:** Reset on calendar month (UTC timezone)
- **Slots:** Historical tracking (can disconnect/reconnect)
- **File size:** Enforced at copy initiation (HTTP 413 if exceeded)
- **Expiration:** On subscription end → downgrade to FREE
  - Excess slots deactivated (oldest 2 preserved)
  - Monthly counters frozen (not reset)
- **Source of truth:** `plan IN ('plus', 'pro')` in database

### plan vs plan_type
- **plan** (TEXT): `'free'`, `'plus'`, `'pro'` - **Source of Truth** for all limits
- **plan_type** (TEXT): `'FREE'` or `'PAID'` - **Derived field** for display/grouping only
- **Derivation rule:**
  - `plan = 'free'` → `plan_type = 'FREE'`
  - `plan IN ('plus', 'pro')` → `plan_type = 'PAID'`

### Add-ons (Phase 2 - Future)
- **+1 Slot:** $1/month (no limit on quantity)
- **+100GB Transfer:** $3/month (stackable)
- **One-time Top-up:** 50GB for $2 (expires in 90 days)

---

## Technical Implementation

### Database Schema

#### user_plans Table
```sql
CREATE TABLE user_plans (
    user_id UUID PRIMARY KEY,
    plan TEXT NOT NULL DEFAULT 'free',  -- Source of truth
    plan_type TEXT NOT NULL DEFAULT 'FREE',  -- Derived
    
    -- Cloud slots
    clouds_slots_total INT NOT NULL DEFAULT 2,
    clouds_slots_used INT NOT NULL DEFAULT 0,
    
    -- Copy quota
    copies_limit_month BIGINT,  -- NULL for FREE (uses lifetime)
    copies_used_month INT DEFAULT 0,
    total_lifetime_copies INT DEFAULT 0,  -- FREE only
    
    -- Transfer bandwidth (BYTES)
    transfer_bytes_limit_month BIGINT,  -- NULL for FREE
    transfer_bytes_used_month BIGINT DEFAULT 0,
    transfer_bytes_limit_lifetime BIGINT,  -- NULL for PAID
    transfer_bytes_used_lifetime BIGINT DEFAULT 0,
    
    -- File size limit (BYTES)
    max_file_bytes BIGINT NOT NULL DEFAULT 1073741824,  -- 1GB
    
    -- Billing period
    period_start TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### copy_jobs Table
```sql
CREATE TABLE copy_jobs (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    source_account_id INT NOT NULL,
    target_account_id INT NOT NULL,
    file_id TEXT NOT NULL,
    file_name TEXT,
    status TEXT NOT NULL DEFAULT 'pending',  -- pending, success, failed
    error_message TEXT,
    bytes_copied BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,  -- Only for success
    finished_at TIMESTAMPTZ    -- For both success/failed
);
```

### Limit Constants (bytes)

```python
# backend/backend/billing_plans.py
PLANS = {
    "free": {
        "clouds_slots_total": 2,
        "copies_limit_lifetime": 20,
        "transfer_bytes_limit_lifetime": 5_368_709_120,  # 5GB
        "max_file_bytes": 1_073_741_824  # 1GB
    },
    "plus": {
        "clouds_slots_total": 5,
        "copies_limit_month": 1000,
        "transfer_bytes_limit_month": 214_748_364_800,  # 200GB
        "max_file_bytes": 10_737_418_240  # 10GB
    },
    "pro": {
        "clouds_slots_total": 10,
        "copies_limit_month": 5000,
        "transfer_bytes_limit_month": 1_099_511_627_776,  # 1TB
        "max_file_bytes": 53_687_091_200  # 50GB
    }
}
```

---

## Enforcement Points

### 1. Slot Limit
**Location:** OAuth callback (`/auth/google/callback`)
**Validation:** `quota.check_cloud_limit_with_slots()`
**Error:** HTTP 402 Payment Required
**Message:** "Has usado tus N slots históricos. Actualiza a un plan PAID para conectar más cuentas."

### 2. Copy Quota
**Location:** POST `/drive/copy-file`
**Validation:** `quota.check_quota_available()`
**Error:** HTTP 402 Payment Required
**Message (FREE):** "Has alcanzado el límite de 20 copias de por vida."
**Message (PAID):** "Has alcanzado el límite de N copias este mes."

### 3. Transfer Quota
**Location:** POST `/drive/copy-file` (before copy initiation)
**Validation:** `quota.check_transfer_bytes_available()`
**Error:** HTTP 402 Payment Required
**Message (FREE):** "Has usado X.XX GB de 5GB lifetime. Este archivo requiere Y.YY GB."
**Message (PAID):** "Has usado X.XX GB de NNNMB este mes. Este archivo requiere Y.YY GB."

### 4. File Size
**Location:** POST `/drive/copy-file` (from metadata)
**Validation:** `quota.check_file_size_limit_bytes()`
**Error:** HTTP 413 Payload Too Large
**Message:** "Archivo excede NGB para tu plan."

---

## Error Codes

| Code | Error | Trigger | Plan Impact |
|------|-------|---------|-------------|
| **402** | `quota_exceeded` | Copies limit reached | FREE: lifetime, PAID: monthly |
| **402** | `transfer_quota_exceeded` | Transfer bandwidth exhausted | FREE: lifetime, PAID: monthly |
| **402** | `cloud_limit_reached` | Slots consumed | Both |
| **413** | `file_too_large` | File > max_file_bytes | Both |
| **429** | `rate_limit_exceeded` | Too many requests | Both |

---

## Migration Path

### Existing Users (Pre-Billing)
1. All existing users → FREE plan
2. Backfill limits based on `plan` field (source of truth)
3. `transfer_bytes_used_lifetime` starts at 0 (no historical data)
4. `total_lifetime_copies` starts at 0 (reset counter)

### Sanitization
Run `sanitize_plan_type_consistency.sql` to ensure:
- `plan = 'free'` → `plan_type = 'FREE'`
- `plan IN ('plus', 'pro')` → `plan_type = 'PAID'`

### Upgrade Flow (Future - Stripe)
1. User clicks "Upgrade" → Stripe Checkout
2. Webhook `checkout.session.completed` → Update `user_plans`
3. Set `period_start` = now (calendar month start)
4. Populate monthly limits from `billing_plans.PLANS`

### Downgrade Flow (Future - Cronjob)
1. Subscription expires → Detect via `plan_type = 'PAID'` and period_start old
2. Update plan to 'free'
3. Carry over `transfer_bytes_used_month` → `transfer_bytes_used_lifetime`
4. Deactivate excess slots (keep oldest 2)

---

## Reset Logic

### Monthly Reset (PAID only)
**Trigger:** `get_or_create_user_plan()` detects `period_start.month != now.month`
**Action:**
- `copies_used_month` = 0
- `transfer_bytes_used_month` = 0
- `period_start` = now (calendar month start)

**Code:**
```python
if plan_name in ("plus", "pro"):
    if period_start.month != now.month or period_start.year != now.year:
        supabase.table("user_plans").update({
            "copies_used_month": 0,
            "transfer_bytes_used_month": 0,
            "period_start": now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
        }).eq("user_id", user_id).execute()
```

### Lifetime Counters (FREE only)
**Never reset:** `total_lifetime_copies`, `transfer_bytes_used_lifetime`

---

## RPC Function: Atomic Quota Increment

### complete_copy_job_success_and_increment_usage()
**Purpose:** Atomically update job status and increment quota counters
**Security:** Verifies `auth.uid() = p_user_id` (SECURITY DEFINER)
**Idempotency:** Safe to call multiple times (detects already-completed jobs)

**Logic:**
1. UPDATE copy_jobs SET status='success' WHERE status='pending'
2. If 0 rows updated → Already completed (idempotent skip)
3. Determine plan: `SELECT plan FROM user_plans`
4. If `plan = 'free'` → Increment `total_lifetime_copies` + `transfer_bytes_used_lifetime`
5. If `plan IN ('plus', 'pro')` → Increment `copies_used_month` + `transfer_bytes_used_month`

**Fallback:** Creates FREE plan if missing (avoid breaking copies)

---

## FAQs

**Q: What happens if I exceed 5GB lifetime on FREE?**
A: All copy operations blocked with HTTP 402. Must upgrade to PLUS/PRO.

**Q: Can I reconnect a disconnected cloud on FREE after reaching 2 slots?**
A: Yes! Historical slots allow unlimited reconnections of previous accounts.

**Q: What if my monthly transfer resets mid-copy?**
A: Copy continues (atomic operation). Next copy validates new month limit.

**Q: Does file size count toward transfer quota?**
A: Yes. `bytes_copied` from each job increments `transfer_bytes_used_*`.

**Q: What happens on downgrade from PAID to FREE?**
A: Monthly usage carries over to lifetime. If already > 5GB, immediately blocked.

---

## Verification Queries

```sql
-- Check all users have correct limits by plan
SELECT 
    plan,
    plan_type,
    COUNT(*) as users,
    MAX(transfer_bytes_limit_lifetime) as max_lifetime_bytes,
    MAX(transfer_bytes_limit_month) as max_monthly_bytes
FROM user_plans
GROUP BY plan, plan_type;

-- Verify FREE users use ONLY lifetime counters
SELECT user_id, plan
FROM user_plans
WHERE plan = 'free'
  AND (copies_limit_month IS NOT NULL 
       OR transfer_bytes_limit_month IS NOT NULL);
-- Expected: 0 rows

-- Verify PAID users use ONLY monthly counters
SELECT user_id, plan
FROM user_plans
WHERE plan IN ('plus', 'pro')
  AND (transfer_bytes_limit_lifetime IS NOT NULL);
-- Expected: 0 rows
```

---

## Next Steps (Phase 2 - Stripe)

1. **Stripe Integration**
   - Checkout session creation
   - Webhooks: `checkout.session.completed`, `invoice.payment_succeeded`
   - Update `user_plans` on payment events

2. **Cronjob: Downgrade Expired Plans**
   - Run hourly
   - Detect `plan_type='PAID'` with old `period_start`
   - Downgrade to FREE + deactivate excess slots

3. **Add-ons**
   - Extra slots: `clouds_slots_total += 1` per add-on
   - Transfer top-ups: Temporary increase to limits

4. **Analytics**
   - Transfer bandwidth usage trends
   - Plan conversion metrics
   - Quota exhaustion alerts

---

**Version:** 1.0
**Last Updated:** 2025-12-22
**Status:** Production Ready (without Stripe)
