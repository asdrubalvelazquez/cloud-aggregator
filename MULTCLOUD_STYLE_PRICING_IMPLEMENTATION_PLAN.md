# 🚀 Plan de Implementación: Nuevos Planes Estilo MultCloud

## 📊 Resumen de Cambios

**Objetivo**: Implementar 6 planes de precios en Cloud Aggregator siguiendo el modelo de MultCloud.

### Planes Actuales vs Nuevos

| Actual | → | Nuevo |
|--------|---|-------|
| Free: $0, 5GB lifetime | → | Free: $0, 50GB/mes |
| Plus: $5/mes, 200GB/mes | → | Standard: $7.99/mes, 100GB/mes |
| Pro: $10/mes, 1TB/mes | → | Annual Basic: $49.99/año, 1200GB |
| - | → | Annual Premium: $89.98/año, 2400GB |
| - | → | Annual Unlimited: $109/año, ilimitado |
| - | → | Lifetime: $239 (una vez), ilimitado |

---

## 🎯 Fase 1: Análisis y Planificación

### 1.1 Decisiones de Arquitectura

#### Billing Periods
Necesitamos soportar 3 tipos de períodos:
- `MONTHLY` - Facturación mensual (planes mensuales)
- `YEARLY` - Facturación anual (planes anuales)
- `LIFETIME` - Pago único (plan lifetime)

#### Plan Naming Convention
```
free           - Plan gratuito
standard       - $7.99/mes
annual_basic   - $49.99/año (1200GB)
annual_premium - $89.98/año (2400GB)
annual_unlimited - $109/año (ilimitado)
lifetime       - $239 (una vez, ilimitado)
```

### 1.2 Cambios en Base de Datos

#### Tabla `user_plans` - Nuevas columnas necesarias

```sql
-- Agregar columna para billing period
ALTER TABLE user_plans 
ADD COLUMN billing_period TEXT CHECK (billing_period IN ('MONTHLY', 'YEARLY', 'LIFETIME'));

-- Agregar columna para indicar si es plan lifetime
ALTER TABLE user_plans 
ADD COLUMN is_lifetime BOOLEAN DEFAULT FALSE;

-- Actualizar constraint para FREE plan
-- FREE ahora usa límites mensuales, no lifetime
ALTER TABLE user_plans 
DROP CONSTRAINT IF EXISTS check_free_plan_no_expiration;

-- Agregar constraint para LIFETIME plans
ALTER TABLE user_plans 
ADD CONSTRAINT check_lifetime_no_expiration 
CHECK (
  (is_lifetime = TRUE AND plan_expires_at IS NULL) OR
  (is_lifetime = FALSE)
);

-- Migrar datos existentes
UPDATE user_plans SET billing_period = 'MONTHLY' WHERE plan IN ('plus', 'pro');
UPDATE user_plans SET billing_period = NULL WHERE plan = 'free';
UPDATE user_plans SET is_lifetime = FALSE;
```

---

## 🔧 Fase 2: Implementación Backend

### 2.1 Actualizar `billing_plans.py`

Necesitamos rediseñar completamente el archivo para soportar:
- Planes anuales
- Planes lifetime
- Límites ilimitados (None para ilimitado)

**Estructura Nueva:**

```python
@dataclass
class PlanLimits:
    """Billing plan limits configuration"""
    plan_name: str
    plan_type: str  # "FREE" | "PAID_MONTHLY" | "PAID_YEARLY" | "PAID_LIFETIME"
    billing_period: str  # "MONTHLY" | "YEARLY" | "LIFETIME"
    price_monthly: float  # Precio efectivo por mes
    price_total: float    # Precio total a pagar
    
    # Cloud slots
    clouds_slots_total: int
    
    # Copy quota
    copies_limit_month: Optional[int]
    
    # Transfer bandwidth (in BYTES, None = unlimited)
    transfer_bytes_limit_month: Optional[int]  # None = unlimited
    
    # File size (in BYTES)
    max_file_bytes: int
```

**Nuevos Planes:**

