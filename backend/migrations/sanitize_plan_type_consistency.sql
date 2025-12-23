-- Migration: Sanitize plan_type inconsistencies
-- Purpose: Ensure plan_type is derived correctly from plan
-- Priority: MUST RUN FIRST before any other billing migrations
-- Created: 2025-12-22

BEGIN;

-- Step 1: Fix inconsistent plan_type values
UPDATE user_plans
SET 
    plan_type = CASE 
        WHEN plan = 'free' THEN 'FREE'
        WHEN plan IN ('plus', 'pro') THEN 'PAID'
        ELSE plan_type  -- Keep existing if plan is unknown
    END,
    updated_at = now()
WHERE plan IN ('free', 'plus', 'pro')
  AND (
    (plan = 'free' AND plan_type != 'FREE')
    OR (plan IN ('plus', 'pro') AND plan_type != 'PAID')
  );

-- Step 2: Report results
DO $$
DECLARE
    v_fixed_count INT;
BEGIN
    GET DIAGNOSTICS v_fixed_count = ROW_COUNT;
    RAISE NOTICE 'Sanitized % rows with inconsistent plan_type', v_fixed_count;
END $$;

-- Step 3: Verification query
DO $$
DECLARE
    v_inconsistent_count INT;
BEGIN
    SELECT COUNT(*) INTO v_inconsistent_count
    FROM user_plans
    WHERE 
        (plan = 'free' AND plan_type != 'FREE')
        OR (plan IN ('plus', 'pro') AND plan_type != 'PAID');
    
    IF v_inconsistent_count > 0 THEN
        RAISE WARNING 'Still found % inconsistent plan_type rows after sanitization', v_inconsistent_count;
    ELSE
        RAISE NOTICE '✓ All plan_type values are consistent with plan';
    END IF;
END $$;

COMMIT;

-- Post-migration verification query (run manually)
/*
SELECT 
    plan, 
    plan_type, 
    COUNT(*) as user_count
FROM user_plans
GROUP BY plan, plan_type
ORDER BY plan;

Expected output:
plan  | plan_type | user_count
------+-----------+-----------
free  | FREE      | N
plus  | PAID      | M
pro   | PAID      | K

Any other combination = ERROR
*/
