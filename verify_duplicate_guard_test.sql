-- ═══════════════════════════════════════════════════════════════════════════════
-- VERIFICATION: Duplicate Guard Test Queries
-- PURPOSE: Verify duplicate prevention logic and find existing duplicates
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. CHECK FOR EXISTING DUPLICATES
-- ═══════════════════════════════════════════════════════════════════════════════
SELECT 
    'EXISTING DUPLICATES' as check_type,
    provider,
    provider_account_id,
    COUNT(*) as duplicate_count,
    array_agg(DISTINCT user_id) as different_users,
    array_agg(id ORDER BY created_at) as record_ids
FROM public.cloud_provider_accounts
WHERE provider = 'onedrive'
GROUP BY provider, provider_account_id
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. FIND A TEST CASE: OneDrive account with active ownership
-- ═══════════════════════════════════════════════════════════════════════════════
SELECT 
    'TEST CASE' as label,
    provider_account_id,
    user_id as current_owner,
    account_email,
    is_active,
    created_at
FROM public.cloud_provider_accounts
WHERE provider = 'onedrive'
  AND is_active = true
ORDER BY created_at DESC
LIMIT 5;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. GET USER IDS FOR TESTING (different users)
-- ═══════════════════════════════════════════════════════════════════════════════
SELECT 
    'AVAILABLE USERS' as label,
    au.id as user_id,
    au.email,
    COUNT(cpa.id) as onedrive_accounts_count
FROM auth.users au
LEFT JOIN public.cloud_provider_accounts cpa 
    ON au.id = cpa.user_id 
    AND cpa.provider = 'onedrive'
GROUP BY au.id, au.email
ORDER BY onedrive_accounts_count DESC
LIMIT 5;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. VERIFY DUPLICATE GUARD WOULD TRIGGER (simulation)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Example: If user B tries to connect OneDrive account owned by user A
-- Query that duplicate guard executes:
SELECT 
    'DUPLICATE GUARD SIMULATION' as test,
    id,
    user_id,
    provider_account_id,
    account_email,
    CASE 
        WHEN user_id = '62bf37c1-6f50-46f2-9f57-7a0b5136ed1d' THEN 'IDEMPOTENT (same user)'
        ELSE 'DUPLICATE PREVENTION (different user)'
    END as guard_action
FROM public.cloud_provider_accounts
WHERE provider = 'onedrive'
  AND provider_account_id = '62c0cfcdf8b5bc8c'  -- Replace with actual test account ID
LIMIT 1;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. COUNT TOTAL ONEDRIVE ACCOUNTS PER USER
-- ═══════════════════════════════════════════════════════════════════════════════
SELECT 
    'ONEDRIVE ACCOUNTS PER USER' as label,
    user_id,
    COUNT(*) as total_accounts,
    COUNT(*) FILTER (WHERE is_active = true) as active_accounts,
    array_agg(provider_account_id ORDER BY created_at) as account_ids
FROM public.cloud_provider_accounts
WHERE provider = 'onedrive'
GROUP BY user_id
HAVING COUNT(*) > 0
ORDER BY total_accounts DESC;
