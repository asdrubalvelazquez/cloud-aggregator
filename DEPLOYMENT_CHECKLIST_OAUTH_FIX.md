# 🚀 DEPLOYMENT CHECKLIST: Slots Vitalicios + OAuth Fix

**Fecha:** 22 Diciembre 2025  
**Release:** v1.1-oauth-fix  
**Prioridad:** 🔴 CRÍTICO (Bloquea producción)

---

## 📦 CAMBIOS EN ESTE RELEASE

### 🔴 CRÍTICO: Login-URL Pattern (Evita 401)
- **Problema:** `window.location.href` a endpoint JWT → 401 Unauthorized
- **Fix:** Endpoint `/auth/google/login-url` retorna JSON, frontend hace fetch + redirect manual
- **Archivos:** `main.py`, `api.ts`, `page.tsx`, `ReconnectSlotsModal.tsx`
- **Testing:** Escenario 0 (prioritario)

### 🔒 Seguridad OAuth
- JWT derivation (user_id de token, NO querystring)
- Logging sin PII (hash SHA256 parcial)
- OAuth prompt strategy (`select_account` por defecto)
- PII reduction (sin `provider_account_id` en API)

### 🛡️ Robustez Backend
- Fallback COUNT DISTINCT desde `cloud_slots_log`
- Scopes mínimos documentados
- Deprecación explícita endpoints antiguos (410 Gone)

---

## 🔧 ARCHIVOS MODIFICADOS

### Backend (5 cambios)
1. `backend/backend/main.py`
   - Import hashlib (línea 2)
   - Nuevo `/auth/google/login-url` (líneas 70-133)
   - Deprecado `/auth/google/login` (líneas 136-147)
   - Scopes documentados (líneas 42-50)

2. `backend/backend/quota.py`
   - Fallback robusto `historical_slots_used` (líneas 97-109)

### Frontend (3 cambios)
3. `frontend/src/lib/api.ts`
   - Función `fetchGoogleLoginUrl()` (líneas 57-92)
   - Type `GoogleLoginUrlResponse` (líneas 52-54)

4. `frontend/src/app/app/page.tsx`
   - `handleConnectGoogle()` con fetch + redirect (líneas 148-162)

5. `frontend/src/components/ReconnectSlotsModal.tsx`
   - `handleReconnect()` con fetch + redirect (líneas 43-66)

---

## ✅ PRE-DEPLOY CHECKLIST

### Código (Obligatorio)
- [x] 0 errores TypeScript
- [x] 0 errores Python/linting
- [x] Imports verificados (hashlib, etc.)
- [x] Types actualizados (GoogleLoginUrlResponse)
- [x] Documentación completa (3 archivos MD)

### Environment Variables (Verificar)
- [ ] **Backend (Fly.io):**
  ```bash
  GOOGLE_CLIENT_ID=...
  GOOGLE_CLIENT_SECRET=...
  GOOGLE_REDIRECT_URI=https://api.cloudaggregator.com/auth/google/callback  # HTTPS!
  JWT_SECRET=...
  SUPABASE_URL=...
  SUPABASE_SERVICE_ROLE_KEY=...
  ```

- [ ] **Frontend (Vercel):**
  ```bash
  NEXT_PUBLIC_API_BASE_URL=https://api.cloudaggregator.com  # HTTPS!
  NEXT_PUBLIC_SUPABASE_URL=...
  NEXT_PUBLIC_SUPABASE_ANON_KEY=...
  ```

### Google Cloud Console (Verificar)
- [ ] OAuth Consent Screen configurado
- [ ] Redirect URI autorizado: `https://api.cloudaggregator.com/auth/google/callback`
- [ ] Scopes: `drive`, `userinfo.email`, `openid` (SOLO esos 3)
- [ ] Privacy Policy URL: `https://cloudaggregator.com/privacy`
- [ ] Terms URL: `https://cloudaggregator.com/terms`

---

## 🧪 TESTING STAGING (OBLIGATORIO)

