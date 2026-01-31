-- ==========================================
-- PREPARAR USUARIOS EXISTENTES PARA NUEVO SISTEMA DE BILLING
-- ==========================================
-- Fecha: 2026-01-31
-- Propósito: Asegurar que usuarios existentes estén listos para probar el flujo de pago
-- Safe: No elimina datos, solo actualiza campos faltantes

-- ==========================================
-- PASO 1: VERIFICACIÓN DE USUARIOS ACTUALES
-- ==========================================

-- Ver todos los usuarios y su estado actual
SELECT 
    u.id as user_id,
    u.email,
    up.plan,
    up.plan_type,
    up.billing_period,
    up.stripe_customer_id,
    up.stripe_subscription_id,
    up.subscription_status,
    up.clouds_slots_used,
    up.clouds_slots_total,
    up.copies_used_month,
    up.total_lifetime_copies,
    up.transfer_bytes_used_month,
    up.transfer_bytes_used_lifetime,
    up.max_file_bytes,
    up.period_start,
    up.updated_at,
    u.created_at as user_created_at
FROM auth.users u
LEFT JOIN user_plans up ON u.id = up.user_id
ORDER BY u.created_at DESC;

-- ==========================================
-- PASO 2: CREAR PLANES PARA USUARIOS SIN user_plans
-- ==========================================
-- Si hay usuarios sin registro en user_plans, crearlos con plan FREE

INSERT INTO user_plans (
    user_id,
    plan,
    plan_type,
    billing_period,
    clouds_slots_total,
    clouds_slots_used,
    copies_used_month,
    total_lifetime_copies,
    transfer_bytes_limit_lifetime,
    transfer_bytes_used_lifetime,
    transfer_bytes_used_month,
    max_file_bytes,
    period_start,
    updated_at
)
SELECT 
    u.id,
    'free' as plan,
    'FREE' as plan_type,
    'MONTHLY' as billing_period,
    2 as clouds_slots_total,
    0 as clouds_slots_used,
    0 as copies_used_month,
    0 as total_lifetime_copies,
    10737418240 as transfer_bytes_limit_lifetime,  -- 10 GB
    0 as transfer_bytes_used_lifetime,
    0 as transfer_bytes_used_month,
    1073741824 as max_file_bytes,  -- 1 GB
    date_trunc('month', now()) as period_start,
    now() as updated_at
FROM auth.users u
WHERE NOT EXISTS (
    SELECT 1 FROM user_plans up WHERE up.user_id = u.id
)
ON CONFLICT (user_id) DO NOTHING;

-- ==========================================
-- PASO 3: ACTUALIZAR USUARIOS EXISTENTES
-- ==========================================
-- Asegurar que todos los usuarios FREE tengan los valores correctos

UPDATE user_plans
SET 
    plan = COALESCE(plan, 'free'),
    plan_type = 'FREE',
    billing_period = COALESCE(billing_period, 'MONTHLY'),
    clouds_slots_total = COALESCE(clouds_slots_total, 2),
    clouds_slots_used = COALESCE(clouds_slots_used, 0),
    copies_used_month = COALESCE(copies_used_month, 0),
    total_lifetime_copies = COALESCE(total_lifetime_copies, 0),
    transfer_bytes_limit_lifetime = COALESCE(transfer_bytes_limit_lifetime, 10737418240),  -- 10 GB
    transfer_bytes_used_lifetime = COALESCE(transfer_bytes_used_lifetime, 0),
    transfer_bytes_used_month = COALESCE(transfer_bytes_used_month, 0),
    max_file_bytes = COALESCE(max_file_bytes, 1073741824),  -- 1 GB
    period_start = COALESCE(period_start, date_trunc('month', now())),
    -- Limpiar campos de Stripe para usuarios FREE
    stripe_customer_id = NULL,
    stripe_subscription_id = NULL,
    subscription_status = NULL
WHERE plan IN ('free', 'FREE') OR plan IS NULL;

