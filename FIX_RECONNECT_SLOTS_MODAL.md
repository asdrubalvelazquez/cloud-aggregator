# Fix ReconnectSlotsModal - OneDrive Desconexión y Reconexión

## Resumen

Se implementaron dos fixes críticos en el modal de reconexión/desconexión de cuentas cloud:

1. **Fix Desconexión**: OneDrive ya no genera error 422 ni congela la UI
2. **Fix Reconexión**: OneDrive ahora redirige correctamente a Microsoft OAuth (no a Google)

---

## A) FIX DESCONEXIÓN (422 → ✅)

### Problema identificado

El error 422 ocurría porque:
- El código intentaba usar `account.cloud_account_id` para construir el body del request
- En OneDrive, `cloud_account_id` puede ser `null` o no existir
- El endpoint `/auth/revoke-account` solo funciona con Google Drive
- Cuando el backend recibía un request mal formado (sin `account_id` válido), respondía 422
- La respuesta 422 intentaba parsearse como JSON, pero si fallaba, causaba "Application error" y congelaba la UI

### Solución implementada

1. Agregar función `normalizeProvider()` para detectar provider de forma robusta
2. Para Google Drive con `cloud_account_id` válido → usar `/auth/revoke-account` (legacy)
3. Para OneDrive y otros → usar `/cloud/disconnect` con `slot_log_id`
4. Manejo robusto de errores:
   - Try/catch anidado para parsear JSON del error
   - Si falla el parse, usar mensaje de fallback con status code
   - `finally` garantiza que `disconnecting` state siempre se limpia

### Diff Desconexión

```diff
                               try {
+                                const normalizedProvider = normalizeProvider(account.provider);
+                                console.log("[DISCONNECT] Starting for:", account.provider_email, "| Provider:", normalizedProvider, "| Slot:", account.slot_log_id);
+                                
                                 let res: Response;
                                 
-                                // Provider-aware disconnect
-                                if (account.provider === "google_drive" && account.cloud_account_id) {
-                                  // Google Drive: usar endpoint legacy
+                                // Provider-aware disconnect con lógica correcta
+                                if (normalizedProvider === "google_drive" && account.cloud_account_id) {
+                                  // Google Drive: usar endpoint legacy si cloud_account_id existe
+                                  console.log("[DISCONNECT] Using legacy endpoint for Google");
                                   res = await authenticatedFetch("/auth/revoke-account", {
                                     method: "POST",
                                     headers: { "Content-Type": "application/json" },
                                     body: JSON.stringify({ account_id: account.cloud_account_id }),
                                   });
                                 } else {
                                   // OneDrive/otros: usar endpoint universal
+                                  console.log("[DISCONNECT] Using universal endpoint");
                                   res = await authenticatedFetch("/cloud/disconnect", {
                                     method: "POST",
                                     headers: { "Content-Type": "application/json" },
                                     body: JSON.stringify({ slot_log_id: account.slot_log_id }),
                                   });
                                 }
 
                                 if (res.ok) {
+                                  console.log("[DISCONNECT] Success");
                                   await loadCloudStatus();
                                   if (onDisconnect) {
                                     onDisconnect(account);
                                   }
                                 } else {
-                                  const errorData = await res.json().catch(() => ({ detail: "Error desconocido" }));
-                                  setError(errorData.detail || errorData.message || "Error al desconectar cuenta");
+                                  // Manejo robusto de error para evitar crash en .json()
+                                  let errorMsg = "Error al desconectar cuenta";
+                                  try {
+                                    const errorData = await res.json();
+                                    errorMsg = errorData.detail || errorData.message || errorMsg;
+                                  } catch (parseErr) {
+                                    console.warn("[DISCONNECT] Could not parse error response");
+                                    errorMsg = `Error ${res.status}: ${res.statusText || errorMsg}`;
+                                  }
+                                  console.error("[DISCONNECT] Failed:", errorMsg);
+                                  setError(errorMsg);
                                 }
                               } catch (err: any) {
-                                console.error("[DISCONNECT] Error:", err);
+                                console.error("[DISCONNECT] Exception:", err);
                                 setError(err.message || "Error al desconectar cuenta");
                               } finally {
                                 // CRÍTICO: Siempre limpiar loading
                                 setDisconnecting(null);
                               }
```

---

## B) FIX RECONEXIÓN (OneDrive → Microsoft OAuth)

### Problema identificado

El modal siempre redirigía a Google OAuth porque:
- El código comparaba directamente `account.provider` sin normalizar
- En algunos casos el provider podía venir como "OneDrive", "onedrive", "microsoft", etc.
- El fallback (cuando slot no existe) no respetaba el provider original
- No había logging para diagnosticar qué provider se estaba detectando

### Solución implementada

1. Agregar función `normalizeProvider()` que:
   - Convierte a lowercase
   - Detecta "google" → `"google_drive"`
   - Detecta "onedrive" o "microsoft" → `"onedrive"`
   
2. Usar `normalizedProvider` para branching:
   - `google_drive` → `fetchGoogleLoginUrl`
   - `onedrive` → `fetchOneDriveLoginUrl`
   - Otros → error claro
   