### Escenario 0: Login-URL Pattern (PRIORITARIO) 🔴
**Objetivo:** Verificar NO hay 401 en OAuth

1. **Nueva conexión:**
   ```bash
   # Browser DevTools Network
   POST /auth/google/login-url
   Status: 200
   Response: {"url": "https://accounts.google.com/..."}
   ```
   - ✅ NO debe haber 401
   - ✅ Redirect a Google funciona
   - ✅ Logs backend: `[OAuth URL Generated] user_hash=abc12345 mode=new`

2. **Reconexión:**
   - Modal slots → Click inactivo
   - Verificar: `mode=reauth` en request
   - Verificar: `prompt=select_account` en logs

3. **Error handling:**
   - Simular backend down
   - UI debe mostrar: "Error al obtener URL de Google: ..."
   - NO redirect silencioso

4. **Deprecated endpoint:**
   ```bash
   curl https://api-staging.cloudaggregator.com/auth/google/login
   Expected: 410 Gone
   ```

### Escenario 1-6: Testing Funcional
(Ver [LOGIN_URL_PATTERN_FIX.md](LOGIN_URL_PATTERN_FIX.md) sección Testing)

### Validaciones Seguridad
- [ ] Logs backend SIN user_id completo (solo hash)
- [ ] Logs backend SIN emails
- [ ] Logs backend SIN provider_account_id
- [ ] Network tab: NO user_id en querystrings
- [ ] HTTPS en todas las URLs (no http)

**Comando audit:**
```bash
# Backend logs staging
fly logs --app cloud-aggregator-backend-staging | grep "user_id="
# Expected: 0 results (solo debe haber user_hash)
```

---

## 🚀 DEPLOY PRODUCCIÓN

### Paso 1: Deploy Backend (Fly.io)
```bash
cd backend

# Verificar configuración
fly status --app cloud-aggregator-backend

# Deploy
fly deploy --app cloud-aggregator-backend

# Verificar logs (primeros 5 min)
fly logs --app cloud-aggregator-backend
```

**Health check:**
```bash
curl https://api.cloudaggregator.com/health
Expected: {"status": "ok"}
```

### Paso 2: Deploy Frontend (Vercel)
```bash
cd frontend

# Verificar preview build
npm run build

# Deploy production
vercel --prod

# Output: https://cloudaggregator.com (o tu dominio)
```

**Health check:**
```bash
curl https://cloudaggregator.com
Expected: 200 (dashboard login)
```

### Paso 3: Smoke Test Producción (CRÍTICO)
1. **Nueva cuenta usuario:**
   - Signup → Login → Dashboard
   - Click "Conectar Google Drive"
   - **Verificar:** NO 401, redirect a Google
   - **Completar:** OAuth → callback → cuenta conectada
   - **Logs:** `[OAuth URL Generated] user_hash=...`

2. **Reconexión slot:**
   - Desconectar cuenta
   - "Reconectar slots" → Click inactivo
   - **Verificar:** mode=reauth, prompt=select_account
   - **Completar:** OAuth → reconnect success

3. **Límite histórico:**
   - Usuario FREE con 2 slots históricos
   - Botón "Conectar nueva" → DISABLED
   - Intentar OAuth manual → "Límite alcanzado"

**Si alguno falla: ROLLBACK INMEDIATO**
```bash
# Backend rollback
fly deploy --app cloud-aggregator-backend --image <previous-image-id>

# Frontend rollback
vercel rollback cloudaggregator.com
```

---

## 📊 MONITOREO POST-DEPLOY (24 HORAS)

### Métricas Backend (Fly.io)
```bash
# Logs en tiempo real
fly logs --app cloud-aggregator-backend

# Buscar errores
fly logs | grep "ERROR"
fly logs | grep "401"
fly logs | grep "410"  # Deprecated endpoint usage

# Métricas OAuth
fly logs | grep "[OAuth URL Generated]" | wc -l  # Count OAuth starts
fly logs | grep "[OAuth Callback]" | wc -l        # Count OAuth completions
```

