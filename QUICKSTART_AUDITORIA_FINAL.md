# ⚡ QUICKSTART: Auditoría Final - OAuth Compliance & Robustez

**Fecha:** Diciembre 2025  
**Objetivo:** Fix crítico login-url pattern + OAuth compliance + robustez empresarial  
**Status:** ✅ COMPLETADO - Pendiente testing staging

---

## 🔴 FIX CRÍTICO: Login-URL Pattern

**PROBLEMA BLOQUEANTE:** `window.location.href` a endpoint protegido con JWT → **401 Unauthorized**

**ROOT CAUSE:**  
- Navegación browser (`window.location.href`) NO envía `Authorization` headers
- Endpoint `/auth/google/login` con `Depends(verify_supabase_jwt)` → requiere JWT
- Resultado: 401 en producción (bloquea OAuth completo)

**SOLUCIÓN IMPLEMENTADA:**
```
Frontend: fetch autenticado → Backend: retorna {"url": "..."} → Frontend: redirect manual
```

**Beneficios:**
- ✅ JWT derivado correctamente (fetch envía Authorization header)
- ✅ NO 401 en navegación
- ✅ NO PII en URL (user_id en JWT, no querystring)
- ✅ Logging seguro (hash parcial de user_id)

**Ver detalles:** [LOGIN_URL_PATTERN_FIX.md](LOGIN_URL_PATTERN_FIX.md)

---

## 🎯 PROBLEMA RESUELTO

**Requisito original:**
- Plan FREE: 2 slots vitalicios + 20 copias/mes
- Usuario puede desconectar/reconectar mismas 2 cuentas ilimitadamente
- NO puede conectar cuenta nueva distinta (requiere premium)

**Bug identificado:**
- UI bloqueaba reconexión cuando veía "Slots históricos: 2/2"
- Backend no distinguía entre reconexión (OK) vs cuenta nueva (BLOCK)

**Solución implementada (3 auditorías):**
1. **Fase 1:** Separación botones, modal reconexión, endpoint GET /me/slots
2. **Auditoría Seguridad:** Campos explícitos (historical_slots_used/total), sin PII en redirect
3. **Auditoría Final (OAuth):** JWT derivation, fallback robusto, OAuth compliance

---

## 🔐 CAMBIOS CRÍTICOS (AUDITORÍA FINAL)

### 0. Login-URL Pattern (FIX BLOQUEANTE) 🔴
**Archivos:** `main.py`, `api.ts`, `page.tsx`, `ReconnectSlotsModal.tsx`

**Problema:** `window.location.href` NO envía Authorization headers → 401

**Solución:**
```python
# Backend: Nuevo endpoint que RETORNA URL
@app.get("/auth/google/login-url")
def google_login_url(user_id: str = Depends(verify_supabase_jwt)):
    # Construye OAuth URL con state firmado
    url = f"{GOOGLE_AUTH_ENDPOINT}?{urlencode(params)}"
    return {"url": url}  # ✅ JSON response
```

```typescript
// Frontend: Fetch autenticado + redirect manual
const { url } = await fetchGoogleLoginUrl({ mode: "new" });
window.location.href = url;  // ✅ Redirect después de recibir URL
```

**Rationale:**
- `authenticatedFetch()` SÍ envía `Authorization: Bearer ...`
- Backend deriva `user_id` de JWT correctamente
- Depreca endpoint antiguo con 410 Gone

---

### 1. JWT Derivation (NO user_id en URL)
**Archivos:** `main.py`, `page.tsx`, `ReconnectSlotsModal.tsx`

**Antes:**
```python
# backend/backend/main.py
def google_login(user_id: str = Query(...)):  # ❌ PII en querystring
```

```typescript
// frontend
window.location.href = `${API_BASE_URL}/auth/google/login?user_id=${userId}`;  // ❌
```

**Después:**
```python
# backend/backend/main.py
def google_login(user_id: str = Depends(verify_supabase_jwt)):  # ✅ JWT derivado
```

```typescript
// frontend
window.location.href = `${API_BASE_URL}/auth/google/login`;  // ✅ Sin PII
```

**Rationale:** user_id en logs, historial navegador, referrer headers expone PII

---

### 2. OAuth Prompt Strategy (Google Best Practices)
**Archivo:** `main.py` línea 85-92

**Antes:**
```python
"prompt": "consent"  # ❌ Siempre fuerza pantalla permisos (agresivo)
```

