-- ==========================================
-- RESETEAR USUARIO A PLAN FREE (PARA PRUEBAS)
-- ==========================================
-- Fecha: 2026-01-31
-- Propósito: Resetear un usuario específico del plan PRO/PAID al plan FREE
--            para poder hacer pruebas del flujo de upgrade
-- IMPORTANTE: Este script es solo para testing/desarrollo
-- NOTA: Si cancelaste en Stripe pero el webhook no actualizó la DB, usa este script

-- ==========================================
-- PASO 1: IDENTIFICAR EL USUARIO
-- ==========================================

-- Buscar tu usuario actual (reemplaza con tu email)
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
    up.transfer_bytes_used_month,
    up.max_file_bytes,
    up.updated_at
FROM auth.users u
LEFT JOIN user_plans up ON u.id = up.user_id
WHERE u.email ILIKE '%@%';  -- 👈 Muestra TODOS los usuarios primero

-- ==========================================
-- PASO 2: RESETEAR A PLAN FREE
-- ==========================================
-- IMPORTANTE: Después de ejecutar PASO 1, copia el user_id de tu usuario
-- y reemplázalo en la línea WHERE user_id = '...' abajo

-- Actualizar el usuario a plan FREE y limpiar todos los campos de Stripe
UPDATE user_plans
SET 
    -- Plan configuration
    plan = 'free',
    plan_type = 'FREE',
    billing_period = 'MONTHLY',
    
    -- FREE plan limits
    clouds_slots_total = 2,  -- Free = 2 slots (ilimitados en realidad, pero UI muestra 2)
    clouds_slots_used = 0,   -- Resetear contador
    
    -- Copies limits (Free = ilimitadas, pero se puede trackear)
    copies_used_month = 0,
    total_lifetime_copies = 0,
    
    -- Transfer limits (Free = 5 GB lifetime)
    transfer_bytes_limit_lifetime = 5368709120,  -- 5 GB en bytes
    transfer_bytes_used_lifetime = 0,
    transfer_bytes_used_month = 0,
    
    -- File size limit (Free = 1 GB)
    max_file_bytes = 1073741824,  -- 1 GB en bytes
    
    -- Period
    period_start = date_trunc('month', now()),
    plan_expires_at = NULL,  -- FREE no tiene expiración (IMPORTANTE para el constraint)
    
    -- Stripe fields (limpiar completamente)
    stripe_customer_id = NULL,
    stripe_subscription_id = NULL,
    subscription_status = NULL,
    
    -- Update timestamp
    updated_at = now()
WHERE user_id = '62bf37c1-6f50-46f2-9f57-7a0b5136ed1d';  -- 👈 REEMPLAZAR con el user_id de arriba

-- ==========================================
-- PASO 3: VERIFICACIÓN
-- ==========================================

-- Verificar que el cambio se aplicó correctamente
SELECT 
    u.email,
    up.plan,
    up.plan_type,
    up.billing_period,
    up.clouds_slots_total,
    up.clouds_slots_used,
    ROUND(up.transfer_bytes_limit_lifetime::numeric / 1073741824, 2) as limit_lifetime_gb,
    ROUND(up.transfer_bytes_used_lifetime::numeric / 1073741824, 2) as used_lifetime_gb,
    ROUND(up.max_file_bytes::numeric / 1073741824, 2) as max_file_gb,
    up.stripe_customer_id,
    up.stripe_subscription_id,
    up.subscription_status
FROM auth.users u
JOIN user_plans up ON u.id = up.user_id
WHERE u.id = '62bf37c1-6f50-46f2-9f57-7a0b5136ed1d';  -- 👈 Mismo user_id del PASO 2

-- ==========================================
-- OPCIONAL: RESETEAR TODAS LAS MÉTRICAS
-- ==========================================

-- Si quieres empezar completamente desde cero, puedes también:
-- 1. Limpiar el historial de copias (NO RECOMENDADO en producción)
/*
DELETE FROM file_copy_history 
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'TU_EMAIL_AQUI@gmail.com');
*/

-- 2. Resetear los contadores de transferencia en cloud_accounts
/*
UPDATE cloud_accounts
SET 
    storage_used_bytes = 0,
    storage_limit_bytes = storage_limit_bytes  -- Mantener límite original
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'TU_EMAIL_AQUI@gmail.com');
*/

-- ==========================================
-- RESULTADO ESPERADO
-- ==========================================

/*
Después de ejecutar este script:

✅ Plan: 'free'
✅ Plan Type: 'FREE'
✅ Billing Period: 'MONTHLY'
✅ Clouds Slots: 2 (en realidad ilimitados para FREE)
✅ Copies: Ilimitadas (contadores en 0)
✅ Transfer: 5 GB lifetime (contador en 0)
✅ Max File Size: 1 GB
✅ Stripe Customer ID: NULL
✅ Stripe Subscription ID: NULL
✅ Subscription Status: NULL

IMPORTANTE:
- Si tenías una suscripción activa en Stripe, este script NO la cancela en Stripe.
- Solo limpia los datos en tu base de datos local.
- Para cancelar la suscripción en Stripe, debes hacerlo desde el Stripe Dashboard
  o implementar la funcionalidad de cancelación en la app.
- Después de este reset, puedes probar el flujo completo de upgrade a Standard/Premium.
*/

-- ==========================================
-- NOTAS ADICIONALES
-- ==========================================

/*
LÍMITES DE CADA PLAN (Referencia):

FREE:
- Clouds Slots: Ilimitados (2 mostrados en UI)
- Copies: Ilimitadas
- Transfer: 5 GB lifetime
- Max File: 1 GB

STANDARD (Monthly: $9.99, Yearly: $59.99):
- Clouds Slots: Ilimitados
- Copies: Ilimitadas
- Transfer: 100 GB/mes (1200 GB/año)
- Max File: 10 GB

PREMIUM (Monthly: $17.99, Yearly: $99.98):
- Clouds Slots: Ilimitados
- Copies: Ilimitadas
- Transfer: 200 GB/mes (2400 GB/año)
- Max File: 50 GB
*/
