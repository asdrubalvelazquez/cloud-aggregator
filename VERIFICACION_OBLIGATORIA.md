# ⚠️ VERIFICACIÓN OBLIGATORIA - AUDITORÍA NO CERRADA

**Status:** 🔴 **PENDIENTE DE EVIDENCIAS REALES**

La auditoría NO puede cerrarse sin las siguientes 3 evidencias:

---

## 📋 EVIDENCIA 1: CURL 200 REAL CON JWT

### Paso 1: Obtener JWT desde Frontend

1. Abre en tu navegador: **https://cloudaggregatorapp.com/app**
2. Haz login con tu cuenta
3. Abre **DevTools** (F12)
4. Ve a **Console** tab
5. Pega y ejecuta este código (robusto con manejo de errores):

```javascript
(() => {
  const key = Object.keys(localStorage).find(k => k.includes('sb-') && k.includes('-auth-token'));
  if (!key) { 
    console.log('❌ NO_AUTH_TOKEN_KEY - No estás logueado o Supabase no guardó el token'); 
    return; 
  }
  const raw = localStorage.getItem(key);
  if (!raw) { 
    console.log('❌ EMPTY_AUTH_TOKEN - Key existe pero valor vacío'); 
    return; 
  }
  let obj = null;
  try { 
    obj = JSON.parse(raw); 
  } catch(e) { 
    console.log('❌ AUTH_TOKEN_JSON_PARSE_FAIL', e); 
    return; 
  }
  const token = obj?.access_token || obj?.currentSession?.access_token || obj?.session?.access_token;
  if (!token) {
    console.log('❌ NO_ACCESS_TOKEN_IN_OBJECT - Estructura del objeto inesperada');
    console.log('🔍 Objeto completo:', obj);
    return;
  }
  console.log('✅ AUTH_KEY:', key);
  console.log('📝 ACCESS_TOKEN:', token);
  console.log('\n🔹 Copia el ACCESS_TOKEN de arriba y úsalo en el siguiente comando curl:');
})();
```

6. **Copia el ACCESS_TOKEN** que aparece en la consola (el JWT largo)

### Paso 2: Ejecutar CURL en Terminal

Abre PowerShell y ejecuta (reemplaza `<ACCESS_TOKEN>` con tu JWT):

```powershell
$jwt = "PEGA-TU-JWT-AQUI"

curl -i -H "Authorization: Bearer $jwt" https://cloud-aggregator-api.fly.dev/billing/quota
```

### Paso 3: PEGA EL OUTPUT COMPLETO AQUÍ

**Output esperado:**
```
HTTP/1.1 200 OK
date: ...
content-type: application/json
...

{
  "plan": "free",
  "plan_type": "FREE",
  "copies": {
    "used": X,
    "limit": 20,
    "is_lifetime": true
  },
  "transfer": {
    "used_bytes": X,
    "limit_bytes": 5368709120,
    "used_gb": X.XX,
    "limit_gb": 5.0,
    "is_lifetime": true
  },
  "max_file_bytes": 1073741824,
  "max_file_gb": 1.0
}
```

**📝 PEGA TU OUTPUT REAL AQUÍ:**
```
[PENDIENTE - Usuario debe ejecutar y pegar]
```

---

### 🔧 TROUBLESHOOTING (si no da 200)

#### Error 401 Unauthorized
**Causas posibles:**
1. JWT expirado (Supabase tokens expiran en 1 hora por default)
   - **Fix:** Recarga la página, vuelve a hacer login, obtén nuevo JWT
2. Header Authorization no llega al backend
   - **Fix:** Verifica que el curl tiene `-H "Authorization: Bearer ..."`
3. SUPABASE_JWT_SECRET incorrecto en backend
   - **Fix:** Ejecuta en terminal:
   ```powershell
   fly secrets list -a cloud-aggregator-api
   ```
   Verifica que SUPABASE_JWT_SECRET existe
4. JWT de Supabase no válido para tu backend
   - **Fix:** Verifica que SUPABASE_URL en frontend match con el del backend

