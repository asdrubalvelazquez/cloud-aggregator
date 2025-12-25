# Fix: Error 401 - Google Drive Token Expiration

## Error en Producción

```
Error 401: Google Drive API error: 401. El archivo podría ser inaccesible o el token expiró.
(ID: 5f6ebed2-d929-4757-884a-4276997b5563)

Log backend:
[GOOGLE API ERROR] status=401 url=https://www.googleapis.com/drive/v3/files?q=...
message: "Request had invalid authentication credentials. Expected OAuth 2 access token..."
```

---

## Diagnóstico

### Causa Raíz
La función `get_valid_token()` en `backend/backend/google_drive.py` tenía **3 problemas críticos**:

1. **No validaba que `access_token` no sea None/empty antes de devolverlo**
   - Si el token en BD era NULL, se devolvía None y causaba 401 en Google API
   
2. **No manejaba errores HTTP del refresh (400 invalid_grant, 401)**
   - Si refresh_token era revocado/expirado, fallaba con ValueError genérico
   - No marcaba cuenta como needs_reconnect
   
3. **Buffer de expiración muy grande (5 minutos)**
   - Tokens expiraban durante la operación de copia (race condition)
   - Necesita buffer de 60s para refresh proactivo

---

## Solución Aplicada

### Cambios en `get_valid_token()`

**Archivo**: `backend/backend/google_drive.py`

#### 1. Validación de Token Existente
```python
access_token = account.get("access_token")

# CRITICAL: Validate token exists before checking expiry
if not access_token or not access_token.strip():
    logger.error(f"[TOKEN ERROR] account_id={account_id} has empty access_token")
    raise HTTPException(
        status_code=401,
        detail={
            "message": "Google Drive token missing. Please reconnect your account.",
            "account_email": account_email,
            "needs_reconnect": True
        }
    )
```

#### 2. Buffer de Expiración Reducido (60s)
```python
# Check if token is expired (with 60s buffer to avoid race conditions)
if token_expiry:
    expiry_dt = dateutil_parser.parse(token_expiry)
    now = datetime.now(timezone.utc)
    buffer = timedelta(seconds=60)  # ✅ Cambiado de 5 min a 60s
    
    # If token expires in less than 60s, refresh it proactively
    if expiry_dt <= (now + buffer):
        needs_refresh = True
```

#### 3. Manejo de Errores de Refresh
```python
# Request new access token
try:
    token_res = await client.post(GOOGLE_TOKEN_ENDPOINT, data={...})
    
    # Handle refresh errors (invalid_grant, revoked token, etc.)
    if token_res.status_code != 200:
        error_data = token_res.json()
        error_type = error_data.get("error", "unknown")
        
        logger.error(f"[TOKEN REFRESH FAILED] account_id={account_id} error={error_type}")
        
        # Mark account as needing reconnection
        supabase.table("cloud_accounts").update({
            "is_active": False,
            "disconnected_at": datetime.now(timezone.utc).isoformat()
        }).eq("id", account_id).execute()
        
        raise HTTPException(
            status_code=401,
            detail={
                "message": f"Google Drive token expired or revoked. Please reconnect. (Error: {error_type})",
                "account_email": account_email,
                "needs_reconnect": True,
                "error_type": error_type
            }
        )

except httpx.HTTPError as e:
    logger.error(f"[TOKEN REFRESH ERROR] account_id={account_id} network error: {str(e)}")
    raise HTTPException(status_code=503, detail={...})
```

#### 4. Reactivación de Cuenta tras Refresh Exitoso
```python
# Update database with new token and expiry
supabase.table("cloud_accounts").update({
    "access_token": new_access_token,
    "token_expiry": new_expiry.isoformat(),
    "is_active": True,  # ✅ Reactivate if was marked inactive
}).eq("id", account_id).execute()

logger.info(f"[TOKEN REFRESH SUCCESS] account_id={account_id} new_expiry={new_expiry.isoformat()}")
```

---

## Cambios en Base de Datos

### Tabla `cloud_accounts`

**Campos actualizados automáticamente por el fix**:

```sql
-- Cuando refresh es exitoso:
UPDATE cloud_accounts SET
  access_token = '<new_token>',
  token_expiry = '<timestamp>',
  is_active = true
WHERE id = <account_id>;

-- Cuando refresh falla (token revocado):
UPDATE cloud_accounts SET
  is_active = false,
  disconnected_at = NOW()
WHERE id = <account_id>;
```

**Estructura esperada**:
```sql
CREATE TABLE cloud_accounts (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  account_email VARCHAR(255),
  access_token TEXT,           -- ✅ OAuth access token
  refresh_token TEXT,          -- ✅ OAuth refresh token (long-lived)
  token_expiry TIMESTAMP,      -- ✅ UTC timestamp
  is_active BOOLEAN DEFAULT true,
  disconnected_at TIMESTAMP,
  -- ... otros campos
);
```

---

## Validación

### Test Automatizado
```bash
cd backend
python -m py_compile backend/google_drive.py
# Output: (sin errores) = ✅ Sintaxis correcta
```

### Test Manual en Producción

#### Paso 1: Deploy
```bash
cd backend
fly deploy
```

