-- ==========================================
-- MIGRATION: Sistema de Slots Históricos y Cuotas Híbridas
-- Version: 1.0
-- Date: 2025-12-21
-- Author: Sistema de Auditoría
-- ==========================================
-- 
-- IMPORTANTE: Hacer backup completo de la base de datos ANTES de ejecutar
-- Comando: pg_dump -U postgres -d cloud_aggregator > backup_pre_slots_$(date +%Y%m%d).sql
--
-- ==========================================

BEGIN;

-- ==========================================
-- PARTE 1: CREACIÓN DE TABLA cloud_slots_log
-- ==========================================

CREATE TABLE IF NOT EXISTS cloud_slots_log (
    -- Identificadores
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Identificación agnóstica del proveedor cloud
    provider TEXT NOT NULL CHECK (provider IN ('google_drive', 'onedrive', 'dropbox')),
    provider_account_id TEXT NOT NULL,  -- Google ID, OneDrive ID, Dropbox ID (único por proveedor)
    provider_email TEXT NOT NULL,       -- Email de la cuenta del proveedor
    
    -- Metadatos del slot
    slot_number INTEGER NOT NULL,       -- Número de slot incremental por usuario (1, 2, 3...)
    plan_at_connection TEXT NOT NULL DEFAULT 'free',  -- Plan cuando se conectó (free, plus, pro)
    
    -- Timestamps de conexión y desconexión
    connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    disconnected_at TIMESTAMPTZ,        -- NULL = cuenta activa, NOT NULL = desconectada
    
    -- Vencimiento de slot (DECISIÓN AUDITOR: NULL para FREE = sin expiración)
    slot_expires_at TIMESTAMPTZ,        -- NULL para plan FREE (permanente), fecha para PAID (si aplica)
    
    -- Estado actual
    is_active BOOLEAN NOT NULL DEFAULT true,
    
    -- Timestamps de auditoría
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Constraints de unicidad: un usuario no puede conectar la misma cuenta del mismo proveedor dos veces
    CONSTRAINT unique_provider_account_per_user UNIQUE (user_id, provider, provider_account_id),
    
    -- Constraint lógico: si está desconectada, disconnected_at debe tener valor
    CONSTRAINT check_disconnected_logic CHECK (
        (is_active = true AND disconnected_at IS NULL) OR 
        (is_active = false AND disconnected_at IS NOT NULL)
    ),
    
    -- Constraint temporal: disconnected_at debe ser posterior a connected_at
    CONSTRAINT check_disconnection_after_connection CHECK (
        disconnected_at IS NULL OR disconnected_at >= connected_at
    )
);

-- Índices de rendimiento para cloud_slots_log
CREATE INDEX idx_cloud_slots_log_user_active 
    ON cloud_slots_log(user_id, is_active) 
    WHERE is_active = true;

CREATE INDEX idx_cloud_slots_log_provider_lookup 
    ON cloud_slots_log(provider, provider_account_id);

CREATE INDEX idx_cloud_slots_log_user_provider 
    ON cloud_slots_log(user_id, provider);

-- Índice para slots expirados (para futura limpieza por cronjob)
CREATE INDEX idx_cloud_slots_log_expiration 
    ON cloud_slots_log(slot_expires_at) 
    WHERE slot_expires_at IS NOT NULL AND is_active = true;

-- Comentarios de documentación
COMMENT ON TABLE cloud_slots_log IS 'Registro histórico de todos los slots de cuentas cloud conectadas, activas o desconectadas. Previene rotación infinita de cuentas en plan FREE.';
COMMENT ON COLUMN cloud_slots_log.slot_number IS 'Número secuencial de slot por usuario. Se incrementa con cada nueva cuenta única, nunca decrementa.';
COMMENT ON COLUMN cloud_slots_log.slot_expires_at IS 'NULL = sin expiración (plan FREE). Fecha futura = expira en esa fecha (planes PAID, si aplica).';
COMMENT ON COLUMN cloud_slots_log.is_active IS 'true = cuenta conectada actualmente, false = cuenta desconectada (soft-delete).';