-- ==========================================
-- PASO 4: RESETEAR CONTADORES PARA PRUEBAS
-- ==========================================
-- OPCIONAL: Si quieres que los usuarios de prueba empiecen desde cero

-- Descomentar si quieres resetear los contadores:
/*
UPDATE user_plans
SET 
    copies_used_month = 0,
    total_lifetime_copies = 0,
    transfer_bytes_used_month = 0,
    transfer_bytes_used_lifetime = 0,
    clouds_slots_used = 0
WHERE plan = 'free';
*/

-- ==========================================
-- PASO 5: VERIFICACIÓN FINAL
-- ==========================================

-- Verificar que todos los usuarios FREE están correctos
SELECT 
    u.email,
    up.plan,
    up.plan_type,
    up.billing_period,
    up.clouds_slots_total,
    up.clouds_slots_used,
    up.total_lifetime_copies,
    ROUND(up.transfer_bytes_limit_lifetime::numeric / 1073741824, 2) as limit_lifetime_gb,
    ROUND(up.transfer_bytes_used_lifetime::numeric / 1073741824, 2) as used_lifetime_gb,
    ROUND(up.max_file_bytes::numeric / 1073741824, 2) as max_file_gb,
    up.stripe_customer_id,
    up.subscription_status
FROM auth.users u
JOIN user_plans up ON u.id = up.user_id
WHERE up.plan = 'free'
ORDER BY u.created_at DESC;

-- Contar usuarios por plan
SELECT 
    plan,
    plan_type,
    billing_period,
    COUNT(*) as total_users,
    COUNT(stripe_customer_id) as with_stripe_customer,
    COUNT(subscription_status) as with_active_subscription
FROM user_plans
GROUP BY plan, plan_type, billing_period
ORDER BY plan;

-- ==========================================
-- RESUMEN DE CAMBIOS
-- ==========================================

-- Ver los cambios que se hicieron
SELECT 
    'Usuarios sin user_plans creados' as tipo,
    COUNT(*) as cantidad
FROM auth.users u
WHERE EXISTS (
    SELECT 1 FROM user_plans up 
    WHERE up.user_id = u.id 
    AND up.updated_at >= now() - INTERVAL '1 minute'
)

UNION ALL

SELECT 
    'Usuarios FREE listos para pruebas' as tipo,
    COUNT(*) as cantidad
FROM user_plans
WHERE plan = 'free'
  AND plan_type = 'FREE'
  AND billing_period = 'MONTHLY'
  AND max_file_bytes = 1073741824
  AND transfer_bytes_limit_lifetime = 10737418240;

-- ==========================================
-- ¿QUÉ HACE ESTE SCRIPT?
-- ==========================================

/*
1. VERIFICA: Muestra todos los usuarios actuales y su estado
2. CREA: Registros en user_plans para usuarios que no tienen
3. ACTUALIZA: Asegura que usuarios FREE tienen valores correctos:
   - plan = 'free'
   - plan_type = 'FREE'
   - billing_period = 'MONTHLY'
   - clouds_slots_total = 2
   - max_file_bytes = 1 GB
   - transfer_bytes_limit_lifetime = 10 GB
   - Limpia stripe_customer_id, stripe_subscription_id (NULL)
   
4. OPCIONAL: Resetea contadores para empezar pruebas desde cero
5. VERIFICA: Muestra estado final de todos los usuarios

PARA PRUEBAS DE FLUJO DE PAGO:
- Usuarios FREE pueden hacer upgrade a Standard/Premium
- No tienen stripe_customer_id → Stripe creará nuevo customer
- Al completar checkout, webhook actualizará:
  * plan → 'standard_monthly' | 'standard_yearly' | 'premium_monthly' | 'premium_yearly'
  * plan_type → 'PAID'
  * billing_period → 'MONTHLY' | 'YEARLY'
  * stripe_customer_id → 'cus_xxx'
  * stripe_subscription_id → 'sub_xxx'
  * subscription_status → 'active'
  * max_file_bytes → 10 GB o 25 GB
  * transfer_bytes_limit_month → 500 GB o 2000 GB
*/
