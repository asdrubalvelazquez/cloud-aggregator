# ==========================================
# DEPLOYMENT A PRODUCCIÓN - TEST MODE
# ==========================================
# Fecha: 2026-01-31
# Propósito: Desplegar sistema de billing con Stripe TEST MODE
# Después cambiaremos a LIVE MODE cuando funcione todo

# ==========================================
# PASO 1: PREPARAR USUARIOS EN SUPABASE
# ==========================================

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "PASO 1: PREPARAR USUARIOS EN SUPABASE" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Ve a: https://supabase.com/dashboard/project/rfkryeryqrilqmzkgzua/editor" -ForegroundColor Yellow
Write-Host "2. Ejecuta el script: prepare_existing_users_for_billing.sql" -ForegroundColor Yellow
Write-Host "3. Verifica que todos los usuarios FREE están correctos" -ForegroundColor Yellow
Write-Host ""
Write-Host "Presiona ENTER cuando hayas ejecutado el script..." -ForegroundColor Green
Read-Host

# ==========================================
# PASO 2: CONFIGURAR SECRETOS EN FLY.IO
# ==========================================

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "PASO 2: CONFIGURAR SECRETOS EN FLY.IO" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Stripe Keys (TEST MODE)
Write-Host "Ingresa tu Stripe Secret Key (sk_test_...):" -ForegroundColor Yellow
$STRIPE_SECRET_KEY = Read-Host "STRIPE_SECRET_KEY"

# Supabase Keys
Write-Host "Ingresa tu Supabase URL:" -ForegroundColor Yellow
$SUPABASE_URL = Read-Host "SUPABASE_URL"
Write-Host "Ingresa tu Supabase Service Role Key:" -ForegroundColor Yellow
$SUPABASE_SERVICE_ROLE_KEY = Read-Host "SUPABASE_SERVICE_ROLE_KEY"

# OAuth Keys
Write-Host "Ingresa tu Google Client ID:" -ForegroundColor Yellow
$GOOGLE_CLIENT_ID = Read-Host "GOOGLE_CLIENT_ID"
Write-Host "Ingresa tu Google Client Secret:" -ForegroundColor Yellow
$GOOGLE_CLIENT_SECRET = Read-Host "GOOGLE_CLIENT_SECRET"
Write-Host "Ingresa tu Dropbox Client ID:" -ForegroundColor Yellow
$DROPBOX_CLIENT_ID = Read-Host "DROPBOX_CLIENT_ID"
Write-Host "Ingresa tu Dropbox Client Secret:" -ForegroundColor Yellow
$DROPBOX_CLIENT_SECRET = Read-Host "DROPBOX_CLIENT_SECRET"

# Frontend URL (Vercel)
Write-Host "Ingresa la URL de tu frontend en Vercel:" -ForegroundColor Yellow
Write-Host "(ejemplo: https://cloud-aggregator.vercel.app)" -ForegroundColor Gray
$FRONTEND_URL = Read-Host "FRONTEND_URL"

# Stripe Price IDs (TEST MODE)
$STRIPE_PRICE_STANDARD_MONTHLY = "price_1Svf9GJtzJiOgNkJBXle45Op"
$STRIPE_PRICE_STANDARD_YEARLY = "price_1Svf88JtzJiOgNkJWKvPkoal"
$STRIPE_PRICE_PREMIUM_MONTHLY = "price_1Svf8hJtzJiOgNkJoeO0BgPu"
$STRIPE_PRICE_PREMIUM_YEARLY = "price_1Svf7OJtzJiOgNkJSZRX6NsY"

Write-Host ""
Write-Host "Configurando secretos en Fly.io..." -ForegroundColor Green
Write-Host ""

# Cambiar al directorio backend
Set-Location backend

# Configurar secretos uno por uno
Write-Host "Configurando STRIPE_SECRET_KEY..." -ForegroundColor Gray
fly secrets set STRIPE_SECRET_KEY="$STRIPE_SECRET_KEY"

Write-Host "Configurando SUPABASE_URL..." -ForegroundColor Gray
fly secrets set SUPABASE_URL="$SUPABASE_URL"

Write-Host "Configurando SUPABASE_SERVICE_ROLE_KEY..." -ForegroundColor Gray
fly secrets set SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY"

Write-Host "Configurando GOOGLE_CLIENT_ID..." -ForegroundColor Gray
fly secrets set GOOGLE_CLIENT_ID="$GOOGLE_CLIENT_ID"

Write-Host "Configurando GOOGLE_CLIENT_SECRET..." -ForegroundColor Gray
fly secrets set GOOGLE_CLIENT_SECRET="$GOOGLE_CLIENT_SECRET"

Write-Host "Configurando DROPBOX_CLIENT_ID..." -ForegroundColor Gray
fly secrets set DROPBOX_CLIENT_ID="$DROPBOX_CLIENT_ID"

Write-Host "Configurando DROPBOX_CLIENT_SECRET..." -ForegroundColor Gray
fly secrets set DROPBOX_CLIENT_SECRET="$DROPBOX_CLIENT_SECRET"

Write-Host "Configurando FRONTEND_URL..." -ForegroundColor Gray
fly secrets set FRONTEND_URL="$FRONTEND_URL"

Write-Host "Configurando Stripe Price IDs..." -ForegroundColor Gray
fly secrets set STRIPE_PRICE_STANDARD_MONTHLY="$STRIPE_PRICE_STANDARD_MONTHLY"
fly secrets set STRIPE_PRICE_STANDARD_YEARLY="$STRIPE_PRICE_STANDARD_YEARLY"
fly secrets set STRIPE_PRICE_PREMIUM_MONTHLY="$STRIPE_PRICE_PREMIUM_MONTHLY"
fly secrets set STRIPE_PRICE_PREMIUM_YEARLY="$STRIPE_PRICE_PREMIUM_YEARLY"

