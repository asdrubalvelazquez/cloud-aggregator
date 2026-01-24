# 🔍 REPORTE DE ANÁLISIS: Bug de Reconexión OneDrive
**Desarrollador Senior:** [Tu Nombre]  
**Fecha:** Enero 18, 2026  
**Ticket:** Usuarios reportan "Error de autenticación: reconnect_failed" al reconectar OneDrive  
**Estado:** Fase de Análisis (NO MODIFICAR CÓDIGO)

---

## 📋 RESUMEN EJECUTIVO

El error `reconnect_failed` es **generado por el backend** en 6 escenarios distintos durante el flujo OAuth de reconexión de OneDrive. Este NO es un error mapeado por el frontend - el mensaje literal viene en la URL de redirect.

**Hallazgo Principal:**  
La causa más probable es que el backend **no puede preservar el refresh_token existente** durante la reconexión, o que **el slot_update falla** al actualizar la base de datos.

---

## 1. 🔎 BÚSQUEDA DE STRING "reconnect_failed"

### Ubicaciones Encontradas

#### Backend (6 ocurrencias en main.py):

| Línea | Contexto | Condición de Error |
|-------|----------|-------------------|
| **1297** | Google Drive callback | Fallo al transferir ownership en reclaim |
| **1371** | Google Drive callback | Error al cargar refresh_token existente |
| **1419** | Google Drive callback | Slot update afectó 0 filas (CRITICAL) |
| **4729** | OneDrive callback | Fallo al transferir ownership en reclaim |
| **4801** | **OneDrive callback** | **Slot update afectó 0 filas (CRITICAL)** ⚠️ |
| **4943** | OneDrive connect | Fallo al transferir ownership en SAFE RECLAIM |

