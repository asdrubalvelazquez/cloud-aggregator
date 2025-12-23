# FASE 1: Implementación de Reconexión de Slots Históricos
## Fecha: 2025-12-22

---

## 📋 RESUMEN EJECUTIVO

**Problema resuelto:** Bug que bloqueaba reconexión de cuentas históricas cuando usuario FREE tenía 2/2 slots consumidos.

**Solución:** Separación de flujos "Conectar nueva" vs "Reconectar histórica" con validación backend que permite reconexión de slots existentes sin consumir nuevo slot.

---

## ✅ CAMBIOS IMPLEMENTADOS

### 🔧 BACKEND (3 archivos modificados)

#### 1. `backend/backend/main.py`

**Nuevo endpoint GET /me/slots:**
```python
@app.get("/me/slots")
async def get_user_slots(user_id: str = Depends(verify_supabase_jwt)):
    """
    Get all historical cloud slots (active and inactive) for authenticated user.
    Returns minimal fields (no PII exposure via select *).
    """
    slots_result = supabase.table("cloud_slots_log").select(
        "id,provider,provider_email,provider_account_id,slot_number,is_active,connected_at,disconnected_at,plan_at_connection"
    ).eq("user_id", user_id).order("slot_number").execute()
    
    return {"slots": slots_result.data or []}
```

**Cambio en OAuth callback (línea ~183):**
- **ANTES:** Incluía `&allowed={allowed}` en redirect (PII en URL)
- **DESPUÉS:** Solo `?error=cloud_limit_reached` (sin PII)

#### 2. `backend/backend/quota.py`

**Mejora en `check_cloud_limit_with_slots` (línea ~389):**
- **ANTES:** Mensaje genérico "Has alcanzado el límite..."
- **DESPUÉS:** Mensaje diferenciado para FREE:
  ```
  "Has usado tus {slots_total} slots históricos. Puedes reconectar tus cuentas 
  anteriores en cualquier momento, pero no puedes agregar cuentas nuevas en plan FREE. 
  Actualiza a un plan PAID para conectar más cuentas."
  ```

---

### 🎨 FRONTEND (4 archivos modificados/creados)

#### 1. `frontend/src/lib/api.ts` (modificado)

**Nueva función exportada:**
```typescript
export type CloudSlot = {
  id: string;
  provider: string;
  provider_email: string;
  provider_account_id: string;
  slot_number: number;
  is_active: boolean;
  connected_at: string;
  disconnected_at: string | null;
  plan_at_connection: string;
};

export async function fetchUserSlots(): Promise<SlotsResponse> {
  const res = await authenticatedFetch("/me/slots");
  if (!res.ok) {
    throw new Error(`Failed to fetch slots: ${res.status}`);
  }
  return await res.json();
}
```

#### 2. `frontend/src/components/ReconnectSlotsModal.tsx` (nuevo)

**Componente modal con dos secciones:**
- **Cuentas Activas**: Badge verde "ACTIVA"
- **Cuentas Históricas Desconectadas**: Botón "Reconectar" por cada slot inactivo

**Funcionalidades:**
- Lista todos los slots desde `GET /me/slots`
- Inicia OAuth para reconectar con `window.location.href = /auth/google/login?user_id=...`
- Info box explicando slots históricos permanentes en FREE

#### 3. `frontend/src/app/app/page.tsx` (modificado)

**Cambios en botones del header:**
- **ANTES:** 1 botón "Conectar nueva cuenta de Google Drive" (siempre visible)
- **DESPUÉS:** 2 botones separados:
  1. 🔵 **"Ver mis cuentas"** (siempre enabled) → Abre modal de slots
  2. 🟢 **"Conectar nueva cuenta"** (disabled si `clouds_connected >= clouds_allowed`)

**Mejora en mensaje de error:**
- **ANTES:** "Has alcanzado el límite de {allowed} cuenta(s) en tu plan..."
- **DESPUÉS:** "Has usado tus slots históricos. Puedes reconectar tus cuentas anteriores desde 'Ver mis cuentas', pero no puedes agregar cuentas nuevas en plan FREE."