-- ==========================================
-- PARTE 2: MODIFICACIÓN DE user_plans
-- ==========================================

-- Agregar nuevas columnas para sistema híbrido FREE/PAID
ALTER TABLE user_plans
ADD COLUMN IF NOT EXISTS plan_type TEXT NOT NULL DEFAULT 'FREE' CHECK (plan_type IN ('FREE', 'PAID')),
ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ,                    -- Fecha de expiración del plan PAID
ADD COLUMN IF NOT EXISTS total_lifetime_copies INTEGER NOT NULL DEFAULT 0,  -- Total de copias históricas (para FREE)
ADD COLUMN IF NOT EXISTS clouds_slots_total INTEGER NOT NULL DEFAULT 2,     -- Total de slots asignados al plan
ADD COLUMN IF NOT EXISTS clouds_slots_used INTEGER NOT NULL DEFAULT 0;      -- Slots consumidos históricamente (nunca decrementa)

-- Constraints de validación lógica entre plan_type y expiración
ALTER TABLE user_plans
ADD CONSTRAINT IF NOT EXISTS check_free_plan_no_expiration 
CHECK (plan_type = 'PAID' OR plan_expires_at IS NULL);

ALTER TABLE user_plans
ADD CONSTRAINT IF NOT EXISTS check_paid_plan_has_expiration 
CHECK (plan_type = 'FREE' OR plan_expires_at IS NOT NULL);

-- Constraint de validación: slots usados no puede exceder slots totales
ALTER TABLE user_plans
ADD CONSTRAINT IF NOT EXISTS check_slots_used_within_total
CHECK (clouds_slots_used <= clouds_slots_total);

-- Índice para verificar planes expirados (para cronjob de downgrade)
CREATE INDEX IF NOT EXISTS idx_user_plans_expiration 
    ON user_plans(plan_expires_at) 
    WHERE plan_type = 'PAID' AND plan_expires_at IS NOT NULL;

-- Índice para búsquedas por plan_type
CREATE INDEX IF NOT EXISTS idx_user_plans_type 
    ON user_plans(plan_type);

-- Comentarios de documentación
COMMENT ON COLUMN user_plans.plan_type IS 'FREE = 20 copias de por vida sin reset, PAID = copias ilimitadas con reset mensual.';
COMMENT ON COLUMN user_plans.total_lifetime_copies IS 'Contador de copias totales históricas. Solo se usa para plan_type=FREE, no se resetea mensualmente.';
COMMENT ON COLUMN user_plans.clouds_slots_total IS 'Número de slots disponibles según plan: FREE=2, PLUS=3, PRO=7. Persistido en DB (no hardcode).';
COMMENT ON COLUMN user_plans.clouds_slots_used IS 'Contador histórico de slots únicos consumidos. Se incrementa con cada nueva cuenta, nunca decrementa.';

-- ==========================================
-- PARTE 3: MODIFICACIÓN DE cloud_accounts
-- ==========================================

-- Agregar columnas para soft-delete y referencia a slot
ALTER TABLE cloud_accounts
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS disconnected_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS slot_log_id UUID REFERENCES cloud_slots_log(id) ON DELETE SET NULL;

-- Índice para consultas de cuentas activas (usado en conteos y listados)
CREATE INDEX IF NOT EXISTS idx_cloud_accounts_active 
    ON cloud_accounts(user_id, is_active) 
    WHERE is_active = true;

-- Índice para búsqueda por slot_log_id
CREATE INDEX IF NOT EXISTS idx_cloud_accounts_slot 
    ON cloud_accounts(slot_log_id) 
    WHERE slot_log_id IS NOT NULL;

