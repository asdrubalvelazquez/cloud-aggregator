# ==========================================
# Cloud Aggregator - Quick Setup Script
# ==========================================
# PowerShell script para configurar entorno de desarrollo local

Write-Host "================================" -ForegroundColor Cyan
Write-Host "Cloud Aggregator - Quick Setup" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# ==========================================
# Paso 1: Verificar si .env existe
# ==========================================
$envPath = "backend\.env"

if (Test-Path $envPath) {
    Write-Host "[✓] Archivo .env ya existe" -ForegroundColor Green
    $overwrite = Read-Host "¿Quieres sobrescribirlo? (y/N)"
    if ($overwrite -ne "y") {
        Write-Host "[!] Usando .env existente" -ForegroundColor Yellow
        exit
    }
}

# ==========================================
# Paso 2: Solicitar configuración
# ==========================================
Write-Host ""
Write-Host "Ingresa tu configuración:" -ForegroundColor Yellow
Write-Host ""

# Supabase
Write-Host "=== Supabase ===" -ForegroundColor Cyan
$supabaseUrl = Read-Host "SUPABASE_URL (ej: https://xxx.supabase.co)"
$supabaseServiceKey = Read-Host "SUPABASE_SERVICE_ROLE_KEY"

# Stripe
Write-Host ""
Write-Host "=== Stripe Test Mode ===" -ForegroundColor Cyan
Write-Host "Obtén tus keys de: https://dashboard.stripe.com/test/apikeys" -ForegroundColor Gray
$stripeSecretKey = Read-Host "STRIPE_SECRET_KEY (sk_test_...)"

Write-Host ""
Write-Host "[Webhook Setup]" -ForegroundColor Yellow
Write-Host "Opción 1: Corre en otra terminal: stripe listen --forward-to localhost:8000/stripe/webhook" -ForegroundColor Gray
Write-Host "Opción 2: Usa ngrok y configura webhook en Stripe Dashboard" -ForegroundColor Gray
$stripeWebhookSecret = Read-Host "STRIPE_WEBHOOK_SECRET (whsec_...) [opcional ahora]"

# ==========================================
# Paso 3: Crear archivo .env
# ==========================================
Write-Host ""
Write-Host "[→] Creando archivo .env..." -ForegroundColor Yellow

$envContent = @"
# ===============================================
# Cloud Aggregator - Environment Variables
# Generado el: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
# ===============================================

# ===============================================
# SUPABASE CONFIGURATION
# ===============================================
SUPABASE_URL=$supabaseUrl
SUPABASE_SERVICE_ROLE_KEY=$supabaseServiceKey

# ===============================================
# STRIPE CONFIGURATION (Test Mode)
# ===============================================
STRIPE_SECRET_KEY=$stripeSecretKey
STRIPE_WEBHOOK_SECRET=$stripeWebhookSecret

# Stripe Test Mode Price IDs (configurados como defaults en código)
# Solo necesitas cambiarlos si creas nuevos productos en Stripe
STRIPE_PRICE_STANDARD_MONTHLY=price_1Svf9GJtzJiOgNkJBXle45Op
STRIPE_PRICE_STANDARD_YEARLY=price_1Svf88JtzJiOgNkJWKvPkoal
STRIPE_PRICE_PREMIUM_MONTHLY=price_1Svf8hJtzJiOgNkJoeO0BgPu
STRIPE_PRICE_PREMIUM_YEARLY=price_1Svf7OJtzJiOgNkJSZRX6NsY

# ===============================================
# FRONTEND CONFIGURATION
# ===============================================
FRONTEND_URL=http://localhost:3000

# ===============================================
# OPCIONAL - Google/OneDrive OAuth
# ===============================================
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=
# ONEDRIVE_CLIENT_ID=
# ONEDRIVE_CLIENT_SECRET=
"@

Set-Content -Path $envPath -Value $envContent