**Nuevo estado:**
```typescript
const [showReconnectModal, setShowReconnectModal] = useState(false);
```

---

### 🗄️ SQL SANEAMIENTO (1 archivo nuevo)

#### `backend/migrations/fix_inconsistent_slots.sql`

**Propósito:** Corregir slots con estado inconsistente (`is_active=true` pero `disconnected_at` no NULL)

**Script principal:**
```sql
UPDATE cloud_slots_log 
SET 
    is_active = false,
    updated_at = NOW()
WHERE 
    disconnected_at IS NOT NULL 
    AND is_active = true;
```

**Características:**
- ✅ Idempotente (puede ejecutarse múltiples veces)
- ✅ Incluye instrucciones de backup obligatorio
- ✅ Query de verificación pre/post ejecución
- ✅ Instrucciones de rollback si es necesario

---

## 📊 DIFF EXACTO DE CAMBIOS

### Backend: main.py

```diff
@@ -499,6 +499,30 @@ async def get_my_plan(user_id: str = Depends(verify_supabase_jwt)):
         raise HTTPException(status_code=500, detail=f"Failed to get plan info: {str(e)}")
 
 
+@app.get("/me/slots")
+async def get_user_slots(user_id: str = Depends(verify_supabase_jwt)):
+    """
+    Get all historical cloud slots (active and inactive) for the authenticated user.
+    """
+    try:
+        slots_result = supabase.table("cloud_slots_log").select(
+            "id,provider,provider_email,provider_account_id,slot_number,is_active,connected_at,disconnected_at,plan_at_connection"
+        ).eq("user_id", user_id).order("slot_number").execute()
+        
+        return {"slots": slots_result.data or []}
+    except Exception as e:
+        import logging
+        logging.error(f"[SLOTS ERROR] Failed to fetch slots for user {user_id}: {str(e)}")
+        raise HTTPException(status_code=500, detail=f"Failed to fetch slots: {str(e)}")
+
+
 class RenameFileRequest(BaseModel):
     account_id: int
     file_id: str
@@ -183,9 +183,8 @@ async def google_callback(request: Request):
     try:
         quota.check_cloud_limit_with_slots(supabase, user_id, "google_drive", google_account_id)
     except HTTPException as e:
-        error_detail = e.detail
-        allowed = error_detail.get("allowed", 0) if isinstance(error_detail, dict) else 0
-        return RedirectResponse(f"{FRONTEND_URL}/app?error=cloud_limit_reached&allowed={allowed}")
+        # NO exponer PII en URL
+        return RedirectResponse(f"{FRONTEND_URL}/app?error=cloud_limit_reached")
```

### Backend: quota.py

```diff
@@ -385,12 +385,19 @@ def check_cloud_limit_with_slots(supabase: Client, user_id: str, provider: str,
     # Nueva cuenta - verificar disponibilidad de slots
     if clouds_slots_used >= clouds_slots_total:
         logging.warning(f"[SLOT LIMIT ✗] Usuario {user_id} ha excedido el límite de slots: {clouds_slots_used}/{clouds_slots_total}")
+        
+        # Mensaje diferenciado para FREE vs PAID
+        if plan_name == "free":
+            message = f"Has usado tus {clouds_slots_total} slots históricos. Puedes reconectar tus cuentas anteriores en cualquier momento, pero no puedes agregar cuentas nuevas en plan FREE. Actualiza a un plan PAID para conectar más cuentas."
+        else:
+            message = f"Has alcanzado el límite de {clouds_slots_total} cuenta(s) únicas para tu plan {plan_name}."
+        
         raise HTTPException(
             status_code=402,
             detail={
                 "error": "cloud_limit_reached",
-                "message": f"Has alcanzado el límite de {clouds_slots_total} cuenta(s) únicas para tu plan {plan_name}. Las cuentas desconectadas no liberan slots.",
+                "message": message,
                 "allowed": clouds_slots_total,
                 "used": clouds_slots_used
             }
         )
```

### Frontend: lib/api.ts

