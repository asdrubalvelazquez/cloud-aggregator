# ==========================================
# Cloud Aggregator - Start Development
# ==========================================
# Levanta backend y frontend simultáneamente

Write-Host "================================" -ForegroundColor Cyan
Write-Host "Cloud Aggregator - Dev Server" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# Verificar que .env existe
if (-not (Test-Path "backend\.env")) {
    Write-Host "[✗] No existe archivo backend\.env" -ForegroundColor Red
    Write-Host "    Ejecuta primero: .\setup-dev.ps1" -ForegroundColor Yellow
    exit
}

Write-Host "[✓] Configuración encontrada" -ForegroundColor Green
Write-Host ""

# Función para matar procesos al cerrar
$jobs = @()
function Stop-Jobs {
    Write-Host ""
    Write-Host "[→] Deteniendo servidores..." -ForegroundColor Yellow
    foreach ($job in $jobs) {
        Stop-Job $job -ErrorAction SilentlyContinue
        Remove-Job $job -ErrorAction SilentlyContinue
    }
    Write-Host "[✓] Servidores detenidos" -ForegroundColor Green
    exit
}

# Capturar Ctrl+C
$null = Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action { Stop-Jobs }

# ==========================================
# Iniciar Backend
# ==========================================
Write-Host "[→] Iniciando Backend (puerto 8000)..." -ForegroundColor Yellow
$backendJob = Start-Job -ScriptBlock {
    Set-Location $using:PWD
    cd backend
    python -m uvicorn backend.main:app --reload --port 8000
}
$jobs += $backendJob
Start-Sleep -Seconds 2

# Verificar que backend levantó
$backendRunning = $false
for ($i = 0; $i -lt 10; $i++) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:8000/health" -TimeoutSec 1 -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) {
            $backendRunning = $true
            break
        }
    } catch {
        Start-Sleep -Seconds 1
    }
}

if ($backendRunning) {
    Write-Host "[✓] Backend iniciado correctamente" -ForegroundColor Green
} else {
    Write-Host "[!] Backend tardando en iniciar (normal en primera ejecución)" -ForegroundColor Yellow
}

# ==========================================
# Iniciar Frontend
# ==========================================
Write-Host ""
Write-Host "[→] Iniciando Frontend (puerto 3000)..." -ForegroundColor Yellow
$frontendJob = Start-Job -ScriptBlock {
    Set-Location $using:PWD
    cd frontend
    npm run dev
}
$jobs += $frontendJob
Start-Sleep -Seconds 3

Write-Host "[✓] Frontend iniciado" -ForegroundColor Green

# ==========================================
# Mostrar información
# ==========================================
Write-Host ""
Write-Host "================================" -ForegroundColor Green
Write-Host "Servidores activos:" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Green
Write-Host ""
Write-Host "Backend:  " -NoNewline -ForegroundColor Cyan
Write-Host "http://localhost:8000" -ForegroundColor White
Write-Host "Frontend: " -NoNewline -ForegroundColor Cyan
Write-Host "http://localhost:3000" -ForegroundColor White
Write-Host "Pricing:  " -NoNewline -ForegroundColor Cyan
Write-Host "http://localhost:3000/pricing" -ForegroundColor White
Write-Host ""
Write-Host "================================" -ForegroundColor Yellow
Write-Host "IMPORTANTE: Webhook Setup" -ForegroundColor Yellow
Write-Host "================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "Para probar pagos, necesitas webhooks:" -ForegroundColor Gray
Write-Host "Abre una NUEVA terminal y ejecuta:" -ForegroundColor White
Write-Host ""
Write-Host "  stripe listen --forward-to localhost:8000/stripe/webhook" -ForegroundColor Cyan
Write-Host ""
Write-Host "Luego copia el 'webhook signing secret' (whsec_...)" -ForegroundColor Gray
Write-Host "y actualízalo en: backend\.env" -ForegroundColor Gray
Write-Host ""
Write-Host "================================" -ForegroundColor Green
Write-Host "Tarjeta de prueba:" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Green
Write-Host "  Número: " -NoNewline
Write-Host "4242 4242 4242 4242" -ForegroundColor White
Write-Host "  Fecha:  " -NoNewline
Write-Host "12/27" -ForegroundColor White
Write-Host "  CVC:    " -NoNewline
Write-Host "123" -ForegroundColor White
Write-Host ""
Write-Host "Presiona Ctrl+C para detener todos los servidores" -ForegroundColor Yellow
Write-Host ""

# ==========================================
# Monitorear logs en tiempo real
# ==========================================
try {
    while ($true) {
        # Mostrar logs del backend
        $backendLogs = Receive-Job $backendJob -ErrorAction SilentlyContinue
        if ($backendLogs) {
            Write-Host "[BACKEND] " -NoNewline -ForegroundColor Blue
            Write-Host $backendLogs
        }
        
        # Mostrar logs del frontend
        $frontendLogs = Receive-Job $frontendJob -ErrorAction SilentlyContinue
        if ($frontendLogs) {
            Write-Host "[FRONTEND] " -NoNewline -ForegroundColor Magenta
            Write-Host $frontendLogs
        }
        
        Start-Sleep -Milliseconds 500
    }
} catch {
    Stop-Jobs
}
