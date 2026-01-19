-- ═══════════════════════════════════════════════════════════════════════════
-- FIX: transfer_provider_account_ownership - WITH ADVISORY LOCK + CONFLICT DELETE
-- Prevents 23505 by acquiring lock and deleting conflicting rows AFTER idempotence check
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.transfer_provider_account_ownership(
    p_provider text,
    p_provider_account_id text,
    p_new_user_id uuid,
    p_expected_old_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_account_id uuid;
    v_current_owner_id uuid;
    v_slot_log_id uuid;
    v_conflict_deleted boolean := false;
    v_conflict_count integer := 0;
BEGIN
    -- ═══════════════════════════════════════════════════════════════════════════
    -- STEP 1: Acquire advisory lock for this external account (transaction-scoped)
    -- Prevents concurrent transfers of the same provider_account_id
    -- ═══════════════════════════════════════════════════════════════════════════
    PERFORM pg_advisory_xact_lock(hashtext(p_provider || ':' || p_provider_account_id));
    
    -- ═══════════════════════════════════════════════════════════════════════════
    -- STEP 2: Find source account and lock it for UPDATE
    -- ═══════════════════════════════════════════════════════════════════════════
    SELECT id, user_id, slot_log_id
    INTO v_account_id, v_current_owner_id, v_slot_log_id
    FROM public.cloud_provider_accounts
    WHERE provider = p_provider
      AND provider_account_id = p_provider_account_id
    LIMIT 1
    FOR UPDATE;
    
    -- ═══════════════════════════════════════════════════════════════════════════
    -- STEP 3: Check if account exists
    -- ═══════════════════════════════════════════════════════════════════════════
    IF v_account_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'account_not_found',
            'provider', p_provider,
            'provider_account_id', p_provider_account_id
        );
    END IF;
    
    -- ═══════════════════════════════════════════════════════════════════════════
    -- STEP 4: Idempotence check - already owned by new user
    -- CRITICAL: Check BEFORE deleting anything to avoid deleting the good row
    -- ═══════════════════════════════════════════════════════════════════════════
    IF v_current_owner_id = p_new_user_id THEN
        RETURN jsonb_build_object(
            'success', true,
            'was_idempotent', true,
            'deleted_conflict', false,
            'old_owner_id', v_current_owner_id,
            'new_owner_id', p_new_user_id,
            'account_id', v_account_id,
            'slot_log_id', v_slot_log_id
        );
    END IF;
    
    -- ═══════════════════════════════════════════════════════════════════════════
    -- STEP 5: Validate expected old owner (security check)
    -- ═══════════════════════════════════════════════════════════════════════════
    IF p_expected_old_user_id IS NOT NULL AND v_current_owner_id != p_expected_old_user_id THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'owner_mismatch',
            'actual_owner', v_current_owner_id,
            'expected_owner', p_expected_old_user_id,
            'new_owner_id', p_new_user_id
        );
    END IF;
    
    -- ═══════════════════════════════════════════════════════════════════════════
    -- STEP 6: Sanitize destination - DELETE conflicting row EXCLUDING source
    -- This prevents 23505 on UNIQUE (user_id, provider, provider_account_id)
    -- CRITICAL: AND id <> v_account_id ensures we don't delete the source row
    -- ═══════════════════════════════════════════════════════════════════════════
    WITH deleted AS (
        DELETE FROM public.cloud_provider_accounts
        WHERE user_id = p_new_user_id
          AND provider = p_provider
          AND provider_account_id = p_provider_account_id
          AND id <> v_account_id
        RETURNING id
    )
    SELECT COUNT(*) INTO v_conflict_count FROM deleted;
    
    IF v_conflict_count > 0 THEN
        v_conflict_deleted := true;
        RAISE NOTICE 'Deleted % conflicting row(s) for new user before transfer', v_conflict_count;
    END IF;
    
    -- ═══════════════════════════════════════════════════════════════════════════
    -- STEP 7: Transfer ownership - UPDATE source account
    -- Note: updated_at is handled by trigger update_provider_accounts_updated_at
    -- ═══════════════════════════════════════════════════════════════════════════
    UPDATE public.cloud_provider_accounts
    SET 
        user_id = p_new_user_id,
        is_active = true,
        disconnected_at = NULL
    WHERE id = v_account_id;
    
    -- ═══════════════════════════════════════════════════════════════════════════
    -- STEP 8: Transfer slot ownership if exists
    -- Note: cloud_slots_log does NOT have updated_at column
    -- ═══════════════════════════════════════════════════════════════════════════
    IF v_slot_log_id IS NOT NULL THEN
        UPDATE public.cloud_slots_log
        SET 
            user_id = p_new_user_id,
            is_active = true,
            disconnected_at = NULL
        WHERE id = v_slot_log_id;
    END IF;
    
    -- ═══════════════════════════════════════════════════════════════════════════
    -- STEP 9: Success response with transfer details
    -- ═══════════════════════════════════════════════════════════════════════════
    RETURN jsonb_build_object(
        'success', true,
        'was_idempotent', false,
        'deleted_conflict', v_conflict_deleted,
        'old_owner_id', v_current_owner_id,
        'new_owner_id', p_new_user_id,
        'account_id', v_account_id,
        'slot_log_id', v_slot_log_id
    );
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.transfer_provider_account_ownership(text, text, uuid, uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION QUERIES
-- ═══════════════════════════════════════════════════════════════════════════

-- Check for remaining duplicates (should return 0 rows after cleanup)
SELECT 
    provider_account_id,
    COUNT(*) as duplicate_count,
    array_agg(user_id::text) as user_ids,
    array_agg(id::text) as account_ids
FROM cloud_provider_accounts
WHERE provider = 'onedrive'
GROUP BY provider_account_id
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;

-- Test RPC function exists and has correct signature
SELECT 
    proname as function_name,
    pg_get_function_arguments(oid) as arguments,
    prosecdef as is_security_definer
FROM pg_proc
WHERE proname = 'transfer_provider_account_ownership'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION QUERIES (run after creating function)
-- ═══════════════════════════════════════════════════════════════════════════

-- Test 1: Check existing accounts that could be transferred
-- SELECT 
--     id, 
--     user_id, 
--     provider, 
--     provider_account_id, 
--     is_active,
--     slot_log_id
-- FROM cloud_provider_accounts
-- WHERE provider = 'onedrive'
-- ORDER BY created_at DESC
-- LIMIT 10;

-- Test 2: Transfer from user A to user B (replace UUIDs with real values)
-- SELECT transfer_provider_account_ownership(
--     'onedrive',
--     '<provider_account_id>',
--     '<new_user_id>'::uuid,
--     '<old_user_id>'::uuid
-- );

-- Test 3: Transfer again (should be idempotent - no-op)
-- SELECT transfer_provider_account_ownership(
--     'onedrive',
--     '<provider_account_id>',
--     '<new_user_id>'::uuid,
--     '<new_user_id>'::uuid
-- );

-- Test 4: Verify result
-- SELECT 
--     id, 
--     user_id, 
--     provider, 
--     provider_account_id, 
--     is_active,
--     disconnected_at,
--     slot_log_id
-- FROM cloud_provider_accounts
-- WHERE provider_account_id = '<provider_account_id>';

