-- Migration: Backfill billing limits for existing users
-- Created: 2025-12-22
-- Updated: v2.1 - Use 'plan' as source of truth (not plan_type)
-- Priority: Run AFTER add_transfer_bytes_tracking.sql

BEGIN;

-- Step 1: Populate limits based on 'plan' field (source of truth)
UPDATE user_plans
SET 
    -- Transfer limits (bytes)
    transfer_bytes_limit_lifetime = CASE 
        WHEN plan = 'free' THEN 5368709120::BIGINT  -- 5GB
        ELSE NULL
    END,
    transfer_bytes_limit_month = CASE 
        WHEN plan = 'plus' THEN 214748364800::BIGINT  -- 200GB
        WHEN plan = 'pro' THEN 1099511627776::BIGINT  -- 1TB
        ELSE NULL
    END,
    
    -- File size limits (bytes)
    max_file_bytes = CASE 
        WHEN plan = 'free' THEN 1073741824::BIGINT  -- 1GB
        WHEN plan = 'plus' THEN 10737418240::BIGINT  -- 10GB
        WHEN plan = 'pro' THEN 53687091200::BIGINT   -- 50GB
        ELSE 1073741824::BIGINT  -- Default 1GB for unknown plans
    END,
    
    -- Copy limits
    copies_limit_month = CASE 
        WHEN plan = 'plus' THEN 1000
        WHEN plan = 'pro' THEN 5000
        ELSE NULL  -- FREE uses total_lifetime_copies
    END,
    
    -- Ensure total_lifetime_copies exists for FREE
    total_lifetime_copies = CASE
        WHEN plan = 'free' AND total_lifetime_copies IS NULL THEN 0
        ELSE total_lifetime_copies
    END,
    
    updated_at = now()
WHERE 
    plan IN ('free', 'plus', 'pro')
    AND (
        transfer_bytes_limit_lifetime IS NULL 
        OR transfer_bytes_limit_month IS NULL 
        OR max_file_bytes IS NULL
    );

-- Step 2: Report results
DO $$
DECLARE
    v_updated_count INT;
BEGIN
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    RAISE NOTICE 'Backfilled % user plans with billing limits', v_updated_count;
END $$;

-- Step 3: Verification - All plans should have appropriate limits
DO $$
DECLARE
    v_free_missing INT;
    v_paid_missing INT;
BEGIN
    -- Check FREE plans have lifetime limits
    SELECT COUNT(*) INTO v_free_missing
    FROM user_plans
    WHERE plan = 'free'
      AND (transfer_bytes_limit_lifetime IS NULL OR total_lifetime_copies IS NULL);
    
    IF v_free_missing > 0 THEN
        RAISE WARNING 'Found % FREE plans missing lifetime limits', v_free_missing;
    END IF;
    
    -- Check PAID plans have monthly limits
    SELECT COUNT(*) INTO v_paid_missing
    FROM user_plans
    WHERE plan IN ('plus', 'pro')
      AND (transfer_bytes_limit_month IS NULL OR copies_limit_month IS NULL);
    
    IF v_paid_missing > 0 THEN
        RAISE WARNING 'Found % PAID plans missing monthly limits', v_paid_missing;
    END IF;
    
    IF v_free_missing = 0 AND v_paid_missing = 0 THEN
        RAISE NOTICE '✓ All plans have appropriate limits configured';
    END IF;
END $$;

COMMIT;

-- Post-migration verification query (run manually)
/*
-- Verify limits by plan
SELECT 
    plan,
    plan_type,
    COUNT(*) as user_count,
    MAX(transfer_bytes_limit_lifetime) as max_lifetime_limit,
    MAX(transfer_bytes_limit_month) as max_monthly_limit,
    MAX(max_file_bytes) as max_file_limit,
    MAX(copies_limit_month) as max_copies_month
FROM user_plans
GROUP BY plan, plan_type
ORDER BY plan;

Expected output:
plan  | plan_type | user_count | max_lifetime_limit | max_monthly_limit  | max_file_limit | max_copies_month
------+-----------+------------+--------------------+--------------------+----------------+-----------------
free  | FREE      | N          | 5368709120         | NULL               | 1073741824     | NULL
plus  | PAID      | M          | NULL               | 214748364800       | 10737418240    | 1000
pro   | PAID      | K          | NULL               | 1099511627776      | 53687091200    | 5000
*/
