-- ==========================================
-- ROLLBACK SCRIPT: Sistema de Slots Históricos
-- Version: 1.0
-- Date: 2025-12-21
-- ==========================================
-- 
-- IMPORTANTE: Usar SOLO si la migración falló o si se necesita revertir cambios
-- Este script restaura el esquema a su estado anterior a la migración de slots
--
-- ==========================================

BEGIN;

-- ==========================================
-- PASO 1: ELIMINAR TRIGGERS Y FUNCIONES
-- ==========================================

DROP TRIGGER IF EXISTS update_cloud_slots_log_updated_at ON cloud_slots_log;
DROP FUNCTION IF EXISTS update_updated_at_column();

-- ==========================================
-- PASO 2: ELIMINAR CONSTRAINTS DE user_plans
-- ==========================================

ALTER TABLE user_plans
DROP CONSTRAINT IF EXISTS check_free_plan_no_expiration,
DROP CONSTRAINT IF EXISTS check_paid_plan_has_expiration,
DROP CONSTRAINT IF EXISTS check_slots_used_within_total;

-- ==========================================
-- PASO 3: ELIMINAR CONSTRAINTS DE cloud_accounts
-- ==========================================

ALTER TABLE cloud_accounts
DROP CONSTRAINT IF EXISTS check_disconnected_is_inactive,
DROP CONSTRAINT IF EXISTS check_disconnection_after_creation;

-- ==========================================
-- PASO 4: ELIMINAR ÍNDICES NUEVOS
-- ==========================================

-- Índices de cloud_slots_log
DROP INDEX IF EXISTS idx_cloud_slots_log_user_active;
DROP INDEX IF EXISTS idx_cloud_slots_log_provider_lookup;
DROP INDEX IF EXISTS idx_cloud_slots_log_user_provider;
DROP INDEX IF EXISTS idx_cloud_slots_log_expiration;

-- Índices de user_plans
DROP INDEX IF EXISTS idx_user_plans_expiration;
DROP INDEX IF EXISTS idx_user_plans_type;

-- Índices de cloud_accounts
DROP INDEX IF EXISTS idx_cloud_accounts_active;
DROP INDEX IF EXISTS idx_cloud_accounts_slot;

-- ==========================================
-- PASO 5: ELIMINAR COLUMNAS DE cloud_accounts
-- ==========================================

ALTER TABLE cloud_accounts
DROP COLUMN IF EXISTS slot_log_id,
DROP COLUMN IF EXISTS disconnected_at,
DROP COLUMN IF EXISTS is_active;

-- ==========================================
-- PASO 6: ELIMINAR COLUMNAS DE user_plans
-- ==========================================

ALTER TABLE user_plans
DROP COLUMN IF EXISTS clouds_slots_used,
DROP COLUMN IF EXISTS clouds_slots_total,
DROP COLUMN IF EXISTS total_lifetime_copies,
DROP COLUMN IF EXISTS plan_expires_at,
DROP COLUMN IF EXISTS plan_type;

-- ==========================================
-- PASO 7: ELIMINAR TABLA cloud_slots_log
-- ==========================================

DROP TABLE IF EXISTS cloud_slots_log CASCADE;

-- ==========================================
-- PASO 8: VALIDACIÓN DE ROLLBACK
-- ==========================================

DO $$
BEGIN
    -- Verificar que la tabla cloud_slots_log fue eliminada
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cloud_slots_log') THEN
        RAISE EXCEPTION 'ROLLBACK FALLIDO: Tabla cloud_slots_log aún existe';
    END IF;
    
    -- Verificar que las columnas de user_plans fueron eliminadas
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'user_plans' 
        AND column_name IN ('plan_type', 'plan_expires_at', 'total_lifetime_copies', 'clouds_slots_total', 'clouds_slots_used')
    ) THEN
        RAISE EXCEPTION 'ROLLBACK FALLIDO: Columnas de user_plans aún existen';
    END IF;
    
    -- Verificar que las columnas de cloud_accounts fueron eliminadas
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'cloud_accounts' 
        AND column_name IN ('is_active', 'disconnected_at', 'slot_log_id')
    ) THEN
        RAISE EXCEPTION 'ROLLBACK FALLIDO: Columnas de cloud_accounts aún existen';
    END IF;
    
    RAISE NOTICE '========================================';
    RAISE NOTICE 'ROLLBACK COMPLETADO EXITOSAMENTE';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'El esquema ha sido restaurado al estado anterior';
    RAISE NOTICE 'Las cuentas y usuarios no fueron modificados';
    RAISE NOTICE '========================================';
END $$;

COMMIT;

-- Si hay errores durante el rollback, usar:
-- ROLLBACK;
