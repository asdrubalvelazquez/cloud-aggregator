# ⚡ QUICK START - Testing Stripe Payments

**Todo está configurado!** Solo necesitas 3 cosas para empezar a probar.

---

## ✅ YA ESTÁ LISTO

- ✅ Price IDs configurados en el código
- ✅ Backend actualizado
- ✅ Frontend con toggle Monthly/Yearly
- ✅ Sistema de restricciones funcionando
- ✅ Migration SQL ejecutada

---

## 🎯 LO QUE NECESITAS (3 PASOS)

### 1️⃣ Obtener Secret Key de Stripe

Ve a: https://dashboard.stripe.com/test/apikeys

Copia: **Secret key** (empieza con `sk_test_`)

### 2️⃣ Obtener Keys de Supabase

Ve a: https://app.supabase.com/project/_/settings/api

Copia:
- **URL** (https://xxx.supabase.co)
- **Service role key**

### 3️⃣ Crear archivo .env

**Opción A - Automático (Recomendado)**:
```powershell
.\setup-dev.ps1
```

**Opción B - Manual**:
```powershell
cd backend
cp .env.example .env
# Editar .env y poner tus keys
```

---

## 🚀 INICIAR PRUEBAS

### Opción 1: Script Automático

```powershell
# Inicia backend + frontend
.\start-dev.ps1

# En otra terminal:
stripe listen --forward-to localhost:8000/stripe/webhook
```

### Opción 2: Manual

**Terminal 1 - Backend**:
```powershell
cd backend
python -m uvicorn backend.main:app --reload --port 8000
```

**Terminal 2 - Frontend**:
```powershell
cd frontend
npm run dev
```

**Terminal 3 - Webhooks** (IMPORTANTE):
```powershell
stripe listen --forward-to localhost:8000/stripe/webhook
```

---

## 🎮 PROBAR PAGO

1. **Abrir**: http://localhost:3000/pricing

2. **Hacer login** (o crear usuario de prueba en Supabase)

3. **Seleccionar plan** (ej: Standard Monthly)

4. **Usar tarjeta de prueba**:
   - Número: `4242 4242 4242 4242`
   - Fecha: `12/27`
   - CVC: `123`

5. **Completar pago**

6. **Verificar**:
   - Webhook recibido en terminal 3
   - Plan actualizado en base de datos
   - Badge "PLAN ACTUAL" aparece en pricing page

---

## ✨ PRICE IDS YA CONFIGURADOS

Estos ya están en el código como defaults:

| Plan | Price ID |
|------|----------|
| Standard Monthly | `price_1Svf9GJtzJiOgNkJBXle45Op` |
| Standard Yearly | `price_1Svf88JtzJiOgNkJWKvPkoal` |
| Premium Monthly | `price_1Svf8hJtzJiOgNkJoeO0BgPu` |
| Premium Yearly | `price_1Svf7OJtzJiOgNkJSZRX6NsY` |

**No necesitas configurarlos manualmente** en el .env.

---

## 🔍 VERIFICAR QUE TODO FUNCIONA

```powershell
# Backend health check
curl http://localhost:8000/health
# ✅ {"status":"ok"}

# Frontend carga
# ✅ http://localhost:3000 abre sin errores

# Pricing page funciona
# ✅ http://localhost:3000/pricing muestra 3 tarjetas + toggle
```

---

## 🆘 PROBLEMAS COMUNES

### "Missing Stripe keys"
➜ Verifica que creaste el archivo `.env` en la carpeta `backend/`

### "Webhook verification failed"  
➜ Asegúrate de que `stripe listen` está corriendo y copia el `whsec_` secret al `.env`

### "CORS error"
➜ Verifica que backend levantó en puerto 8000 y frontend en 3000

### "Can't create checkout session"
➜ Necesitas estar logueado. Crea un usuario de prueba en Supabase Dashboard

---

## 📚 DOCUMENTACIÓN COMPLETA

- **Setup detallado**: [TESTING_MODE_SETUP.md](TESTING_MODE_SETUP.md)
- **Sistema de restricciones**: [SISTEMA_RESTRICCIONES_PLANES.md](SISTEMA_RESTRICCIONES_PLANES.md)
- **Deployment**: [DEPLOYMENT_NEW_PRICING_STRUCTURE.md](DEPLOYMENT_NEW_PRICING_STRUCTURE.md)

---

## 🎉 ¡LISTO!

Una vez que tengas las 3 keys (Stripe + Supabase URL + Supabase Service Key), ejecuta:

```powershell
.\setup-dev.ps1
.\start-dev.ps1
```

Y ya puedes probar pagos! 🚀