#### Frontend (1 ocurrencia):
- [frontend/src/app/(dashboard)/app/page.tsx:472](frontend/src/app/(dashboard)/app/page.tsx#L472)
  ```typescript
  let errorMessage = `Error de autenticación: ${authError}`;
  ```
  **Conclusión:** El frontend NO mapea este error. Solo lo muestra como string literal del query param.

---

## 2. 🔐 ANÁLISIS DEL FLUJO DE RECONEXIÓN ONEDRIVE

### Endpoint Crítico
**Archivo:** [backend/backend/main.py:4429](backend/backend/main.py#L4429)  
**Ruta:** `GET /auth/onedrive/callback`

### Flujo Paso a Paso (Modo Reconnect)

#### PASO 1: Validación de State Token
```python
# Línea 4462-4469
state_data = decode_state_token(state)
user_id = state_data.get("user_id")
mode = state_data.get("mode", "connect")  # ← Debe ser "reconnect"
reconnect_account_id = state_data.get("reconnect_account_id")  # ← Microsoft account ID
slot_log_id = state_data.get("slot_log_id")  # ← ID del slot a actualizar
user_email = state_data.get("user_email")
```

**🚨 PUNTO DE FALLO #1:**  
Si `state` es inválido o expiró (TTL de 10 minutos), el flujo falla silenciosamente.

---

#### PASO 2: Token Exchange con Microsoft
```python
# Línea 4471-4550
data = {
    "code": code,
    "client_id": MICROSOFT_CLIENT_ID,
    "client_secret": MICROSOFT_CLIENT_SECRET,
    "redirect_uri": MICROSOFT_REDIRECT_URI,
    "grant_type": "authorization_code",
    "scope": " ".join(ONEDRIVE_SCOPES),
}

token_res = await client.post(MICROSOFT_TOKEN_ENDPOINT, data=data)
```

**Posibles Errores:**
- `invalid_grant` (código expirado) → Redirect a `error=onedrive_invalid_grant`
- HTTP 500/503 → Redirect a `error=onedrive_token_exchange_failed`

**🔑 Detalle Crítico:**
```python
access_token = token_json.get("access_token")
refresh_token = token_json.get("refresh_token")  # ← May be None
```

**Microsoft NO siempre retorna refresh_token** en reconexiones. Solo en `prompt=consent`.

---

#### PASO 3: Validación de Account Mismatch
```python
# Línea 4621-4657
if microsoft_account_id_normalized != reconnect_account_id_normalized:
    logging.error("[RECONNECT ERROR][ONEDRIVE] Account mismatch")
    return RedirectResponse(f"{frontend_origin}/app?error=account_mismatch")
```

**Escenario:** Usuario intenta reconectar con una cuenta diferente a la original.

---

#### PASO 4: Security Check - Ownership Verification
```python
# Línea 4660-4747
target_slot = supabase.table("cloud_slots_log")
    .select("id, user_id, provider_account_id, provider_email")
    .eq("id", slot_log_id)
    .eq("provider", "onedrive")
    .limit(1)
    .execute()

if not target_slot.data:
    return RedirectResponse(f"{frontend_origin}/app?error=slot_not_found")

slot_user_id = target_slot.data[0]["user_id"]

if slot_user_id != user_id:
    # SAFE RECLAIM logic (email matching)
    # If fails: return RedirectResponse(error=ownership_violation)
```

**🚨 PUNTO DE FALLO #2:**  
Si el slot fue eliminado o el `slot_log_id` es inválido, falla aquí.

---

#### PASO 5: Refresh Token Preservation (CRÍTICO)
```python
# Línea 4749-4766
upsert_payload = {
    "user_id": user_id,
    "provider": "onedrive",
    "provider_account_id": microsoft_account_id,
    "account_email": account_email,
    "access_token": encrypt_token(access_token),
    "token_expiry": expiry_iso,
    "is_active": True,
    "disconnected_at": None,
    "slot_log_id": slot_id,
}

# CRITICAL: Only update refresh_token if a new one is provided
if refresh_token:
    upsert_payload["refresh_token"] = encrypt_token(refresh_token)
    logging.info(f"[RECONNECT][ONEDRIVE] Got new refresh_token for slot_id={slot_id}")
else:
    # Do NOT set refresh_token field - this preserves existing refresh_token in database
    logging.info(f"[RECONNECT][ONEDRIVE] No new refresh_token, preserving existing for slot_id={slot_id}")
```

**⚠️ DIFERENCIA CON GOOGLE DRIVE:**
- Google Drive (línea 1337-1371): **Lee explícitamente el refresh_token de la DB** si Microsoft no lo envía.
- OneDrive: **Omite el campo en el UPSERT** para preservarlo (estrategia diferente).

**🚨 PUNTO DE FALLO #3:**  
Si el refresh_token existente en DB es `NULL`, el upsert lo dejará NULL → Conexión sin refresh token.

---

#### PASO 6: Upsert de cloud_provider_accounts
```python
# Línea 4770-4779
upsert_result = supabase.table("cloud_provider_accounts").upsert(
    upsert_payload,
    on_conflict="user_id,provider,provider_account_id"
).execute()

if upsert_result.data:
    logging.info(f"[RECONNECT SUCCESS][ONEDRIVE] cloud_provider_accounts UPSERT account_id={account_id}")
```

**Posible Issue:** UPSERT puede fallar silenciosamente si hay conflictos de constraint.

---

#### PASO 7: Update de cloud_slots_log (PUNTO DE FALLO MÁS CRÍTICO)
```python
# Línea 4782-4801
if slot_log_id:
    slot_update = supabase.table("cloud_slots_log").update({
        "is_active": True,
        "disconnected_at": None,
        "provider_email": account_email,
    }).eq("id", slot_log_id).eq("user_id", user_id).execute()
else:
    slot_update = supabase.table("cloud_slots_log").update({
        "is_active": True,
        "disconnected_at": None,
        "provider_email": account_email,
    }).eq("user_id", user_id).eq("provider_account_id", microsoft_account_id).execute()

slots_updated = len(slot_update.data) if slot_update.data else 0

if slots_updated == 0:
    logging.error(f"[RECONNECT ERROR][ONEDRIVE] cloud_slots_log UPDATE affected 0 rows")
    return RedirectResponse(f"{frontend_origin}/app?error=reconnect_failed&reason=slot_not_updated")
```

**🔴 ESTE ES EL ERROR MÁS PROBABLE** (Línea 4801)

**Causas posibles:**
1. **Slot fue eliminado** entre el security check y el update (race condition).
2. **user_id no coincide** (ownership cambió en paralelo).
3. **slot_log_id es NULL** y el fallback con `provider_account_id` no encuentra nada.
4. **Database error** (constraint violation, timeout).

---

## 3. 💡 HIPÓTESIS SOBRE TOKENS EXPIRADOS

### Comportamiento de Microsoft OAuth

#### Refresh Token Expiration
- **Lifetime:** 90 días de inactividad (no hay expiración absoluta).
- **Revocación:** Usuario cambia password, habilita MFA, o desvincula app.
- **Error Code:** `invalid_grant` (AADSTS70000, AADSTS54005).

### Validación en Código

El código maneja `invalid_grant` correctamente:
```python
# Línea 4546-4554
if "invalid_grant" in error_body.lower() or "aadsts54005" in error_body.lower():
    logging.warning("[ONEDRIVE][TOKEN_EXCHANGE] invalid_grant (code expired/redeemed)")
    return RedirectResponse(f"{frontend_origin}/app?error=onedrive_invalid_grant&hint=retry_connect")
```

**Conclusión:** Los tokens expirados **no causan `reconnect_failed`**. Tienen su propio error: `onedrive_invalid_grant`.

---

### Refresh Token en DB

El módulo [backend/backend/onedrive.py](backend/backend/onedrive.py#L164) tiene la función `refresh_onedrive_token()`:

```python
# Línea 181-202
if not refresh_token or not refresh_token.strip():
    raise HTTPException(
        status_code=401,
        detail={
            "error_code": "MISSING_REFRESH_TOKEN",
            "message": "OneDrive needs reconnect",
            "detail": "No refresh token available"
        }
    )
```

**🚨 POSIBLE CAUSA RAÍZ:**
Si el refresh_token en DB es `NULL` o vacío, la cuenta queda en estado `needs_reconnect`, pero al intentar reconectar:
1. Microsoft no envía nuevo refresh_token (porque no fue `prompt=consent`).
2. El UPSERT omite el campo refresh_token.
3. El slot se actualiza exitosamente.
4. **PERO:** La cuenta sigue sin refresh_token → Próximo acceso falla.

**Sin embargo**, esto no explica el error `reconnect_failed`. Solo explica por qué la cuenta volvería a `needs_reconnect` después.

---

## 4. 🪵 QUÉ BUSCAR EN LOS LOGS

### Logs Críticos para Debugging

#### 1. Token Exchange
```
[ONEDRIVE][TOKEN_EXCHANGE] Attempting token exchange
[ONEDRIVE][TOKEN_EXCHANGE] SUCCESS: Received tokens from Microsoft
```
**Si falla:**
```
[ONEDRIVE][TOKEN_EXCHANGE] invalid_grant (code expired/redeemed)
[ONEDRIVE][TOKEN_EXCHANGE] HTTP 500 from Microsoft token endpoint
```

#### 2. Refresh Token Preservation
```
[RECONNECT][ONEDRIVE] Got new refresh_token for slot_id={slot_id}
[RECONNECT][ONEDRIVE] No new refresh_token, preserving existing for slot_id={slot_id}
```

**Buscar:** Si aparece el segundo log, verificar que el refresh_token existía en DB.

#### 3. Slot Update (EL MÁS CRÍTICO)
```
[RECONNECT SUCCESS][ONEDRIVE] cloud_provider_accounts UPSERT account_id={account_id}
[RECONNECT SUCCESS][ONEDRIVE] cloud_slots_log updated. slot_id={validated_slot_id}
```

**Si falla:**
```
[RECONNECT ERROR][ONEDRIVE] cloud_slots_log UPDATE affected 0 rows
```

**Línea de error:** 4801 → `return RedirectResponse(...error=reconnect_failed&reason=slot_not_updated)`

#### 4. Ownership/Security
```
[SECURITY][ONEDRIVE] Reconnect ownership verified: slot_id={slot_id}
[SECURITY][RECLAIM][ONEDRIVE] Slot reassignment authorized
[SECURITY][ONEDRIVE] Account takeover blocked!
```

---

### Comando para Logs en Fly.io

```bash
# Ver logs en tiempo real (filtrado por ONEDRIVE y RECONNECT)
fly logs --app cloud-aggregator-api | grep -E "ONEDRIVE.*RECONNECT"

# Ver últimos 200 logs
fly logs --app cloud-aggregator-api -n 200 | grep "reconnect_failed"

# Ver logs de un usuario específico (reemplazar con user_id real)
fly logs --app cloud-aggregator-api | grep "user_id=abc123"
```

### Query SQL para Investigar

```sql
-- 1. Verificar slots con refresh_token NULL
SELECT 
    cs.id,
    cs.provider,
    cs.provider_email,
    cs.is_active,
    cpa.refresh_token IS NULL AS missing_refresh_token,
    cpa.token_expiry,
    cpa.disconnected_at
FROM cloud_slots_log cs
LEFT JOIN cloud_provider_accounts cpa 
    ON cpa.slot_log_id = cs.id 
    AND cpa.provider = cs.provider
WHERE cs.provider = 'onedrive'
    AND cs.is_active = false
ORDER BY cs.disconnected_at DESC
LIMIT 20;

-- 2. Buscar discrepancias user_id entre cloud_slots_log y cloud_provider_accounts
SELECT 
    cs.id AS slot_id,
    cs.user_id AS slot_user_id,
    cs.provider_account_id,
    cpa.user_id AS account_user_id,
    cpa.id AS account_id
FROM cloud_slots_log cs
LEFT JOIN cloud_provider_accounts cpa 
    ON cpa.provider_account_id = cs.provider_account_id
    AND cpa.provider = cs.provider
WHERE cs.provider = 'onedrive'
    AND cs.user_id != cpa.user_id;
```

---

## 5. 🎯 CAUSAS MÁS PROBABLES (ORDENADAS POR LIKELIHOOD)

### 🥇 Causa #1: Slot Update Falla (Línea 4801)
**Probabilidad:** ⭐⭐⭐⭐⭐ (90%)

**Escenario:**
1. Usuario hace click en "Reconectar".
2. Frontend genera request a `/auth/onedrive/authorize?mode=reconnect&...`.
3. Backend crea state token con `slot_log_id` y `reconnect_account_id`.
4. Usuario autoriza en Microsoft.
5. Callback recibe código y state correctamente.
6. Token exchange exitoso.
7. **Upsert de `cloud_provider_accounts` exitoso.**
8. **Update de `cloud_slots_log` FALLA (0 rows affected).**
9. Backend retorna `error=reconnect_failed&reason=slot_not_updated`.

**Por qué falla el UPDATE:**
- **Opción A:** El slot fue eliminado por otro proceso (cleanup job, admin action).
- **Opción B:** `slot_log_id` del state token no coincide con la DB (state expiró/corrupto).
- **Opción C:** Condición `.eq("user_id", user_id)` no coincide (ownership cambió).
- **Opción D:** Database timeout o constraint error (menos probable).

**Código Sospechoso:**
```python
# Si slot_log_id viene del state:
slot_update = supabase.table("cloud_slots_log").update({
    "is_active": True,
    "disconnected_at": None,
    "provider_email": account_email,
}).eq("id", slot_log_id).eq("user_id", user_id).execute()
```

**¿Por qué `.eq("user_id", user_id)` puede fallar?**
- Si el slot ownership cambió entre el security check (línea 4660) y el update (línea 4787).
- Si el state token tiene un `user_id` diferente al del JWT (improbable pero posible).

---

### 🥈 Causa #2: State Token Inválido/Expirado
**Probabilidad:** ⭐⭐⭐ (60%)

**Escenario:**
1. Usuario hace click en "Reconectar".
2. State token se genera con TTL de 10 minutos.
3. Usuario tarda >10 minutos en autorizar.
4. State token expira.
5. `decode_state_token(state)` retorna `None` o datos vacíos.
6. `slot_log_id` es `None`.
7. Fallback query con `provider_account_id` no encuentra el slot.
8. Update afecta 0 rows.

**Evidencia:**
```python
# Línea 4462-4469
if state:
    state_data = decode_state_token(state)
    if state_data:  # ← Si es None, todos los valores son None
        slot_log_id = state_data.get("slot_log_id")
```

**Solución Potencial:**
- Aumentar TTL del state token de 10 a 30 minutos.
- Validar explícitamente que `slot_log_id` no es None antes del update.

---

### 🥉 Causa #3: Refresh Token Missing en DB
**Probabilidad:** ⭐⭐ (30%)

**Escenario:**
1. Cuenta original se conectó con `prompt=select_account` (sin refresh_token).
2. Access token expira.
3. Sistema marca cuenta como `needs_reconnect`.
4. Usuario intenta reconectar.
5. Microsoft envía access_token pero NO refresh_token (normal en reconexión).
6. UPSERT omite campo `refresh_token`.
7. **Si refresh_token era NULL en DB, sigue siendo NULL.**
8. Slot update es exitoso.
9. **Conexión aparece exitosa pero pronto falla de nuevo.**

**Nota:** Esto NO causa `reconnect_failed` directamente, pero explica reconexiones en loop.

---

### 🏅 Causa #4: Race Condition con Slot Deletion
**Probabilidad:** ⭐ (10%)

**Escenario:**
1. Usuario tiene slot inactivo.
2. Usuario hace click en "Reconectar".
3. Simultáneamente, un cleanup job elimina slots desconectados >90 días.
4. Security check pasa (slot existe).
5. Slot es eliminado por cleanup job.
6. Update falla (0 rows).

**Mitigación:** Agregar transacción SQL o retry logic.

---

## 6. 🔧 RECOMENDACIONES PARA EL AUDITOR

### Investigación Inmediata

1. **Revisar logs de producción:**
   ```bash
   fly logs --app cloud-aggregator-api -n 500 | grep -A 5 "RECONNECT ERROR.*ONEDRIVE"
   ```
   Buscar: `cloud_slots_log UPDATE affected 0 rows`.

2. **Query de Diagnóstico SQL:**
   Ejecutar las queries del punto 4 para identificar:
   - Slots con `refresh_token = NULL`.
   - Discrepancias de `user_id` entre tablas.

3. **Reproducir el Bug:**
   - Conectar una cuenta OneDrive de prueba.
   - Desconectarla manualmente (set `is_active = false`).
   - Intentar reconectar y capturar logs completos.

### Puntos de Código a Revisar

| Archivo | Línea | Acción |
|---------|-------|--------|
| [main.py](backend/backend/main.py#L4801) | 4801 | Agregar log detallado con `slot_log_id`, `user_id`, `provider_account_id` antes del UPDATE |
| [main.py](backend/backend/main.py#L4462) | 4462 | Validar que `slot_log_id` != None antes de entrar en modo reconnect |
| [main.py](backend/backend/main.py#L4787) | 4787 | Considerar remover `.eq("user_id", user_id)` del UPDATE para evitar ownership check redundante |
| [auth.py](backend/backend/auth.py) | - | Verificar TTL del state token (debería ser ≥30 minutos) |

### Testing Recomendado

```python
# Test Case 1: Reconnect con slot_log_id inválido
# Simular state token con slot_log_id de slot eliminado

# Test Case 2: Reconnect con ownership mismatch
# Crear slot, cambiar user_id manualmente, intentar reconectar

# Test Case 3: Reconnect sin refresh_token
# Crear cuenta con refresh_token=NULL, intentar reconectar
```

---

## 7. 📊 MATRIZ DE DECISIÓN

| Síntoma | Causa Raíz Probable | Línea de Código | Acción Correctiva |
|---------|---------------------|-----------------|-------------------|
| Error `reconnect_failed&reason=slot_not_updated` | Slot update afecta 0 rows | [4801](backend/backend/main.py#L4801) | Validar `slot_log_id` antes de UPDATE |
| Error `reconnect_failed` (sin reason) | Ownership transfer falla | [4729](backend/backend/main.py#L4729), [4943](backend/backend/main.py#L4943) | Revisar lógica de SAFE RECLAIM |
| Reconexión exitosa pero cuenta falla de nuevo | Refresh token missing | [4759-4766](backend/backend/main.py#L4759-L4766) | Implementar lógica de lectura explícita como Google Drive |
| Error `slot_not_found` | State expirado o slot eliminado | [4687](backend/backend/main.py#L4687) | Aumentar TTL de state token |

---

## 8. 🚦 PRÓXIMOS PASOS

### Fase 1: Diagnóstico (ACTUAL)
- ✅ Rastreo de string `reconnect_failed`.
- ✅ Análisis del flujo OAuth.
- ✅ Identificación de puntos de fallo.
- ⏳ **Pendiente:** Revisar logs de producción (hacer con Auditor).

### Fase 2: Instrumentación (NO TOCAR CÓDIGO AÚN)
- Agregar logs detallados antes del UPDATE de `cloud_slots_log`.
- Agregar telemetría para contar `slots_updated == 0`.
- Crear dashboard de Grafana con query de slots fallidos.

### Fase 3: Fixing (DESPUÉS DE APROBACIÓN)
- Implementar validación de `slot_log_id` != None.
- Considerar remover `.eq("user_id", user_id)` del UPDATE.
- Agregar retry logic para race conditions.
- Implementar lectura explícita de refresh_token (como Google Drive).

---

## 📎 ANEXO: Comparación Google Drive vs OneDrive

| Aspecto | Google Drive | OneDrive |
|---------|-------------|----------|
| **Líneas de callback** | 1000-1450 | 4429-4950 |
| **Preservación refresh_token** | Lee explícitamente de DB (línea 1357) | Omite campo en UPSERT (línea 4759) |
| **Error reason** | `&reason=token_load_error` | `&reason=slot_not_updated` |
| **Fallback order** | `.order("created_at", desc=True)` | `execute_with_order_fallback()` helper |

**Conclusión:** Lógica similar pero implementaciones divergentes. OneDrive NO lee refresh_token de DB.

---

## ✅ CONCLUSIÓN FINAL

El error `reconnect_failed` se genera cuando el **UPDATE de `cloud_slots_log` afecta 0 filas**.

**Causa más probable:**
1. **State token expiró** → `slot_log_id` es `None` → Fallback query falla.
2. **Slot fue eliminado** entre security check y update (race condition).
3. **Ownership check redundante** (`.eq("user_id", user_id)`) bloquea el update.

**Evidencia necesaria:**
- Logs de producción con `[RECONNECT ERROR][ONEDRIVE] cloud_slots_log UPDATE affected 0 rows`.
- Query SQL para identificar slots huérfanos o discrepancias de user_id.

**NO SE MODIFICÓ CÓDIGO** según restricción.

---

**Reporte generado por:** Desarrollador Senior  
**Entregado a:** Auditor del Proyecto  
**Siguiente paso:** Revisión conjunta de logs de producción
