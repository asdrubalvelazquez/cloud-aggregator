-- ========================================
-- BACKFILL SLOT_LOG_ID - Cloud Aggregator
-- ========================================
-- Purpose: Fix "infinite connections" bug by ensuring ALL cloud_accounts have slot_log_id
-- Author: DevOps Team
-- Created: 2025-12-22
-- Priority: CRITICAL (prevents unlimited connections)
--
-- ROOT CAUSE:
-- - cloud_accounts with slot_log_id = NULL (legacy) are NOT counted by slots system
-- - This allows users to connect unlimited accounts bypassing the FREE 2-slot limit
--
-- FIX:
-- 1. Create unique index on cloud_slots_log(user_id, provider, provider_account_id)
-- 2. Backfill: For each cloud_accounts with slot_log_id = NULL:
--    a) Create (if not exists) a slot in cloud_slots_log
--    b) Update cloud_accounts.slot_log_id with the slot id
-- 3. Idempotent: Safe to run multiple times (uses ON CONFLICT)
--
-- DOES NOT:
-- - Touch auth.users
-- - Delete any data
-- - Change existing slots (only creates missing ones)
--
-- USAGE:
-- 1. Open Supabase Dashboard → SQL Editor
-- 2. Paste this entire script
-- 3. Click "Run" (executes in a transaction)
-- 4. Verify all cloud_accounts have slot_log_id NOT NULL
-- ========================================