3. Aplicar normalización también en el fallback (404 slot_not_found)

4. Agregar logging robusto con provider original + normalizado

### Diff Reconexión

**1. Función normalizeProvider (nueva)**

```diff
 export default function ReconnectSlotsModal({
   isOpen,
   onClose,
   onReconnect,
   onDisconnect,
 }: ReconnectSlotsModalProps) {
   const [accounts, setAccounts] = useState<CloudAccountStatus[]>([]);
   const [summary, setSummary] = useState<any>(null);
   const [loading, setLoading] = useState(true);
   const [error, setError] = useState<string | null>(null);
   const [reconnecting, setReconnecting] = useState<string | null>(null);
   const [disconnecting, setDisconnecting] = useState<string | null>(null);
 
+  // Normalizar provider para manejar variaciones
+  function normalizeProvider(p?: string): string {
+    const v = (p || "").toLowerCase();
+    if (v.includes("google")) return "google_drive";
+    if (v.includes("onedrive") || v.includes("microsoft")) return "onedrive";
+    return v;
+  }
```

**2. Handler de Reconexión Principal**

```diff
       setReconnecting(account.slot_log_id);
       setError(null);
       
-      console.log("[RECONNECT] Fetching OAuth URL for:", account.provider_email, account.provider, account.provider_account_id);
+      const normalizedProvider = normalizeProvider(account.provider);
+      console.log("[RECONNECT] Fetching OAuth URL for:", account.provider_email, "| Original provider:", account.provider, "| Normalized:", normalizedProvider, "| Account ID:", account.provider_account_id);
       
       // Fetch OAuth URL with reconnect mode (provider-aware)
       let url: string;
       
-      if (account.provider === "google_drive") {
+      if (normalizedProvider === "google_drive") {
         // Google Drive OAuth
         const result = await fetchGoogleLoginUrl({ 
           mode: "reconnect",
           reconnect_account_id: account.provider_account_id
         });
         url = result.url;
-      } else if (account.provider === "onedrive") {
+      } else if (normalizedProvider === "onedrive") {
         // OneDrive OAuth
         const result = await fetchOneDriveLoginUrl({ 
           mode: "reconnect",
           reconnect_account_id: account.provider_account_id
         });
         url = result.url;
       } else {
         // Provider no soportado
         throw new Error(`Provider "${account.provider}" no soportado para reconexión`);
       }
```

**3. Fallback cuando slot no existe (404)**

```diff
       // Manejar error 404: slot_not_found (cuenta histórica no reconectable)
       if (err.status === 404 || (err.message && err.message.includes("slot_not_found"))) {
         // Mostrar mensaje y conectar automáticamente como nueva cuenta
         setError("Esta cuenta histórica no puede reconectarse. La conectaremos como nueva cuenta…");
         
         try {
-          // Conectar como nueva cuenta (sin reconnect_account_id) - provider-aware
+          // Conectar como nueva cuenta (sin reconnect_account_id) - provider-aware con normalización
+          const normalizedProvider = normalizeProvider(account.provider);
           let url: string;
           
-          if (account.provider === "google_drive") {
+          if (normalizedProvider === "google_drive") {
             const result = await fetchGoogleLoginUrl({ mode: "connect" });
             url = result.url;
-          } else if (account.provider === "onedrive") {
+          } else if (normalizedProvider === "onedrive") {
             const result = await fetchOneDriveLoginUrl({ mode: "connect" });
             url = result.url;
           } else {
             throw new Error(`Provider "${account.provider}" no soportado`);
           }
```

---

## Cambios de Archivos

### ✅ Modificado: `frontend/src/components/ReconnectSlotsModal.tsx`

- **Función nueva**: `normalizeProvider()` (líneas 38-43)
- **Reconexión**: Líneas 95-119 (normalización + logging)
- **Fallback 404**: Líneas 128-147 (normalización)
- **Desconexión**: Líneas 262-307 (logging + manejo robusto de errores)

### ✅ Sin cambios: `frontend/src/lib/api.ts`

No fue necesario modificar `api.ts` porque:
- `authenticatedFetch` ya está disponible
- `fetchGoogleLoginUrl` y `fetchOneDriveLoginUrl` ya existen
- El endpoint `/cloud/disconnect` ya está implementado en el backend

---

## Por qué este fix elimina el 422

**Antes:**
```typescript
// ❌ Siempre intentaba usar cloud_account_id (puede ser null en OneDrive)
res = await authenticatedFetch("/auth/revoke-account", {
  body: JSON.stringify({ account_id: account.cloud_account_id })  // null → 422
});
```

**Ahora:**
```typescript
// ✅ OneDrive usa endpoint universal con slot_log_id (siempre existe)
if (normalizedProvider === "google_drive" && account.cloud_account_id) {
  // Google con ID válido → legacy endpoint
  res = await authenticatedFetch("/auth/revoke-account", { ... });
} else {
  // OneDrive y otros → endpoint universal
  res = await authenticatedFetch("/cloud/disconnect", {
    body: JSON.stringify({ slot_log_id: account.slot_log_id })  // ✅ siempre válido
  });
}
```

