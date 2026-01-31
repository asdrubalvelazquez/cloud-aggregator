-- Migration: Add billing_period column to user_plans
-- Purpose: Support monthly/yearly billing frequency for new pricing structure
-- Date: 2025
-- Safe: Includes rollback script and idempotency checks

-- ============================================
-- FORWARD MIGRATION
-- ============================================

-- Check if column already exists (idempotency)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'user_plans' 
        AND column_name = 'billing_period'
    ) THEN
        -- Add billing_period column
        ALTER TABLE user_plans 
        ADD COLUMN billing_period TEXT DEFAULT 'MONTHLY' CHECK (billing_period IN ('MONTHLY', 'YEARLY'));
        
        RAISE NOTICE 'Added billing_period column to user_plans';
    ELSE
        RAISE NOTICE 'billing_period column already exists, skipping';
    END IF;
END $$;

-- Update existing legacy plans to MONTHLY
UPDATE user_plans 
SET billing_period = 'MONTHLY'
WHERE plan IN ('plus', 'pro', 'free')
AND billing_period IS NULL;

-- Update new plans based on plan name
UPDATE user_plans
SET billing_period = CASE
    WHEN plan LIKE '%_monthly' THEN 'MONTHLY'
    WHEN plan LIKE '%_yearly' THEN 'YEARLY'
    ELSE 'MONTHLY'
END
WHERE billing_period IS NULL;

-- Add index for performance (optional but recommended)
CREATE INDEX IF NOT EXISTS idx_user_plans_billing_period 
ON user_plans(billing_period);

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Verify column was added
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'user_plans' 
AND column_name = 'billing_period';

-- Verify data distribution
SELECT billing_period, COUNT(*) as count
FROM user_plans
GROUP BY billing_period
ORDER BY count DESC;

-- Verify constraint is working
SELECT conname, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conrelid = 'user_plans'::regclass 
AND conname LIKE '%billing_period%';

-- ============================================
-- ROLLBACK SCRIPT (if needed)
-- ============================================

-- To rollback this migration, run:
-- ALTER TABLE user_plans DROP COLUMN IF EXISTS billing_period;
-- DROP INDEX IF EXISTS idx_user_plans_billing_period;
