# 🧪 CONFIGURACIÓN MODO TESTING - Stripe Test Mode

**Fecha**: Enero 31, 2026  
**Objetivo**: Probar flujo completo de pagos antes de producción

---

## 📋 PRODUCTOS CREADOS EN TEST MODE

Has creado estos productos en Stripe Test Mode:

| Producto | Product ID |
|----------|------------|
| Cloud Aggregator Standard (Monthly) | `prod_TtS3hdHoy4QtNj` |
| Cloud Aggregator Standard Yearly | `prod_TtS2beFYPInPNm` |
| Cloud Aggregator Premium (Monthly) | `prod_TtS2QWDRwFvFP2` |
| Cloud Aggregator Premium Yearly | `prod_TtS18ARdBp8yed` |

---

## ⚠️ IMPORTANTE: Necesitas los PRICE IDs

Los **Product IDs** (`prod_xxx`) identifican el producto, pero para cobrar necesitas los **Price IDs** (`price_xxx`) que definen el precio específico.

### 🔍 Cómo Obtener los Price IDs

#### Opción 1: Desde Stripe Dashboard (Recomendado)

1. Ve a: https://dashboard.stripe.com/test/products
2. Click en cada producto (ej: "Cloud Aggregator Standard")
3. En la sección "Pricing", verás los precios creados
4. Copia el **Price ID** que empieza con `price_`

**Ejemplo visual**:
```
Producto: Cloud Aggregator Standard
  └─ Pricing
      └─ $9.99 / month
          Price ID: price_1XxxxxJtzJiOgNkJxxxxxxxx  ← ESTE es el que necesitas
```

#### Opción 2: Usando Stripe CLI

```bash
# Instalar Stripe CLI si no lo tienes
# https://stripe.com/docs/stripe-cli

# Login
stripe login

# Listar productos con sus precios
stripe products list --limit 10

# Ver detalles de un producto específico con sus precios
stripe products retrieve prod_TtS3hdHoy4QtNj

# O listar todos los precios directamente
stripe prices list --limit 20
```

#### Opción 3: Usando API de Stripe

```bash
# Necesitas tu Secret Key de test (empieza con sk_test_)
curl https://api.stripe.com/v1/prices \
  -u sk_test_TU_SECRET_KEY: \
  -d "product"="prod_TtS3hdHoy4QtNj"
```

---

## 📝 PRICE IDs CONFIGURADOS (Test Mode)

✅ Ya están configurados en el código como defaults:

| Plan | Precio | Price ID (Test Mode) |
|------|--------|----------------------|
| **Standard Monthly** | $9.99/mes | `price_1Svf9GJtzJiOgNkJBXle45Op` |
| **Standard Yearly** | $59.99/año | `price_1Svf88JtzJiOgNkJWKvPkoal` |
| **Premium Monthly** | $17.99/mes | `price_1Svf8hJtzJiOgNkJoeO0BgPu` |
| **Premium Yearly** | $99.98/año | `price_1Svf7OJtzJiOgNkJSZRX6NsY` |

**No necesitas configurarlos manualmente** - ya están en `stripe_utils.py` como valores por defecto para desarrollo local.

---

## ⚙️ CONFIGURACIÓN RÁPIDA (3 Opciones)

### 🚀 Opción 1: Setup Automático (Recomendado)

```powershell
# Ejecuta el script de setup interactivo
.\setup-dev.ps1

# Te pedirá:
# 1. SUPABASE_URL
# 2. SUPABASE_SERVICE_ROLE_KEY  
# 3. STRIPE_SECRET_KEY (sk_test_...)
# 4. STRIPE_WEBHOOK_SECRET (opcional ahora)

# El script:
# ✅ Crea archivo .env con los Price IDs ya configurados
# ✅ Verifica dependencias (Python, Node.js)
# ✅ Instala requirements.txt y package.json
# ✅ Te da instrucciones para iniciar
```

### ⚡ Opción 2: Iniciar Servidores Automáticamente

```powershell
# Una vez configurado el .env, inicia todo:
.\start-dev.ps1

# Esto levanta:
# ✅ Backend en http://localhost:8000
# ✅ Frontend en http://localhost:3000
# ✅ Muestra logs en tiempo real
# ✅ Ctrl+C detiene ambos servidores
```

### 🔧 Opción 3: Setup Manual

Si prefieres hacerlo manualmente:

**Paso 1: Crear archivo `.env`**

```bash
# Copia el archivo de ejemplo
cd backend
cp .env.example .env

# Edita .env y completa:
# - STRIPE_SECRET_KEY (de Stripe Dashboard)
# - SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY
# - Los Price IDs ya están configurados como defaults

# Mínimo requerido:
STRIPE_SECRET_KEY=sk_test_tu_key_aqui
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key
FRONTEND_URL=http://localhost:3000
```

**Paso 2: Instalar dependencias**

```bash
# Backend
cd backend
pip install -r requirements.txt

# Frontend  
cd frontend
npm install
```

**Paso 3: Iniciar servidores**