```python
PLANS = {
    "free": PlanLimits(
        plan_name="free",
        plan_type="FREE",
        billing_period="MONTHLY",
        price_monthly=0.0,
        price_total=0.0,
        clouds_slots_total=2,
        copies_limit_month=None,  # Ilimitado
        transfer_bytes_limit_month=53_687_091_200,  # 50GB
        max_file_bytes=1_073_741_824  # 1GB
    ),
    "standard": PlanLimits(
        plan_name="standard",
        plan_type="PAID_MONTHLY",
        billing_period="MONTHLY",
        price_monthly=7.99,
        price_total=7.99,
        clouds_slots_total=5,
        copies_limit_month=None,  # Ilimitado
        transfer_bytes_limit_month=107_374_182_400,  # 100GB
        max_file_bytes=5_368_709_120  # 5GB
    ),
    "annual_basic": PlanLimits(
        plan_name="annual_basic",
        plan_type="PAID_YEARLY",
        billing_period="YEARLY",
        price_monthly=4.17,  # $49.99/12
        price_total=49.99,
        clouds_slots_total=5,
        copies_limit_month=None,
        transfer_bytes_limit_month=107_374_182_400,  # 100GB/mes
        max_file_bytes=5_368_709_120  # 5GB
    ),
    "annual_premium": PlanLimits(
        plan_name="annual_premium",
        plan_type="PAID_YEARLY",
        billing_period="YEARLY",
        price_monthly=7.50,  # $89.98/12
        price_total=89.98,
        clouds_slots_total=10,
        copies_limit_month=None,
        transfer_bytes_limit_month=214_748_364_800,  # 200GB/mes
        max_file_bytes=10_737_418_240  # 10GB
    ),
    "annual_unlimited": PlanLimits(
        plan_name="annual_unlimited",
        plan_type="PAID_YEARLY",
        billing_period="YEARLY",
        price_monthly=9.08,  # $109/12
        price_total=109.0,
        clouds_slots_total=20,
        copies_limit_month=None,
        transfer_bytes_limit_month=None,  # UNLIMITED
        max_file_bytes=53_687_091_200  # 50GB
    ),
    "lifetime": PlanLimits(
        plan_name="lifetime",
        plan_type="PAID_LIFETIME",
        billing_period="LIFETIME",
        price_monthly=0.0,  # N/A
        price_total=239.0,
        clouds_slots_total=999,  # Prácticamente ilimitado
        copies_limit_month=None,
        transfer_bytes_limit_month=None,  # UNLIMITED
        max_file_bytes=107_374_182_400  # 100GB
    )
}
```

### 2.2 Actualizar `stripe_utils.py`

Agregar los nuevos Price IDs:

```python
# Stripe price IDs (loaded from environment variables)
STRIPE_PRICE_STANDARD = os.getenv("STRIPE_PRICE_STANDARD")
STRIPE_PRICE_ANNUAL_BASIC = os.getenv("STRIPE_PRICE_ANNUAL_BASIC")
STRIPE_PRICE_ANNUAL_PREMIUM = os.getenv("STRIPE_PRICE_ANNUAL_PREMIUM")
STRIPE_PRICE_ANNUAL_UNLIMITED = os.getenv("STRIPE_PRICE_ANNUAL_UNLIMITED")
STRIPE_PRICE_LIFETIME = os.getenv("STRIPE_PRICE_LIFETIME")

# Validate configuration on module load
if not all([STRIPE_PRICE_STANDARD, STRIPE_PRICE_ANNUAL_BASIC, 
            STRIPE_PRICE_ANNUAL_PREMIUM, STRIPE_PRICE_ANNUAL_UNLIMITED,
            STRIPE_PRICE_LIFETIME]):
    logging.warning(
        "[STRIPE_CONFIG] ⚠️ Missing Stripe price IDs. "
        "Stripe functionality will be limited."
    )

# Allowlist of valid price IDs
VALID_PRICE_IDS = {
    STRIPE_PRICE_STANDARD,
    STRIPE_PRICE_ANNUAL_BASIC,
    STRIPE_PRICE_ANNUAL_PREMIUM,
    STRIPE_PRICE_ANNUAL_UNLIMITED,
    STRIPE_PRICE_LIFETIME
} - {None}


def map_price_to_plan(price_id: str) -> Optional[str]:
    """Map Stripe price_id to internal plan code."""
    if not price_id or price_id not in VALID_PRICE_IDS:
        return None
    
    mapping = {
        STRIPE_PRICE_STANDARD: "standard",
        STRIPE_PRICE_ANNUAL_BASIC: "annual_basic",
        STRIPE_PRICE_ANNUAL_PREMIUM: "annual_premium",
        STRIPE_PRICE_ANNUAL_UNLIMITED: "annual_unlimited",
        STRIPE_PRICE_LIFETIME: "lifetime"
    }
    
    return mapping.get(price_id)
```

