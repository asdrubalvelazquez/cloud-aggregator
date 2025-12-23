-- ========================================
-- RESET SINGLE USER - Cloud Aggregator
-- ========================================
-- Purpose: Reset a specific user to "fresh" state for testing
-- Author: DevOps Team
-- Created: 2025-12-22
-- Environment: Development/Staging/Production (safe for all)
--
-- WHAT THIS DOES:
-- - Deletes all cloud_accounts for the user (connections removed)
-- - Deletes all cloud_slots_log for the user (historical slots cleared)
-- - Resets user_plans (will regenerate with FREE defaults on next login)
-- - Deletes all copy_jobs for the user (copy history cleared)
--
-- WHAT THIS DOES NOT DO:
-- - Does NOT delete the user from auth.users (user account remains)
-- - Does NOT affect other users
--
-- USAGE:
-- 1. Get your test user_id from Supabase Dashboard:
--    SELECT id, email FROM auth.users WHERE email = 'your-test-email@gmail.com';
--
-- 2. Copy the UUID from step 1
--
-- 3. Replace 'YOUR_USER_ID_HERE' below with the actual UUID
--
-- 4. Open Supabase Dashboard → SQL Editor
--
-- 5. Paste this entire script (with your user_id)
--
-- 6. Click "Run"
--
-- 7. Verify user is reset (see verification queries at bottom)
-- ========================================

-- ⚠️ REPLACE THIS WITH YOUR TEST USER ID ⚠️
-- Example: '62bf37c1-6f50-46f2-9f57-7a0b5136ed1d'
-- En Supabase SQL Editor, ejecuta: SELECT id, email FROM auth.users WHERE email = 'tu-email-test@gmail.com';

DO $$
DECLARE
    v_target_user_id UUID := 'YOUR_USER_ID_HERE';  -- ← CHANGE THIS!
    
    v_email TEXT;
    v_accounts_deleted INT := 0;
    v_slots_deleted INT := 0;
    v_plans_deleted INT := 0;
    v_jobs_deleted INT := 0;
