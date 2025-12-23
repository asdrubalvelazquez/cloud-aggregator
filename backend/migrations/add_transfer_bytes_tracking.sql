-- Migration: Add transfer bandwidth tracking in BYTES
-- Created: 2025-12-22
-- Updated: v2.1 - Use 'plan' as source of truth (not plan_type)

BEGIN;

-- Add transfer bandwidth columns (BIGINT for precision)
ALTER TABLE user_plans
ADD COLUMN IF NOT EXISTS transfer_bytes_limit_month BIGINT,
ADD COLUMN IF NOT EXISTS transfer_bytes_used_month BIGINT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS transfer_bytes_limit_lifetime BIGINT,
ADD COLUMN IF NOT EXISTS transfer_bytes_used_lifetime BIGINT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS max_file_bytes BIGINT NOT NULL DEFAULT 1073741824;

-- Allow copies_limit_month to be NULL for FREE plans
ALTER TABLE user_plans
ALTER COLUMN copies_limit_month DROP NOT NULL,
ALTER COLUMN copies_limit_month DROP DEFAULT;

-- Constraints
ALTER TABLE user_plans
ADD CONSTRAINT IF NOT EXISTS check_transfer_monthly_positive 
CHECK (transfer_bytes_used_month >= 0),

ADD CONSTRAINT IF NOT EXISTS check_transfer_lifetime_positive 
CHECK (transfer_bytes_used_lifetime >= 0),

ADD CONSTRAINT IF NOT EXISTS check_max_file_positive 
CHECK (max_file_bytes > 0);

-- Constraint: FREE plans must have lifetime limits
ALTER TABLE user_plans
ADD CONSTRAINT IF NOT EXISTS check_free_has_lifetime
CHECK (
    plan != 'free' OR (
        transfer_bytes_limit_lifetime IS NOT NULL 
        AND total_lifetime_copies IS NOT NULL
    )
);

-- Constraint: PAID plans must have monthly limits
ALTER TABLE user_plans
ADD CONSTRAINT IF NOT EXISTS check_paid_has_monthly
CHECK (
    plan NOT IN ('plus', 'pro') OR (
        transfer_bytes_limit_month IS NOT NULL 
        AND copies_limit_month IS NOT NULL
    )
);

-- Comments
COMMENT ON COLUMN user_plans.plan IS 'Source of truth: free, plus, pro. Use this for limit lookups.';
COMMENT ON COLUMN user_plans.plan_type IS 'Derived field: FREE (plan=free), PAID (plan in plus/pro). For display only.';
COMMENT ON COLUMN user_plans.transfer_bytes_limit_month IS 'Transfer bytes limit per month (PAID only). NULL for FREE.';
COMMENT ON COLUMN user_plans.transfer_bytes_used_month IS 'Transfer bytes used this month (PAID only).';
COMMENT ON COLUMN user_plans.transfer_bytes_limit_lifetime IS 'Transfer bytes limit lifetime (FREE only). NULL for PAID.';
COMMENT ON COLUMN user_plans.transfer_bytes_used_lifetime IS 'Transfer bytes used lifetime (FREE only).';
COMMENT ON COLUMN user_plans.max_file_bytes IS 'Maximum file size in bytes allowed for copy operations.';
COMMENT ON COLUMN user_plans.copies_limit_month IS 'Monthly copy limit (PAID only). NULL for FREE (uses total_lifetime_copies).';

-- Verification (CORRECTED: Check specific columns exist)
DO $$
DECLARE
    v_has_transfer_limit_month BOOLEAN;
    v_has_transfer_used_month BOOLEAN;
    v_has_transfer_limit_lifetime BOOLEAN;
    v_has_transfer_used_lifetime BOOLEAN;
    v_has_max_file_bytes BOOLEAN;
BEGIN
    SELECT 
        COUNT(*) FILTER (WHERE column_name = 'transfer_bytes_limit_month') > 0,
        COUNT(*) FILTER (WHERE column_name = 'transfer_bytes_used_month') > 0,
        COUNT(*) FILTER (WHERE column_name = 'transfer_bytes_limit_lifetime') > 0,
        COUNT(*) FILTER (WHERE column_name = 'transfer_bytes_used_lifetime') > 0,
        COUNT(*) FILTER (WHERE column_name = 'max_file_bytes') > 0
    INTO 
        v_has_transfer_limit_month,
        v_has_transfer_used_month,
        v_has_transfer_limit_lifetime,
        v_has_transfer_used_lifetime,
        v_has_max_file_bytes
    FROM information_schema.columns 
    WHERE table_name = 'user_plans'
      AND column_name IN (
        'transfer_bytes_limit_month',
        'transfer_bytes_used_month',
        'transfer_bytes_limit_lifetime',
        'transfer_bytes_used_lifetime',
        'max_file_bytes'
      );
    
    IF NOT (v_has_transfer_limit_month AND v_has_transfer_used_month 
            AND v_has_transfer_limit_lifetime AND v_has_transfer_used_lifetime 
            AND v_has_max_file_bytes) THEN
        RAISE EXCEPTION 'Migration failed: Not all required columns created';
    END IF;
    
    RAISE NOTICE '✓ Migration successful: All transfer bytes columns created';
END $$;

COMMIT;
