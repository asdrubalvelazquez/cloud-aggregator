# 🔄 Guía: Cancelar Suscripción de Usuario en Stripe

## 📋 Resumen

Tu app ya tiene **webhooks automáticos** que se encargan de limpiar todo cuando cancelas una suscripción en Stripe. **NO necesitas hacer nada manualmente** en tu base de datos.

## ✅ Proceso Correcto

### Opción 1: Cancelar desde Stripe Dashboard (RECOMENDADO)

1. **Ir a Stripe Dashboard**
   - Test mode: https://dashboard.stripe.com/test/subscriptions
   - Live mode: https://dashboard.stripe.com/subscriptions

2. **Buscar al usuario**
   - Busca por email del usuario
   - O busca por Customer ID (empieza con `cus_`)

3. **Cancelar la suscripción**
   - Click en la suscripción activa
   - Click en "Cancel subscription"
   - Elige una de estas opciones:

   **a) Cancel immediately (Sin reembolso)**
   - La suscripción se cancela al instante
   - El usuario NO recibe reembolso
   - Pierde acceso inmediatamente al plan PAID
   - ✅ **Recomendado para testing/desarrollo**

   **b) Cancel at period end (Sin reembolso)**
   - La suscripción sigue activa hasta el final del período actual
   - El usuario mantiene acceso hasta que expire
   - Al expirar, automáticamente baja a FREE
   - ✅ **Recomendado para producción** (mejor experiencia de usuario)

4. **Confirmar cancelación**
   - Click en "Cancel subscription"
   - Stripe enviará webhook a tu backend automáticamente

### Opción 2: Cancelar con Stripe CLI (Para testing)

```bash
# Listar suscripciones del usuario
stripe subscriptions list --customer cus_XXXXX

# Cancelar inmediatamente
stripe subscriptions cancel sub_XXXXX

# O cancelar al final del período
stripe subscriptions update sub_XXXXX --cancel-at-period-end=true
```

## 🤖 ¿Qué Hace el Webhook Automáticamente?

Cuando cancelas en Stripe, tu backend recibe el evento `customer.subscription.deleted` y **automáticamente**:

### 1. Actualiza la Base de Datos

```python
# Archivo: backend/backend/main.py
# Función: handle_subscription_deleted()

✅ plan = 'free'
✅ plan_type = 'FREE'
✅ plan_expires_at = NULL
✅ stripe_subscription_id = NULL
✅ subscription_status = 'canceled'
✅ copies_limit_month = NULL
✅ transfer_bytes_limit_month = NULL
✅ copies_used_month = 0
✅ transfer_bytes_used_month = 0
✅ period_start = primer día del mes actual
```

### 2. Mantiene el Customer ID

```python
✅ stripe_customer_id = 'cus_XXXXX'  # SE MANTIENE (para reactivaciones)
```

**¿Por qué?** Si el usuario quiere volver a suscribirse, Stripe reutiliza el mismo Customer ID y no necesita volver a guardar su tarjeta.

## 💰 ¿Cuándo Hacer Reembolso?

### NO necesitas reembolso si:

- ❌ El usuario canceló por su propia voluntad
- ❌ Es para testing/desarrollo
- ❌ Quieres simplemente resetear el plan a FREE

### SÍ necesitas reembolso si:

- ✅ Hubo un error en el cobro
- ✅ El usuario pagó por accidente
- ✅ Vas a cancelar por un problema de tu lado (bug, error, etc.)
- ✅ Quieres hacer un "gesture of goodwill" por mala experiencia

## 💸 Cómo Hacer un Reembolso (Si es necesario)

### Desde Stripe Dashboard:

1. Ve a: https://dashboard.stripe.com/test/payments
2. Busca el pago del usuario (por email o fecha)
3. Click en el Payment Intent
4. Click en "Refund payment"
5. Opciones:
   - **Full refund**: Devuelve todo el dinero
   - **Partial refund**: Devuelve una parte (ej: prorrateado)
6. Agrega un motivo (opcional pero recomendado)
7. Click en "Refund"

### Con Stripe CLI:

```bash
# Ver pagos del cliente
stripe payment_intents list --customer cus_XXXXX

# Reembolso completo
stripe refunds create --payment-intent pi_XXXXX

# Reembolso parcial (ej: $5.00)
stripe refunds create --payment-intent pi_XXXXX --amount 500
```

## 🔍 Verificar que Todo Funcionó

### 1. Revisa los Logs del Backend

```powershell
# En Fly.io (producción)
fly logs

# Busca esto:
[STRIPE_WEBHOOK] customer.subscription.deleted: user_id=xxx, subscription_id=sub_xxx
[STRIPE_WEBHOOK] ✅ User xxx downgraded to FREE successfully
```

### 2. Verifica en la Base de Datos

```sql
SELECT 
    u.email,
    up.plan,
    up.plan_type,
    up.billing_period,
    up.stripe_customer_id,
    up.stripe_subscription_id,
    up.subscription_status,
    ROUND(up.transfer_bytes_limit_lifetime::numeric / 1073741824, 2) as limit_lifetime_gb,
    up.max_file_bytes
FROM auth.users u
JOIN user_plans up ON u.id = up.user_id
WHERE u.email = 'usuario@email.com';
```