Write-Host "[✓] Archivo .env creado exitosamente!" -ForegroundColor Green
Write-Host ""

# ==========================================
# Paso 4: Verificar dependencias
# ==========================================
Write-Host "=== Verificando dependencias ===" -ForegroundColor Cyan

# Python
Write-Host ""
Write-Host "[→] Verificando Python..." -ForegroundColor Yellow
try {
    $pythonVersion = python --version 2>&1
    Write-Host "[✓] $pythonVersion" -ForegroundColor Green
} catch {
    Write-Host "[✗] Python no encontrado. Instala Python 3.10+" -ForegroundColor Red
    exit
}

# Node.js
Write-Host ""
Write-Host "[→] Verificando Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version 2>&1
    Write-Host "[✓] Node.js $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "[✗] Node.js no encontrado. Instala Node.js 18+" -ForegroundColor Red
    exit
}

# Stripe CLI (opcional)
Write-Host ""
Write-Host "[→] Verificando Stripe CLI..." -ForegroundColor Yellow
try {
    $stripeVersion = stripe --version 2>&1
    Write-Host "[✓] Stripe CLI instalado: $stripeVersion" -ForegroundColor Green
} catch {
    Write-Host "[!] Stripe CLI no encontrado (opcional pero recomendado)" -ForegroundColor Yellow
    Write-Host "    Instala con: scoop install stripe" -ForegroundColor Gray
}

# ==========================================
# Paso 5: Instalar dependencias
# ==========================================
Write-Host ""
$installDeps = Read-Host "¿Instalar dependencias de Python y Node? (Y/n)"

if ($installDeps -ne "n") {
    # Backend
    Write-Host ""
    Write-Host "[→] Instalando dependencias del backend..." -ForegroundColor Yellow
    Set-Location backend
    pip install -r requirements.txt
    Set-Location ..
    Write-Host "[✓] Backend dependencies instaladas" -ForegroundColor Green
    
    # Frontend
    Write-Host ""
    Write-Host "[→] Instalando dependencias del frontend..." -ForegroundColor Yellow
    Set-Location frontend
    npm install
    Set-Location ..
    Write-Host "[✓] Frontend dependencies instaladas" -ForegroundColor Green
}

# ==========================================
# Paso 6: Resumen e Instrucciones
# ==========================================
Write-Host ""
Write-Host "================================" -ForegroundColor Cyan
Write-Host "¡Setup Completado!" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Próximos pasos:" -ForegroundColor Yellow
Write-Host ""
Write-Host "1. [Backend] En una terminal:" -ForegroundColor Cyan
Write-Host "   cd backend" -ForegroundColor Gray
Write-Host "   python -m uvicorn backend.main:app --reload --port 8000" -ForegroundColor Gray
Write-Host ""
Write-Host "2. [Frontend] En otra terminal:" -ForegroundColor Cyan
Write-Host "   cd frontend" -ForegroundColor Gray
Write-Host "   npm run dev" -ForegroundColor Gray
Write-Host ""
Write-Host "3. [Webhooks] En otra terminal (IMPORTANTE para testing):" -ForegroundColor Cyan
Write-Host "   stripe listen --forward-to localhost:8000/stripe/webhook" -ForegroundColor Gray
Write-Host "   (Copia el webhook secret y actualiza .env)" -ForegroundColor Gray
Write-Host ""
Write-Host "4. Abrir en navegador:" -ForegroundColor Cyan
Write-Host "   http://localhost:3000/pricing" -ForegroundColor Gray
Write-Host ""
Write-Host "5. Para probar pagos, usa tarjeta de test:" -ForegroundColor Cyan
Write-Host "   4242 4242 4242 4242 | 12/27 | 123" -ForegroundColor Gray
Write-Host ""
Write-Host "Documentación completa: TESTING_MODE_SETUP.md" -ForegroundColor Yellow
Write-Host ""
Write-Host "¡Listo para probar! 🚀" -ForegroundColor Green