BEGIN
    -- ========================================
    -- STEP 0: Validate user exists
    -- ========================================
    RAISE NOTICE '========================================';
    RAISE NOTICE 'RESET SINGLE USER - Starting';
    RAISE NOTICE 'Target user_id: %', v_target_user_id;
    RAISE NOTICE 'Timestamp: %', NOW();
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    
    -- Check if user exists in auth.users
    SELECT email INTO v_email
    FROM auth.users
    WHERE id = v_target_user_id;
    
    IF v_email IS NULL THEN
        RAISE EXCEPTION 'ERROR: User ID % not found in auth.users. Check the UUID and try again.', v_target_user_id;
    END IF;
    
    RAISE NOTICE 'User found: % (email: %)', v_target_user_id, v_email;
    RAISE NOTICE 'Proceeding with reset...';
    RAISE NOTICE '';
    
    -- ========================================
    -- STEP 1: Delete cloud_accounts
    -- ========================================
    RAISE NOTICE '--- STEP 1: Deleting cloud_accounts ---';
    
    DELETE FROM cloud_accounts
    WHERE user_id = v_target_user_id
    RETURNING * INTO v_accounts_deleted;
    
    GET DIAGNOSTICS v_accounts_deleted = ROW_COUNT;
    RAISE NOTICE '✓ Deleted % cloud_accounts', v_accounts_deleted;
    
    -- ========================================
    -- STEP 2: Delete cloud_slots_log
    -- ========================================
    RAISE NOTICE '';
    RAISE NOTICE '--- STEP 2: Deleting cloud_slots_log ---';
    
    DELETE FROM cloud_slots_log
    WHERE user_id = v_target_user_id;
    
    GET DIAGNOSTICS v_slots_deleted = ROW_COUNT;
    RAISE NOTICE '✓ Deleted % cloud_slots_log entries', v_slots_deleted;
    
    -- ========================================
    -- STEP 3: Delete user_plans (will regenerate)
    -- ========================================
    RAISE NOTICE '';
    RAISE NOTICE '--- STEP 3: Deleting user_plans ---';
    
    DELETE FROM user_plans
    WHERE user_id = v_target_user_id;
    
    GET DIAGNOSTICS v_plans_deleted = ROW_COUNT;
    RAISE NOTICE '✓ Deleted % user_plans entries', v_plans_deleted;
    RAISE NOTICE 'ℹ user_plans will regenerate with FREE defaults on next login';
    
    -- ========================================
    -- STEP 4: Delete copy_jobs (if exists)
    -- ========================================
    RAISE NOTICE '';
    RAISE NOTICE '--- STEP 4: Deleting copy_jobs ---';
    
    IF EXISTS (SELECT FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = 'copy_jobs') THEN
        DELETE FROM copy_jobs
        WHERE user_id = v_target_user_id;
        
        GET DIAGNOSTICS v_jobs_deleted = ROW_COUNT;
        RAISE NOTICE '✓ Deleted % copy_jobs entries', v_jobs_deleted;
    ELSE
        RAISE NOTICE '⊘ copy_jobs table not found (skipping)';
    END IF;
    
    -- ========================================
    -- STEP 5: Summary
    -- ========================================
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'RESET COMPLETE - Summary';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'User: % (%)', v_email, v_target_user_id;
    RAISE NOTICE '';
    RAISE NOTICE 'Deleted:';
    RAISE NOTICE '  - cloud_accounts: %', v_accounts_deleted;
    RAISE NOTICE '  - cloud_slots_log: %', v_slots_deleted;
    RAISE NOTICE '  - user_plans: %', v_plans_deleted;
    RAISE NOTICE '  - copy_jobs: %', v_jobs_deleted;
    RAISE NOTICE '';
    RAISE NOTICE '✅ User is now FRESH (0 connections, 0 slots)';
    RAISE NOTICE '✅ User can login and will get FREE plan defaults';
    RAISE NOTICE '✅ auth.users entry INTACT (user account preserved)';
    RAISE NOTICE '========================================';
    
END $$;

-- ========================================
-- VERIFICATION QUERIES
-- ========================================
-- Run these AFTER the reset to verify user is clean:

/*
-- 1. Check user still exists in auth.users (should return 1 row)
SELECT id, email, created_at
FROM auth.users
WHERE id = 'YOUR_USER_ID_HERE';  -- Replace with your user_id

-- 2. Check cloud_accounts (should return 0 rows)
SELECT COUNT(*) AS accounts_remaining
FROM cloud_accounts
WHERE user_id = 'YOUR_USER_ID_HERE';

-- 3. Check cloud_slots_log (should return 0 rows)
SELECT COUNT(*) AS slots_remaining
FROM cloud_slots_log
WHERE user_id = 'YOUR_USER_ID_HERE';

-- 4. Check user_plans (should return 0 rows - will regenerate on next login)
SELECT COUNT(*) AS plans_remaining
FROM user_plans
WHERE user_id = 'YOUR_USER_ID_HERE';

-- 5. Check copy_jobs (should return 0 rows)
SELECT COUNT(*) AS jobs_remaining
FROM copy_jobs
WHERE user_id = 'YOUR_USER_ID_HERE';
*/

-- Expected results:
-- - auth.users: 1 row (user account exists)
-- - cloud_accounts: 0 rows
-- - cloud_slots_log: 0 rows
-- - user_plans: 0 rows (will regenerate)
-- - copy_jobs: 0 rows

-- ========================================
-- QUICK REFERENCE
-- ========================================
-- To get your test user_id:
-- SELECT id, email FROM auth.users WHERE email = 'your-email@gmail.com';

-- To reset multiple users, run this script multiple times with different user_ids.

-- To reset ALL users (DANGEROUS - only for dev/staging):
-- Use backend/migrations/RESET_ALL_TEST_DATA.sql instead