### 2.3 Actualizar `main.py`

#### 2.3.1 Endpoint `/stripe/create-checkout-session`

Cambios necesarios:

```python
@app.post("/stripe/create-checkout-session")
def create_checkout_session(
    request: CreateCheckoutSessionRequest,
    user_id: str = Depends(verify_supabase_jwt)
):
    # Validation: plan_code allowlist
    plan_code = request.plan_code.lower()
    valid_plans = ["standard", "annual_basic", "annual_premium", 
                   "annual_unlimited", "lifetime"]
    
    if plan_code not in valid_plans:
        raise HTTPException(
            status_code=400, 
            detail=f"Invalid plan_code. Must be one of: {', '.join(valid_plans)}"
        )
    
    # Map plan_code to Stripe price_id
    price_id_map = {
        "standard": STRIPE_PRICE_STANDARD,
        "annual_basic": STRIPE_PRICE_ANNUAL_BASIC,
        "annual_premium": STRIPE_PRICE_ANNUAL_PREMIUM,
        "annual_unlimited": STRIPE_PRICE_ANNUAL_UNLIMITED,
        "lifetime": STRIPE_PRICE_LIFETIME
    }
    price_id = price_id_map[plan_code]
    
    # Determinar mode: subscription vs payment (lifetime)
    if plan_code == "lifetime":
        mode = "payment"  # One-time payment
    else:
        mode = "subscription"  # Recurring
    
    # Create Stripe Checkout Session
    checkout_session = stripe.checkout.Session.create(
        customer=stripe_customer_id,
        payment_method_types=["card"],
        line_items=[{
            "price": price_id,
            "quantity": 1
        }],
        mode=mode,  # "subscription" o "payment"
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={
            "user_id": user_id,
            "plan_code": plan_code
        },
        allow_promotion_codes=True,
        billing_address_collection="auto"
    )
    
    return {"url": checkout_session.url}
```

#### 2.3.2 Webhook Handler - `checkout.session.completed`

Para planes lifetime, el flujo es diferente:

```python
def handle_checkout_completed(event: dict):
    session = event["data"]["object"]
    metadata = session.get("metadata", {})
    plan_code = metadata.get("plan_code", "").lower()
    
    # Get plan limits
    plan_limits = get_plan_limits(plan_code)
    
    # Determinar si es lifetime o subscription
    is_lifetime = (plan_code == "lifetime")
    
    if is_lifetime:
        # Lifetime: No subscription_id, no expiration
        subscription_id = None
        plan_expires_at = None
        billing_period = "LIFETIME"
    else:
        # Subscription: Get subscription details
        subscription_id = session.get("subscription")
        sub = stripe.Subscription.retrieve(subscription_id)
        current_period_end = getattr(sub, "current_period_end", None)
        plan_expires_at = datetime.fromtimestamp(
            current_period_end, tz=timezone.utc
        ).isoformat()
        
        # Determinar billing_period
        if plan_code.startswith("annual_"):
            billing_period = "YEARLY"
        else:
            billing_period = "MONTHLY"
    
    # Update user_plans
    update_data = {
        "plan": plan_code,
        "plan_type": plan_limits.plan_type,
        "billing_period": billing_period,
        "is_lifetime": is_lifetime,
        "plan_expires_at": plan_expires_at,
        "stripe_customer_id": customer_id,
        "stripe_subscription_id": subscription_id,
        "subscription_status": "active" if not is_lifetime else None,
        "copies_limit_month": plan_limits.copies_limit_month,
        "transfer_bytes_limit_month": plan_limits.transfer_bytes_limit_month,
        "copies_used_month": 0,
        "transfer_bytes_used_month": 0,
        "period_start": now.isoformat(),
        "updated_at": now.isoformat()
    }
    
    result = supabase.table("user_plans").update(update_data).eq("user_id", user_id).execute()
```

