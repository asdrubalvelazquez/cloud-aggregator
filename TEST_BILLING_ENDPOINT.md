# TEST: Endpoint /billing/quota en Producción

## Obtener JWT de Supabase

### Opción 1: Desde DevTools del navegador

1. Abre https://cloudaggregatorapp.com/app (logueado)
2. Abre DevTools (F12)
3. Ve a **Application** → **Storage** → **Local Storage** → `https://cloudaggregatorapp.com`
4. Busca el key que contiene `supabase.auth.token`
5. Copia el valor del `access_token` (el JWT largo)

### Opción 2: Desde Console del navegador

1. Abre https://cloudaggregatorapp.com/app (logueado)
2. Abre Console (F12)
3. Ejecuta:
```javascript
(async () => {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  const supabase = createClient(
    'https://rfkryeryqrilqmzkgzua.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJma3J5ZXJ5cXJpbHFtemtnenVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5ODE1OTgsImV4cCI6MjA4MDU1NzU5OH0.ePriz4T9LszE0XyyVyj0WYvCMWGobHOUVAGP_UjP49w'
  );
  const { data: { session } } = await supabase.auth.getSession();
  console.log('JWT:', session?.access_token);
})();
```

## Ejecutar Prueba

Una vez tengas el JWT, ejecuta:

```powershell
# Reemplaza <JWT> con tu token
$jwt = "tu-jwt-aqui"

# Test endpoint
curl -i -H "Authorization: Bearer $jwt" https://cloud-aggregator-api.fly.dev/billing/quota
```

## Resultado Esperado

### Status: 200 OK

```json
{
  "plan": "free",
  "plan_type": "FREE",
  "copies": {
    "used": 0,
    "limit": 20,
    "is_lifetime": true
  },
  "transfer": {
    "used_bytes": 0,
    "limit_bytes": 5368709120,
    "used_gb": 0.0,
    "limit_gb": 5.0,
    "is_lifetime": true
  },
  "max_file_bytes": 1073741824,
  "max_file_gb": 1.0
}
```

### Posibles Errores

**401 Unauthorized:**
- JWT inválido o expirado
- Falta header Authorization
- CORS issue

**403 Forbidden:**
- JWT válido pero user_id no existe en DB
- Permisos de Supabase

**500 Internal Server Error:**
- Bug en backend
- Revisar logs: `fly logs -a cloud-aggregator-api`

## Verificación Frontend

1. Abre https://cloudaggregatorapp.com/app (logueado)
2. Verifica que aparezca sección **"Plan & Límites"** arriba de las 4 tarjetas
3. Debe mostrar:
   - Badge "FREE" (gris)
   - Copias: "0 / 20 (Lifetime)"
   - Transferencia: "0.00 / 5.0 GB (Lifetime)"
   - Botón "⬆️ Actualizar plan"

## DevTools Console Check

Ejecuta en Console para verificar que el endpoint se está llamando:

```javascript
// Ver todas las llamadas al backend
performance.getEntriesByType('resource')
  .filter(r => r.name.includes('cloud-aggregator-api.fly.dev'))
  .map(r => ({ url: r.name, duration: r.duration }))
```

Deberías ver una llamada a `/billing/quota` con duración ~100-500ms.