#### Error 403 Forbidden
**Causas posibles:**
1. JWT válido pero user_id no existe en tabla `user_plans`
   - **Fix:** Verifica en Supabase SQL Editor:
   ```sql
   SELECT * FROM user_plans WHERE user_id = 'tu-user-id';
   ```
   Si no existe, ejecuta:
   ```sql
   INSERT INTO user_plans (user_id, plan, plan_type) VALUES ('tu-user-id', 'free', 'FREE');
   ```

#### Error 500 Internal Server Error
**Causas posibles:**
1. Backend crashea con KeyError/AttributeError
   - **Fix:** Ver logs:
   ```powershell
   fly logs -a cloud-aggregator-api
   ```
   Buscar el error, arreglar código, redeploy:
   ```powershell
   cd backend
   fly deploy
   ```

#### Error CORS (preflight failed)
**Causas posibles:**
1. Backend no acepta Authorization header en CORS
   - **Fix:** Verificar en `backend/backend/main.py`:
   ```python
   app.add_middleware(
       CORSMiddleware,
       allow_origins=[...],
       allow_credentials=True,
       allow_methods=["*"],
       allow_headers=["*"],  # ← Debe estar
   )
   ```

---

## 📋 EVIDENCIA 2: SCREENSHOT UI "Plan & Límites"

### Pasos:

1. Abre **https://cloudaggregatorapp.com/app** (logueado)
2. Espera que cargue el dashboard completo
3. **Verifica visualmente** que aparece una sección con:
   - Título: **"Plan & Límites"**
   - Badge gris que dice: **"FREE"** (o PLUS/PRO según tu plan)
   - 3 columnas:
     - **Copias (Lifetime)**: X / 20 con barra de progreso verde
     - **Transferencia (Lifetime)**: X.XX / 5.0 GB con barra de progreso
     - **Máx por archivo**: 1.0 GB
   - Botón verde: **"⬆️ Actualizar plan"** (si eres FREE)

4. **Toma screenshot** (Windows: Win + Shift + S)
   - Debe mostrar la sección completa "Plan & Límites"
   - Debe verse el badge, las 3 columnas, y el botón

5. **Guarda el screenshot como:** `EVIDENCIA_UI_PLAN_LIMITES.png`

### Checklist de Verificación:

- [ ] Sección "Plan & Límites" visible arriba de las 4 tarjetas de resumen
- [ ] Badge muestra plan correcto (FREE/PLUS/PRO)
- [ ] Copias muestra número correcto (ej: 0 / 20)
- [ ] Transferencia muestra GB correctos (ej: 0.00 / 5.0 GB)
- [ ] Máx archivo muestra 1.0 GB (para FREE) o 10.0 GB (PLUS) o 50.0 GB (PRO)
- [ ] Botón "Actualizar plan" visible SOLO si plan = FREE
- [ ] Progress bars se renderizan correctamente (no errores en console)

**📸 SCREENSHOT:**
```
[PENDIENTE - Usuario debe tomar screenshot y adjuntar]
Nombre archivo: EVIDENCIA_UI_PLAN_LIMITES.png
```

---

## 📋 EVIDENCIA 3: SCREENSHOT NETWORK TAB (200 OK)

### Pasos:

1. Abre **https://cloudaggregatorapp.com/app** (logueado)
2. Abre **DevTools** (F12)
3. Ve a tab **Network**
4. **Filtra** por: `billing`
5. **Recarga** la página (Ctrl + R) para ver las requests
6. Busca la request: **`billing/quota`**
7. Haz click en esa request para ver detalles
8. Verifica:
   - **Request URL:** `https://cloud-aggregator-api.fly.dev/billing/quota`
   - **Status:** `200 OK`
   - **Method:** `GET`
   - **Response Headers:** contiene `content-type: application/json`
   - **Response Body (Preview):** JSON con `plan`, `copies`, `transfer`, `max_file_bytes`

9. **Toma screenshot** que muestre:
   - Lista de requests con `/billing/quota` visible
   - Status `200` en verde
   - Panel de Response mostrando el JSON

10. **Guarda el screenshot como:** `EVIDENCIA_NETWORK_200.png`

### Checklist de Verificación:

- [ ] Request URL es exactamente `https://cloud-aggregator-api.fly.dev/billing/quota`
- [ ] Status Code es `200 OK` (verde)
- [ ] Response Type es `json`
- [ ] Response Body contiene keys: `plan`, `plan_type`, `copies`, `transfer`, `max_file_bytes`, `max_file_gb`
- [ ] Request Headers contienen `Authorization: Bearer eyJ...`
- [ ] Tiempo de respuesta < 1000ms (latencia razonable)