```bash
# Terminal 1: Backend
cd backend
python -m uvicorn backend.main:app --reload --port 8000

# Terminal 2: Frontend
cd frontend
npm run dev

# Terminal 3: Webhooks (IMPORTANTE)
stripe listen --forward-to localhost:8000/stripe/webhook
```

---

## 🔑 DONDE OBTENER LAS KEYS

### Stripe Secret Key

1. Ve a: https://dashboard.stripe.com/test/apikeys
2. Copia "Secret key" (empieza con `sk_test_`)

### Webhook Secret

**Con Stripe CLI** (Recomendado):
```bash
stripe listen --forward-to localhost:8000/stripe/webhook

# Output:
# > Ready! Your webhook signing secret is whsec_xxxxxxxxxxxxx
# Copia ese whsec_xxx y ponlo en .env
```

**Sin Stripe CLI** (Alternativa con ngrok):
```bash
# 1. Instalar ngrok
# 2. Exponer puerto: ngrok http 8000
# 3. Copiar URL: https://abc123.ngrok.io
# 4. Ir a Stripe Dashboard → Webhooks → Add endpoint
# 5. URL: https://abc123.ngrok.io/stripe/webhook
# 6. Eventos: checkout.session.completed, customer.subscription.*
# 7. Copiar el "Signing secret"
```

**¿Dónde encontrar las keys de Stripe?**

### Supabase Keys

1. Ve a: https://app.supabase.com/project/_/settings/api
2. Copia:
   - **URL**: https://tu-proyecto.supabase.co
   - **Service Role Key** (NO uses la Anon Key)

---

## 🚀 INICIAR PRUEBAS

### Método 1: Script Automático (Más Fácil)

```powershell
# Inicia backend + frontend + logs
.\start-dev.ps1

# En otra terminal, inicia webhooks:
stripe listen --forward-to localhost:8000/stripe/webhook
```

### Método 2: Manual (3 terminales)

```bash
# Terminal 1: Backend
cd backend
python -m uvicorn backend.main:app --reload --port 8000

# Terminal 2: Frontend
cd frontend
npm run dev

# Terminal 3: Webhooks
stripe listen --forward-to localhost:8000/stripe/webhook
```

---

## 🧪 FLUJO DE TESTING COMPLETO

### Test 1: Verificar Backend Levanta Correctamente

```bash
# Terminal 1: Backend
cd backend
uvicorn backend.main:app --reload --port 8000

# Terminal 2: Verificar
curl http://localhost:8000/health

# ✅ Esperado: {"status": "ok"}
```

### Test 2: Verificar Frontend Carga Pricing Page

```bash
# Terminal 3: Frontend
cd frontend
npm run dev

# Abrir navegador: http://localhost:3000/pricing

# ✅ Esperado:
# - Toggle Monthly/Yearly visible
# - 3 tarjetas: Free, Standard, Premium
# - Precios cambian al hacer toggle
```

### Test 3: Crear Checkout Session (sin login aún)

```bash
# Primero necesitas un JWT token de un usuario de prueba
# Opción A: Crear usuario en Supabase Dashboard
# Opción B: Usar endpoint de registro si existe

# Con token:
curl -X POST http://localhost:8000/stripe/create-checkout-session \
  -H "Authorization: Bearer TU_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"plan_code": "standard_monthly"}'

# ✅ Esperado:
# {"url": "https://checkout.stripe.com/c/pay/cs_test_xxxxx"}
```

### Test 4: Completar Pago de Prueba

1. **Usar tarjeta de prueba de Stripe**:
   - Número: `4242 4242 4242 4242`
   - Fecha: Cualquier fecha futura (ej: 12/27)
   - CVC: Cualquier 3 dígitos (ej: 123)
   - Código postal: Cualquiera (ej: 12345)

2. **Completar checkout**

3. **Verificar webhook recibido**:
   - En terminal donde corre `stripe listen` verás: `checkout.session.completed`
   - En logs del backend verás: `[STRIPE_WEBHOOK] checkout.session.completed: user_id=...`

### Test 5: Verificar Plan Actualizado en DB

```sql
-- Conectar a Supabase SQL Editor
SELECT 
  user_id,
  plan,
  billing_period,
  plan_type,
  subscription_status,
  transfer_bytes_limit_month,
  max_file_bytes,
  plan_expires_at
FROM user_plans
WHERE user_id = 'TU_USER_ID_DE_PRUEBA';

-- ✅ Esperado:
-- plan: 'standard_monthly'
-- billing_period: 'MONTHLY'
-- plan_type: 'PAID'
-- subscription_status: 'active'
-- transfer_bytes_limit_month: 107374182400 (100GB)
-- max_file_bytes: 10737418240 (10GB)
```

### Test 6: Verificar Restricciones se Aplican

```bash
# Probar subir archivo de 15GB con plan Standard (max: 10GB)
# Debe fallar con 413 Payload Too Large

# Probar después de usar 99GB transferir archivo de 5GB
# Debe fallar con 402 Payment Required
```