### Métricas Frontend (Vercel)
- Dashboard Vercel → Analytics
- Errores 4xx/5xx
- Tiempo respuesta `/auth/google/login-url`

### KPIs Clave
| Métrica | Target | Alerta Si |
|---------|--------|-----------|
| OAuth success rate | >95% | <90% |
| 401 errors count | 0 | >5/hora |
| 410 deprecated endpoint | <10/día | >50/día |
| Slot reconexión success | >98% | <95% |
| Callback errors | <1% | >5% |

### Alertas Críticas
**Setup en Fly.io/Vercel:**
- 🔴 5xx errors >10/min → Email + Slack
- 🟠 401 errors >5/hora → Email
- 🟢 410 deprecated >20/día → Info (migración lenta OK)

---

## 🔄 ROLLBACK PLAN

### Si hay issues críticos (401 masivos, OAuth broken):

**Opción 1: Rollback completo**
```bash
# Backend
fly deploy --app cloud-aggregator-backend --image <VERSION_ANTERIOR>

# Frontend
vercel rollback cloudaggregator.com
```

**Opción 2: Feature flag (si implementado)**
```bash
# Deshabilitar login-url, volver a endpoint antiguo temporalmente
# (requiere código preparado con flag)
```

**Opción 3: Hotfix forward**
- Si bug menor, fix forward más rápido que rollback
- Deploy hotfix a staging → test 15 min → prod

---

## 📚 DOCUMENTACIÓN ENTREGADA

### Para Desarrolladores
1. **[LOGIN_URL_PATTERN_FIX.md](LOGIN_URL_PATTERN_FIX.md)** - Detalle técnico fix 401
2. **[QUICKSTART_AUDITORIA_FINAL.md](QUICKSTART_AUDITORIA_FINAL.md)** - Resumen ejecutivo
3. **[AUDITORIA_SLOTS_VITALICIOS_FIXES.md](AUDITORIA_SLOTS_VITALICIOS_FIXES.md)** - Diffs completos

### Para Google OAuth Review (Si aplica)
- Scopes justificados (drive, userinfo.email, openid)
- Limited Use Disclosure (preparar en `/privacy`)
- Consent screen configurado
- HTTPS enforced
- Security best practices (state, no PII, logging seguro)

---

## ✅ SIGN-OFF

### Pre-Deploy (Obligatorio)
- [ ] Code review completado
- [ ] 0 errores linting
- [ ] Staging tested (Escenario 0 prioritario)
- [ ] Environment variables verificadas
- [ ] Google Console configurado

### Post-Deploy (24h)
- [ ] Smoke test producción OK
- [ ] Logs sin errores críticos
- [ ] Métricas OAuth >95% success
- [ ] NO hay 401 errors
- [ ] Monitoring activo

### Responsables
- **Tech Lead:** Aprobar deploy
- **DevOps:** Ejecutar deploy + monitoreo
- **QA:** Smoke test producción
- **On-call:** 24h monitoring post-deploy

---

## 🎯 RESUMEN EJECUTIVO

**Qué se despliega:**
- Fix crítico OAuth (401 → login-url pattern)
- Seguridad mejorada (JWT, no PII)
- Robustez backend (fallback slots)

**Riesgo:** 🟡 MEDIO
- Cambio arquitectónico (endpoint nuevo)
- Testing staging obligatorio
- Rollback plan listo

**Impacto:** 🟢 POSITIVO
- Desbloquea OAuth en producción
- Mejor seguridad (no PII en logs)
- Cumplimiento Google OAuth review

**Timeline:**
- Staging: 2 horas (testing completo)
- Deploy prod: 30 min
- Monitoring: 24h post-deploy
- Total: 1 día laboral

---

**Aprobación requerida:** Tech Lead + DevOps  
**Deploy window:** Lunes-Jueves (no viernes/fines de semana)  
**Contacto emergencias:** On-call engineer
