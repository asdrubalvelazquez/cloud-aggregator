# 📋 GUÍA DE EJECUCIÓN - MIGRACIÓN DE SLOTS HISTÓRICOS

**Versión:** 1.0  
**Fecha:** 21 de diciembre de 2025  
**Fase:** 2 - DB Schema  

---

## ⚠️ ADVERTENCIAS CRÍTICAS

1. **HACER BACKUP OBLIGATORIO** antes de ejecutar la migración
2. **PROBAR EN AMBIENTE DE DESARROLLO** antes de producción
3. **LEER COMPLETAMENTE** esta guía antes de ejecutar comandos
4. **TENER SCRIPT DE ROLLBACK** a mano en caso de fallo

---

## 📦 PRE-REQUISITOS

### Acceso Requerido
- ✅ Acceso a Supabase Dashboard (https://app.supabase.com)
- ✅ Usuario con permisos de `postgres` (service_role_key)
- ✅ Conexión estable a Internet
- ✅ Cliente PostgreSQL instalado (para backups locales)

### Verificaciones Previas
```sql
-- Verificar versión de PostgreSQL (debe ser >= 12)
SELECT version();

-- Verificar número de usuarios actuales
SELECT COUNT(*) AS total_users FROM user_plans;

-- Verificar número de cuentas conectadas
SELECT COUNT(*) AS total_accounts FROM cloud_accounts WHERE user_id IS NOT NULL;

-- Verificar que no existen tablas/columnas nuevas (migración limpia)
SELECT table_name FROM information_schema.tables WHERE table_name = 'cloud_slots_log';
-- Resultado esperado: 0 filas
```

---

## 🛠️ PASO 1: BACKUP DE BASE DE DATOS

### Opción A: Backup desde Supabase Dashboard

1. Ir a **Supabase Dashboard** → Tu proyecto
2. Navegar a **Settings** → **Database** → **Backups**
3. Click en **"Download latest backup"**
4. Guardar archivo con nombre: `backup_pre_slots_YYYYMMDD.sql`

### Opción B: Backup con pg_dump (local)

```bash
# Obtener connection string de Supabase Dashboard → Settings → Database → Connection string
# Formato: postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres

# Ejecutar backup
pg_dump "postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres" \
  --schema=public \
  --data-only \
  --table=user_plans \
  --table=cloud_accounts \
  --table=copy_jobs \
  > backup_pre_slots_$(date +%Y%m%d).sql

# Verificar tamaño del backup (debe ser > 0 bytes)
ls -lh backup_pre_slots_*.sql
```

### ✅ Checkpoint 1
- [ ] Backup descargado y guardado en ubicación segura
- [ ] Archivo de backup tiene tamaño > 0 bytes
- [ ] Fecha del backup es de HOY

---

## 🚀 PASO 2: EJECUTAR MIGRACIÓN

### Opción A: Desde Supabase SQL Editor (RECOMENDADO)

1. Ir a **Supabase Dashboard** → **SQL Editor**
2. Click en **"New query"**
3. Copiar TODO el contenido de `add_slots_system.sql`
4. Pegar en el editor
5. **REVISAR** el script completo
6. Click en **"Run"** (esquina inferior derecha)
7. **ESPERAR** a que termine (puede tomar 10-30 segundos)

### Opción B: Desde psql (línea de comandos)

```bash
# Conectar a Supabase
psql "postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres"

# Ejecutar migración desde archivo
\i backend/migrations/add_slots_system.sql

# Verificar salida en consola
# Debe mostrar: "MIGRACIÓN COMPLETADA EXITOSAMENTE"
```

### 🔍 Verificar Resultado

Debes ver mensajes como:
```
NOTICE:  Validación OK: Todos los usuarios tienen plan_type asignado
NOTICE:  Validación OK: clouds_slots_used sincronizado con cloud_slots_log
NOTICE:  Validación OK: Todas las cuentas tienen slot_log_id
NOTICE:  ========================================
NOTICE:  MIGRACIÓN COMPLETADA EXITOSAMENTE
NOTICE:  ========================================
NOTICE:  Total de usuarios migrados: XXX
NOTICE:  Total de slots históricos creados: XXX
NOTICE:  Total de cuentas vinculadas: XXX
```

### ✅ Checkpoint 2
- [ ] Script ejecutado sin errores SQL
- [ ] Mensaje "MIGRACIÓN COMPLETADA EXITOSAMENTE" visible
- [ ] Números de usuarios/slots/cuentas son coherentes

---

## 🧪 PASO 3: VALIDACIÓN POST-MIGRACIÓN

### Test 1: Verificar Tabla `cloud_slots_log`

```sql
-- Ver primeros 10 slots creados
SELECT 
    user_id,
    provider,
    provider_email,
    slot_number,
    is_active,
    connected_at
FROM cloud_slots_log
ORDER BY connected_at DESC
LIMIT 10;

-- Resultado esperado: 10 filas con datos de cuentas Google Drive
```

### Test 2: Verificar `user_plans`

```sql
-- Ver distribución de plan_type
SELECT 
    plan_type,
    COUNT(*) as usuarios,
    AVG(clouds_slots_used) as promedio_slots,
    SUM(total_lifetime_copies) as total_copias
FROM user_plans
GROUP BY plan_type;

-- Resultado esperado:
-- plan_type | usuarios | promedio_slots | total_copias
-- FREE      | XXX      | ~1.5           | XXX
```

### Test 3: Verificar `cloud_accounts`

```sql
-- Verificar que todas las cuentas tienen slot_log_id
SELECT 
    COUNT(*) as total_cuentas,
    COUNT(slot_log_id) as cuentas_con_slot,
    COUNT(CASE WHEN is_active = true THEN 1 END) as cuentas_activas
FROM cloud_accounts
WHERE user_id IS NOT NULL;

-- Resultado esperado: total_cuentas = cuentas_con_slot
```

### Test 4: Integridad de Datos

```sql
-- Verificar que clouds_slots_used coincide con cloud_slots_log
SELECT 
    up.user_id,
    up.clouds_slots_used as slots_en_user_plans,
    COUNT(csl.id) as slots_en_log,
    CASE 
        WHEN up.clouds_slots_used = COUNT(csl.id) THEN 'OK'
        ELSE 'DESINCRONIZADO'
    END as estado
FROM user_plans up
LEFT JOIN cloud_slots_log csl ON up.user_id = csl.user_id
GROUP BY up.user_id, up.clouds_slots_used
HAVING up.clouds_slots_used != COUNT(csl.id);

-- Resultado esperado: 0 filas (todos sincronizados)
```

### ✅ Checkpoint 3
- [ ] Tabla `cloud_slots_log` existe y tiene datos
- [ ] Todos los usuarios tienen `plan_type = 'FREE'`
- [ ] Todas las cuentas tienen `slot_log_id` asignado
- [ ] Contadores sincronizados (Test 4 retorna 0 filas)

---

## 📊 PASO 4: VERIFICACIÓN DE ÍNDICES

```sql
-- Verificar que todos los índices fueron creados
SELECT 
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename IN ('cloud_slots_log', 'user_plans', 'cloud_accounts')
AND indexname LIKE '%slot%' OR indexname LIKE '%plan_type%';

-- Resultado esperado: ~8 índices nuevos
```

### ✅ Checkpoint 4
- [ ] Índices de `cloud_slots_log` creados (4 índices)
- [ ] Índices de `user_plans` creados (2 índices)
- [ ] Índices de `cloud_accounts` creados (2 índices)

---

## ⚠️ PASO 5: PLAN DE CONTINGENCIA (Si algo falló)

### Si hubo ERROR durante la migración:

1. **NO PÁNICO** - El script tiene transacción BEGIN/COMMIT
2. Si el error ocurrió, la DB hizo ROLLBACK automático
3. Verificar estado:

```sql
-- Verificar si cloud_slots_log existe
SELECT table_name FROM information_schema.tables WHERE table_name = 'cloud_slots_log';

-- Si retorna 1 fila: migración se aplicó parcialmente
-- Si retorna 0 filas: migración NO se aplicó (rollback automático)
```

4. Si migración se aplicó parcialmente, ejecutar rollback manual:

```bash
# Desde psql o SQL Editor de Supabase
\i backend/migrations/rollback_slots_system.sql
```

### Si necesitas ROLLBACK después de migración exitosa:

```sql
-- Ejecutar script de rollback
-- ADVERTENCIA: Perderás datos de cloud_slots_log
\i backend/migrations/rollback_slots_system.sql

-- O desde Supabase SQL Editor: copiar contenido de rollback_slots_system.sql
```

### ✅ Checkpoint 5
- [ ] Plan de rollback entendido
- [ ] Script `rollback_slots_system.sql` accesible
- [ ] Backup de DB disponible para restauración

---

## 📝 PASO 6: DOCUMENTACIÓN POST-MIGRACIÓN

### Crear Registro de Migración

```markdown
# MIGRACIÓN EJECUTADA

- **Fecha:** 2025-12-21
- **Hora:** [COMPLETAR]
- **Ejecutado por:** [TU NOMBRE]
- **Usuarios migrados:** [COMPLETAR]
- **Slots creados:** [COMPLETAR]
- **Cuentas vinculadas:** [COMPLETAR]
- **Duración:** [COMPLETAR]
- **Estado:** EXITOSO / FALLIDO
- **Notas:** [COMPLETAR]
```

### ✅ Checkpoint Final
- [ ] Migración completada sin errores
- [ ] Todas las validaciones pasaron
- [ ] Registro de migración documentado
- [ ] Backup pre-migración guardado
- [ ] Listo para Fase 3 (Backend Logic)

---

## 🎯 PRÓXIMOS PASOS

1. **Fase 3:** Refactorizar funciones de `backend/backend/quota.py`
2. **Testing:** Ejecutar test cases en ambiente de desarrollo
3. **Deploy Backend:** Aplicar cambios de lógica en producción
4. **Monitoreo:** Observar métricas de DB y logs de errores

---

## 📞 SOPORTE

**Si encuentras problemas:**
1. Revisar logs de Supabase Dashboard → Logs → Database
2. Verificar backup está accesible
3. Ejecutar rollback si es necesario
4. Contactar a equipo de desarrollo

---

**Preparado por:** Sistema de Auditoría  
**Versión:** 1.0  
**Última actualización:** 21 de diciembre de 2025
