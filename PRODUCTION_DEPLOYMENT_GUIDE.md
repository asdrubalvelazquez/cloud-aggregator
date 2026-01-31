# 🚀 DEPLOYMENT A PRODUCCIÓN - TEST MODE

## ✅ Lo que ya tenemos configurado

- ✅ Stripe Test Mode con 4 Price IDs
- ✅ Código backend y frontend completamente actualizado
- ✅ Migración de base de datos ejecutada
- ✅ Script SQL para preparar usuarios existentes
- ✅ Usuarios de prueba existentes en Supabase

---

## 📋 PASO A PASO

### 1️⃣ PREPARAR USUARIOS EN SUPABASE (5 minutos)

**¿Por qué?** Tus usuarios existentes necesitan tener los campos correctos para el nuevo sistema de billing.

**Acción:**
```bash
1. Ve a: https://supabase.com/dashboard/project/rfkryeryqrilqmzkgzua/editor
2. Copia el contenido de: prepare_existing_users_for_billing.sql
3. Pégalo y ejecuta (click en RUN)
4. Verifica que los usuarios aparezcan correctamente
```

**Resultado esperado:**
- Todos los usuarios FREE con `plan = 'free'`
- `billing_period = 'MONTHLY'`
- `stripe_customer_id = NULL` (se creará al hacer upgrade)
- Límites correctos (1 GB file size, 10 GB lifetime transfer)

---

### 2️⃣ DESPLEGAR A PRODUCCIÓN (10 minutos)

**Opción A: Script Automático (Recomendado)**
```powershell
.\deploy-production.ps1
```

