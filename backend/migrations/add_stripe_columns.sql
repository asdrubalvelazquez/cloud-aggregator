-- Migration: Add Stripe subscription tracking columns to user_plans
-- Purpose: Prepare database for Stripe Subscriptions integration (Phase 1)
-- Created: 2025-12-25
-- Status: Safe for production (adds NULL columns, no data modification)

BEGIN;

-- ==========================================
-- PART 1: ADD COLUMNS
-- ==========================================

-- Add Stripe customer ID (persistent across subscription lifecycle)
ALTER TABLE user_plans
ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

-- Add Stripe subscription ID (NULL if FREE, populated if PAID)
ALTER TABLE user_plans
ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

-- Add subscription status (active, canceled, past_due, or NULL)
ALTER TABLE user_plans
ADD COLUMN IF NOT EXISTS subscription_status TEXT;

-- ==========================================
-- PART 2: ADD UNIQUE CONSTRAINTS (idempotent)
-- ==========================================

-- Unique constraint for stripe_customer_id (prevents duplicate Stripe customers)
-- Note: Creates implicit index automatically
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'user_plans_stripe_customer_id_key'
    ) THEN
        ALTER TABLE user_plans
        ADD CONSTRAINT user_plans_stripe_customer_id_key 
        UNIQUE (stripe_customer_id);
        RAISE NOTICE '✓ Created UNIQUE constraint: user_plans_stripe_customer_id_key';
    ELSE
        RAISE NOTICE '✓ UNIQUE constraint already exists: user_plans_stripe_customer_id_key';
    END IF;
END $$;

-- Unique constraint for stripe_subscription_id (prevents duplicate subscriptions)
-- Note: Creates implicit index automatically
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'user_plans_stripe_subscription_id_key'
    ) THEN
        ALTER TABLE user_plans
        ADD CONSTRAINT user_plans_stripe_subscription_id_key 
        UNIQUE (stripe_subscription_id);
        RAISE NOTICE '✓ Created UNIQUE constraint: user_plans_stripe_subscription_id_key';
    ELSE
        RAISE NOTICE '✓ UNIQUE constraint already exists: user_plans_stripe_subscription_id_key';
    END IF;
END $$;

-- ==========================================
-- PART 3: ADD CHECK CONSTRAINT (idempotent)
-- ==========================================

-- Check constraint for subscription_status (allow only valid values or NULL)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'user_plans_subscription_status_check'
    ) THEN
        ALTER TABLE user_plans
        ADD CONSTRAINT user_plans_subscription_status_check 
        CHECK (
            subscription_status IS NULL 
            OR subscription_status IN ('active', 'canceled', 'past_due')
        );
        RAISE NOTICE '✓ Created CHECK constraint: user_plans_subscription_status_check';
    ELSE
        RAISE NOTICE '✓ CHECK constraint already exists: user_plans_subscription_status_check';
    END IF;
END $$;

-- ==========================================
-- PART 4: ADD INDEX FOR QUERIES (optional but recommended)
-- ==========================================

-- Index for filtering by subscription_status (e.g., find all active subscriptions)
-- This is useful for cronjobs and analytics queries
CREATE INDEX IF NOT EXISTS idx_user_plans_subscription_status 
    ON user_plans(subscription_status)
    WHERE subscription_status IS NOT NULL;

-- ==========================================
-- PART 5: DOCUMENTATION COMMENTS
-- ==========================================

COMMENT ON COLUMN user_plans.stripe_customer_id IS 'Stripe Customer ID (persistent across subscription lifecycle). NULL for users who never subscribed.';
COMMENT ON COLUMN user_plans.stripe_subscription_id IS 'Stripe Subscription ID. NULL if plan=free, populated if plan in (plus, pro).';
COMMENT ON COLUMN user_plans.subscription_status IS 'Subscription status from Stripe: active, canceled, past_due. NULL if no active subscription.';

-- ==========================================
-- PART 6: VERIFICATION
-- ==========================================

DO $$
DECLARE
    v_has_customer_id BOOLEAN;
    v_has_subscription_id BOOLEAN;
    v_has_status BOOLEAN;
    v_has_customer_unique BOOLEAN;
    v_has_subscription_unique BOOLEAN;
    v_has_status_check BOOLEAN;
BEGIN
    -- Check columns exist
    SELECT 
        COUNT(*) FILTER (WHERE column_name = 'stripe_customer_id') > 0,
        COUNT(*) FILTER (WHERE column_name = 'stripe_subscription_id') > 0,
        COUNT(*) FILTER (WHERE column_name = 'subscription_status') > 0
    INTO 
        v_has_customer_id,
        v_has_subscription_id,
        v_has_status
    FROM information_schema.columns 
    WHERE table_name = 'user_plans'
      AND column_name IN ('stripe_customer_id', 'stripe_subscription_id', 'subscription_status');
    
    -- Check constraints exist
    SELECT 
        COUNT(*) FILTER (WHERE conname = 'user_plans_stripe_customer_id_key') > 0,
        COUNT(*) FILTER (WHERE conname = 'user_plans_stripe_subscription_id_key') > 0,
        COUNT(*) FILTER (WHERE conname = 'user_plans_subscription_status_check') > 0
    INTO
        v_has_customer_unique,
        v_has_subscription_unique,
        v_has_status_check
    FROM pg_constraint
    WHERE conrelid = 'user_plans'::regclass
      AND conname IN (
          'user_plans_stripe_customer_id_key',
          'user_plans_stripe_subscription_id_key',
          'user_plans_subscription_status_check'
      );
    
    -- Validate all components
    IF NOT (v_has_customer_id AND v_has_subscription_id AND v_has_status) THEN
        RAISE EXCEPTION 'Migration failed: Not all columns were created';
    END IF;
    
    IF NOT (v_has_customer_unique AND v_has_subscription_unique AND v_has_status_check) THEN
        RAISE EXCEPTION 'Migration failed: Not all constraints were created';
    END IF;
    
    RAISE NOTICE '========================================';
    RAISE NOTICE '✓ Migration successful: add_stripe_columns.sql';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Added columns:';
    RAISE NOTICE '  - stripe_customer_id (TEXT, UNIQUE)';
    RAISE NOTICE '  - stripe_subscription_id (TEXT, UNIQUE)';
    RAISE NOTICE '  - subscription_status (TEXT, CHECK)';
    RAISE NOTICE 'All existing user data preserved (columns NULL)';
    RAISE NOTICE '========================================';
END $$;

COMMIT;