**Resultado esperado:**
```
plan: 'free'
plan_type: 'FREE'
stripe_customer_id: 'cus_XXXXX'  (mantiene el customer)
stripe_subscription_id: NULL     (subscription borrada)
subscription_status: 'canceled'
transfer_bytes_limit_lifetime: 5 GB
max_file_bytes: 1 GB
```

### 3. Verifica en el Frontend

- Ve a la página `/pricing`
- El usuario debe ver el badge "PLAN ACTUAL" en la tarjeta de FREE
- Los botones de Standard/Premium deben estar habilitados para upgrade

## 📊 Flujo Completo Cancelación

```
Usuario con plan STANDARD/PREMIUM
           ↓
Cancelas en Stripe Dashboard
  (Cancel immediately o Cancel at period end)
           ↓
Stripe envía webhook: customer.subscription.deleted
           ↓
Tu backend (main.py) recibe el webhook
           ↓
handle_subscription_deleted() se ejecuta
           ↓
Actualiza user_plans automáticamente:
  - plan = 'free'
  - stripe_subscription_id = NULL
  - subscription_status = 'canceled'
  - Límites FREE aplicados
           ↓
Usuario ahora tiene plan FREE
  ✅ Puede volver a hacer upgrade cuando quiera
```

## ⚠️ IMPORTANTE: No Ejecutar el Script SQL Manual

Si ya tienes el webhook configurado y funcionando:

**❌ NO ejecutes:** `reset_user_to_free_plan.sql`  
**✅ SÍ usa:** Cancelación en Stripe Dashboard

El script SQL manual es **solo para emergencias** cuando:
- El webhook no está funcionando
- Quieres resetear sin tocar Stripe
- Estás en desarrollo local sin webhooks configurados

## 🧪 Testing del Flujo Completo

### Paso 1: Crear suscripción de prueba
```
1. Usuario hace upgrade a Standard/Premium
2. Completa pago con tarjeta 4242 4242 4242 4242
3. Webhook actualiza plan a PAID
```

### Paso 2: Verificar upgrade
```sql
SELECT plan, plan_type, stripe_subscription_id, subscription_status
FROM user_plans WHERE user_id = 'xxx';

-- Debe mostrar:
-- plan: 'standard_monthly' o 'premium_monthly'
-- plan_type: 'PAID'
-- subscription_status: 'active'
```

### Paso 3: Cancelar en Stripe
```
1. Dashboard → Subscriptions
2. Buscar subscription del usuario
3. Cancel → Cancel immediately
```

### Paso 4: Verificar downgrade automático
```sql
SELECT plan, plan_type, stripe_subscription_id, subscription_status
FROM user_plans WHERE user_id = 'xxx';

-- Debe mostrar:
-- plan: 'free'
-- plan_type: 'FREE'
-- stripe_subscription_id: NULL
-- subscription_status: 'canceled'
```

## 🔗 Webhooks que Manejan Suscripciones

Tu backend maneja estos eventos automáticamente:

| Evento | Qué Hace |
|--------|----------|
| `checkout.session.completed` | Upgrade a PAID |
| `customer.subscription.deleted` | Downgrade a FREE |
| `customer.subscription.updated` | Actualiza estado (active → past_due, etc.) |
| `invoice.paid` | Marca suscripción como activa |
| `invoice.payment_failed` | Marca suscripción como past_due |

## 📝 Notas Finales

1. **Siempre cancela desde Stripe** - El webhook se encarga de todo
2. **No toques la BD manualmente** a menos que sea necesario
3. **Los reembolsos son opcionales** - Solo para casos especiales
4. **El Customer ID se mantiene** - Facilita reactivaciones
5. **Los webhooks son idempotentes** - No hay problema si Stripe reintenta

## 🆘 Troubleshooting

### Webhook no funciona

**Síntomas:** Cancelas en Stripe pero el usuario sigue con plan PAID en tu app

**Solución:**
```powershell
# 1. Verifica que el webhook esté configurado
fly secrets list

# 2. Debe estar: STRIPE_WEBHOOK_SECRET=whsec_...
# 3. Si no está, configúralo:
fly secrets set STRIPE_WEBHOOK_SECRET="whsec_TU_SECRET"

# 4. Revisa los logs cuando canceles:
fly logs
```

### Usuario ya canceló pero la DB no se actualizó

**Solución temporal (solo si webhook falló):**
```sql
-- Usa el script manual una sola vez
-- Reemplaza el email:
UPDATE user_plans
SET 
    plan = 'free',
    plan_type = 'FREE',
    stripe_subscription_id = NULL,
    subscription_status = 'canceled',
    plan_expires_at = NULL,
    copies_limit_month = NULL,
    transfer_bytes_limit_month = NULL,
    transfer_bytes_limit_lifetime = 5368709120,
    max_file_bytes = 1073741824,
    updated_at = now()
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'usuario@email.com');
```

Luego **arregla el webhook** para que no vuelva a pasar.