-- Constraint: si disconnected_at tiene valor, is_active debe ser false
ALTER TABLE cloud_accounts
ADD CONSTRAINT IF NOT EXISTS check_disconnected_is_inactive 
CHECK (disconnected_at IS NULL OR is_active = false);

-- Constraint temporal: disconnected_at debe ser posterior a created_at
ALTER TABLE cloud_accounts
ADD CONSTRAINT IF NOT EXISTS check_disconnection_after_creation
CHECK (disconnected_at IS NULL OR disconnected_at >= created_at);

-- Comentarios de documentación
COMMENT ON COLUMN cloud_accounts.is_active IS 'false = cuenta desconectada (soft-delete), true = cuenta activa.';
COMMENT ON COLUMN cloud_accounts.slot_log_id IS 'Referencia al slot en cloud_slots_log. Permite vincular cuenta activa con su registro histórico.';

-- ==========================================
-- PARTE 4: MIGRACIÓN DE DATOS EXISTENTES
-- ==========================================

-- 4.1. Inicializar plan_type para usuarios existentes
-- DECISIÓN: Todos los usuarios actuales se consideran FREE por defecto
UPDATE user_plans
SET plan_type = 'FREE'
WHERE plan_type IS NULL OR plan_type = 'FREE';

-- 4.2. Inicializar clouds_slots_total basado en plan actual
UPDATE user_plans
SET clouds_slots_total = CASE 
    WHEN plan = 'free' THEN 2
    WHEN plan = 'plus' THEN 3
    WHEN plan = 'pro' THEN 7
    ELSE 2  -- Default: free
END
WHERE clouds_slots_total = 0 OR clouds_slots_total IS NULL;

-- 4.3. Migrar cuentas existentes a cloud_slots_log
-- Solo migrar cuentas que tienen user_id asignado
INSERT INTO cloud_slots_log (
    user_id,
    provider,
    provider_account_id,
    provider_email,
    slot_number,
    plan_at_connection,
    connected_at,
    is_active,
    slot_expires_at  -- NULL para FREE (sin expiración, según decisión auditor)
)
SELECT 
    ca.user_id,
    'google_drive' AS provider,  -- Asumimos que todas las cuentas actuales son Google Drive
    ca.google_account_id AS provider_account_id,
    ca.account_email AS provider_email,
    ROW_NUMBER() OVER (PARTITION BY ca.user_id ORDER BY ca.created_at) AS slot_number,
    COALESCE(up.plan, 'free') AS plan_at_connection,
    COALESCE(ca.created_at, now()) AS connected_at,
    true AS is_active,  -- Todas las cuentas existentes se consideran activas
    NULL AS slot_expires_at  -- Sin expiración para usuarios FREE existentes
FROM cloud_accounts ca
LEFT JOIN user_plans up ON ca.user_id = up.user_id
WHERE ca.user_id IS NOT NULL  -- Solo migrar cuentas con usuario asignado
ON CONFLICT (user_id, provider, provider_account_id) DO NOTHING;  -- Evitar duplicados en re-ejecución

-- 4.4. Actualizar clouds_slots_used en user_plans basado en slots migrados
UPDATE user_plans up
SET clouds_slots_used = (
    SELECT COUNT(*)
    FROM cloud_slots_log csl
    WHERE csl.user_id = up.user_id
)
WHERE EXISTS (
    SELECT 1 FROM cloud_slots_log csl WHERE csl.user_id = up.user_id
);

-- 4.5. Vincular cloud_accounts con cloud_slots_log (asignar slot_log_id)
UPDATE cloud_accounts ca
SET slot_log_id = (
    SELECT csl.id
    FROM cloud_slots_log csl
    WHERE csl.user_id = ca.user_id
    AND csl.provider = 'google_drive'
    AND csl.provider_account_id = ca.google_account_id
    LIMIT 1
)
WHERE ca.user_id IS NOT NULL
AND ca.slot_log_id IS NULL;

