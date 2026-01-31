# 🔒 SISTEMA DE RESTRICCIONES POR PLAN

**Fecha**: Enero 30, 2026  
**Sistema**: Cloud Aggregator - Quota Management  

---

## 📋 RESUMEN EJECUTIVO

El sistema de restricciones controla qué puede hacer cada usuario según su plan de pago. Las restricciones se aplican **automáticamente** en el backend sin necesidad de configuración adicional.

### ✅ ¿Qué está implementado?

- ✅ **Límite de tamaño de archivo** por plan
- ✅ **Límite de transferencia de datos** (GB/mes o GB/lifetime)
- ✅ **Auto-reset mensual** para planes mensuales
- ✅ **Mensajes de error con sugerencias de upgrade**
- ✅ **Validación en tiempo real** antes de cada operación

---

## 🎯 RESTRICCIONES POR PLAN

### Free ($0)
| Restricción | Límite | Tipo |
|-------------|--------|------|
| **Transferencia** | 5 GB | Lifetime (nunca se resetea) |
| **Tamaño de archivo** | 1 GB | Por archivo |
| **Cuentas conectadas** | Ilimitadas | - |
| **Copias** | Ilimitadas | - |

### Standard Monthly ($9.99/mes)
| Restricción | Límite | Tipo |
|-------------|--------|------|
| **Transferencia** | 100 GB | Por mes (se resetea el día 1) |
| **Tamaño de archivo** | 10 GB | Por archivo |
| **Cuentas conectadas** | Ilimitadas | - |
| **Copias** | Ilimitadas | - |

### Standard Yearly ($59.99/año)
| Restricción | Límite | Tipo |
|-------------|--------|------|
| **Transferencia** | 1200 GB | Por año (100GB/mes × 12) |
| **Tamaño de archivo** | 10 GB | Por archivo |
| **Cuentas conectadas** | Ilimitadas | - |
| **Copias** | Ilimitadas | - |

**Nota**: Aunque el plan es anual, la transferencia se trackea mensualmente (100GB/mes).

### Premium Monthly ($17.99/mes)
| Restricción | Límite | Tipo |
|-------------|--------|------|
| **Transferencia** | 200 GB | Por mes (se resetea el día 1) |
| **Tamaño de archivo** | 50 GB | Por archivo |
| **Cuentas conectadas** | Ilimitadas | - |
| **Copias** | Ilimitadas | - |

### Premium Yearly ($99.98/año)
| Restricción | Límite | Tipo |
|-------------|--------|------|
| **Transferencia** | 2400 GB | Por año (200GB/mes × 12) |
| **Tamaño de archivo** | 50 GB | Por archivo |
| **Cuentas conectadas** | Ilimitadas | - |
| **Copias** | Ilimitadas | - |

---

## 🔧 CÓMO FUNCIONAN LAS RESTRICCIONES

### 1. Validación de Tamaño de Archivo

**Función**: `check_file_size_limit_bytes()`  
**Ubicación**: `backend/backend/quota.py`  
**Cuándo se ejecuta**: Antes de iniciar cualquier copia/transferencia

```python
# Ejemplo de uso en el código
quota.check_file_size_limit_bytes(
    supabase=supabase,
    user_id=user_id,
    file_size_bytes=file_size,
    file_name="documento.pdf"
)
```

**¿Qué hace?**
1. Consulta el plan del usuario en la base de datos
2. Obtiene `max_file_bytes` del plan
3. Compara el tamaño del archivo con el límite
4. Si excede, lanza `HTTPException(413)` con mensaje personalizado

**Ejemplo de error**:
```json
{
  "code": "FILE_TOO_LARGE",
  "message": "Archivo demasiado grande para tu plan FREE",
  "file": {
    "name": "video.mp4",
    "size_bytes": 5368709120,
    "size_gb": 5.0
  },
  "limits": {
    "max_file_bytes": 1073741824,
    "max_file_gb": 1.0
  },
  "action": {
    "type": "UPGRADE",
    "to": "STANDARD"
  }
}
```

### 2. Validación de Transferencia de Datos

**Función**: `check_transfer_bytes_available()`  
**Ubicación**: `backend/backend/quota.py`  
**Cuándo se ejecuta**: Antes de cada transferencia

