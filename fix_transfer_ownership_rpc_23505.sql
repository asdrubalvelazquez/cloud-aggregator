-- ═══════════════════════════════════════════════════════════════════════════
-- FIX: transfer_provider_account_ownership - 4 params signature
-- Prevents 23505 by doing UPDATE only (no INSERT/UPSERT)
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
BEGIN
    -- Find existing account by (provider, provider_account_id)
    SELECT id, user_id, slot_log_id
    INTO v_account_id, v_current_owner_id, v_slot_log_id
    FROM cloud_provider_accounts
    WHERE provider = p_provider
      AND provider_account_id = p_provider_account_id
    LIMIT 1;

    -- If account not found
    IF v_account_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'account_not_found'
        );
    END IF;

    -- If already owned by new user (idempotent)
    IF v_current_owner_id = p_new_user_id THEN
        RETURN jsonb_build_object(
            'success', true,
            'was_idempotent', true
        );
    END IF;

    -- Validate expected old owner
    IF p_expected_old_user_id IS NOT NULL AND v_current_owner_id != p_expected_old_user_id THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'owner_mismatch'
        );
    END IF;

    -- UPDATE cloud_provider_accounts (change owner)
    UPDATE cloud_provider_accounts
    SET 
        user_id = p_new_user_id,
        is_active = true,
        disconnected_at = NULL,
        updated_at = now()
    WHERE id = v_account_id;

    -- UPDATE cloud_slots_log (if exists)
    IF v_slot_log_id IS NOT NULL THEN
        UPDATE cloud_slots_log
        SET 
            user_id = p_new_user_id,
            is_active = true,
            disconnected_at = NULL,
            updated_at = now()
        WHERE id = v_slot_log_id;
    END IF;

    -- Success
    RETURN jsonb_build_object(
        'success', true,
        'was_idempotent', false
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_provider_account_ownership(text, text, uuid, uuid) TO authenticated;

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

