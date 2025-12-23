# RESUMEN EJECUTIVO: Fixes Auditoría Slots Vitalicios

## ✅ CAMBIOS IMPLEMENTADOS (4 archivos)

### 🔴 CRÍTICO: Eliminado pre-check bloqueante
**Archivo:** `backend/backend/main.py` (líneas 65-104)
- **ANTES:** Pre-check en `/auth/google/login` bloqueaba OAuth antes de conocer cuenta
- **DESPUÉS:** Sin pre-check - validación solo en callback con `check_cloud_limit_with_slots`
- **Impacto:** Permite reconexión de slots históricos sin bloqueo prematuro

### 🔴 ALTA: Campos explícitos para gating
**Archivo:** `backend/backend/quota.py` (líneas 168-215)
- **Nuevos campos:**
  - `historical_slots_used` - slots consumidos lifetime (nunca decrece)
  - `historical_slots_total` - slots permitidos por plan (FREE=2)
  - `active_clouds_connected` - cuentas activas ahora
- **Impacto:** Separación clara entre slots históricos vs cuentas activas

### 🔴 ALTA: Gating correcto en frontend
**Archivo:** `frontend/src/app/app/page.tsx` (líneas 38-268)
- **ANTES:** `disabled={clouds_connected >= clouds_allowed}` (ambiguo)
- **DESPUÉS:** `disabled={historical_slots_used >= historical_slots_total}` (correcto)
- **Impacto:** Botón "Conectar nueva" basado en slots históricos, no en activas

### 🟡 MEDIA: OAuth prompt mejorado
**Archivo:** `frontend/src/components/ReconnectSlotsModal.tsx` (líneas 43-57)
- **Cambio:** Agregado `mode=reauth` al URL de reconexión
- **Backend:** Usa `prompt=select_account` en lugar de `consent`
- **Impacto:** Mejor UX - muestra selector de cuenta en reconexión

---

## 🧪 PRUEBAS CRÍTICAS

```bash
# Escenario: FREE 2/2 slots, cuenta A desconectada
1. historical_slots_used=2, active_clouds_connected=1
2. Botón "Conectar nueva" DESHABILITADO ✅
3. Botón "Ver mis cuentas" HABILITADO ✅
4. Clic "Reconectar" en cuenta A → OAuth inicia sin bloqueo ✅
5. Callback valida provider_account_id existente → SALVOCONDUCTO ✅
6. Cuenta A reaparece sin error ✅
7. Intentar conectar cuenta C nueva → Bloqueo en callback ✅
```

---

## 📊 MODELO FINAL: Slots Vitalicios FREE

```
Plan FREE:
├─ historical_slots_total: 2 (fijo, permanente)
├─ historical_slots_used: 0→1→2 (solo incrementa, nunca decrece)
└─ active_clouds_connected: 0-2 (sube/baja con conectar/desconectar)

Gating:
- Conectar nueva: disabled si historical_slots_used >= 2
- Reconectar: siempre permitido (SALVOCONDUCTO en callback)

OAuth:
- Login: SIN pre-check (permite iniciar OAuth)
- Callback: check_cloud_limit_with_slots valida provider_account_id
  ├─ Existe en cloud_slots_log → PERMITIR (reconexión)
  └─ No existe + slots_used >= slots_total → BLOQUEAR (nueva cuenta)
```

---

## 🚀 DEPLOY RÁPIDO

```bash
# Pre-deploy
pg_dump -t cloud_slots_log > backup_slots.sql
psql -c "SELECT COUNT(*) FROM cloud_slots_log WHERE disconnected_at IS NOT NULL AND is_active=true;"
# Si > 0: ejecutar fix_inconsistent_slots.sql

# Deploy
git push origin main
# (CI/CD despliega backend + frontend)

# Post-deploy
curl https://api.example.com/me/plan -H "Authorization: Bearer TOKEN"
# Verificar campos: historical_slots_used, historical_slots_total, active_clouds_connected

# Pruebas críticas
# Ejecutar escenario 1-7 del checklist
```

---

## 📁 ARCHIVOS MODIFICADOS

| Archivo | Cambios | Criticidad |
|---------|---------|------------|
| `backend/backend/quota.py` | +campos explícitos | 🔴 ALTA |
| `backend/backend/main.py` | -pre-check, +prompt | 🔴 CRÍTICA |
| `frontend/src/app/app/page.tsx` | gating correcto | 🔴 ALTA |
| `frontend/src/components/ReconnectSlotsModal.tsx` | +mode=reauth | 🟡 MEDIA |

**Total:** ~120 líneas, 0 errores de linting

---

## ✅ CUMPLIMIENTO OAUTH

- ✅ No PII en querystring (emails)
- ⚠️ user_id en URL (TODO Fase 2: derivar de JWT)
- ✅ Scopes mínimos (Drive + email + openid)
- ✅ prompt=select_account en reconexión
- ✅ Mensajes claros sin exponer datos

---

**Docs completos:** Ver `AUDITORIA_SLOTS_VITALICIOS_FIXES.md`