```python
# Ejemplo de uso
quota.check_transfer_bytes_available(
    supabase=supabase,
    user_id=user_id,
    file_size_bytes=file_size
)
```

**¿Qué hace?**

#### Para plan FREE:
1. Consulta `transfer_bytes_used_lifetime` (uso total acumulado)
2. Consulta `transfer_bytes_limit_lifetime` (5GB)
3. Verifica: `usado + nuevo_archivo <= límite`
4. Si excede, lanza `HTTPException(402)`

#### Para planes PAID (Standard/Premium):
1. Consulta `transfer_bytes_used_month` (uso del mes actual)
2. Consulta `transfer_bytes_limit_month` (100GB o 200GB)
3. Verifica: `usado + nuevo_archivo <= límite`
4. Si excede, lanza `HTTPException(402)`

**Ejemplo de error**:
```json
{
  "error": "transfer_quota_exceeded",
  "message": "Has usado 98.50GB de 100GB este mes. Este archivo requiere 5.00GB.",
  "used_bytes": 105708134400,
  "limit_bytes": 107374182400,
  "required_bytes": 5368709120,
  "used_gb": 98.5,
  "limit_gb": 100.0,
  "action": {
    "type": "UPGRADE",
    "to": "PREMIUM"
  }
}
```

### 3. Auto-Reset Mensual

**Función**: `get_or_create_user_plan()`  
**Ubicación**: `backend/backend/quota.py`  
**Cuándo se ejecuta**: Cada vez que se consulta el plan del usuario

**¿Qué hace?**
1. Consulta el plan del usuario
2. Verifica `billing_period`:
   - Si es `"MONTHLY"` → chequea si cambió el mes
   - Si es `"YEARLY"` → NO resetea mensualmente
3. Si cambió el mes (solo MONTHLY):
   - Resetea `transfer_bytes_used_month` a 0
   - Resetea `copies_used_month` a 0
   - Actualiza `period_start` al primer día del mes actual

**Ejemplo de reset**:
```
Usuario: Standard Monthly
Fecha actual: Febrero 1, 2026 00:01
Period start guardado: Enero 1, 2026

¿Cambió el mes? Sí (Enero → Febrero)
Acción:
  - transfer_bytes_used_month: 95GB → 0GB
  - copies_used_month: 150 → 0
  - period_start: 2026-02-01T00:00:00Z
```

**Planes anuales (YEARLY)**:
- NO se resetean automáticamente cada mes
- Continúan acumulando uso durante todo el año
- Se resetean solo cuando Stripe envía evento de renovación

---

## 🚀 FLUJO DE UNA OPERACIÓN DE COPIA

```
1. Usuario inicia copia de archivo (15 GB)
   ↓
2. Backend llama: check_file_size_limit_bytes(15GB)
   ↓
   Plan: Standard Monthly (max: 10GB)
   ↓
   ❌ ERROR 413: "Archivo demasiado grande para tu plan STANDARD"
   → Sugerencia: "Actualiza a PREMIUM"
   → OPERACIÓN BLOQUEADA
```

```
1. Usuario inicia copia de archivo (5 GB)
   ↓
2. Backend llama: check_file_size_limit_bytes(5GB)
   ↓
   Plan: Premium Monthly (max: 50GB)
   ↓
   ✅ PASA
   ↓
3. Backend llama: check_transfer_bytes_available(5GB)
   ↓
   Usado: 198GB, Límite: 200GB, Requiere: 5GB
   ↓
   ❌ ERROR 402: "Has usado 198GB de 200GB este mes"
   → Sugerencia: Espera al próximo mes o actualiza
   → OPERACIÓN BLOQUEADA
```

```
1. Usuario inicia copia de archivo (5 GB)
   ↓
2. Backend llama: check_file_size_limit_bytes(5GB)
   ↓
   ✅ PASA (5GB < 50GB)
   ↓
3. Backend llama: check_transfer_bytes_available(5GB)
   ↓
   Usado: 50GB, Límite: 200GB, Requiere: 5GB
   ↓
   ✅ PASA (50 + 5 = 55GB < 200GB)
   ↓
4. Operación procede
   ↓
5. Al completar: transfer_bytes_used_month += 5GB
   → Nuevo uso: 55GB
```