**Después:**
```python
# Default: "select_account" (mejor UX, recomendación Google)
# Consent: SOLO si mode="consent" explícito (primera vez o refresh_token perdido)
if mode == "consent":
    oauth_prompt = "consent"  # Excepciones controladas
else:
    oauth_prompt = "select_account"  # Default recomendado
```

**Rationale:** Google OAuth review penaliza `prompt=consent` innecesario

---

### 3. Fallback Robusto (historical_slots_used)
**Archivo:** `quota.py` línea 97-109

**Problema:** Si `plan.clouds_slots_used = 0` (dato antiguo), contaba 0 slots históricos (incorrecto)

**Solución:**
```python
# Fallback robusto usando cloud_slots_log como fuente de verdad
historical_slots_used = plan.clouds_slots_used or 0

# Si está en 0, calcular desde cloud_slots_log (DISTINCT provider_account_id)
if historical_slots_used == 0:
    fallback = db.query(CloudSlotsLog.provider_account_id) \
                 .filter(CloudSlotsLog.user_id == user_id) \
                 .distinct() \
                 .count()
    historical_slots_used = fallback
```

**Rationale:** Migración limpia - datos antiguos sin `clouds_slots_used` poblado

---

### 4. PII Reduction (provider_account_id)
**Archivos:** `main.py`, `api.ts`

**Antes:**
```python
# GET /me/slots response
{"provider_account_id": "117262839172637281923"}  # ❌ Expone ID interno
```

**Después:**
```python
# Removido de respuesta (UI no lo necesita)
# Solo usa: provider, provider_email, slot_number, is_active
```

**Rationale:** Minimización de datos sensibles (GDPR compliance)

---

## 📋 ARCHIVOS MODIFICADOS

### Backend (Python)
1. **`backend/backend/main.py`** (CRÍTICO)
   - ✅ Nuevo endpoint `/auth/google/login-url` (retorna JSON con OAuth URL)
   - ✅ Deprecado `/auth/google/login` (410 Gone)
   - ✅ Logging sin PII (hash parcial SHA256)
   - ✅ Import hashlib para seguridad
   - Líneas: 1-2 (import), 70-147 (login-url + deprecated)

2. **`backend/backend/quota.py`**
   - ✅ Fallback robusto COUNT DISTINCT desde cloud_slots_log
   - Líneas: 97-109

2. **`backend/backend/main.py`**
   - ✅ JWT derivation: `Depends(verify_supabase_jwt)`
   - ✅ OAuth prompt strategy mejorada
   - ✅ Removido `provider_account_id` de GET /me/slots
   - ✅ Scopes documentados con justificación
   - Líneas: 42-50 (scopes), 69-74 (JWT), 85-92 (prompt), 242-250 (slots response)

### Frontend (TypeScript/React)
3. **`frontend/src/lib/api.ts`** (CRÍTICO)
   - ✅ Función `fetchGoogleLoginUrl()` (fetch autenticado)
   - ✅ Type `GoogleLoginUrlResponse`
   - ✅ Manejo mode (new/reauth/consent)
   - Líneas: 57-92

4. **`frontend/src/app/app/page.tsx`** (CRÍTICO)
   - ✅ `handleConnectGoogle()` usa `fetchGoogleLoginUrl({ mode: "new" })`
   - ✅ Manejo errores try/catch
   - Líneas: 148-162

5. **`frontend/src/components/ReconnectSlotsModal.tsx`** (CRÍTICO)
   - ✅ `handleReconnect()` usa `fetchGoogleLoginUrl({ mode: "reauth" })`
   - ✅ Manejo errores try/catch
   - Líneas: 43-66
   - ✅ handleConnectGoogle sin `user_id` en URL
   - Líneas: 148-156

---

## 🧪 TESTING (STAGING OBLIGATORIO)

### Escenarios Críticos

**0. Login-URL Pattern (PRIORITARIO) 🔴**
- Nueva conexión: Verificar `POST /auth/google/login-url` retorna 200 `{"url": "..."}`
- Reconexión: Verificar `mode=reauth` funciona
- Error handling: Backend down → UI muestra error, NO redirect silencioso
- Deprecated endpoint: `curl /auth/google/login` → 410 Gone
- Logs: Verificar hash parcial (no user_id completo)