El script te pedirá:
1. ✅ URL de tu frontend en Vercel (ejemplo: https://cloud-aggregator.vercel.app)
2. ✅ Webhook Signing Secret de Stripe (lo obtienes en paso 3)

**Opción B: Manual**

**Backend (Fly.io):**
```powershell
cd backend

# Configurar secretos (usa tus propias keys)
fly secrets set STRIPE_SECRET_KEY="TU_STRIPE_SECRET_KEY_AQUI"
fly secrets set SUPABASE_URL="TU_SUPABASE_URL_AQUI"
fly secrets set SUPABASE_SERVICE_ROLE_KEY="TU_SUPABASE_SERVICE_ROLE_KEY_AQUI"
fly secrets set FRONTEND_URL="https://TU-FRONTEND.vercel.app"
fly secrets set STRIPE_PRICE_STANDARD_MONTHLY="price_1Svf9GJtzJiOgNkJBXle45Op"
fly secrets set STRIPE_PRICE_STANDARD_YEARLY="price_1Svf88JtzJiOgNkJWKvPkoal"
fly secrets set STRIPE_PRICE_PREMIUM_MONTHLY="price_1Svf8hJtzJiOgNkJoeO0BgPu"
fly secrets set STRIPE_PRICE_PREMIUM_YEARLY="price_1Svf7OJtzJiOgNkJSZRX6NsY"

# Desplegar
fly deploy --ha=false

cd ..
```

**Frontend (Vercel):**
```powershell
cd frontend

# Configura estas variables en Vercel Dashboard:
# NEXT_PUBLIC_API_URL = https://cloud-aggregator-api.fly.dev
# NEXT_PUBLIC_SUPABASE_URL = https://rfkryeryqrilqmzkgzua.supabase.co
# NEXT_PUBLIC_SUPABASE_ANON_KEY = (tu anon key)

# Desplegar
vercel --prod

cd ..
```

---

### 3️⃣ CONFIGURAR WEBHOOK DE STRIPE (3 minutos)

**¿Por qué?** Stripe necesita notificar a tu backend cuando un pago se completa.

**Acción:**
```bash
1. Ve a: https://dashboard.stripe.com/test/webhooks
2. Click en "+ Add endpoint"
3. Endpoint URL: https://cloud-aggregator-api.fly.dev/stripe/webhook
4. Selecciona estos eventos:
   ✅ checkout.session.completed
   ✅ customer.subscription.created
   ✅ customer.subscription.updated
   ✅ customer.subscription.deleted
5. Click "Add endpoint"
6. Copia el "Signing secret" (whsec_...)
```

**Configurar el secret en Fly.io:**
```powershell
cd backend
fly secrets set STRIPE_WEBHOOK_SECRET="whsec_TU_SECRET_AQUI"
cd ..
```

---

### 4️⃣ PROBAR EL FLUJO DE PAGO (5 minutos)

**URLs de Producción:**
- Frontend: `https://TU-FRONTEND.vercel.app`
- Backend: `https://cloud-aggregator-api.fly.dev`
- Pricing: `https://TU-FRONTEND.vercel.app/pricing`

**Flujo de prueba:**
```bash
1. Abre: https://TU-FRONTEND.vercel.app/pricing
2. Login con usuario de prueba existente
3. Selecciona "Standard Monthly" ($9.99/mes)
4. Usa tarjeta de prueba: 4242 4242 4242 4242
5. Completa el checkout
6. Verifica que redirige a success
7. Verifica en dashboard que el plan cambió
```

**Verificar en Supabase:**
```sql
SELECT 
    u.email,
    up.plan,
    up.billing_period,
    up.stripe_customer_id,
    up.subscription_status,
    up.max_file_bytes / 1073741824 as max_file_gb
FROM auth.users u
JOIN user_plans up ON u.id = up.user_id
WHERE u.email = 'tu-email-de-prueba@example.com';
```

**Resultado esperado:**
```
email                | plan              | billing_period | stripe_customer_id | subscription_status | max_file_gb
---------------------|-------------------|----------------|-------------------|---------------------|-------------
test@example.com     | standard_monthly  | MONTHLY        | cus_xxxxx         | active              | 10
```

---

### 5️⃣ MONITOREAR LOGS

**Backend (Fly.io):**
```powershell
fly logs -a cloud-aggregator-api
```

**Frontend (Vercel):**
```powershell
vercel logs
```

**Stripe Events:**
```
https://dashboard.stripe.com/test/events
```

**Buscar errores:**
```powershell
# Backend
fly logs -a cloud-aggregator-api | Select-String "ERROR"

# Webhooks
fly logs -a cloud-aggregator-api | Select-String "STRIPE_WEBHOOK"
```

---

## 🔍 VERIFICACIONES IMPORTANTES

### ✅ Checklist Pre-Deploy

- [ ] Script SQL ejecutado en Supabase
- [ ] Usuarios FREE tienen valores correctos
- [ ] Fly.io CLI instalado y autenticado (`fly auth login`)
- [ ] Vercel CLI instalado y autenticado (`vercel login`)
- [ ] URLs de frontend confirmadas

### ✅ Checklist Post-Deploy

- [ ] Backend responde: `https://cloud-aggregator-api.fly.dev/health`
- [ ] Frontend carga: `https://TU-FRONTEND.vercel.app`
- [ ] Pricing page funciona: `https://TU-FRONTEND.vercel.app/pricing`
- [ ] Webhook configurado en Stripe Dashboard
- [ ] Secret de webhook configurado en Fly.io

### ✅ Checklist de Prueba

- [ ] Login con usuario existente funciona
- [ ] Página de pricing muestra toggle Monthly/Yearly
- [ ] Click en "Upgrade" redirige a Stripe Checkout
- [ ] Checkout con tarjeta de prueba completa exitosamente
- [ ] Redirección a success funciona
- [ ] Plan actualizado en database (verificar en Supabase)
- [ ] Webhook recibido (verificar en Stripe Dashboard)

---

## 🚨 TROUBLESHOOTING

### Error: "fly: command not found"
```powershell
# Instalar Fly.io CLI
irm https://fly.io/install.ps1 | iex
fly auth login
```

### Error: "vercel: command not found"
```powershell
# Instalar Vercel CLI
npm install -g vercel
vercel login
```

### Error: Webhook no se recibe
```bash
1. Verifica la URL: https://cloud-aggregator-api.fly.dev/stripe/webhook
2. Verifica el signing secret en Fly.io: fly secrets list
3. Verifica los eventos seleccionados en Stripe Dashboard
4. Revisa logs: fly logs -a cloud-aggregator-api | Select-String "webhook"
```

### Error: Plan no se actualiza después del pago
```bash
1. Verifica que el webhook se recibió: https://dashboard.stripe.com/test/events
2. Revisa logs del backend: fly logs -a cloud-aggregator-api | Select-String "checkout"
3. Verifica que metadata.plan_code está presente en checkout session
```

### Error: "Invalid plan_code"
```bash
# Verifica que los Price IDs en Stripe coinciden con los configurados en Fly.io
fly secrets list | Select-String "STRIPE_PRICE"
```

---

## 🔄 DESPUÉS DE PROBAR EN TEST MODE

Cuando todo funcione correctamente con tarjetas de prueba:

### 1. Crear Products en Stripe LIVE Mode
```bash
1. Ve a: https://dashboard.stripe.com/products
2. Cambia a LIVE mode (toggle arriba a la derecha)
3. Crea los mismos 4 productos con los mismos precios
4. Obtén los nuevos Price IDs (price_xxx en LIVE mode)
```

### 2. Actualizar Price IDs en Fly.io
```powershell
cd backend
fly secrets set STRIPE_PRICE_STANDARD_MONTHLY="price_LIVE_xxx"
fly secrets set STRIPE_PRICE_STANDARD_YEARLY="price_LIVE_xxx"
fly secrets set STRIPE_PRICE_PREMIUM_MONTHLY="price_LIVE_xxx"
fly secrets set STRIPE_PRICE_PREMIUM_YEARLY="price_LIVE_xxx"
```

### 3. Actualizar Stripe Secret Key
```powershell
fly secrets set STRIPE_SECRET_KEY="sk_live_TU_KEY_REAL"
```

### 4. Actualizar Webhook para LIVE Mode
```bash
1. Ve a: https://dashboard.stripe.com/webhooks
2. Cambia a LIVE mode
3. Crea endpoint con misma URL
4. Obtén nuevo signing secret
5. Actualiza en Fly.io: fly secrets set STRIPE_WEBHOOK_SECRET="whsec_LIVE_xxx"
```

---

## 📞 SOPORTE

- **Fly.io:** https://fly.io/docs
- **Vercel:** https://vercel.com/docs
- **Stripe:** https://stripe.com/docs/webhooks
- **Supabase:** https://supabase.com/docs

---

## 📝 NOTAS IMPORTANTES

### Sobre usuarios existentes:
- Los usuarios FREE pueden hacer upgrade inmediatamente
- Al hacer upgrade, Stripe crea un nuevo `customer_id`
- El webhook actualiza automáticamente el plan en la DB
- Los límites se actualizan según el nuevo plan

### Sobre billing_period:
- `MONTHLY`: Reset mensual de quotas
- `YEARLY`: Reset anual de quotas
- Se extrae automáticamente del `plan_code` en el webhook

### Sobre Stripe Customer IDs:
- `NULL` para usuarios FREE
- Se crea automáticamente en el primer checkout
- Se reutiliza para futuros upgrades/downgrades

### Sobre los límites:
- FREE: 1 GB file, 10 GB lifetime transfer
- Standard: 10 GB file, 500 GB monthly transfer
- Premium: 25 GB file, 2000 GB monthly transfer

---

¡Listo para desplegar! 🚀
