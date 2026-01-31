# 🚀 DEPLOYMENT CHECKLIST - Nueva Estructura de Precios

**Fecha**: 2025  
**Cambio**: Implementación de precios simplificados con toggle Monthly/Yearly  
**Tickets de referencia**: Modernización de pricing inspirado en MultCloud

---

## 📋 RESUMEN DE CAMBIOS

### Estructura Nueva vs Antigua

**ANTES (Legacy)**:
- Free: 5GB lifetime
- Plus: $5/mes, 100GB/mes  
- Pro: $10/mes, ilimitado

**AHORA (Nueva Estructura)**:
- **Free**: 5GB lifetime, $0
- **Standard**: 100GB/mes o 1200GB/año
  - Monthly: $9.99/mes
  - Yearly: $59.99/año (ahorro de 40%)
- **Premium**: 200GB/mes o 2400GB/año
  - Monthly: $17.99/mes
  - Yearly: $99.98/año (ahorro de 44%)

### Productos Stripe Creados

1. **Cloud Aggregator Standard (Monthly)**
   - Product ID: `prod_TtBq0CSC35DmgX`
   - Price ID: `price_1SvPSsJtzJiOgNkJR2fZj8sR`
   - Precio: $9.99/mes

2. **Cloud Aggregator Standard (Yearly)**
   - Product ID: (separate product)
   - Price ID: `price_1SvPtYJtzJiOgNkJ2hwQ0Us9`
   - Precio: $59.99/año

3. **Cloud Aggregator Premium (Monthly)**
   - Product ID: `prod_TtBtgLVP7nbjuK`
   - Price ID: `price_1SvPVRJtzJiOgNkJIgIiEUFw`
   - Precio: $17.99/mes

4. **Cloud Aggregator Premium (Yearly)**
   - Product ID: (separate product)
   - Price ID: `price_1SvPvoJtzJiOgNkJxjKgngM5`
   - Precio: $99.98/año

---

## ✅ CHECKLIST PRE-DEPLOY

### 1. Backend Changes

- [x] **billing_plans.py**: Actualizado con nueva estructura
  - [x] Añadidos campos: `billing_period`, `price_total`
  - [x] Removidos campos: `copies_limit_lifetime`, `transfer_bytes_limit_lifetime`
  - [x] 5 planes activos: `free`, `standard_monthly`, `standard_yearly`, `premium_monthly`, `premium_yearly`
  - [x] Planes legacy preservados: `plus`, `pro`

- [x] **stripe_utils.py**: Actualizado con 4 Price IDs
  - [x] Variables de entorno: `STRIPE_PRICE_STANDARD_MONTHLY`, `STRIPE_PRICE_STANDARD_YEARLY`, `STRIPE_PRICE_PREMIUM_MONTHLY`, `STRIPE_PRICE_PREMIUM_YEARLY`
  - [x] Función `map_price_to_plan()` actualizada
  - [x] `VALID_PRICE_IDS` incluye 4 nuevos Price IDs + 2 legacy

- [x] **main.py**: Endpoints y webhooks actualizados
  - [x] `/stripe/create-checkout-session`: Acepta 4 nuevos plan_codes
  - [x] Validación de plan_code con allowlist de 6 planes (4 nuevos + 2 legacy)
  - [x] `handle_checkout_completed`: Extrae `billing_period` del plan_code
  - [x] Webhook guarda `billing_period` en `user_plans`
  - [x] Imports actualizados con 4 Price IDs

### 2. Frontend Changes

- [x] **pricing/page.tsx**: Nueva interfaz con toggle
  - [x] Toggle Monthly/Yearly funcional
  - [x] 3 tarjetas de planes: Free, Standard, Premium
  - [x] Cálculo dinámico de precios según billing period
  - [x] Indicador de ahorro en plan anual
  - [x] Badges: "MÁS POPULAR", "PLAN ACTUAL"
  - [x] Botones inteligentes: "Cambiar a Anual", "Cambiar a Mensual"
  - [x] Construcción de `plan_code` con sufijo `_monthly` o `_yearly`

### 3. Database Migration

- [x] **Script SQL creado**: `migrations/add_billing_period_column.sql`
  - [x] Añade columna `billing_period TEXT`
  - [x] Constraint: `CHECK (billing_period IN ('MONTHLY', 'YEARLY'))`
  - [x] Default: `'MONTHLY'`
  - [x] Actualiza registros existentes
  - [x] Crea índice para performance
  - [x] Incluye script de rollback

---

## 🔧 PASOS DE DEPLOYMENT

### PASO 1: Backup de Base de Datos

```bash
# Ejecutar backup completo de user_plans
pg_dump -h <HOST> -U postgres -d cloudaggregator -t user_plans > user_plans_backup_$(date +%Y%m%d).sql
```

### PASO 2: Ejecutar Migración SQL

```sql
-- Conectarse a Supabase SQL Editor o psql
-- Ejecutar: migrations/add_billing_period_column.sql

-- Verificar columna añadida
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'user_plans' AND column_name = 'billing_period';

-- Verificar distribución de datos
SELECT billing_period, COUNT(*) as count 
FROM user_plans 
GROUP BY billing_period;
```

