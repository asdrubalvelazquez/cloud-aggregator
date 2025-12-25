# Fix: ClientOptions AttributeError en copy_file

## Error en Producción

```
Error 500: "'ClientOptions' object has no attribute 'storage'"
correlation_id: ac009c29-f773-4304-950e-3a54583a5458
```

**Contexto**: Error al copiar archivos entre cuentas de Google Drive en producción.

---

## Diagnóstico

### 1. Stack Trace
El error ocurría en la línea 529 de `backend/backend/main.py`:
```python
from backend.auth import create_user_scoped_client
user_client = create_user_scoped_client(jwt_token)
```

Internamente, `create_user_scoped_client()` en `backend/backend/auth.py` usaba:
```python
from supabase.lib.client_options import ClientOptions  # ❌ INCORRECTO

options = ClientOptions(headers={"Authorization": f"Bearer {jwt_token.strip()}"})
return create_client(SUPABASE_URL, SUPABASE_ANON_KEY, options=options)
```

### 2. Causa Raíz
La librería `supabase-py` tiene dos clases similares:
- **`ClientOptions`** (async): NO tiene atributo `storage`
- **`SyncClientOptions`** (sync): SÍ tiene atributo `storage` (tipo `SyncSupportedStorage`)

Cuando `create_client()` (sincrónico) recibe un objeto `ClientOptions` (async), intenta acceder a `options.storage` y falla con:
```python
AttributeError: 'ClientOptions' object has no attribute 'storage'
```

Este es un **error de tipo**: estábamos pasando la clase async al cliente sync.

### 3. Reproducción del Error
```python
from supabase import create_client
from supabase.lib.client_options import ClientOptions  # ❌ 

opts = ClientOptions(headers={'Authorization': 'Bearer test'})
client = create_client('https://test.supabase.co', 'test', options=opts)
# AttributeError: 'ClientOptions' object has no attribute 'storage'
```

---

## Solución Aplicada

### Cambio Mínimo (2 líneas)

**Archivo**: `backend/backend/auth.py`

```diff
 from typing import Optional
 from fastapi import Header, HTTPException
 from supabase import create_client, Client
-from supabase.lib.client_options import ClientOptions
+from supabase.lib.client_options import SyncClientOptions

 def create_user_scoped_client(jwt_token: str) -> Client:
     """
     Create a user-scoped Supabase client (ANON key) that injects the user's JWT
     via default Authorization header, so PostgREST RPC sees auth.uid().
     """
     if not SUPABASE_URL or not SUPABASE_ANON_KEY:
         raise ValueError("SUPABASE_URL and SUPABASE_ANON_KEY must be configured")
     if not jwt_token or not jwt_token.strip():
         raise ValueError("jwt_token is required")

-    options = ClientOptions(headers={"Authorization": f"Bearer {jwt_token.strip()}"})
+    options = SyncClientOptions(headers={"Authorization": f"Bearer {jwt_token.strip()}"})
     return create_client(SUPABASE_URL, SUPABASE_ANON_KEY, options=options)
```

### Por Qué Esto Funciona

1. **`SyncClientOptions`** tiene el atributo `storage` que requiere `create_client()`
2. **Firma correcta**:
   ```python
   SyncClientOptions.__init__(
       schema='public',
       headers={},
       storage=<SyncMemoryStorage>,  # ✅ Existe por defecto
       ...
   )
   ```
3. **Sin cambios en lógica**: Solo corregimos el tipo de opciones usado

---

## Validación

### Test Automatizado
```bash
cd backend
python test_clientoptions_fix.py
# Output: ✅ Test PASSED: create_user_scoped_client() creates client without AttributeError
```

### Test Manual (Producción)

1. **Desplegar cambio**:
   ```bash
   cd backend
   fly deploy
   ```

2. **Reproducir escenario original**:
   - Ir a https://cloudaggregatorapp.com/drive/{account_id}
   - Intentar copiar un archivo `.mp3` o `.pdf` entre dos cuentas
   - Seleccionar cuenta destino
   - Click en "Copiar"

3. **Resultado esperado**:
   - ✅ Modal de error NO debe mostrar: `"'ClientOptions' object has no attribute 'storage'"`
   - ✅ Si hay otro error (ej: token expirado), debe ser un error diferente con correlation_id
   - ✅ Si copia exitosa: Modal debe cerrar y archivo aparecer en cuenta destino

4. **Verificar logs** (si hay error diferente):
   ```bash
   fly logs -a cloud-aggregator-api | grep [COPY
   ```
   - Buscar correlation_id del error en frontend
   - Identificar nueva causa raíz (ej: 401, 403, 429, timeout)

### Casos de Prueba Sugeridos

| Archivo | Tamaño | Resultado Esperado |
|---------|--------|-------------------|
| `intro 2 con los cazones rotos.mp3` | ~5 MB | ✅ Copia exitosa o error específico (NO ClientOptions) |
| `documento.pdf` | ~2 MB | ✅ Copia exitosa o error específico (NO ClientOptions) |
| Google Doc (export a PDF) | Variable | ✅ Copia exitosa o error específico (NO ClientOptions) |

---

## Impacto

### Antes del Fix
- ❌ **100% de copias fallaban** con Error 500 genérico
- ❌ Mensaje críptico: `'ClientOptions' object has no attribute 'storage'`
- ❌ Imposible diagnosticar causa real (token, cuota, tamaño, etc.)

### Después del Fix
- ✅ Cliente Supabase se crea correctamente
- ✅ RPC `complete_copy_job_success_and_increment_usage` puede ejecutarse
- ✅ Si hay errores, serán errores reales (401, 403, 429, timeout)
- ✅ Observabilidad funcional (correlation_id traceable en logs)

---

## Archivos Modificados

```
backend/backend/auth.py          | 2 lines changed (import + usage)
backend/test_clientoptions_fix.py | 1 file added (49 lines)
```

**Git diff completo**:
```bash
git diff backend/backend/auth.py
```

---

## Próximos Pasos (Post-Deployment)

1. **Desplegar** a Fly.io:
   ```bash
   cd backend
   fly deploy
   ```

2. **Probar en producción** con archivo real (mp3/pdf)

3. **Si aparece nuevo error** (ej: 401 token expired):
   - Extraer `correlation_id` del modal frontend
   - Buscar en logs: `fly logs -a cloud-aggregator-api | grep {correlation_id}`
   - Identificar causa raíz específica
   - Aplicar fix correspondiente (ej: refresh token antes de copy)

4. **Validar métricas**:
   - Tasa de éxito de copias debe aumentar de 0% → >80%
   - Errores restantes deben ser específicos (no genéricos)

---

## Notas de Seguridad

- ✅ Sin cambios en lógica de negocio
- ✅ Sin cambios en validación de tokens
- ✅ Sin cambios en quotas/rate limits
- ✅ Fix puramente técnico (tipo correcto para opciones sync)

## Regresiones Esperadas

**Ninguna**: Este cambio solo corrige el tipo de las opciones del cliente Supabase. La funcionalidad permanece idéntica.
