-- ═══════════════════════════════════════════════════════════════════════════════
-- INVESTIGATION: OneDrive provider_account_id = 62c0cfcdf8b5bc8c
-- PURPOSE: Understand inconsistent behavior (sometimes transfer CTA, sometimes direct connect)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Current ownership state in cloud_provider_accounts
-- ═══════════════════════════════════════════════════════════════════════════════
SELECT 
    'cloud_provider_accounts' as table_name,
    id,
    user_id,
    provider,
    provider_account_id,
    account_email,
    is_active,
    disconnected_at,
    slot_log_id,
    created_at,
    updated_at
FROM public.cloud_provider_accounts
WHERE provider = 'onedrive' 
  AND provider_account_id = '62c0cfcdf8b5bc8c'
ORDER BY created_at DESC;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Check for duplicate records (should be UNIQUE constraint violation)
-- ═══════════════════════════════════════════════════════════════════════════════
SELECT 
    'DUPLICATE CHECK' as check_type,
    provider_account_id,
    COUNT(*) as record_count,
    array_agg(DISTINCT user_id) as different_users,
    array_agg(DISTINCT is_active) as active_states
FROM public.cloud_provider_accounts
WHERE provider = 'onedrive' 
  AND provider_account_id = '62c0cfcdf8b5bc8c'
GROUP BY provider_account_id
HAVING COUNT(*) > 1;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. Slot state in cloud_slots_log
-- ═══════════════════════════════════════════════════════════════════════════════
SELECT 
    'cloud_slots_log' as table_name,
    id,
    user_id,
    provider,
    provider_account_id,
    provider_email,
    is_active,
    disconnected_at,
    slot_number
FROM public.cloud_slots_log
WHERE provider = 'onedrive' 
  AND provider_account_id = '62c0cfcdf8b5bc8c'
ORDER BY id DESC;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. Check for orphaned slots (slot exists but no cloud_provider_account)
-- ═══════════════════════════════════════════════════════════════════════════════
SELECT 
    'ORPHAN SLOT CHECK' as check_type,
    csl.id as slot_id,
    csl.user_id as slot_user_id,
    csl.provider_account_id,
    cpa.user_id as account_user_id,
    CASE 
        WHEN cpa.user_id IS NULL THEN 'ORPHANED (no cloud_provider_account)'
        WHEN csl.user_id != cpa.user_id THEN 'MISMATCH (different user_ids)'
        ELSE 'OK'
    END as status
FROM public.cloud_slots_log csl
LEFT JOIN public.cloud_provider_accounts cpa 
    ON csl.provider = cpa.provider 
    AND csl.provider_account_id = cpa.provider_account_id
WHERE csl.provider = 'onedrive' 
  AND csl.provider_account_id = '62c0cfcdf8b5bc8c';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. Ownership transfer requests (pending or failed)
-- ═══════════════════════════════════════════════════════════════════════════════
SELECT 
    'ownership_transfer_requests' as table_name,
    id,
    provider,
    provider_account_id,
    requesting_user_id,
    existing_owner_id,
    account_email,
    status,
    created_at,
    expires_at
FROM public.ownership_transfer_requests
WHERE provider = 'onedrive' 
  AND provider_account_id = '62c0cfcdf8b5bc8c'
ORDER BY created_at DESC
LIMIT 10;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. User info (to understand who owns what)
-- ═══════════════════════════════════════════════════════════════════════════════
SELECT 
    'USERS INFO' as info_type,
    au.id as user_id,
    au.email as user_email,
    COUNT(DISTINCT cpa.id) as onedrive_accounts_count
FROM auth.users au
LEFT JOIN public.cloud_provider_accounts cpa 
    ON au.id = cpa.user_id 
    AND cpa.provider = 'onedrive'
WHERE au.id IN (
    SELECT DISTINCT user_id 
    FROM public.cloud_provider_accounts 
    WHERE provider = 'onedrive' 
      AND provider_account_id = '62c0cfcdf8b5bc8c'
    UNION
    SELECT DISTINCT user_id 
    FROM public.cloud_slots_log 
    WHERE provider = 'onedrive' 
      AND provider_account_id = '62c0cfcdf8b5bc8c'
)
GROUP BY au.id, au.email;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. Check cloud_transfer_events (ownership transfer notifications)
-- ═══════════════════════════════════════════════════════════════════════════════
SELECT 
    'cloud_transfer_events' as table_name,
    id,
    provider,
    provider_account_id,
    from_user_id,
    to_user_id,
    event_type,
    acknowledged_at,
    created_at
FROM public.cloud_transfer_events
WHERE provider = 'onedrive' 
  AND provider_account_id = '62c0cfcdf8b5bc8c'
ORDER BY created_at DESC;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 8. Check RPC function availability
-- ═══════════════════════════════════════════════════════════════════════════════
SELECT 
    'RPC CHECK' as check_type,
    proname as function_name,
    pg_get_function_arguments(oid) as arguments
FROM pg_proc
WHERE proname = 'transfer_provider_account_ownership';
