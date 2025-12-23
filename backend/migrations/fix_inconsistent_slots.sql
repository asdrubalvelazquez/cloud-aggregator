-- ==========================================
-- SCRIPT DE SANEAMIENTO: Corrección de estados inconsistentes en cloud_slots_log
-- Fecha: 2025-12-22
-- Objetivo: Corregir slots marcados como activos pero con disconnected_at presente
-- ==========================================
--
-- PROBLEMA:
-- Algunos slots en cloud_slots_log pueden tener is_active=true pero disconnected_at no NULL,
-- lo cual viola la lógica de negocio (un slot desconectado debe estar inactivo).
--
-- CAUSA:
-- Posible race condition o lógica incorrecta en versiones anteriores del código.
--
-- SOLUCIÓN:
-- Marcar como inactivos (is_active=false) todos los slots que tienen disconnected_at.
--
-- SEGURIDAD:
-- - Esta operación es IDEMPOTENTE (puede ejecutarse múltiples veces sin efectos adversos)
-- - Solo actualiza registros con estado inconsistente
-- - No elimina ni modifica datos críticos
-- - Preserva toda la información histórica (emails, fechas, etc.)
--
-- ==========================================

BEGIN;

-- Vista previa (opcional): Ver cuántos registros se actualizarán
-- Descomentar para ejecutar antes del UPDATE:
/*
SELECT 
    COUNT(*) as registros_inconsistentes,
    user_id,
    provider_email,
    is_active,
    disconnected_at
FROM cloud_slots_log
WHERE disconnected_at IS NOT NULL 
  AND is_active = true
GROUP BY user_id, provider_email, is_active, disconnected_at;
*/

-- Actualización de registros inconsistentes
UPDATE cloud_slots_log 
SET 
    is_active = false,
    updated_at = NOW()  -- Marcar timestamp de corrección
WHERE 
    disconnected_at IS NOT NULL 
    AND is_active = true;

-- Reporte post-actualización
SELECT 
    'Saneamiento completado' as status,
    COUNT(*) as registros_corregidos
FROM cloud_slots_log
WHERE 
    disconnected_at IS NOT NULL 
    AND is_active = false;

COMMIT;

-- ==========================================
-- INSTRUCCIONES DE EJECUCIÓN:
-- ==========================================
--
-- 1. BACKUP (OBLIGATORIO antes de ejecutar):
--    pg_dump -U postgres -d cloud_aggregator -t cloud_slots_log > backup_cloud_slots_log_20251222.sql
--
-- 2. EJECUTAR SCRIPT:
--    psql -U postgres -d cloud_aggregator -f fix_inconsistent_slots.sql
--
-- 3. VERIFICACIÓN POST-EJECUCIÓN:
--    SELECT COUNT(*) FROM cloud_slots_log WHERE disconnected_at IS NOT NULL AND is_active = true;
--    (Debe retornar 0)
--
-- 4. ROLLBACK (si es necesario):
--    -- Solo si detectas problemas inmediatamente después
--    BEGIN;
--    UPDATE cloud_slots_log 
--    SET is_active = true 
--    WHERE disconnected_at IS NOT NULL 
--      AND updated_at >= '2025-12-22 00:00:00';  -- Ajustar fecha
--    COMMIT;
--
-- ==========================================
-- VALIDACIÓN DE CONSTRAINTS:
-- ==========================================
--
-- Este script asegura el cumplimiento del constraint check_disconnected_logic:
--
--   CONSTRAINT check_disconnected_logic CHECK (
--       (is_active = true AND disconnected_at IS NULL) OR 
--       (is_active = false AND disconnected_at IS NOT NULL)
--   )
--
-- Después de ejecutar este script, todos los registros cumplirán este constraint.
--
-- ==========================================