---

## 🎭 TARJETAS DE PRUEBA DE STRIPE

### Tarjetas Exitosas

| Tarjeta | Escenario |
|---------|-----------|
| `4242 4242 4242 4242` | Pago exitoso estándar |
| `4000 0025 0000 3155` | Requiere autenticación 3D Secure |
| `5555 5555 5555 4444` | Mastercard exitosa |

### Tarjetas con Errores (para testing)

| Tarjeta | Error |
|---------|-------|
| `4000 0000 0000 0002` | Card declined |
| `4000 0000 0000 9995` | Insufficient funds |
| `4000 0000 0000 9987` | Lost card |
| `4000 0000 0000 0069` | Expired card |

**Más info**: https://stripe.com/docs/testing

---

## 📊 CHECKLIST DE TESTING

### Preparación
- [ ] Price IDs obtenidos de Stripe Dashboard
- [ ] Archivo `.env` creado con todas las variables
- [ ] Dependencias instaladas (backend + frontend)
- [ ] Base de datos migrada (columna `billing_period` existe)

### Backend
- [ ] Backend levanta sin errores: `uvicorn backend.main:app`
- [ ] Health check retorna OK: `curl http://localhost:8000/health`
- [ ] Stripe keys cargadas (logs no muestran warnings)

### Frontend
- [ ] Frontend levanta: `npm run dev`
- [ ] Pricing page carga: `http://localhost:3000/pricing`
- [ ] Toggle Monthly/Yearly funciona
- [ ] Precios se muestran correctamente

### Webhooks
- [ ] Stripe CLI corriendo: `stripe listen --forward-to localhost:8000/stripe/webhook`
- [ ] O ngrok configurado con webhook en Stripe Dashboard

### Flujo E2E
- [ ] Usuario puede crear checkout session
- [ ] Redirige a Stripe Checkout
- [ ] Pago con tarjeta test exitoso
- [ ] Webhook `checkout.session.completed` recibido
- [ ] Plan actualizado en base de datos
- [ ] Usuario ve "Plan Actual" en pricing page

### Restricciones
- [ ] Archivo grande (>max) es rechazado con 413
- [ ] Transferencia excedida rechazada con 402
- [ ] Mensajes de error tienen sugerencia de upgrade

---

## 🔧 TROUBLESHOOTING

### Error: "Missing Stripe price IDs"

**Causa**: Variables de entorno no cargadas  
**Solución**:
```bash
# Verificar que .env existe
cat backend/.env

# Verificar que Python carga las variables
python -c "import os; print(os.getenv('STRIPE_SECRET_KEY'))"

# Si no carga, asegurar que estás en la carpeta correcta
# O exportar manualmente:
export STRIPE_SECRET_KEY=sk_test_xxx
export STRIPE_PRICE_STANDARD_MONTHLY=price_xxx
# etc...
```

### Error: "Webhook signature verification failed"

**Causa**: `STRIPE_WEBHOOK_SECRET` incorrecto  
**Solución**:
```bash
# Con Stripe CLI, el secret cambia cada vez que reinicias
# Copiar el nuevo secret de la terminal donde corre stripe listen
stripe listen --forward-to localhost:8000/stripe/webhook
# > Your webhook signing secret is whsec_xxxxx  ← Copiar este

# Actualizar .env con el nuevo secret
```

### Error: "CORS error" en frontend

**Causa**: Backend no permite requests de localhost:3000  
**Solución**: Verificar que `main.py` tiene CORS configurado:
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # ← Debe incluir esto
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### Error: "Invalid plan_code"

**Causa**: Plan code enviado no está en la lista válida  
**Solución**: Verificar que envías uno de estos:
- `standard_monthly`
- `standard_yearly`
- `premium_monthly`
- `premium_yearly`

---

## 📞 PRÓXIMOS PASOS

Una vez que complete esta tabla con los Price IDs:

| Plan | Price ID (test) |
|------|-----------------|
| Standard Monthly | `price_` _____________ |
| Standard Yearly | `price_` _____________ |
| Premium Monthly | `price_` _____________ |
| Premium Yearly | `price_` _____________ |

**Responde con los 4 Price IDs y te ayudo a**:
1. ✅ Actualizar el archivo `.env` con la configuración completa
2. ✅ Crear script de setup automático
3. ✅ Verificar que todo esté configurado correctamente
4. ✅ Hacer tu primera prueba de pago end-to-end

---

## 🎯 RESUMEN

**Lo que TIENES** ✅:
- 4 productos creados en Stripe Test Mode
- Código backend y frontend actualizado
- Migration SQL ejecutada
- Documentación completa

**Lo que NECESITAS** ⏳:
1. **Price IDs** (no Product IDs) de Stripe Dashboard
2. **Secret Key** de test mode
3. **Webhook Secret** (con Stripe CLI o ngrok)
4. Archivo **`.env`** configurado con todas las variables

**Una vez tengas los Price IDs, todo lo demás está listo para probar!** 🚀