#### 2.3.3 Nuevo Endpoint: Reset Mensual para Planes Anuales

Los planes anuales necesitan resetear el contador mensual:

```python
# Cronjob diario (ejecutar con Fly.io cron o similar)
@app.post("/internal/reset-monthly-quotas")
async def reset_monthly_quotas(api_key: str = Header(None)):
    """
    Reset monthly quotas for annual/yearly plans.
    Run daily via cron job.
    """
    # Validar API key interna
    if api_key != os.getenv("INTERNAL_API_KEY"):
        raise HTTPException(status_code=403, detail="Unauthorized")
    
    now = datetime.now(timezone.utc)
    first_day_of_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    
    # Resetear contadores para todos los usuarios con planes activos
    result = supabase.table("user_plans").update({
        "copies_used_month": 0,
        "transfer_bytes_used_month": 0,
        "period_start": first_day_of_month.isoformat()
    }).neq("plan", "free").execute()
    
    logging.info(f"[QUOTA_RESET] Monthly quotas reset for {len(result.data)} users")
    return {"reset": len(result.data)}
```

---

## 🎨 Fase 3: Implementación Frontend

### 3.1 Actualizar `frontend/src/app/pricing/page.tsx`

**Nueva estructura de planes:**

```tsx
type Plan = {
  name: string;
  code: string;  // Para enviar al backend
  price: string;
  period: string;  // "/mes", "/año", "pago único"
  savings?: string;  // Texto de ahorro
  transfer_gb: number | null; // null = ilimitado
  max_file_gb: number;
  features: string[];
  isMostPopular?: boolean;
};

const plans: Plan[] = [
  {
    name: "Free",
    code: "free",
    price: "$0",
    period: "",
    transfer_gb: 50,
    max_file_gb: 1,
    features: [
      "2 cuentas conectadas",
      "Copias ilimitadas",
      "50 GB de transferencia/mes",
      "Archivos hasta 1 GB",
      "Soporte básico",
    ],
  },
  {
    name: "Standard",
    code: "standard",
    price: "$7.99",
    period: "/mes",
    transfer_gb: 100,
    max_file_gb: 5,
    isMostPopular: true,
    features: [
      "5 cuentas conectadas",
      "Copias ilimitadas",
      "100 GB de transferencia/mes",
      "Archivos hasta 5 GB",
      "Soporte prioritario",
      "Velocidad mejorada",
    ],
  },
  {
    name: "Annual Basic",
    code: "annual_basic",
    price: "$49.99",
    period: "/año",
    savings: "Ahorra $46 vs mensual",
    transfer_gb: 100,
    max_file_gb: 5,
    features: [
      "5 cuentas conectadas",
      "Copias ilimitadas",
      "100 GB de transferencia/mes",
      "Archivos hasta 5 GB",
      "Soporte prioritario",
      "Facturación anual",
    ],
  },
  {
    name: "Annual Premium",
    code: "annual_premium",
    price: "$89.98",
    period: "/año",
    savings: "Ahorra $101 vs mensual",
    transfer_gb: 200,
    max_file_gb: 10,
    features: [
      "10 cuentas conectadas",
      "Copias ilimitadas",
      "200 GB de transferencia/mes",
      "Archivos hasta 10 GB",
      "Soporte VIP",
      "Facturación anual",
    ],
  },
  {
    name: "Annual Unlimited",
    code: "annual_unlimited",
    price: "$109",
    period: "/año",
    transfer_gb: null, // ilimitado
    max_file_gb: 50,
    features: [
      "20 cuentas conectadas",
      "Copias ilimitadas",
      "Transferencia ilimitada 🚀",
      "Archivos hasta 50 GB",
      "Soporte VIP 24/7",
      "Ideal para empresas",
    ],
  },
  {
    name: "Lifetime",
    code: "lifetime",
    price: "$239",
    period: "pago único",
    savings: "¡Mejor valor!",
    transfer_gb: null,
    max_file_gb: 100,
    features: [
      "Cuentas ilimitadas",
      "Copias ilimitadas",
      "Transferencia ilimitada 🚀",
      "Archivos hasta 100 GB",
      "Soporte VIP de por vida",
      "Actualizaciones gratuitas",
      "Sin pagos recurrentes",
    ],
  },
];
```