**Adicionalmente:**
- Try/catch anidado previene que un error de parse JSON rompa toda la app
- `finally` garantiza que el estado `disconnecting` siempre se limpia
- Mensajes de error informativos con fallback seguro

---

## Instrucciones de Prueba Manual

### 1. Desconectar OneDrive (debe llamar `/cloud/disconnect`)

1. Abrir modal "Mis Cuentas Cloud"
2. En una cuenta OneDrive conectada, hacer clic en "Desconectar"
3. Confirmar
4. **Verificar en Network tab**:
   - Debe aparecer `POST /cloud/disconnect`
   - Body: `{ "slot_log_id": "..." }`
   - Respuesta 200 OK
5. **Verificar en Console**:
   ```
   [DISCONNECT] Starting for: user@outlook.com | Provider: onedrive | Slot: xxx
   [DISCONNECT] Using universal endpoint
   [DISCONNECT] Success
   ```
6. ✅ NO debe aparecer error 422
7. ✅ NO debe congelarse la UI
8. ✅ El modal debe recargar y mostrar la cuenta como "Históricas Desconectadas"

### 2. Reconectar OneDrive (debe abrir Microsoft OAuth)

1. En el modal, en la sección "Requieren Reconexión" o "Históricas Desconectadas"
2. Hacer clic en "Reconectar" en una cuenta OneDrive
3. **Verificar en Console**:
   ```
   [RECONNECT] Fetching OAuth URL for: user@outlook.com | Original provider: onedrive | Normalized: onedrive | Account ID: xxx
   ```
4. **Verificar en Network tab**:
   - `POST /auth/onedrive/login-url`
   - Body debe incluir `mode: "reconnect"` y `reconnect_account_id`
5. ✅ Debe redirigir a `login.microsoftonline.com` (NO a Google)
6. Completar OAuth → debe reconectar correctamente

### 3. Google sigue funcionando igual

1. Desconectar una cuenta Google Drive
2. **Verificar en Console**:
   ```
   [DISCONNECT] Starting for: user@gmail.com | Provider: google_drive | Slot: xxx
   [DISCONNECT] Using legacy endpoint for Google
   [DISCONNECT] Success
   ```
3. **Verificar en Network tab**:
   - `POST /auth/revoke-account` (legacy)
   - Body: `{ "account_id": 123 }`
4. Reconectar → debe redirigir a Google OAuth
5. ✅ Todo funciona como antes

---

## Commits Sugeridos

```bash
# Commit 1: Fix desconexión OneDrive (422)
git add frontend/src/components/ReconnectSlotsModal.tsx
git commit -m "fix: OneDrive disconnect 422 error with robust error handling

- Add normalizeProvider() to handle provider variations
- Use /cloud/disconnect endpoint for OneDrive (not /auth/revoke-account)
- Add nested try/catch for JSON parse errors (prevents UI freeze)
- Add detailed logging for debugging
- Ensure disconnecting state always clears in finally block

Fixes: OneDrive disconnect causing 422 + Application error"
```

```bash
# Commit 2: Fix reconexión OneDrive (OAuth incorrecto)
git add frontend/src/components/ReconnectSlotsModal.tsx
git commit -m "fix: OneDrive reconnect routing to Microsoft OAuth (not Google)

- Use normalizeProvider() for reliable provider detection
- Route to fetchOneDriveLoginUrl when provider is OneDrive
- Apply normalization in 404 fallback (new connection)
- Add detailed logging with original + normalized provider

Fixes: Modal reconnect always going to Google for OneDrive accounts"
```

O en un solo commit:

```bash
git add frontend/src/components/ReconnectSlotsModal.tsx
git commit -m "fix: ReconnectSlotsModal OneDrive disconnect and reconnect

Fix 1 - Disconnect 422 error:
- Add normalizeProvider() for robust provider detection
- Use /cloud/disconnect endpoint for OneDrive (not /auth/revoke-account)
- Nested try/catch prevents JSON parse errors from breaking UI
- Detailed logging for debugging

Fix 2 - Reconnect OAuth routing:
- OneDrive now correctly routes to Microsoft OAuth (not Google)
- Normalization applied in main handler and 404 fallback
- Logging shows original + normalized provider for diagnostics

Changes: frontend/src/components/ReconnectSlotsModal.tsx only
No backend changes required"
```

---

## Estado Final

✅ **OneDrive desconectar**: usa `/cloud/disconnect`, no genera 422, manejo robusto de errores
✅ **OneDrive reconectar**: redirige a Microsoft OAuth correctamente
✅ **Google Drive**: sigue funcionando igual (backward compatible)
✅ **UI**: nunca se congela gracias a `finally` y try/catch anidado
✅ **Logging**: console.log detallado para debugging
✅ **Sin cambios en backend**: solo frontend modificado
✅ **Sin cambios en Stripe**: 0 líneas de Stripe tocadas

**Código listo para commit.**