---

## 📊 TRACKING DE USO

### ¿Cómo se actualiza el uso?

**Después de cada transferencia exitosa**:
```python
# En backend/backend/main.py o donde se complete la transferencia
supabase.table("user_plans").update({
    "transfer_bytes_used_month": RawSQL("transfer_bytes_used_month + :bytes", bytes=file_size),
    "copies_used_month": RawSQL("copies_used_month + 1"),
    "updated_at": datetime.utcnow().isoformat()
}).eq("user_id", user_id).execute()
```

### ¿Dónde se guarda?

**Tabla**: `user_plans`  
**Columnas relevantes**:
- `plan`: "free", "standard_monthly", "standard_yearly", "premium_monthly", "premium_yearly"
- `billing_period`: "MONTHLY", "YEARLY"
- `transfer_bytes_used_lifetime`: Uso total acumulado (solo FREE)
- `transfer_bytes_used_month`: Uso del mes actual (PAID)
- `transfer_bytes_limit_month`: Límite mensual del plan
- `max_file_bytes`: Tamaño máximo de archivo permitido
- `period_start`: Inicio del período actual
- `plan_expires_at`: Fecha de expiración del plan

---

## 🎨 MENSAJES DE ERROR AL USUARIO

### Error 413: Archivo muy grande
**Frontend debe mostrar**:
```
❌ Archivo demasiado grande

Tu plan FREE permite archivos de hasta 1 GB.
Este archivo pesa 5.0 GB.

👉 Actualiza a STANDARD para archivos de hasta 10 GB
   O actualiza a PREMIUM para archivos de hasta 50 GB

[Botón: Ver Planes]
```

### Error 402: Cuota de transferencia excedida
**Frontend debe mostrar**:
```
❌ Cuota de transferencia agotada

Has usado 98.5 GB de 100 GB este mes.
Este archivo requiere 5.0 GB adicionales.

👉 Opciones:
   • Espera hasta el 1 de febrero (reset automático)
   • Actualiza a PREMIUM (200 GB/mes)

[Botón: Ver Planes]
```

---

## ⚙️ CONFIGURACIÓN AL ACTUALIZAR PLAN

### ¿Qué pasa cuando un usuario paga?

**Webhook**: `checkout.session.completed`  
**Ubicación**: `backend/backend/main.py` → `handle_checkout_completed()`

**Proceso**:
1. Stripe envía webhook con `plan_code` (ej: "standard_monthly")
2. Backend extrae `billing_period` del plan_code
3. Consulta límites en `billing_plans.py`:
   ```python
   plan_limits = get_plan_limits("standard_monthly")
   ```
4. Actualiza tabla `user_plans`:
   ```python
   {
     "plan": "standard_monthly",
     "plan_type": "PAID",
     "billing_period": "MONTHLY",
     "transfer_bytes_limit_month": 107374182400,  # 100GB
     "max_file_bytes": 10737418240,               # 10GB
     "transfer_bytes_used_month": 0,              # Reset
     "copies_used_month": 0,                      # Reset
     "plan_expires_at": "2026-02-28T23:59:59Z"
   }
   ```

**¿Cuándo se aplican los nuevos límites?**
- ✅ Inmediatamente después del pago exitoso
- ✅ La próxima operación ya usa los nuevos límites
- ✅ No requiere logout/login del usuario

---

## 🧪 TESTING DE RESTRICCIONES

### Test 1: Usuario FREE intenta subir archivo de 2GB

```bash
# Setup: Usuario con plan FREE (max: 1GB)

curl -X POST http://localhost:8000/copy/start \
  -H "Authorization: Bearer <FREE_USER_TOKEN>" \
  -d '{
    "source_file_id": "...",
    "dest_folder_id": "...",
    "file_size": 2147483648
  }'

# ✅ Respuesta esperada: 413 Payload Too Large
{
  "code": "FILE_TOO_LARGE",
  "message": "Archivo demasiado grande para tu plan FREE",
  "action": {"type": "UPGRADE", "to": "STANDARD"}
}
```