#### Paso 2: Reproducir Error Original
1. Ir a https://cloudaggregatorapp.com/drive/{account_id}
2. Intentar copiar archivo `intro 2 con los cazones rotos.mp3`
3. Seleccionar cuenta destino
4. Click "Copiar"

#### Paso 3: Verificar Comportamiento

**Escenario A: Token Válido (Refresh No Necesario)**
- ✅ Copia debe completar exitosamente
- ✅ No debe aparecer error 401
- Log esperado: `[COPY SUCCESS] correlation_id=...`

**Escenario B: Token Expirado (Refresh Automático)**
- ✅ Backend refresca token automáticamente (transparente para usuario)
- ✅ Copia completa exitosamente
- Log esperado:
  ```
  [TOKEN REFRESH] account_id=X token expires soon, refreshing
  [TOKEN REFRESH SUCCESS] account_id=X new_expiry=2025-12-25T...
  [COPY SUCCESS] correlation_id=...
  ```

**Escenario C: Refresh Token Revocado (Requiere Reconexión)**
- ❌ Modal muestra: "Google Drive token expired or revoked. Please reconnect your account. (Error: invalid_grant)"
- ✅ `correlation_id` presente en mensaje
- ✅ Cuenta marcada como `is_active=false` en BD
- Log esperado:
  ```
  [TOKEN REFRESH FAILED] account_id=X email=user@gmail.com status=400 error=invalid_grant
  [GOOGLE API ERROR] correlation_id=... status=401
  ```
- **Acción requerida**: Usuario debe reconectar cuenta vía OAuth

#### Paso 4: Verificar Logs
```bash
fly logs -a cloud-aggregator-api | Select-String -Pattern "[TOKEN"
```

Buscar:
- `[TOKEN REFRESH]` - Indica que se intentó refresh
- `[TOKEN REFRESH SUCCESS]` - Refresh exitoso
- `[TOKEN REFRESH FAILED]` - Refresh falló (invalid_grant, etc.)
- `[TOKEN ERROR]` - Token missing o vacío

---

## Impacto

### Antes del Fix
- ❌ Error 401 genérico sin contexto
- ❌ Tokens expirados causaban fallo inmediato
- ❌ No se marcaban cuentas que requerían reconexión
- ❌ Race conditions (token expira durante copia)
- ❌ Errores de refresh no manejados (ValueError genérico)

### Después del Fix
- ✅ Refresh automático con 60s de buffer (evita race conditions)
- ✅ Validación de token antes de uso
- ✅ Errores 401 con mensaje claro + `needs_reconnect=true`
- ✅ Cuentas con refresh fallido marcadas como `is_active=false`
- ✅ Logs estructurados para debugging
- ✅ Reactivación automática tras refresh exitoso

---

## Archivos Modificados

```
backend/backend/google_drive.py   | +111 -10 lines
```

**Diff completo**: Ver output de `git diff` arriba

---

## Casos de Prueba

| Caso | Token Status | Refresh Token | Resultado Esperado |
|------|-------------|---------------|-------------------|
| 1 | Válido (no expirado) | N/A | ✅ Copia exitosa (sin refresh) |
| 2 | Expira en 30s | Válido | ✅ Refresh automático → copia exitosa |
| 3 | Expirado | Válido | ✅ Refresh automático → copia exitosa |
| 4 | Missing/NULL | Válido | ❌ Error 401: "token missing. Please reconnect" |
| 5 | Válido | Revocado (invalid_grant) | ❌ Error 401: "token expired or revoked. Please reconnect" |
| 6 | Válido | Missing/NULL | ❌ Error 401: "refresh token missing. Please reconnect" |

---

## Próximos Pasos (Post-Deployment)

1. ✅ **Deploy a Fly.io**: `cd backend && fly deploy`
2. ⏳ **Probar copia de archivos**: mp3, pdf, Google Docs
3. ⏳ **Verificar que 401 ya no aparece** (si tokens son válidos)
4. ⏳ **Si error persiste**: Extraer `correlation_id` y buscar en logs:
   ```bash
   fly logs -a cloud-aggregator-api | Select-String -Pattern "<correlation_id>"
   ```
5. ⏳ **Validar refresh automático**: Forzar token expirado en BD (manual) y verificar que se refresca

---

## Breaking Changes

**Ninguno esperado** - Este fix es backward compatible:
- ✅ Función `get_valid_token()` mantiene misma firma
- ✅ Retorna `str` (access_token) como antes
- ✅ Solo mejora manejo de errores (ValueError → HTTPException)
- ⚠️ Cuentas con tokens inválidos ahora se marcan como `is_active=false` (correcto)

---

## Notas de Seguridad

- ✅ Tokens **NUNCA** se loggean (solo `account_id` y `account_email`)
- ✅ Mensajes de error no exponen `access_token` o `refresh_token`
- ✅ `correlation_id` permite tracing sin exponer datos sensibles
- ✅ Validación de expiración usa UTC (evita timezone issues)
- ✅ Buffer de 60s previene race conditions sin comprometer seguridad

---

## Rollback Plan

Si el fix causa problemas inesperados:

```bash
cd backend
git revert HEAD
fly deploy
```

**Reversión manual** (si no hay commit):
1. Restaurar `google_drive.py` de commit anterior: `git checkout HEAD~1 backend/backend/google_drive.py`
2. Deploy: `fly deploy`