Write-Host ""
Write-Host "✅ Secretos configurados correctamente" -ForegroundColor Green

# ==========================================
# PASO 3: DESPLEGAR BACKEND A FLY.IO
# ==========================================

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "PASO 3: DESPLEGAR BACKEND A FLY.IO" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Desplegando backend..." -ForegroundColor Green
fly deploy --ha=false

Write-Host ""
Write-Host "✅ Backend desplegado en Fly.io" -ForegroundColor Green

# Volver al directorio raíz
Set-Location ..

# ==========================================
# PASO 4: CONFIGURAR WEBHOOK EN STRIPE
# ==========================================

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "PASO 4: CONFIGURAR WEBHOOK EN STRIPE" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$BACKEND_URL = "https://cloud-aggregator-api.fly.dev"
$WEBHOOK_URL = "$BACKEND_URL/stripe/webhook"

Write-Host "Configuración del Webhook:" -ForegroundColor Yellow
Write-Host "1. Ve a: https://dashboard.stripe.com/test/webhooks" -ForegroundColor Yellow
Write-Host "2. Click en 'Add endpoint'" -ForegroundColor Yellow
Write-Host "3. Endpoint URL: $WEBHOOK_URL" -ForegroundColor Cyan
Write-Host "4. Selecciona estos eventos:" -ForegroundColor Yellow
Write-Host "   - checkout.session.completed" -ForegroundColor Gray
Write-Host "   - customer.subscription.created" -ForegroundColor Gray
Write-Host "   - customer.subscription.updated" -ForegroundColor Gray
Write-Host "   - customer.subscription.deleted" -ForegroundColor Gray
Write-Host "5. Copia el Signing Secret (whsec_...)" -ForegroundColor Yellow
Write-Host ""
Write-Host "Ingresa el Webhook Signing Secret:" -ForegroundColor Green
$STRIPE_WEBHOOK_SECRET = Read-Host "STRIPE_WEBHOOK_SECRET"

# Configurar webhook secret en Fly.io
Set-Location backend
Write-Host ""
Write-Host "Configurando STRIPE_WEBHOOK_SECRET en Fly.io..." -ForegroundColor Green
fly secrets set STRIPE_WEBHOOK_SECRET="$STRIPE_WEBHOOK_SECRET"

Write-Host ""
Write-Host "✅ Webhook configurado correctamente" -ForegroundColor Green

# Volver al directorio raíz
Set-Location ..

# ==========================================
# PASO 5: DESPLEGAR FRONTEND A VERCEL
# ==========================================

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "PASO 5: DESPLEGAR FRONTEND A VERCEL" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Set-Location frontend

Write-Host "Configurando variables de entorno en Vercel..." -ForegroundColor Yellow
Write-Host "1. Ve a: https://vercel.com/tu-proyecto/settings/environment-variables" -ForegroundColor Yellow
Write-Host "2. Configura estas variables:" -ForegroundColor Yellow
Write-Host ""
Write-Host "   NEXT_PUBLIC_API_URL = $BACKEND_URL" -ForegroundColor Cyan
Write-Host "   NEXT_PUBLIC_SUPABASE_URL = $SUPABASE_URL" -ForegroundColor Cyan
Write-Host "   NEXT_PUBLIC_SUPABASE_ANON_KEY = (tu anon key de Supabase)" -ForegroundColor Cyan
Write-Host ""
Write-Host "Presiona ENTER cuando hayas configurado las variables..." -ForegroundColor Green
Read-Host

Write-Host ""
Write-Host "Desplegando frontend a Vercel..." -ForegroundColor Green
vercel --prod

Write-Host ""
Write-Host "✅ Frontend desplegado en Vercel" -ForegroundColor Green

# Volver al directorio raíz
Set-Location ..

# ==========================================
# RESUMEN FINAL
# ==========================================

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "🎉 DEPLOYMENT COMPLETADO" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "URLs de producción:" -ForegroundColor Yellow
Write-Host "  Backend:  $BACKEND_URL" -ForegroundColor Cyan
Write-Host "  Frontend: $FRONTEND_URL" -ForegroundColor Cyan
Write-Host ""
Write-Host "Stripe Webhook:" -ForegroundColor Yellow
Write-Host "  URL: $WEBHOOK_URL" -ForegroundColor Cyan
Write-Host "  Dashboard: https://dashboard.stripe.com/test/webhooks" -ForegroundColor Gray
Write-Host ""
Write-Host "Próximos pasos:" -ForegroundColor Yellow
Write-Host "  1. Prueba el flujo completo en: $FRONTEND_URL/pricing" -ForegroundColor Gray
Write-Host "  2. Usa tarjeta de prueba: 4242 4242 4242 4242" -ForegroundColor Gray
Write-Host "  3. Verifica que el webhook se recibe correctamente" -ForegroundColor Gray
Write-Host "  4. Cuando funcione, cambiar a Stripe LIVE mode" -ForegroundColor Gray
Write-Host ""
Write-Host "Monitoreo:" -ForegroundColor Yellow
Write-Host "  Backend logs:  fly logs -a cloud-aggregator-api" -ForegroundColor Gray
Write-Host "  Frontend logs: vercel logs" -ForegroundColor Gray
Write-Host "  Stripe events: https://dashboard.stripe.com/test/events" -ForegroundColor Gray
Write-Host ""