### 3.2 UI Improvements

**Card Design con badges:**

```tsx
<div className="relative">
  {plan.isMostPopular && (
    <div className="absolute -top-4 left-1/2 -translate-x-1/2">
      <span className="bg-emerald-500 text-white text-xs font-bold px-3 py-1 rounded-full">
        MÁS POPULAR
      </span>
    </div>
  )}
  
  {plan.savings && (
    <div className="bg-amber-500/20 border border-amber-500 rounded-lg p-2 mb-4">
      <p className="text-amber-400 text-xs font-bold text-center">
        {plan.savings}
      </p>
    </div>
  )}
  
  {/* Resto del card... */}
</div>
```

### 3.3 Comparación de Planes

Agregar una tabla de comparación:

```tsx
<section className="mt-16">
  <h2 className="text-3xl font-bold text-center mb-8">
    Comparación de Planes
  </h2>
  <div className="overflow-x-auto">
    <table className="w-full border-collapse">
      <thead>
        <tr className="bg-slate-800">
          <th className="p-4 text-left">Característica</th>
          <th className="p-4">Free</th>
          <th className="p-4">Standard</th>
          <th className="p-4">Annual Basic</th>
          <th className="p-4">Annual Premium</th>
          <th className="p-4">Annual Unlimited</th>
          <th className="p-4">Lifetime</th>
        </tr>
      </thead>
      <tbody>
        {/* Filas de comparación */}
      </tbody>
    </table>
  </div>
</section>
```

---

## 💳 Fase 4: Configuración de Stripe

### 4.1 Crear Productos en Stripe Dashboard

Para **cada plan** (excepto Free), crear un producto en Stripe:

#### Plan 1: Standard ($7.99/mes)
1. Dashboard → Products → Add Product
2. Name: "Standard Plan"
3. Description: "100GB monthly transfer, 5 cloud accounts"
4. Pricing:
   - **Recurring**: Monthly
   - **Price**: $7.99 USD
5. Copiar el **Price ID** (ej: `price_xxxStandard`)

#### Plan 2: Annual Basic ($49.99/año)
1. Name: "Annual Basic"
2. Description: "100GB monthly transfer, annual billing"
3. Pricing:
   - **Recurring**: Yearly
   - **Price**: $49.99 USD
4. Copiar el **Price ID**

#### Plan 3: Annual Premium ($89.98/año)
1. Name: "Annual Premium"
2. Description: "200GB monthly transfer, annual billing"
3. Pricing:
   - **Recurring**: Yearly
   - **Price**: $89.98 USD
4. Copiar el **Price ID**

#### Plan 4: Annual Unlimited ($109/año)
1. Name: "Annual Unlimited"
2. Description: "Unlimited transfers, annual billing"
3. Pricing:
   - **Recurring**: Yearly
   - **Price**: $109 USD
4. Copiar el **Price ID**

#### Plan 5: Lifetime ($239 one-time)
1. Name: "Lifetime Unlimited"
2. Description: "Unlimited access, one-time payment"
3. Pricing:
   - **One time**: $239 USD (NO recurring)
4. Copiar el **Price ID**

### 4.2 Configurar Variables de Entorno

```bash
# Fly.io secrets
fly secrets set STRIPE_PRICE_STANDARD="price_xxxStandard" -a cloud-aggregator-backend
fly secrets set STRIPE_PRICE_ANNUAL_BASIC="price_xxxAnnualBasic" -a cloud-aggregator-backend
fly secrets set STRIPE_PRICE_ANNUAL_PREMIUM="price_xxxAnnualPremium" -a cloud-aggregator-backend
fly secrets set STRIPE_PRICE_ANNUAL_UNLIMITED="price_xxxAnnualUnlimited" -a cloud-aggregator-backend
fly secrets set STRIPE_PRICE_LIFETIME="price_xxxLifetime" -a cloud-aggregator-backend
fly secrets set INTERNAL_API_KEY="tu-api-key-segura-aqui" -a cloud-aggregator-backend
```