**✅ Resultado esperado**:
- billing_period existe
- Todos los registros tienen billing_period = 'MONTHLY' (inicialmente)

### PASO 3: Configurar Variables de Entorno en Fly.io

```bash
# Conectar a Fly.io
fly secrets set \
  STRIPE_PRICE_STANDARD_MONTHLY="price_1SvPSsJtzJiOgNkJR2fZj8sR" \
  STRIPE_PRICE_STANDARD_YEARLY="price_1SvPtYJtzJiOgNkJ2hwQ0Us9" \
  STRIPE_PRICE_PREMIUM_MONTHLY="price_1SvPVRJtzJiOgNkJIgIiEUFw" \
  STRIPE_PRICE_PREMIUM_YEARLY="price_1SvPvoJtzJiOgNkJxjKgngM5"

# Verificar secrets (no muestra valores completos por seguridad)
fly secrets list
```

**✅ Resultado esperado**:
- 4 nuevas variables de entorno configuradas
- Variables legacy (`STRIPE_PRICE_PLUS`, `STRIPE_PRICE_PRO`) siguen presentes para backward compatibility

### PASO 4: Deploy Backend

```bash
cd backend

# Verificar tests (opcional pero recomendado)
pytest tests/ -v

# Deploy a Fly.io
fly deploy

# Verificar logs
fly logs
```

**✅ Buscar en logs**:
- `[STRIPE_CONFIG]` sin warnings sobre Price IDs faltantes
- Backend levanta correctamente en puerto 8000

### PASO 5: Deploy Frontend

```bash
cd frontend

# Build producción
npm run build

# Deploy a Vercel
vercel --prod

# O si usas Vercel CLI con proyecto vinculado
vercel deploy --prod
```

**✅ Verificar**:
- Build exitoso sin errores TypeScript
- Deployment completo en Vercel

### PASO 6: Verificar Stripe Dashboard

1. Ir a https://dashboard.stripe.com/test/products
2. Verificar 4 productos visibles con sus respectivos Price IDs
3. Confirmar que productos están activos (no archived)

### PASO 7: Smoke Tests en Producción

#### Test 1: Página de Pricing Carga Correctamente
```
1. Visitar: https://www.cloudaggregatorapp.com/pricing
2. ✅ Toggle Monthly/Yearly funciona
3. ✅ Precios cambian correctamente
4. ✅ 3 tarjetas visibles: Free, Standard, Premium
```

#### Test 2: Backend Health Check
```bash
curl https://api.cloudaggregatorapp.com/health
# ✅ Debe retornar 200 OK
```

#### Test 3: Obtener Plan Actual (Usuario Autenticado)
```bash
curl -H "Authorization: Bearer <JWT_TOKEN>" \
  https://api.cloudaggregatorapp.com/me/plan

# ✅ Respuesta incluye:
# {"plan": "free", "billing_period": "MONTHLY", ...}
```

#### Test 4: Crear Checkout Session (Standard Monthly)
```bash
curl -X POST https://api.cloudaggregatorapp.com/stripe/create-checkout-session \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"plan_code": "standard_monthly"}'

# ✅ Debe retornar:
# {"url": "https://checkout.stripe.com/c/pay/cs_test_..."}
```

#### Test 5: Webhook Signature Validation
```bash
# Trigger test webhook desde Stripe Dashboard
# Send test webhook -> checkout.session.completed

# ✅ Verificar logs:
fly logs | grep STRIPE_WEBHOOK
# Debe mostrar: "checkout.session.completed: user_id=..., plan=standard_monthly, billing_period=MONTHLY"
```

---

## 🧪 TESTING COMPLETO

### Test E2E: Flujo de Compra Completo

**Escenario 1: Usuario Free → Standard Monthly**

1. Login como usuario free
2. Ir a `/pricing`
3. Asegurar toggle en "Mensual"
4. Click "Seleccionar Plan" en Standard
5. Redirige a Stripe Checkout
6. Completar pago con tarjeta de prueba: `4242 4242 4242 4242`
7. Redirige a `/pricing?payment=success&session_id=...`
8. Verificar banner verde: "¡Pago exitoso!"
9. Verificar badge "PLAN ACTUAL" en Standard Monthly
10. Verificar en DB:
```sql
SELECT plan, billing_period, subscription_status 
FROM user_plans 
WHERE user_id = '<USER_ID>';
-- ✅ plan = 'standard_monthly', billing_period = 'MONTHLY', subscription_status = 'active'
```

**Escenario 2: Usuario Free → Premium Yearly**

1. Login como usuario free
2. Ir a `/pricing`
3. Click toggle "Anual"
4. Verificar precio Premium muestra $99.98/año
5. Verificar mensaje de ahorro: "$115.90 de ahorro anual"
6. Click "Seleccionar Plan" en Premium
7. Completar checkout
8. Verificar DB:
```sql
-- ✅ plan = 'premium_yearly', billing_period = 'YEARLY'
```

**Escenario 3: Usuario Standard Monthly → Standard Yearly**

