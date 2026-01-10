-- Migration: Create atomic RPC for copy job completion
-- Created: 2025-12-22
-- Updated: v2.1 - Add auth check + plan creation fallback + SELECT after INSERT

BEGIN;

CREATE OR REPLACE FUNCTION complete_copy_job_success_and_increment_usage(
    p_job_id UUID,
    p_user_id UUID,
    p_bytes_copied BIGINT
)
RETURNS TABLE(
    success BOOLEAN,
    already_completed BOOLEAN,
    message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_updated_rows INT;
    v_plan TEXT;
    v_plan_type TEXT;
    v_now TIMESTAMPTZ := now();
    v_caller_id UUID;
BEGIN
    -- SECURITY CHECK: Verify caller is authorized
    v_caller_id := auth.uid();
    
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required. No user session found.';
    END IF;
    
    IF v_caller_id <> p_user_id THEN
        RAISE EXCEPTION 'Authorization failed. Cannot complete job for another user.';
    END IF;
    
    -- STEP 1: Atomic update job status (ONLY if currently pending)
    UPDATE copy_jobs
    SET 
        status = 'success',
        bytes_copied = p_bytes_copied,
        completed_at = v_now,  -- Only for success
        finished_at = v_now    -- For both success/failed
    WHERE 
        id = p_job_id 
        AND user_id = p_user_id
        AND status = 'pending';  -- CRITICAL: Only if still pending
    
    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
    
    -- IDEMPOTENCY: Skip increment if already completed
    IF v_updated_rows = 0 THEN
        -- Check if job exists but already completed
        IF EXISTS (SELECT 1 FROM copy_jobs WHERE id = p_job_id AND status = 'success') THEN
            RETURN QUERY SELECT false, true, 'Job already completed (idempotent skip)'::TEXT;
        ELSE
            RETURN QUERY SELECT false, true, 'Job not found or not pending'::TEXT;
        END IF;
        RETURN;
    END IF;
    
    -- STEP 2: Get or create user plan (fallback to FREE if missing)
    SELECT plan, plan_type INTO v_plan, v_plan_type
    FROM user_plans
    WHERE user_id = p_user_id;
    
    IF v_plan IS NULL THEN
        -- GUARD: Create minimal FREE plan if missing (avoid breaking copies)
        INSERT INTO user_plans (
            user_id, 
            plan, 
            plan_type,
            clouds_slots_total,
            clouds_slots_used,
            total_lifetime_copies,
            copies_limit_month,
            transfer_bytes_used_lifetime,
            transfer_bytes_limit_lifetime,
            transfer_bytes_used_month,
            transfer_bytes_limit_month,
            max_file_bytes,
            period_start
        ) VALUES (
            p_user_id,
            'free',
            'FREE',
            2,
            0,
            0,
            NULL,  -- FREE uses lifetime
            0,
            5368709120,  -- 5GB
            0,
            NULL,  -- FREE doesn't use monthly
            1073741824,  -- 1GB
            date_trunc('month', v_now)
        )
        ON CONFLICT (user_id) DO NOTHING;
        
        -- CORRECTION: SELECT to ensure we have real values after INSERT
        SELECT plan, plan_type INTO v_plan, v_plan_type
        FROM user_plans
        WHERE user_id = p_user_id;
        
        RAISE NOTICE 'Created missing plan for user % (fallback to FREE)', p_user_id;
    END IF;
    
    -- STEP 3: Increment counters based on plan (not plan_type)
    IF v_plan = 'free' THEN
        -- FREE: Increment ONLY transfer_bytes (UNLIMITED COPIES Phase 2)
        UPDATE user_plans
        SET 
            -- total_lifetime_copies = COALESCE(total_lifetime_copies, 0) + 1,  -- DISABLED: Unlimited copies
            transfer_bytes_used_lifetime = COALESCE(transfer_bytes_used_lifetime, 0) + p_bytes_copied,
            updated_at = v_now
        WHERE user_id = p_user_id;
        
    ELSIF v_plan IN ('plus', 'pro') THEN
        -- PAID: Increment ONLY transfer_bytes (UNLIMITED COPIES Phase 2)
        UPDATE user_plans
        SET 
            -- copies_used_month = COALESCE(copies_used_month, 0) + 1,  -- DISABLED: Unlimited copies
            transfer_bytes_used_month = COALESCE(transfer_bytes_used_month, 0) + p_bytes_copied,
            updated_at = v_now
        WHERE user_id = p_user_id;
        
    ELSE
        RAISE WARNING 'Unknown plan type: %. Defaulting to lifetime counters.', v_plan;
        
        -- Fallback: ONLY transfer_bytes (UNLIMITED COPIES Phase 2)
        UPDATE user_plans
        SET 
            -- total_lifetime_copies = COALESCE(total_lifetime_copies, 0) + 1,  -- DISABLED: Unlimited copies
            transfer_bytes_used_lifetime = COALESCE(transfer_bytes_used_lifetime, 0) + p_bytes_copied,
            updated_at = v_now
        WHERE user_id = p_user_id;
    END IF;
    
    RETURN QUERY SELECT true, false, format('Job completed. Plan: %s, Bytes: %s', v_plan, p_bytes_copied)::TEXT;
END;
$$;

-- Security: Grant only to authenticated users (NOT public)
REVOKE ALL ON FUNCTION complete_copy_job_success_and_increment_usage FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_copy_job_success_and_increment_usage TO authenticated;

COMMENT ON FUNCTION complete_copy_job_success_and_increment_usage IS 
'Atomically update copy job to success and increment quota counters. 
SECURITY: Verifies auth.uid() matches p_user_id.
IDEMPOTENT: Safe to call multiple times.
FALLBACK: Creates FREE plan if missing to avoid breaking copies.';

-- Verification test
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc 
        WHERE proname = 'complete_copy_job_success_and_increment_usage'
    ) THEN
        RAISE EXCEPTION 'Migration failed: RPC function not created';
    END IF;
    
    RAISE NOTICE '✓ Migration successful: RPC function created with auth check';
END $$;

COMMIT;
