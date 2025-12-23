-- ========================================
-- RESET ALL TEST DATA - Cloud Aggregator
-- ========================================
-- Purpose: Delete ALL cloud connections and history to reset users to "new" state
-- Author: DevOps Team
-- Created: 2025-12-22
-- Environment: Development/Staging ONLY (DO NOT run in production)
--
-- WARNING: This script will DELETE ALL data from:
-- - cloud_accounts (all connections)
-- - cloud_slots_log (all historical slots)
-- - user_plans (will be regenerated with defaults)
-- - copy_jobs (copy history)
--
-- DOES NOT DELETE:
-- - auth.users (user accounts remain intact)
--
-- USAGE:
-- 1. Open Supabase Dashboard → SQL Editor
-- 2. Paste this entire script
-- 3. Click "Run" (executes in a transaction)
-- 4. Verify post-check shows 0 rows for all tables
-- ========================================

DO $$
DECLARE
    v_cloud_accounts_before INT := 0;
    v_cloud_slots_log_before INT := 0;
    v_user_plans_before INT := 0;
    v_copy_jobs_before INT := 0;
    
    v_cloud_accounts_after INT := 0;
    v_cloud_slots_log_after INT := 0;
    v_user_plans_after INT := 0;
    v_copy_jobs_after INT := 0;
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'RESET ALL TEST DATA - Starting';
    RAISE NOTICE 'Timestamp: %', NOW();
    RAISE NOTICE '========================================';
    
    -- ========================================
    -- PRE-CHECK: Count rows BEFORE deletion
    -- ========================================
    RAISE NOTICE '';
    RAISE NOTICE '--- PRE-CHECK: Current row counts ---';
    
    -- Count cloud_accounts (if exists)
    IF EXISTS (SELECT FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = 'cloud_accounts') THEN
        SELECT COUNT(*) INTO v_cloud_accounts_before FROM cloud_accounts;
        RAISE NOTICE 'cloud_accounts: % rows', v_cloud_accounts_before;
    ELSE
        RAISE NOTICE 'cloud_accounts: TABLE NOT FOUND (skipping)';
    END IF;
    
    -- Count cloud_slots_log (if exists)
    IF EXISTS (SELECT FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = 'cloud_slots_log') THEN
        SELECT COUNT(*) INTO v_cloud_slots_log_before FROM cloud_slots_log;
        RAISE NOTICE 'cloud_slots_log: % rows', v_cloud_slots_log_before;
    ELSE
        RAISE NOTICE 'cloud_slots_log: TABLE NOT FOUND (skipping)';
    END IF;
    
    -- Count user_plans (if exists)
    IF EXISTS (SELECT FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = 'user_plans') THEN
        SELECT COUNT(*) INTO v_user_plans_before FROM user_plans;
        RAISE NOTICE 'user_plans: % rows', v_user_plans_before;
    ELSE
        RAISE NOTICE 'user_plans: TABLE NOT FOUND (skipping)';
    END IF;
    
    -- Count copy_jobs (if exists)
    IF EXISTS (SELECT FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = 'copy_jobs') THEN
        SELECT COUNT(*) INTO v_copy_jobs_before FROM copy_jobs;
        RAISE NOTICE 'copy_jobs: % rows', v_copy_jobs_before;
    ELSE
        RAISE NOTICE 'copy_jobs: TABLE NOT FOUND (skipping)';
    END IF;
    
    RAISE NOTICE '';
    RAISE NOTICE '--- TOTAL ROWS BEFORE: % ---', (v_cloud_accounts_before + v_cloud_slots_log_before + v_user_plans_before + v_copy_jobs_before);
    
    -- ========================================
    -- APPLY: Delete data in correct order
    -- ========================================
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'APPLY: Deleting data...';
    RAISE NOTICE '========================================';
    
    -- Delete copy_jobs first (no foreign keys to other tables)
    IF EXISTS (SELECT FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = 'copy_jobs') THEN
        DELETE FROM copy_jobs;
        RAISE NOTICE '✓ Deleted all rows from copy_jobs';
    ELSE
        RAISE NOTICE '⊘ Skipped copy_jobs (table not found)';
    END IF;
    
    -- Delete cloud_accounts (has potential references in copy_jobs via account_id, but we deleted those first)
    IF EXISTS (SELECT FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = 'cloud_accounts') THEN
        DELETE FROM cloud_accounts;
        RAISE NOTICE '✓ Deleted all rows from cloud_accounts';
    ELSE
        RAISE NOTICE '⊘ Skipped cloud_accounts (table not found)';
    END IF;
    
    -- Delete cloud_slots_log (no foreign keys from other tables)
    IF EXISTS (SELECT FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = 'cloud_slots_log') THEN
        DELETE FROM cloud_slots_log;
        RAISE NOTICE '✓ Deleted all rows from cloud_slots_log';
    ELSE
        RAISE NOTICE '⊘ Skipped cloud_slots_log (table not found)';
    END IF;
    
    -- Delete user_plans (will be regenerated on next user action)
    IF EXISTS (SELECT FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = 'user_plans') THEN
        DELETE FROM user_plans;
        RAISE NOTICE '✓ Deleted all rows from user_plans';
    ELSE
        RAISE NOTICE '⊘ Skipped user_plans (table not found)';
    END IF;
    
    -- ========================================
    -- POST-CHECK: Verify all tables are empty
    -- ========================================
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'POST-CHECK: Verifying deletion...';
    RAISE NOTICE '========================================';
    
    -- Count cloud_accounts (if exists)
    IF EXISTS (SELECT FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = 'cloud_accounts') THEN
        SELECT COUNT(*) INTO v_cloud_accounts_after FROM cloud_accounts;
        IF v_cloud_accounts_after = 0 THEN
            RAISE NOTICE '✓ cloud_accounts: 0 rows (SUCCESS)';
        ELSE
            RAISE WARNING '⚠ cloud_accounts: % rows remaining (UNEXPECTED)', v_cloud_accounts_after;
        END IF;
    END IF;
    
    -- Count cloud_slots_log (if exists)
    IF EXISTS (SELECT FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = 'cloud_slots_log') THEN
        SELECT COUNT(*) INTO v_cloud_slots_log_after FROM cloud_slots_log;
        IF v_cloud_slots_log_after = 0 THEN
            RAISE NOTICE '✓ cloud_slots_log: 0 rows (SUCCESS)';
        ELSE
            RAISE WARNING '⚠ cloud_slots_log: % rows remaining (UNEXPECTED)', v_cloud_slots_log_after;
        END IF;
    END IF;
    
    -- Count user_plans (if exists)
    IF EXISTS (SELECT FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = 'user_plans') THEN
        SELECT COUNT(*) INTO v_user_plans_after FROM user_plans;
        IF v_user_plans_after = 0 THEN
            RAISE NOTICE '✓ user_plans: 0 rows (SUCCESS)';
        ELSE
            RAISE WARNING '⚠ user_plans: % rows remaining (UNEXPECTED)', v_user_plans_after;
        END IF;
    END IF;
    
    -- Count copy_jobs (if exists)
    IF EXISTS (SELECT FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = 'copy_jobs') THEN
        SELECT COUNT(*) INTO v_copy_jobs_after FROM copy_jobs;
        IF v_copy_jobs_after = 0 THEN
            RAISE NOTICE '✓ copy_jobs: 0 rows (SUCCESS)';
        ELSE
            RAISE WARNING '⚠ copy_jobs: % rows remaining (UNEXPECTED)', v_copy_jobs_after;
        END IF;
    END IF;
    
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'RESET COMPLETE';
    RAISE NOTICE 'Total rows deleted: %', (v_cloud_accounts_before + v_cloud_slots_log_before + v_user_plans_before + v_copy_jobs_before);
    RAISE NOTICE 'Users in auth.users: UNTOUCHED (as intended)';
    RAISE NOTICE 'All users now appear as NEW (no cloud history)';
    RAISE NOTICE '========================================';
    
END $$;

-- ========================================
-- VERIFICATION QUERY (optional)
-- ========================================
-- Run this after the reset to double-check:
/*
SELECT 
    'cloud_accounts' AS table_name, 
    COUNT(*) AS row_count 
FROM cloud_accounts
UNION ALL
SELECT 
    'cloud_slots_log', 
    COUNT(*) 
FROM cloud_slots_log
UNION ALL
SELECT 
    'user_plans', 
    COUNT(*) 
FROM user_plans
UNION ALL
SELECT 
    'copy_jobs', 
    COUNT(*) 
FROM copy_jobs
ORDER BY table_name;
*/

-- Expected result: All tables should show 0 rows