1. Login como usuario con `standard_monthly`
2. Ir a `/pricing`
3. Toggle debería estar en "Mensual", badge en Standard
4. Click toggle "Anual"
5. Botón Standard cambia a "Cambiar a Anual"
6. Click botón
7. Checkout con precio $59.99/año
8. Completar pago
9. Verificar upgrade en DB

---

## 🚨 ROLLBACK PLAN

### Si algo sale mal durante el deployment:

#### Rollback Backend (Fly.io)
```bash
# Listar versiones anteriores
fly releases

# Rollback a versión anterior
fly releases rollback <VERSION_NUMBER>
```

#### Rollback Frontend (Vercel)
1. Ir a Vercel Dashboard
2. Seleccionar deployment anterior
3. Click "Promote to Production"

#### Rollback Database Migration
```sql
-- Ejecutar rollback script
ALTER TABLE user_plans DROP COLUMN IF EXISTS billing_period;
DROP INDEX IF EXISTS idx_user_plans_billing_period;
```

#### Rollback Variables de Entorno (si fuera necesario)
```bash
fly secrets unset STRIPE_PRICE_STANDARD_MONTHLY STRIPE_PRICE_STANDARD_YEARLY \
  STRIPE_PRICE_PREMIUM_MONTHLY STRIPE_PRICE_PREMIUM_YEARLY
```

---

## 📊 MONITOREO POST-DEPLOY

### Métricas a Vigilar (primeras 24h)

1. **Stripe Dashboard**:
   - Nuevas subscripciones creadas
   - Payment intents exitosos vs fallidos
   - Webhooks recibidos correctamente

2. **Logs de Backend** (`fly logs`):
   - Buscar errores: `grep ERROR`
   - Buscar warnings de Stripe: `grep STRIPE_CONFIG`
   - Verificar webhooks procesados: `grep checkout.session.completed`

3. **Frontend Analytics**:
   - Page views en `/pricing`
   - Clicks en botones de planes
   - Conversión de clicks a checkouts

4. **Database Health**:
```sql
-- Distribución de planes
SELECT plan, billing_period, COUNT(*) as count
FROM user_plans
GROUP BY plan, billing_period
ORDER BY count DESC;

-- Subscripciones activas
SELECT subscription_status, COUNT(*) as count
FROM user_plans
GROUP BY subscription_status;
```

---

## ✅ CHECKLIST FINAL

Antes de cerrar este ticket, confirmar:

- [ ] Migration SQL ejecutada exitosamente
- [ ] 4 Price IDs configurados en Fly.io secrets
- [ ] Backend deployed en Fly.io
- [ ] Frontend deployed en Vercel
- [ ] Toggle Monthly/Yearly funcional en producción
- [ ] Test E2E de compra Standard Monthly exitoso
- [ ] Test E2E de compra Premium Yearly exitoso
- [ ] Test de upgrade Monthly → Yearly exitoso
- [ ] Webhooks de Stripe procesándose correctamente
- [ ] Logs sin errores críticos
- [ ] Planes legacy (plus, pro) siguen funcionando
- [ ] Documentación actualizada en README
- [ ] Stakeholders notificados del cambio

---

## 📝 NOTAS IMPORTANTES

### Compatibilidad con Planes Legacy

Los planes `plus` y `pro` siguen siendo funcionales para:
- Usuarios existentes con esos planes
- Testing interno
- Período de transición (opcional)

**NO** se muestran en la nueva UI de pricing, pero el backend los soporta completamente.

### Stripe Webhook Configuration

Asegurar que los siguientes eventos están configurados en Stripe:
- `checkout.session.completed` ✅
- `customer.subscription.updated` ✅
- `customer.subscription.deleted` ✅
- `invoice.payment_succeeded` ✅
- `invoice.payment_failed` ✅

### Frontend Cache

Si la página de pricing no se actualiza inmediatamente:
```bash
# Clear Vercel cache
vercel deploy --force

# O invalidar cache manualmente en Vercel dashboard
```

---

## 🎉 SUCCESS CRITERIA

Deployment exitoso cuando:

1. ✅ Usuario puede ver toggle Monthly/Yearly
2. ✅ Precios cambian dinámicamente con el toggle
3. ✅ Usuario puede completar compra de Standard Monthly
4. ✅ Usuario puede completar compra de Premium Yearly
5. ✅ Webhook actualiza `billing_period` correctamente en DB
6. ✅ Badge "PLAN ACTUAL" se muestra correctamente
7. ✅ Usuario con plan mensual puede cambiar a anual (y viceversa)
8. ✅ Sin errores 500 en logs de backend
9. ✅ Sin errores JavaScript en consola del navegador
10. ✅ Stripe Dashboard muestra nuevas subscripciones correctamente

---

**🚀 Ready to Deploy!**

Si todos los checkboxes están marcados, procede con el deployment siguiendo los pasos en orden.

**Contacto de Emergencia**: support@cloudaggregatorapp.com  
**Documentación Técnica**: Ver `MULTCLOUD_STYLE_PRICING_IMPLEMENTATION_PLAN.md`