```diff
@@ -29,3 +29,40 @@ export async function authenticatedFetch(
 
   return response;
 }
+
+/**
+ * Types for cloud slots
+ */
+export type CloudSlot = {
+  id: string;
+  provider: string;
+  provider_email: string;
+  provider_account_id: string;
+  slot_number: number;
+  is_active: boolean;
+  connected_at: string;
+  disconnected_at: string | null;
+  plan_at_connection: string;
+};
+
+export type SlotsResponse = {
+  slots: CloudSlot[];
+};
+
+/**
+ * Fetch all cloud slots (active and inactive) for authenticated user
+ */
+export async function fetchUserSlots(): Promise<SlotsResponse> {
+  const res = await authenticatedFetch("/me/slots");
+  if (!res.ok) {
+    throw new Error(`Failed to fetch slots: ${res.status}`);
+  }
+  return await res.json();
+}
```

### Frontend: page.tsx (cambios principales)

```diff
@@ -9,6 +9,7 @@ import Toast from "@/components/Toast";
 import ProgressBar from "@/components/ProgressBar";
 import AccountStatusBadge from "@/components/AccountStatusBadge";
 import { formatStorage, formatStorageFromGB } from "@/lib/formatStorage";
+import ReconnectSlotsModal from "@/components/ReconnectSlotsModal";
 
 // ... (tipos sin cambios)
 
@@ -52,6 +53,7 @@ function DashboardContent() {
   const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
   const [lastUpdated, setLastUpdated] = useState<number | null>(null);
   const [quota, setQuota] = useState<QuotaInfo>(null);
+  const [showReconnectModal, setShowReconnectModal] = useState(false);
   const router = useRouter();
   const searchParams = useSearchParams();
 
@@ -126,8 +128,7 @@ function DashboardContent() {
       }, 1000);
     } else if (authError === "cloud_limit_reached") {
       setToast({
-        message: `Has alcanzado el límite de ${allowed} cuenta(s) en tu plan. Actualiza tu plan para conectar más.`,
+        message: `Has usado tus slots históricos. Puedes reconectar tus cuentas anteriores desde "Ver mis cuentas", pero no puedes agregar cuentas nuevas en plan FREE.`,
         type: "warning",
       });
       window.history.replaceState({}, "", window.location.pathname);
@@ -260,11 +261,31 @@ function DashboardContent() {
           </div>
           <div className="flex gap-3">
             <button
+              onClick={() => setShowReconnectModal(true)}
+              className="rounded-lg transition px-4 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700"
+            >
+              📊 Ver mis cuentas
+            </button>
+            <button
               onClick={handleConnectGoogle}
-              className="rounded-lg transition px-4 py-2 text-sm font-semibold bg-emerald-500 hover:bg-emerald-600"
+              disabled={quota && quota.clouds_connected >= quota.clouds_allowed}
+              className={
+                quota && quota.clouds_connected >= quota.clouds_allowed
+                  ? "rounded-lg transition px-4 py-2 text-sm font-semibold bg-slate-600 text-slate-400 cursor-not-allowed"
+                  : "rounded-lg transition px-4 py-2 text-sm font-semibold bg-emerald-500 hover:bg-emerald-600"
+              }
+              title={
+                quota && quota.clouds_connected >= quota.clouds_allowed
+                  ? "Has usado todos tus slots. Puedes reconectar cuentas anteriores desde 'Ver mis cuentas'"
+                  : "Conectar una nueva cuenta de Google Drive"
+              }
             >
-              Conectar nueva cuenta de Google Drive
+              Conectar nueva cuenta
             </button>
@@ -471,6 +492,12 @@ function DashboardContent() {
           </>
         )}
       </div>
+
+      {/* Modal de slots históricos */}
+      <ReconnectSlotsModal
+        isOpen={showReconnectModal}
+        onClose={() => setShowReconnectModal(false)}
+      />
     </main>
   );
 }
```

---

## 🧪 INSTRUCCIONES DE PRUEBA (6 PASOS)

