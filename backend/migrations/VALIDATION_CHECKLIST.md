# ✅ POST-DEPLOYMENT VALIDATION CHECKLIST

## 🎯 Objetivo
Verificar que la corrección de normalización de IDs resolvió los fallos de reconexión sin afectar la lógica de negocio.

---

## 📋 Pre-checks (Antes de deploy)

- [ ] **SQL ejecutado en Supabase**
  ```sql
  -- Verificar cuántos registros necesitan normalización
  SELECT COUNT(*) as needs_fix
  FROM cloud_slots_log
  WHERE provider_account_id IS NOT NULL
    AND provider_account_id != TRIM(provider_account_id);
  ```
  **Esperado:** Ver el número de registros a normalizar

- [ ] **SQL ejecutado con éxito**
  ```sql
  UPDATE cloud_slots_log
  SET provider_account_id = TRIM(provider_account_id)
  WHERE provider_account_id IS NOT NULL
    AND provider_account_id != TRIM(provider_account_id);
  ```
  **Esperado:** `UPDATE X` (donde X = número del query anterior)

- [ ] **Verificación post-migración**
  ```sql
  SELECT COUNT(*) as remaining_issues
  FROM cloud_slots_log
  WHERE provider_account_id IS NOT NULL
    AND provider_account_id != TRIM(provider_account_id);
  ```
  **Esperado:** `0` (cero registros con espacios)

- [ ] **Backend con logging desplegado a Fly.io**
  - Commit realizado con mensaje descriptivo
  - Deploy ejecutado: `fly deploy`
  - Health check OK: `curl https://cloud-aggregator-api.fly.dev/health`

---

## 🧪 Test Cases (Después de deploy)

### TEST 1: Reconexión de cuenta histórica (CON espacios previos)

**Escenario:** Usuario tenía cuenta con ID mal normalizado (ej: "12345 "), la desconectó, y ahora intenta reconectar.

**Setup:**
1. Identificar un usuario con slot histórico en `cloud_slots_log`
2. Verificar que `is_active = false` (desconectada)
3. Verificar que `clouds_slots_used >= clouds_slots_total` en `user_plans`

**Pasos:**
1. Iniciar OAuth flow: `https://cloud-aggregator-api.fly.dev/auth/google?state=<user_id>`
2. Completar autorización de Google
3. Observar callback response

**Resultado esperado:**
- ✅ Redirección: `https://horabuena.com/app?auth=success`
- ✅ NO muestra toast naranja de límite
- ✅ Cuenta aparece en dashboard como activa
- ✅ Log en Fly.io muestra:
  ```
  [SALVOCONDUCTO ✓] Slot histórico encontrado - slot_id=...
  ```

**Comando para verificar logs:**
```bash
fly logs --app cloud-aggregator-api | grep "SALVOCONDUCTO"
```

---

### TEST 2: Cuenta nueva SIN slots disponibles (Validación legítima)

**Escenario:** Usuario FREE con 2 slots ya consumidos intenta conectar una tercera cuenta nueva.

**Setup:**
1. Usuario con `plan = 'free'`
2. `clouds_slots_used = 2`, `clouds_slots_total = 2`
3. La nueva cuenta NO existe en `cloud_slots_log`

**Pasos:**
1. Iniciar OAuth flow con cuenta Google nunca conectada antes
2. Completar autorización

**Resultado esperado:**
- 🟠 Redirección: `https://horabuena.com/app?error=cloud_limit_reached&allowed=2`
- 🟠 Toast naranja: "Has alcanzado el límite de 2 cuenta(s)..."
- ❌ Cuenta NO aparece en dashboard
- ✅ Log en Fly.io muestra:
  ```
  [SLOT LIMIT ✗] Usuario ... ha excedido el límite de slots: 2/2
  ```

**Comando para verificar logs:**
```bash
fly logs --app cloud-aggregator-api | grep "SLOT LIMIT"
```

---

### TEST 3: Reconexión de cuenta histórica con `is_active=false`

**Escenario:** Usuario PLUS desconectó una cuenta (soft-delete), ahora la reconecta.

**Setup:**
1. Usuario con `plan = 'plus'`
2. Slot en `cloud_slots_log` con `is_active = false`, `disconnected_at != NULL`
3. `clouds_slots_used = 3`, `clouds_slots_total = 3` (límite alcanzado)

**Pasos:**
1. Desconectar cuenta desde UI (revoke)
2. Verificar que `is_active = false` en DB
3. Intentar reconectar la misma cuenta

**Resultado esperado:**
- ✅ Redirección: `https://horabuena.com/app?auth=success`
- ✅ NO muestra toast de límite
- ✅ `is_active` actualizado a `true`
- ✅ `disconnected_at` actualizado a `NULL`
- ✅ `clouds_slots_used` NO incrementa (permanece en 3)
- ✅ Log muestra:
  ```
  [SALVOCONDUCTO ✓] Slot histórico encontrado...
  [SLOT REACTIVATION] Reactivando slot existente...
  ```

---

## 🔍 Logging Debug (Casos edge)

Si algún test falla, revisar logs con:

```bash
# Ver todos los checks de slots
fly logs --app cloud-aggregator-api | grep "\[SLOT CHECK"

# Ver detalles de normalización
fly logs --app cloud-aggregator-api | grep "DEBUG\]"

# Ver errores de OAuth callback
fly logs --app cloud-aggregator-api | grep "\[OAUTH CALLBACK\]"
```

**Info crítica a buscar:**
- `normalized_id='...' (type=str, len=X)` ← confirmar sin espacios
- `Query result: found=1 slots` ← salvoconducto activado
- `Query result: found=0 slots` ← cuenta nueva (validar límites)

---

## ✅ Criterios de aprobación

**El fix se considera exitoso si:**

1. ✅ TEST 1 pasa (reconexión histórica permitida)
2. 🟠 TEST 2 falla correctamente (bloqueo legítimo de cuenta nueva)
3. ✅ TEST 3 pasa (reactivación de soft-deleted permitida)
4. 📊 Logs muestran `[SLOT CHECK DEBUG]` con IDs normalizados
5. 🐛 CERO reportes de usuarios sobre "límite alcanzado" al reconectar

---

## 🚨 Rollback Plan

Si la corrección causa problemas:

1. **Rollback de código:**
   ```bash
   git revert HEAD
   fly deploy
   ```

2. **NO hacer rollback de SQL** (la normalización es segura y permanente)

3. **Investigar:** Revisar logs para identificar IDs problemáticos específicos

---

## 📞 Soporte

Si después del fix persisten reportes de bloqueo:

1. Solicitar al usuario su email/user_id
2. Consultar `cloud_slots_log` para ese usuario:
   ```sql
   SELECT id, provider, provider_account_id, is_active, slot_number, 
          LENGTH(provider_account_id) as id_length,
          provider_account_id = TRIM(provider_account_id) as is_normalized
   FROM cloud_slots_log
   WHERE user_id = '<user_id>';
   ```
3. Verificar si hay IDs con caracteres invisibles (tabs, \r, \n)
4. Si existe, normalizar manualmente:
   ```sql
   UPDATE cloud_slots_log
   SET provider_account_id = TRIM(REGEXP_REPLACE(provider_account_id, '\s+', '', 'g'))
   WHERE id = '<slot_id>';
   ```
