# 🚀 QUICK START GUIDE - Nueva Estructura de Precios

**Tiempo estimado de deployment**: 30-45 minutos  
**Complejidad**: Media  
**Riesgo**: Bajo (backward compatible con planes legacy)

---

## 📁 ARCHIVOS MODIFICADOS/CREADOS

### ✅ Backend (3 archivos)
1. `backend/backend/billing_plans.py` - Nueva estructura de planes
2. `backend/backend/stripe_utils.py` - Price IDs y mapeo
3. `backend/backend/main.py` - Checkout endpoint + webhooks

### ✅ Frontend (1 archivo)
4. `frontend/src/app/pricing/page.tsx` - UI con toggle Monthly/Yearly

### ✅ Database (1 archivo)
5. `migrations/add_billing_period_column.sql` - Nueva columna

### ✅ Documentación (2 archivos)
6. `DEPLOYMENT_NEW_PRICING_STRUCTURE.md` - Checklist completo
7. `IMPLEMENTATION_SUMMARY_NEW_PRICING.md` - Resumen técnico

---

## ⚡ DEPLOYMENT RÁPIDO (TL;DR)

### 1. Database (5 min)
```sql
-- Conectar a Supabase SQL Editor
-- Copiar y ejecutar: migrations/add_billing_period_column.sql
-- Verificar: SELECT billing_period, COUNT(*) FROM user_plans GROUP BY billing_period;
```

### 2. Backend Environment Variables (5 min)
```bash
fly secrets set \
  STRIPE_PRICE_STANDARD_MONTHLY="price_1SvPSsJtzJiOgNkJR2fZj8sR" \
  STRIPE_PRICE_STANDARD_YEARLY="price_1SvPtYJtzJiOgNkJ2hwQ0Us9" \
  STRIPE_PRICE_PREMIUM_MONTHLY="price_1SvPVRJtzJiOgNkJIgIiEUFw" \
  STRIPE_PRICE_PREMIUM_YEARLY="price_1SvPvoJtzJiOgNkJxjKgngM5"
```

### 3. Deploy Backend (10 min)
```bash
cd backend
fly deploy
fly logs  # Verificar sin errores
```

### 4. Deploy Frontend (10 min)
```bash
cd frontend
npm run build  # Verificar sin errores TypeScript
vercel --prod  # O tu método de deploy
```

### 5. Smoke Test (5 min)
```bash
# Test 1: Health check
curl https://api.cloudaggregatorapp.com/health

# Test 2: Pricing page carga
# Visitar: https://www.cloudaggregatorapp.com/pricing
# ✅ Toggle funciona, 3 tarjetas visibles

# Test 3: Crear checkout session
curl -X POST https://api.cloudaggregatorapp.com/stripe/create-checkout-session \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"plan_code": "standard_monthly"}'
# ✅ Retorna {"url": "https://checkout.stripe.com/..."}
```

---

## 🎯 NUEVOS PLANES

| Plan | Storage | Precio Mensual | Precio Anual | Ahorro |
|------|---------|----------------|--------------|--------|
| **Free** | 5GB | $0 | $0 | - |
| **Standard** | 100GB | $9.99/mes | $59.99/año | 40% |
| **Premium** | 200GB | $17.99/mes | $99.98/año | 44% |

### Plan Codes Backend
- `free` (no billing_period)
- `standard_monthly` + `billing_period: "MONTHLY"`
- `standard_yearly` + `billing_period: "YEARLY"`
- `premium_monthly` + `billing_period: "MONTHLY"`
- `premium_yearly` + `billing_period: "YEARLY"`

### Legacy Plans (preservados)
- `plus` ($5/mes, 100GB)
- `pro` ($10/mes, ilimitado)

---

## 🧪 TEST RÁPIDO POST-DEPLOY

### Test E2E: Compra Standard Monthly

1. **Setup**:
   - Login como usuario free
   - Visitar `/pricing`

2. **Acción**:
   - Asegurar toggle en "Mensual"
   - Click "Seleccionar Plan" en Standard
   - Completar checkout con `4242 4242 4242 4242`

3. **Verificación**:
   ```sql
   SELECT plan, billing_period, subscription_status 
   FROM user_plans 
   WHERE user_id = '<USER_ID>';
   ```
   ✅ Esperado: `plan = 'standard_monthly'`, `billing_period = 'MONTHLY'`, `subscription_status = 'active'`

---

## 🔍 TROUBLESHOOTING