-- 4.6. Migrar contador de copias para plan FREE
-- Asumimos que copies_used_month es el contador histórico actual (no ha habido reset aún)
UPDATE user_plans
SET total_lifetime_copies = COALESCE(copies_used_month, 0)
WHERE plan_type = 'FREE';

-- ==========================================
-- PARTE 5: VALIDACIÓN POST-MIGRACIÓN
-- ==========================================

-- Verificar que todos los usuarios tienen plan_type asignado
DO $$
DECLARE
    null_plan_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO null_plan_count
    FROM user_plans
    WHERE plan_type IS NULL;
    
    IF null_plan_count > 0 THEN
        RAISE EXCEPTION 'MIGRACIÓN FALLIDA: % usuarios sin plan_type asignado', null_plan_count;
    END IF;
    
    RAISE NOTICE 'Validación OK: Todos los usuarios tienen plan_type asignado';
END $$;

-- Verificar que clouds_slots_used coincide con slots en cloud_slots_log
DO $$
DECLARE
    mismatch_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO mismatch_count
    FROM user_plans up
    WHERE up.clouds_slots_used != (
        SELECT COUNT(*)
        FROM cloud_slots_log csl
        WHERE csl.user_id = up.user_id
    )
    AND EXISTS (SELECT 1 FROM cloud_slots_log csl WHERE csl.user_id = up.user_id);
    
    IF mismatch_count > 0 THEN
        RAISE EXCEPTION 'MIGRACIÓN FALLIDA: % usuarios con slots_used desincronizado', mismatch_count;
    END IF;
    
    RAISE NOTICE 'Validación OK: clouds_slots_used sincronizado con cloud_slots_log';
END $$;

-- Verificar que todas las cuentas activas tienen slot_log_id
DO $$
DECLARE
    missing_slot_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO missing_slot_count
    FROM cloud_accounts
    WHERE user_id IS NOT NULL
    AND slot_log_id IS NULL;
    
    IF missing_slot_count > 0 THEN
        RAISE WARNING 'ADVERTENCIA: % cuentas sin slot_log_id asignado', missing_slot_count;
    ELSE
        RAISE NOTICE 'Validación OK: Todas las cuentas tienen slot_log_id';
    END IF;
END $$;

-- ==========================================
-- PARTE 6: FUNCIÓN DE TRIGGER PARA updated_at
-- ==========================================

-- Crear función trigger para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Aplicar trigger a cloud_slots_log
DROP TRIGGER IF EXISTS update_cloud_slots_log_updated_at ON cloud_slots_log;
CREATE TRIGGER update_cloud_slots_log_updated_at
    BEFORE UPDATE ON cloud_slots_log
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ==========================================
-- PARTE 7: INFORMACIÓN DE MIGRACIÓN
-- ==========================================

DO $$
DECLARE
    total_users INTEGER;
    total_slots INTEGER;
    total_accounts INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_users FROM user_plans;
    SELECT COUNT(*) INTO total_slots FROM cloud_slots_log;
    SELECT COUNT(*) INTO total_accounts FROM cloud_accounts WHERE user_id IS NOT NULL;
    
    RAISE NOTICE '========================================';
    RAISE NOTICE 'MIGRACIÓN COMPLETADA EXITOSAMENTE';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Total de usuarios migrados: %', total_users;
    RAISE NOTICE 'Total de slots históricos creados: %', total_slots;
    RAISE NOTICE 'Total de cuentas vinculadas: %', total_accounts;
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Próximos pasos:';
    RAISE NOTICE '1. Verificar datos en tablas: SELECT * FROM cloud_slots_log LIMIT 10;';
    RAISE NOTICE '2. Actualizar código backend para usar nueva lógica';
    RAISE NOTICE '3. Desplegar backend con cambios de quota.py';
    RAISE NOTICE '========================================';
END $$;

-- Si todo es correcto, hacer commit
COMMIT;

-- Si hubo errores, descomentar la siguiente línea para hacer rollback:
-- ROLLBACK;