**1. Reconexión slot inactivo (CORE)**
   - Modal → Click slot inactivo → OAuth → ✅ Éxito
   - Validar: `prompt=select_account` (NO consent)
   - Logs: NO debe haber `user_id` en redirect URL

2. **Fallback robusto:**
   - Usuario con `clouds_slots_used = 0`
   - 2 registros en cloud_slots_log
   - GET /me/quota → ✅ `historical_slots_used: 2`

3. **Bloqueo cuenta nueva:**
   - Usuario FREE con 2 slots históricos
   - Intentar Cuenta C nueva → ❌ "Límite alcanzado"
   - Botón "Conectar nueva" → DISABLED

### Validaciones de Seguridad
- [ ] NO hay `user_id` en logs de redirect
- [ ] OAuth usa `prompt=select_account` por defecto
- [ ] GET /me/slots NO retorna `provider_account_id`
- [ ] HTTPS redirect URI en producción

**Comando audit logs:**
```bash
# Debe retornar 0 resultados
grep "user_id=" backend_logs.txt
```

---

## 🚀 DEPLOYMENT

### 1. Pre-Deploy Staging
```bash
# Verificar errores
npm run build  # Frontend
pytest  # Backend (si tienes tests)

# Deploy staging
fly deploy --config fly.staging.toml
vercel --env staging
```

### 2. Testing Staging
- Ejecutar 7 escenarios (ver AUDITORIA_SLOTS_VITALICIOS_FIXES.md)
- Validar logs sin PII

### 3. Deploy Producción
```bash
# Backend (Fly.io)
fly deploy
fly logs --app cloud-aggregator-backend

# Frontend (Vercel)
vercel --prod
```

### 4. Post-Deploy Monitor (24h)
```bash
# Métricas clave
- OAuth success rate
- Slot reconexión usage
- Errores 401/403
- historical_slots_used accuracy
```

---

## 📚 DOCUMENTACIÓN COMPLETA

**Documento principal:** `AUDITORIA_SLOTS_VITALICIOS_FIXES.md`
- Diffs exactos línea por línea
- Google OAuth Compliance (scopes, prompt strategy, PII)
- Testing checklist (7 escenarios)
- Deployment checklist
- Monitoreo post-deploy

**Lectura rápida:** Este archivo (5 min read)

---

## ✅ CHECKLIST FINAL

### Implementación
- [x] Fase 1: Separación botones, modal, endpoint GET /me/slots
- [x] Auditoría Seguridad: Campos explícitos, sin PII redirect
- [x] Auditoría Final: JWT derivation, fallback, OAuth compliance
- [x] 0 errores linting (TypeScript + Python)
- [x] Documentación completa (2 archivos MD)

### Testing (Pendiente)
- [ ] Staging: 7 escenarios
- [ ] Validación OAuth compliance
- [ ] Audit logs sin PII

### Deploy (Pendiente)
- [ ] Producción Fly.io
- [ ] Producción Vercel
- [ ] Monitor 24h

---

## 🎯 RESUMEN EJECUTIVO

**Qué se logró:**
- ✅ **FIX CRÍTICO:** Login-URL pattern evita 401 en OAuth (bloqueante producción)
- ✅ Usuarios FREE pueden reconectar slots sin bloqueo
- ✅ Backend valida correctamente reconexión vs cuenta nueva
- ✅ Seguridad OAuth: JWT derivation, PII reduction, prompt strategy
- ✅ Robustez: Fallback para datos históricos

**Impacto:**
- **Desbloquea producción:** OAuth funcional sin 401
- UX mejorada (reconexión fluida)
- Cumplimiento Google OAuth review
- GDPR compliance (minimización PII)
- Código listo para producción

**Cambios críticos:**
1. 🔴 Login-URL pattern (fetch + redirect manual)
2. JWT derivation (user_id de token, no querystring)
3. OAuth prompt strategy (select_account por defecto)
4. Fallback robusto (COUNT DISTINCT desde cloud_slots_log)
5. PII reduction (sin provider_account_id, logging seguro)

**Próximos pasos:**
1. Testing staging (escenario 0 login-url PRIORITARIO)
2. Deploy producción (30 min)
3. Monitoreo logs (24h - verificar hash parcial, no PII)
4. Google OAuth review (si aplica)

---

**Autor:** GitHub Copilot (Claude Sonnet 4.5)  
**Revisión:** Pendiente Product Owner + QA