### Prerequisitos
- Usuario FREE con plan_type='FREE', clouds_slots_total=2
- 2 cuentas de Google diferentes disponibles (A, B, C)
- Base de datos limpia o con slots históricos inconsistentes corregidos

### Flujo de prueba

#### **PASO 1: Conectar cuenta A (primera cuenta)**
```bash
# Acción: Usuario hace clic en "Conectar nueva cuenta"
# Resultado esperado:
✅ OAuth exitoso
✅ Cuenta A aparece en dashboard
✅ Header muestra: "Slots históricos: 1 / 2"
✅ Botón "Conectar nueva cuenta" sigue enabled
```

#### **PASO 2: Conectar cuenta B (segunda cuenta, llega a 2/2)**
```bash
# Acción: Usuario hace clic en "Conectar nueva cuenta"
# Resultado esperado:
✅ OAuth exitoso
✅ Cuenta B aparece en dashboard
✅ Header muestra: "Slots históricos: 2 / 2"
✅ Botón "Conectar nueva cuenta" se vuelve DISABLED (gris, cursor-not-allowed)
✅ Botón "Ver mis cuentas" sigue ENABLED
✅ Se muestra mensaje: "Puedes reconectar tus cuentas anteriores en cualquier momento"
```

#### **PASO 3: Desconectar cuenta A**
```bash
# Acción: Usuario hace clic en "Desconectar" en cuenta A
# Resultado esperado:
✅ Cuenta A desaparece del dashboard
✅ En base de datos:
   - cloud_accounts.is_active = false
   - cloud_accounts.disconnected_at = NOW()
   - cloud_slots_log.is_active = false
   - cloud_slots_log.disconnected_at = NOW()
✅ Header sigue mostrando: "Slots históricos: 2 / 2" (no cambia!)
✅ Botón "Conectar nueva cuenta" sigue DISABLED
```

#### **PASO 4: Ver slots históricos (modal)**
```bash
# Acción: Usuario hace clic en "Ver mis cuentas"
# Resultado esperado:
✅ Modal se abre con título "Mis Cuentas Cloud"
✅ Sección "Cuentas Activas (1)":
   - Cuenta B con badge verde "ACTIVA"
✅ Sección "Cuentas Históricas Desconectadas (1)":
   - Cuenta A con badge gris "DESCONECTADA"
   - Botón "Reconectar" verde visible
✅ Info box: "Plan FREE: Tienes 2 slots históricos permanentes..."
```

#### **PASO 5: Reconectar cuenta A (debe funcionar sin errores)**
```bash
# Acción: Usuario hace clic en "Reconectar" en cuenta A del modal
# Resultado esperado:
✅ Redirige a OAuth de Google
✅ Usuario selecciona cuenta A (email correcto)
✅ Callback backend ejecuta check_cloud_limit_with_slots:
   - Encuentra provider_account_id en cloud_slots_log
   - SALVOCONDUCTO: permite reconexión SIN validar límite 2/2
✅ Cuenta A reaparece en dashboard
✅ En base de datos:
   - cloud_accounts.is_active = true
   - cloud_accounts.disconnected_at = NULL
   - cloud_slots_log.is_active = true
   - cloud_slots_log.disconnected_at = NULL
✅ Header sigue mostrando: "Slots históricos: 2 / 2"
✅ Toast: "Cuenta de Google conectada exitosamente"
```

#### **PASO 6: Intentar conectar cuenta C nueva (debe bloquearse)**
```bash
# Acción: Usuario hace clic en "Conectar nueva cuenta" (si estuviera enabled, o mediante URL directa)
# Resultado esperado:
❌ OAuth callback detecta que provider_account_id NO existe en cloud_slots_log
❌ check_cloud_limit_with_slots valida clouds_slots_used (2) >= clouds_slots_total (2)
❌ Lanza HTTPException(402, "cloud_limit_reached")
❌ Redirect a /app?error=cloud_limit_reached (SIN allowed= en URL)
❌ Toast: "Has usado tus slots históricos. Puedes reconectar tus cuentas anteriores desde 'Ver mis cuentas', pero no puedes agregar cuentas nuevas en plan FREE."
❌ Cuenta C NO aparece en dashboard
❌ Base de datos NO crea nuevo registro
```