**📸 SCREENSHOT:**
```
[PENDIENTE - Usuario debe tomar screenshot y adjuntar]
Nombre archivo: EVIDENCIA_NETWORK_200.png
```

---

## 📋 EVIDENCIA 4: VERIFICACIÓN DE CONSISTENCIA

### Comparación JSON vs UI

**Del CURL (Evidencia 1):**
```json
{
  "plan": "free",
  "copies": { "used": X, "limit": 20 },
  "transfer": { "used_gb": Y.YY, "limit_gb": 5.0 },
  "max_file_gb": 1.0
}
```

**Del UI (Evidencia 2):**
- Badge: "FREE" ← debe match con JSON `"plan": "free"`
- Copias: "X / 20" ← debe match con JSON `copies.used` y `copies.limit`
- Transferencia: "Y.YY / 5.0 GB" ← debe match con JSON `transfer.used_gb` y `transfer.limit_gb`
- Máx archivo: "1.0 GB" ← debe match con JSON `max_file_gb`

### Checklist:

- [ ] Badge del UI match con `plan` del JSON
- [ ] Números de Copias del UI match con `copies` del JSON
- [ ] Números de Transferencia del UI match con `transfer` del JSON
- [ ] Máx archivo del UI match con `max_file_gb` del JSON

**📝 CONFIRMACIÓN:**
```
[PENDIENTE - Usuario debe confirmar que los valores coinciden]
```

---

## 🔧 FIX: PROBLEMA VERCEL "frontend/frontend"

### Diagnóstico:

El error `Error: The provided path "~/OneDrive/OneDrive - Suscripciones/python/cloud-aggregator 2/frontend/frontend" does not exist` indica que Vercel está buscando en el path incorrecto.

### Solución:

1. Ve a **Vercel Dashboard**: https://vercel.com/asdrubalvelazquezs-projects/cloud-aggregator-umy5/settings
2. Sección: **General** → **Build & Development Settings**
3. Verifica **Root Directory**:
   - Debe ser: `frontend` (sin duplicación)
   - NO debe ser: `frontend/frontend` o vacío
4. Si está mal, corrige a: `frontend`
5. Guarda cambios
6. Dispara redeploy:
   ```powershell
   cd frontend
   vercel --prod --force
   ```

### Verificación:

```powershell
cd frontend
vercel inspect cloud-aggregator-umy5 --scope asdrubalvelazquezs-projects
```

Debería mostrar:
```
Root Directory: frontend  ← ✅ Correcto
Build Command: npm run build
Output Directory: .next
```

**📝 OUTPUT DE VERIFICACIÓN:**
```
[PENDIENTE - Usuario debe ejecutar vercel inspect y pegar output]
```

---

## ✅ CRITERIOS DE APROBACIÓN

La auditoría puede cerrarse como **APROBADA** SOLO SI:

1. ✅ CURL retorna `HTTP/1.1 200 OK` con JSON completo (evidencia pegada arriba)
2. ✅ Screenshot UI muestra sección "Plan & Límites" con todos los elementos (archivo adjunto)
3. ✅ Screenshot Network muestra request `/billing/quota` con status `200 OK` (archivo adjunto)
4. ✅ Valores del JSON coinciden con valores mostrados en UI
5. ✅ Vercel Root Directory configurado correctamente

---

## 🔴 ESTADO ACTUAL

**AUDITORÍA:** 🔴 **PENDIENTE DE EVIDENCIAS**

**Razón:** No se pueden obtener evidencias sin:
- Acceso al navegador con sesión autenticada
- Capacidad de ejecutar comandos en terminal con JWT real
- Capacidad de tomar screenshots

**Próximo paso:** Usuario debe:
1. Ejecutar los pasos de las Evidencias 1, 2, 3
2. Pegar outputs y adjuntar screenshots
3. Solo entonces la auditoría puede cerrarse como APROBADA

---

**⚠️ IMPORTANTE:** No cierres esta auditoría hasta tener las 3 evidencias documentadas arriba.