### Error: "Price ID not configured"
```bash
# Verificar env vars en Fly.io
fly secrets list

# Si faltan, configurar:
fly secrets set STRIPE_PRICE_STANDARD_MONTHLY="price_1SvPSsJtzJiOgNkJR2fZj8sR"
```

### Error: Column billing_period does not exist
```sql
-- Ejecutar migration
\i migrations/add_billing_period_column.sql

-- O copiar contenido manualmente en Supabase SQL Editor
```

### Frontend: Toggle no aparece
```bash
# Verificar build sin errores
cd frontend
npm run build

# Clear cache y redeploy
vercel --prod --force
```

### Webhook no procesa billing_period
```bash
# Verificar logs
fly logs | grep checkout.session.completed

# Debe mostrar: "billing_period=MONTHLY" o "billing_period=YEARLY"
# Si no, verificar que plan_code incluya sufijo _monthly o _yearly
```

---

## 📊 ESTRUCTURA DE CÓDIGO

### Backend Flow
```
Usuario click "Seleccionar Plan"
  ↓
Frontend construye plan_code: "standard_monthly"
  ↓
POST /stripe/create-checkout-session {plan_code: "standard_monthly"}
  ↓
Backend valida plan_code
  ↓
Backend mapea a Price ID: price_1SvPSsJtzJiOgNkJR2fZj8sR
  ↓
Stripe.checkout.Session.create(price_id=...)
  ↓
Retorna checkout URL
  ↓
Usuario completa pago
  ↓
Webhook: checkout.session.completed
  ↓
Extrae billing_period de plan_code ("standard_monthly" → "MONTHLY")
  ↓
UPDATE user_plans SET plan='standard_monthly', billing_period='MONTHLY'
```

### Frontend Flow
```
Usuario visita /pricing
  ↓
Fetch /me/plan → {plan: "standard_monthly", billing_period: "MONTHLY"}
  ↓
Extrae base plan: "standard" (remove _monthly/_yearly)
  ↓
Renderiza toggle Monthly/Yearly
  ↓
Usuario cambia toggle a "Yearly"
  ↓
Precios cambian: $9.99/mes → $59.99/año
  ↓
Usuario click "Seleccionar Plan"
  ↓
Construye plan_code: "standard" + "_yearly" = "standard_yearly"
  ↓
POST /stripe/create-checkout-session {plan_code: "standard_yearly"}
```

---

## 🔗 ENLACES ÚTILES

- **Stripe Dashboard**: https://dashboard.stripe.com/test/products
- **Fly.io Dashboard**: https://fly.io/apps/cloudaggregator-api (ajusta el nombre)
- **Vercel Dashboard**: https://vercel.com/dashboard
- **Supabase SQL Editor**: Tu proyecto Supabase > SQL Editor
- **Documentación completa**: `DEPLOYMENT_NEW_PRICING_STRUCTURE.md`

---

## ✅ CHECKLIST MÍNIMO

Antes de considerar deployment exitoso:

- [ ] Database migration ejecutada sin errores
- [ ] 4 env vars configuradas en Fly.io
- [ ] Backend deployed, health check retorna 200
- [ ] Frontend deployed, pricing page carga correctamente
- [ ] Toggle Monthly/Yearly funciona
- [ ] Test de compra Standard Monthly exitoso
- [ ] Webhook actualiza billing_period en DB
- [ ] Sin errores 500 en logs de backend

---

## 🆘 ROLLBACK (si algo sale mal)

```bash
# Backend
fly releases rollback <PREVIOUS_VERSION>

# Frontend (Vercel Dashboard)
# Seleccionar deployment anterior → "Promote to Production"

# Database
ALTER TABLE user_plans DROP COLUMN IF EXISTS billing_period;
```

---

## 💡 NOTAS FINALES

1. **Planes legacy funcionan**: `plus` y `pro` siguen disponibles para usuarios existentes
2. **Backward compatible**: Código antiguo no se rompe
3. **Idempotente**: Puedes re-ejecutar migration SQL sin problemas
4. **Staging first**: Testea en staging si está disponible antes de prod
5. **Monitoring**: Vigila logs las primeras 24h post-deploy

---

**¿Listo para deploy?** → Sigue `DEPLOYMENT_NEW_PRICING_STRUCTURE.md`  
**¿Dudas?** → Lee `IMPLEMENTATION_SUMMARY_NEW_PRICING.md`  
**¿Emergencia?** → Ejecuta rollback arriba

🎉 **¡Buena suerte con el deployment!**