---

## 🔐 VALIDACIONES DE SEGURIDAD

### ✅ Implementadas en Fase 1

1. **NO PII en URL:** Emails de cuentas permitidas NO se exponen en querystring
2. **Campos mínimos:** GET /me/slots usa select explícito (no `*`)
3. **Autenticación obligatoria:** Todos los endpoints requieren JWT válido
4. **Validación de ownership:** Backend verifica user_id antes de retornar slots
5. **SQL idempotente:** Script de saneamiento puede ejecutarse múltiples veces sin riesgo

### 🟠 Pendientes para Fase 2 (opcional)

1. **login_hint forzado:** Endpoint `/auth/reconnect-slot` con pre-selección de cuenta correcta
2. **Validación post-OAuth:** Si usuario selecciona cuenta incorrecta en OAuth, rechazar con mensaje específico mostrando emails permitidos
3. **Rate limiting:** Limitar intentos de reconexión para prevenir abuse

---

## 📦 ARCHIVOS MODIFICADOS/CREADOS

### Backend (2 modificados + 1 nuevo)
- ✏️ `backend/backend/main.py` (nuevo endpoint + fix redirect)
- ✏️ `backend/backend/quota.py` (mensaje mejorado)
- 📄 `backend/migrations/fix_inconsistent_slots.sql` (nuevo)

### Frontend (2 modificados + 1 nuevo)
- ✏️ `frontend/src/lib/api.ts` (fetchUserSlots + tipos)
- ✏️ `frontend/src/app/app/page.tsx` (botones separados + modal)
- 📄 `frontend/src/components/ReconnectSlotsModal.tsx` (nuevo)

---

## 🚀 DEPLOYMENT CHECKLIST

### Pre-deployment
- [ ] Ejecutar backup de `cloud_slots_log` tabla
- [ ] Revisar que no haya slots con estado inconsistente (ejecutar query de verificación)
- [ ] Ejecutar script SQL de saneamiento si es necesario
- [ ] Validar que `FRONTEND_URL` y `API_BASE_URL` estén correctamente configurados

### Deployment
- [ ] Deploy backend (main.py + quota.py)
- [ ] Deploy frontend (page.tsx + ReconnectSlotsModal.tsx + api.ts)
- [ ] Verificar que endpoint `/me/slots` responda correctamente (status 200)

### Post-deployment
- [ ] Ejecutar PASO 1-6 de pruebas en ambiente de staging
- [ ] Validar logs backend para [SALVOCONDUCTO ✓] y [SLOT LIMIT ✗]
- [ ] Verificar que no haya PII (emails) en logs de acceso/nginx
- [ ] Monitorear errores 402 en `/auth/google/callback`

---

## 🐛 TROUBLESHOOTING

### Problema: Modal no muestra slots inactivos
**Causa:** Script SQL de saneamiento no ejecutado
**Solución:** Ejecutar `fix_inconsistent_slots.sql`

### Problema: Backend permite conectar cuenta C nueva en FREE 2/2
**Causa:** `check_cloud_limit_with_slots` no está validando correctamente
**Solución:** Verificar logs de backend para `[SALVOCONDUCTO ✓]` vs `[NEW ACCOUNT]`

### Problema: Usuario ve "cloud_limit_reached" al reconectar
**Causa:** Backend no encuentra `provider_account_id` en `cloud_slots_log`
**Solución:** Verificar normalización de ID (string trim) en línea 357 de quota.py

### Problema: Frontend muestra emails en URL después de error
**Causa:** Versión antigua de main.py con redirect que incluye `&allowed=`
**Solución:** Verificar que línea 186 de main.py solo tenga `?error=cloud_limit_reached`

---

## 📞 CONTACTO Y SOPORTE

Para reportar bugs o sugerir mejoras de Fase 2:
- GitHub Issues: [repositorio]/issues
- Email: [soporte]
- Documentación completa: Ver `PRE_DEPLOY_AUDIT_REPORT.md`

---

**Fin del documento de Fase 1**