### 4.3 Configurar Webhooks

Asegurarse de que el webhook escucha:
- `checkout.session.completed` (para subscription Y payment)
- `customer.subscription.deleted`
- `customer.subscription.updated`
- `invoice.paid`
- `invoice.payment_failed`

---

## ⚙️ Fase 5: Migraciones y Testing

### 5.1 Script de Migración de Usuarios Existentes

```python
# migrate_users_to_new_plans.py
"""
Migrar usuarios existentes a los nuevos planes.
"""

# Mapeo de planes antiguos → nuevos
PLAN_MIGRATION_MAP = {
    "plus": "standard",      # Plus ($5) → Standard ($7.99)
    "pro": "annual_premium"  # Pro ($10) → Annual Premium ($89.98/año)
}

def migrate_existing_users():
    # 1. Obtener todos los usuarios con planes pagos
    users = supabase.table("user_plans").select("*").neq("plan", "free").execute()
    
    for user in users.data:
        old_plan = user["plan"]
        new_plan = PLAN_MIGRATION_MAP.get(old_plan, "free")
        
        # 2. Actualizar plan
        supabase.table("user_plans").update({
            "plan": new_plan,
            "billing_period": "MONTHLY" if new_plan == "standard" else "YEARLY",
            "is_lifetime": False
        }).eq("user_id", user["user_id"]).execute()
        
        print(f"Migrated user {user['user_id']}: {old_plan} → {new_plan}")
```

### 5.2 Testing Checklist

#### Test en Modo TEST de Stripe

- [ ] 1. Crear cuenta de prueba
- [ ] 2. Comprar plan Standard (mensual)
  - Verificar webhook recibido
  - Verificar plan actualizado en DB
  - Verificar límites aplicados
- [ ] 3. Comprar plan Annual Basic
  - Verificar subscription_id guardado
  - Verificar billing_period = "YEARLY"
- [ ] 4. Comprar plan Lifetime
  - Verificar mode="payment" (no subscription)
  - Verificar is_lifetime = TRUE
  - Verificar plan_expires_at = NULL
- [ ] 5. Cancelar subscription mensual
  - Verificar downgrade a FREE
- [ ] 6. Simular reset mensual (cronjob)
  - Verificar contadores reseteados
- [ ] 7. Verificar upgrade path (FREE → Standard → Annual)

#### Test de Límites

- [ ] Verificar quota enforcement en `/billing/quota`
- [ ] Verificar que planes unlimited no tienen límites
- [ ] Verificar reset mensual para planes anuales

---

## 🚨 Consideraciones Importantes

### ⚠️ Advertencias

1. **Plan Lifetime - Sin Refunds**: 
   - No hay subscription_id, no se puede cancelar automáticamente
   - Implementar política de reembolso manual

2. **Reset Mensual de Planes Anuales**:
   - Requiere cronjob diario
   - Considerar timezone del usuario (o usar UTC)

3. **Migración de Usuarios Existentes**:
   - Usuarios con Plus/Pro pagaron por suscripción mensual
   - No migrar automáticamente a anuales sin consentimiento
   - Enviar email explicando cambios

4. **Stripe Webhook para Payment Mode**:
   - `checkout.session.completed` funciona diferente para mode="payment"
   - No hay `subscription_id` en el evento
   - Verificar que el código maneje ambos casos

### 💡 Recomendaciones

1. **Plan de Transición Gradual**:
   - Mantener planes antiguos (Plus/Pro) como "legacy"
   - Permitir que usuarios existentes los conserven
   - Solo ofrecer nuevos planes a usuarios nuevos

2. **Grandfathering**:
   - Usuarios con Plus ($5) mantienen su precio
   - No forzar upgrade a Standard ($7.99)

3. **Trial Period**:
   - Stripe soporta trials gratuitos de 7-30 días
   - Considerar agregar para planes anuales