### Test 2: Usuario Standard Monthly con 99GB usados intenta transferir 5GB

```bash
# Setup: Standard Monthly, usado 99GB, límite 100GB

curl -X POST http://localhost:8000/copy/start \
  -H "Authorization: Bearer <STANDARD_USER_TOKEN>" \
  -d '{
    "file_size": 5368709120
  }'

# ✅ Respuesta esperada: 402 Payment Required
{
  "error": "transfer_quota_exceeded",
  "message": "Has usado 99.00GB de 100GB este mes. Este archivo requiere 5.00GB.",
  "action": {"type": "UPGRADE", "to": "PREMIUM"}
}
```

### Test 3: Reset mensual automático

```sql
-- Setup: Simular cambio de mes
UPDATE user_plans 
SET 
  transfer_bytes_used_month = 100000000000,  -- 93GB usado
  period_start = '2026-01-01T00:00:00Z'
WHERE user_id = '<USER_ID>';

-- Ejecutar cualquier operación (trigger auto-reset)
-- Luego verificar:
SELECT 
  plan,
  billing_period,
  transfer_bytes_used_month,
  period_start
FROM user_plans
WHERE user_id = '<USER_ID>';

-- ✅ Resultado esperado (si hoy es Feb 1+):
-- transfer_bytes_used_month: 0
-- period_start: 2026-02-01T00:00:00Z
```

---

## 📝 CHECKLIST DE VERIFICACIÓN

### Backend
- [x] `billing_plans.py` tiene límites correctos para cada plan
- [x] `quota.py` consulta límites de `billing_plans.py`
- [x] `check_file_size_limit_bytes()` validado
- [x] `check_transfer_bytes_available()` validado
- [x] Auto-reset mensual funciona (solo MONTHLY)
- [x] Webhook actualiza límites correctamente

### Frontend (TO-DO)
- [ ] Mostrar mensajes de error personalizados
- [ ] Botón "Ver Planes" en errores de cuota
- [ ] Indicador de uso actual (ej: "50GB / 100GB usado")
- [ ] Warning al 90% de uso: "Te quedan 10GB este mes"
- [ ] Celebrar reset mensual: "¡Tu cuota se ha renovado!"

### Database
- [x] Columna `billing_period` existe
- [x] Columna `max_file_bytes` existe
- [x] Columna `transfer_bytes_limit_month` existe
- [x] Valores correctos después de webhook

---

## 🚨 CASOS ESPECIALES

### ¿Qué pasa si un usuario downgrade?
**Respuesta**: NO está permitido en el código actual.
- Endpoint rechaza con error 409
- Solo permite upgrades

### ¿Qué pasa si expira la subscripción?
**Webhook**: `customer.subscription.deleted`
- Plan vuelve a "free"
- Límites vuelven a: 5GB lifetime, 1GB max file

### ¿Qué pasa con planes legacy (plus, pro)?
- Siguen funcionando normalmente
- No se muestran en UI de pricing
- Pueden usar el sistema sin problemas
- Se sugiere migrar a nuevos planes eventualmente

---

## 📞 RESUMEN PARA SOPORTE

**¿Un usuario reporta que no puede copiar un archivo?**

1. **Verificar plan**:
   ```sql
   SELECT plan, billing_period, 
          transfer_bytes_used_month, transfer_bytes_limit_month,
          max_file_bytes
   FROM user_plans WHERE user_id = '<USER_ID>';
   ```

2. **Verificar tamaño del archivo**:
   - Si archivo > max_file_bytes → Necesita upgrade
   - Si archivo < max_file_bytes → Revisar cuota de transferencia

3. **Verificar cuota de transferencia**:
   - Si used + file_size > limit → Esperar reset o upgrade
   - Si used + file_size < limit → Puede ser otro problema

4. **Soluciones**:
   - Upgrade a plan superior
   - Esperar reset mensual (solo MONTHLY)
   - Reportar bug si límites están incorrectos

---

**🎉 Sistema de restricciones completamente implementado y funcionando!**

Todas las validaciones se hacen automáticamente en el backend.
El frontend solo necesita mostrar los mensajes de error correctamente.
