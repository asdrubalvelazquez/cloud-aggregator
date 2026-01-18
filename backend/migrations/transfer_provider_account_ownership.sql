-- ==========================================
-- MIGRATION: Transfer Provider Account Ownership
-- Version: 1.0
-- Date: 2026-01-18
-- Author: Backend Engineer (Ownership Conflict Resolution)
-- ==========================================
-- 
-- PROPÓSITO:
-- Resolver ownership_violation cuando User B intenta conectar OneDrive ya owned por User A
-- con email mismatch (caso no cubierto por SAFE RECLAIM automático).
--
-- ESTRATEGIA:
-- - RPC transaccional con FOR UPDATE (bloqueo pesimista)
-- - UPDATE atómico de user_id (no DELETE+INSERT)
-- - Transferencia de ownership en cloud_slots_log si existe slot_log_id
-- - Validación de concurrencia (expected_old_user_id)
--
-- USO:
-- SELECT * FROM transfer_provider_account_ownership(
--   'onedrive',                          -- p_provider
--   'microsoft_account_id_123',          -- p_provider_account_id
--   'new-user-uuid',                     -- p_new_user_id
--   'old-user-uuid'                      -- p_expected_old_user_id
-- );
--
-- RETORNA:
-- { "success": true, "account_id": "uuid", "slot_log_id": "uuid" }
-- { "success": false, "error": "account_not_found" }
-- { "success": false, "error": "owner_changed" }
-- ==========================================

BEGIN;

CREATE OR REPLACE FUNCTION public.transfer_provider_account_ownership(
  p_provider text,
  p_provider_account_id text,
  p_new_user_id uuid,
  p_expected_old_user_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER  -- Ejecuta con permisos del owner (necesario para UPDATE)
AS $$
DECLARE
  v_id uuid;
  v_old_user_id uuid;
  v_slot_log_id uuid;
BEGIN
  -- ==========================================
  -- PASO 1: Obtener cuenta con bloqueo pesimista (FOR UPDATE)
  -- ==========================================
  -- Bloquea la fila para evitar race conditions durante la transferencia
  SELECT id, user_id, slot_log_id
    INTO v_id, v_old_user_id, v_slot_log_id
  FROM public.cloud_provider_accounts
  WHERE provider = p_provider 
    AND provider_account_id = p_provider_account_id
  FOR UPDATE;

  -- Validación: cuenta no existe
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false, 
      'error', 'account_not_found'
    );
  END IF;

  -- ==========================================
  -- PASO 2: Validar ownership actual (evitar race condition)
  -- ==========================================
  -- Si el propietario cambió entre la lectura inicial y esta función,
  -- abortar la transferencia para evitar transferir la cuenta del usuario incorrecto
  IF v_old_user_id <> p_expected_old_user_id THEN
    RETURN json_build_object(
      'success', false, 
      'error', 'owner_changed',
      'expected_owner', p_expected_old_user_id,
      'actual_owner', v_old_user_id
    );
  END IF;

  -- ==========================================
  -- PASO 3: Transferir ownership en cloud_provider_accounts
  -- ==========================================
  -- UPDATE atómico (no DELETE+INSERT) para preservar constraints y FKs
  UPDATE public.cloud_provider_accounts
    SET user_id = p_new_user_id
  WHERE id = v_id;

  -- ==========================================
  -- PASO 4: Transferir ownership en cloud_slots_log (si existe)
  -- ==========================================
  -- Si la cuenta tiene slot_log_id asignado, actualizar user_id en cloud_slots_log
  -- para mantener consistencia histórica del slot
  IF v_slot_log_id IS NOT NULL THEN
    UPDATE public.cloud_slots_log
      SET user_id = p_new_user_id
    WHERE id = v_slot_log_id;
  END IF;

  -- ==========================================
  -- PASO 5: Retornar resultado exitoso
  -- ==========================================
  RETURN json_build_object(
    'success', true, 
    'account_id', v_id,
    'slot_log_id', v_slot_log_id,
    'previous_owner', p_expected_old_user_id,
    'new_owner', p_new_user_id
  );
END;
$$;

-- Comentario de documentación
COMMENT ON FUNCTION public.transfer_provider_account_ownership IS 
'Transferencia atómica de ownership de cuenta cloud entre usuarios. 
Usa bloqueo pesimista (FOR UPDATE) para evitar race conditions.
Actualiza user_id en cloud_provider_accounts y cloud_slots_log.
SECURITY DEFINER permite ejecutar con permisos de owner.';

-- ==========================================
-- SEGURIDAD: Revocar acceso público al RPC
-- ==========================================
-- Evita que usuarios no autorizados puedan invocar directamente la función
-- Solo el backend con service_role puede ejecutarla
REVOKE EXECUTE ON FUNCTION public.transfer_provider_account_ownership(text, text, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.transfer_provider_account_ownership(text, text, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.transfer_provider_account_ownership(text, text, uuid, uuid) FROM authenticated;

-- Permitir ejecución solo a service_role (usado por backend)
GRANT EXECUTE ON FUNCTION public.transfer_provider_account_ownership(text, text, uuid, uuid) TO service_role;

COMMIT;