DO $$
DECLARE
    v_orphan_accounts_count INT := 0;
    v_slots_created INT := 0;
    v_accounts_updated INT := 0;
    v_orphan_remaining INT := 0;
    
    r_account RECORD;
    v_slot_id UUID;
    v_slot_number INT;
    v_max_slot INT;
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'BACKFILL SLOT_LOG_ID - Starting';
    RAISE NOTICE 'Timestamp: %', NOW();
    RAISE NOTICE '========================================';
    
    -- ========================================
    -- STEP 1: Create unique index (idempotent)
    -- ========================================
    RAISE NOTICE '';
    RAISE NOTICE '--- STEP 1: Creating unique index ---';
    
    -- Check if index already exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE schemaname = 'public' 
        AND tablename = 'cloud_slots_log' 
        AND indexname = 'idx_cloud_slots_log_unique_account'
    ) THEN
        -- Create unique index to prevent duplicate slots
        -- This enforces: one slot per (user_id, provider, provider_account_id) tuple
        CREATE UNIQUE INDEX idx_cloud_slots_log_unique_account 
            ON cloud_slots_log(user_id, provider, provider_account_id);
        RAISE NOTICE '✓ Created unique index: idx_cloud_slots_log_unique_account';
    ELSE
        RAISE NOTICE '⊘ Unique index already exists (skipping)';
    END IF;
    
    -- ========================================
    -- STEP 2: Count orphan accounts (slot_log_id NULL)
    -- ========================================
    RAISE NOTICE '';
    RAISE NOTICE '--- STEP 2: Pre-check orphan accounts ---';
    
    SELECT COUNT(*) INTO v_orphan_accounts_count
    FROM cloud_accounts
    WHERE slot_log_id IS NULL;
    
    RAISE NOTICE 'Orphan accounts (slot_log_id = NULL): %', v_orphan_accounts_count;
    
    IF v_orphan_accounts_count = 0 THEN
        RAISE NOTICE '✓ No orphan accounts found. Database is healthy!';
        RAISE NOTICE '========================================';
        RAISE NOTICE 'BACKFILL COMPLETE (nothing to do)';
        RAISE NOTICE '========================================';
        RETURN;
    END IF;
    
    -- ========================================
    -- STEP 3: Backfill orphan accounts
    -- ========================================
    RAISE NOTICE '';
    RAISE NOTICE '--- STEP 3: Backfilling orphan accounts ---';
    RAISE NOTICE 'Processing % accounts...', v_orphan_accounts_count;
    
    -- Loop through all cloud_accounts with slot_log_id = NULL
    FOR r_account IN 
        SELECT 
            id,
            user_id,
            google_account_id,
            account_email,
            is_active,
            disconnected_at,
            created_at
        FROM cloud_accounts
        WHERE slot_log_id IS NULL
        ORDER BY created_at ASC  -- Process oldest first
    LOOP
        RAISE NOTICE '';
        RAISE NOTICE '→ Processing account: id=%, email=%', r_account.id, r_account.account_email;
        
        -- Get next slot number for this user
        SELECT COALESCE(MAX(slot_number), 0) + 1 INTO v_slot_number
        FROM cloud_slots_log
        WHERE user_id = r_account.user_id;
        
        -- Insert or get existing slot (idempotent with ON CONFLICT)
        INSERT INTO cloud_slots_log (
            user_id,
            provider,
            provider_account_id,
            provider_email,
            slot_number,
            plan_at_connection,
            connected_at,
            is_active,
            disconnected_at,
            slot_expires_at
        ) VALUES (
            r_account.user_id,
            'google_drive',  -- Hardcoded for now (only provider supported)
            r_account.google_account_id,
            r_account.account_email,
            v_slot_number,
            'free',  -- Default to FREE (will be corrected by user_plans logic)
            r_account.created_at,  -- Use original connection date
            r_account.is_active,
            r_account.disconnected_at,
            NULL  -- FREE slots never expire
        )
        ON CONFLICT (user_id, provider, provider_account_id) DO NOTHING
        RETURNING id INTO v_slot_id;
        
        -- If ON CONFLICT triggered, get existing slot_id
        IF v_slot_id IS NULL THEN
            SELECT id INTO v_slot_id
            FROM cloud_slots_log
            WHERE user_id = r_account.user_id
              AND provider = 'google_drive'
              AND provider_account_id = r_account.google_account_id;
            
            RAISE NOTICE '  ⊘ Slot already exists (slot_id=%)', v_slot_id;
        ELSE
            v_slots_created := v_slots_created + 1;
            RAISE NOTICE '  ✓ Created new slot (slot_id=%, slot_number=%)', v_slot_id, v_slot_number;
        END IF;
        
        -- Update cloud_accounts.slot_log_id
        UPDATE cloud_accounts
        SET slot_log_id = v_slot_id
        WHERE id = r_account.id;
        
        v_accounts_updated := v_accounts_updated + 1;
        RAISE NOTICE '  ✓ Updated cloud_accounts.slot_log_id (account_id=%)', r_account.id;
    END LOOP;
    
    -- ========================================
    -- STEP 4: Sync user_plans.clouds_slots_used
    -- ========================================
    RAISE NOTICE '';
    RAISE NOTICE '--- STEP 4: Syncing user_plans counters ---';
    
    -- Update clouds_slots_used for each user based on actual slot count
    UPDATE user_plans
    SET clouds_slots_used = (
        SELECT COUNT(DISTINCT provider_account_id)
        FROM cloud_slots_log
        WHERE cloud_slots_log.user_id = user_plans.user_id
    ),
    updated_at = NOW()
    WHERE user_id IN (
        SELECT DISTINCT user_id FROM cloud_accounts WHERE slot_log_id IS NOT NULL
    );
    
    RAISE NOTICE '✓ Synced user_plans.clouds_slots_used counters';
    
    -- ========================================
    -- STEP 5: Post-check verification
    -- ========================================
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'POST-CHECK: Verifying backfill...';
    RAISE NOTICE '========================================';
    
    SELECT COUNT(*) INTO v_orphan_remaining
    FROM cloud_accounts
    WHERE slot_log_id IS NULL;
    
    RAISE NOTICE '';
    RAISE NOTICE '--- Results ---';
    RAISE NOTICE 'Orphan accounts before: %', v_orphan_accounts_count;
    RAISE NOTICE 'New slots created: %', v_slots_created;
    RAISE NOTICE 'Accounts updated: %', v_accounts_updated;
    RAISE NOTICE 'Orphan accounts remaining: %', v_orphan_remaining;
    RAISE NOTICE '';
    
    IF v_orphan_remaining = 0 THEN
        RAISE NOTICE '✅ SUCCESS: All cloud_accounts now have slot_log_id';
        RAISE NOTICE '✅ Infinite connections bug is FIXED';
    ELSE
        RAISE WARNING '⚠ WARNING: % orphan accounts still remain (unexpected)', v_orphan_remaining;
        RAISE WARNING 'Manual investigation required';
    END IF;
    
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'BACKFILL COMPLETE';
    RAISE NOTICE '========================================';
    
END $$;

-- ========================================
-- VERIFICATION QUERY (optional)
-- ========================================
-- Run this after the backfill to double-check:
/*
-- 1. Check for orphan accounts (should be 0)
SELECT 
    'Orphan accounts (slot_log_id = NULL)' AS check_name,
    COUNT(*) AS count
FROM cloud_accounts
WHERE slot_log_id IS NULL

UNION ALL

-- 2. Check total accounts vs total slots (should match)
SELECT 
    'Total cloud_accounts' AS check_name,
    COUNT(*) AS count
FROM cloud_accounts

UNION ALL

SELECT 
    'Total cloud_slots_log' AS check_name,
    COUNT(*) AS count
FROM cloud_slots_log

UNION ALL

-- 3. Check user_plans counters are correct
SELECT 
    'user_plans.clouds_slots_used SUM' AS check_name,
    SUM(clouds_slots_used) AS count
FROM user_plans;
*/

-- Expected result: 
-- - Orphan accounts = 0
-- - Total accounts ≈ Total slots (may differ if some accounts share slots via reconnection)
-- - user_plans counters should match actual slot counts