4. **Cupones de Migración**:
   - Crear cupón de descuento para usuarios que upgraden de mensual a anual
   - Ejemplo: 20% off primer año anual

---

## 📋 Checklist de Implementación

### Backend

- [ ] Actualizar `billing_plans.py` con 6 planes
- [ ] Actualizar `stripe_utils.py` con nuevos Price IDs
- [ ] Modificar `/stripe/create-checkout-session` (mode: subscription vs payment)
- [ ] Modificar `handle_checkout_completed` (lifetime vs subscription)
- [ ] Crear endpoint `/internal/reset-monthly-quotas`
- [ ] Actualizar constraints de base de datos (billing_period, is_lifetime)
- [ ] Crear script de migración de usuarios

### Frontend

- [ ] Actualizar `pricing/page.tsx` con 6 planes
- [ ] Agregar badges ("Más Popular", "Mejor Valor")
- [ ] Agregar tabla de comparación
- [ ] Actualizar validación de plan_code
- [ ] Agregar indicador de savings

### Stripe

- [ ] Crear 5 productos en Stripe Dashboard
- [ ] Obtener 5 Price IDs
- [ ] Configurar variables de entorno en Fly.io
- [ ] Verificar webhooks (mode=payment + mode=subscription)
- [ ] Testear flujo de pago completo

### Base de Datos

- [ ] Ejecutar migraciones SQL (billing_period, is_lifetime)
- [ ] Migrar usuarios existentes (con consentimiento)
- [ ] Backup de tabla user_plans antes de cambios

### Cronjobs

- [ ] Configurar cronjob para reset mensual
- [ ] Testear reset en staging
- [ ] Monitorear logs de reset

### Testing

- [ ] Test unitarios para nuevos planes
- [ ] Test de integración con Stripe
- [ ] Test de webhooks (payment + subscription)
- [ ] Test de límites (unlimited)
- [ ] Test de reset mensual

---

## 📊 Comparación Cloud Aggregator vs MultCloud

| Feature | MultCloud | Cloud Aggregator (Propuesto) |
|---------|-----------|------------------------------|
| Plan Free | 30GB/mes | 50GB/mes ✅ |
| Plan Mensual | $9.99 (100GB) | $7.99 (100GB) ✅ Más barato |
| Plan Anual Basic | $59.99 (1200GB) | $49.99 (1200GB) ✅ Más barato |
| Plan Anual Premium | $99.98 (2400GB) | $89.98 (2400GB) ✅ Más barato |
| Plan Anual Unlimited | $119/año | $109/año ✅ Más barato |
| Plan Lifetime | $249 | $239 ✅ Más barato |
| Clouds soportados | 30+ | 3 (Google, OneDrive, Dropbox) |
| App móvil | ❌ | ❌ |

**Ventaja competitiva**: Cloud Aggregator es más económico en todos los planes.

---

## 🚀 Roadmap de Implementación

### Semana 1: Backend
- Actualizar billing_plans.py
- Actualizar stripe_utils.py
- Modificar endpoints de Stripe

### Semana 2: Frontend
- Rediseñar página de pricing
- Agregar nuevos planes
- Testing visual

### Semana 3: Stripe & DB
- Crear productos en Stripe
- Ejecutar migraciones de DB
- Configurar webhooks

### Semana 4: Testing
- Testing end-to-end
- Fix de bugs
- Migración de usuarios

### Semana 5: Deploy
- Deploy a staging
- Testing en staging
- Deploy a producción

---

## 📚 Recursos

- [Stripe Subscriptions](https://stripe.com/docs/billing/subscriptions/overview)
- [Stripe One-time Payments](https://stripe.com/docs/payments/checkout/one-time)
- [Stripe Webhooks](https://stripe.com/docs/webhooks)
- [Fly.io Scheduled Jobs](https://fly.io/docs/reference/configuration/#scheduled-jobs)

---

**Creado**: Enero 30, 2026
**Estimación de esfuerzo**: 4-5 semanas
**Dificultad**: Media-Alta
**Riesgo**: Medio (requiere migración de usuarios existentes)

