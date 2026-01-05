# OneDrive Storage Quota Integration

## DIFF BACKEND

### backend/backend/main.py

**Nuevo endpoint agregado después de `disconnect_slot` (línea ~2767):**

```diff
+@app.get("/cloud/storage-summary")
+async def get_cloud_storage_summary(user_id: str = Depends(verify_supabase_jwt)):
+    """
+    Get aggregated storage summary across all connected cloud accounts (Google Drive + OneDrive).
+    
+    Returns total storage across all accounts plus per-account breakdown.
+    Gracefully handles account errors (expired tokens, quota fetch failures).
+    
+    Security:
+    - Requires valid JWT token
+    - Only returns data for authenticated user's accounts
+    
+    Returns:
+        {
+            "totals": {
+                "total_bytes": int,
+                "used_bytes": int,
+                "free_bytes": int,
+                "percent_used": float
+            },
+            "accounts": [
+                {
+                    "provider": "google_drive"|"onedrive",
+                    "email": str,
+                    "total_bytes": int,
+                    "used_bytes": int,
+                    "free_bytes": int,
+                    "percent_used": float,
+                    "status": "ok"|"unavailable"|"error"
+                }
+            ]
+        }
+    """
+    try:
+        # Fetch all active accounts for user
+        google_accounts_resp = supabase.table("cloud_accounts").select(
+            "id, account_email, access_token"
+        ).eq("user_id", user_id).eq("is_active", True).execute()
+        
+        onedrive_accounts_resp = supabase.table("cloud_provider_accounts").select(
+            "id, provider_account_id, provider_email, access_token, refresh_token"
+        ).eq("user_id", user_id).eq("provider", "onedrive").eq("is_active", True).execute()
+        
+        google_accounts = google_accounts_resp.data or []
+        onedrive_accounts = onedrive_accounts_resp.data or []
+        
+        accounts_data = []
+        total_bytes = 0
+        used_bytes = 0
+        
+        # Process Google Drive accounts
+        for account in google_accounts:
+            try:
+                quota_info = await get_storage_quota(account["id"])
+                storage_quota = quota_info.get("storageQuota", {})
+                
+                account_total = int(storage_quota.get("limit", 0))
+                account_used = int(storage_quota.get("usage", 0))
+                account_free = account_total - account_used if account_total > 0 else 0
+                account_percent = round((account_used / account_total * 100) if account_total > 0 else 0, 2)
+                
+                total_bytes += account_total
+                used_bytes += account_used
+                
+                accounts_data.append({
+                    "provider": "google_drive",
+                    "email": account["account_email"],
+                    "total_bytes": account_total,
+                    "used_bytes": account_used,
+                    "free_bytes": account_free,
+                    "percent_used": account_percent,
+                    "status": "ok"
+                })
+            except Exception as e:
+                logging.warning(f"[STORAGE_SUMMARY] Failed to fetch Google Drive quota for {account.get('account_email')}: {e}")
+                accounts_data.append({
+                    "provider": "google_drive",
+                    "email": account.get("account_email", "unknown"),
+                    "total_bytes": None,
+                    "used_bytes": None,
+                    "free_bytes": None,
+                    "percent_used": None,
+                    "status": "unavailable"
+                })
+        
+        # Process OneDrive accounts
+        for account in onedrive_accounts:
+            try:
+                # Decrypt access token
+                access_token = decrypt_token(account["access_token"])
+                
+                # Try to get quota, refresh token if needed
+                try:
+                    quota_info = await get_onedrive_storage_quota(access_token)
+                except HTTPException as e:
+                    # If 401, try to refresh token
+                    if e.status_code == 401:
+                        refresh_token = decrypt_token(account["refresh_token"])
+                        tokens = await refresh_onedrive_token(refresh_token)
+                        
+                        # Update tokens in DB
+                        supabase.table("cloud_provider_accounts").update({
+                            "access_token": encrypt_token(tokens["access_token"]),
+                            "refresh_token": encrypt_token(tokens["refresh_token"]),
+                            "updated_at": datetime.now(timezone.utc).isoformat()
+                        }).eq("id", account["id"]).execute()
+                        
+                        # Retry quota fetch
+                        quota_info = await get_onedrive_storage_quota(tokens["access_token"])
+                    else:
+                        raise
+                
+                account_total = quota_info.get("total", 0)
+                account_used = quota_info.get("used", 0)
+                account_free = quota_info.get("remaining", 0)
+                account_percent = round((account_used / account_total * 100) if account_total > 0 else 0, 2)
+                
+                total_bytes += account_total
+                used_bytes += account_used
+                
+                accounts_data.append({
+                    "provider": "onedrive",
+                    "email": account["provider_email"],
+                    "total_bytes": account_total,
+                    "used_bytes": account_used,
+                    "free_bytes": account_free,
+                    "percent_used": account_percent,
+                    "status": "ok"
+                })
+            except Exception as e:
+                logging.warning(f"[STORAGE_SUMMARY] Failed to fetch OneDrive quota for {account.get('provider_email')}: {e}")
+                accounts_data.append({
+                    "provider": "onedrive",
+                    "email": account.get("provider_email", "unknown"),
+                    "total_bytes": None,
+                    "used_bytes": None,
+                    "free_bytes": None,
+                    "percent_used": None,
+                    "status": "unavailable"
+                })
+        
+        free_bytes = total_bytes - used_bytes if total_bytes > 0 else 0
+        percent_used = round((used_bytes / total_bytes * 100) if total_bytes > 0 else 0, 2)
+        
+        return {
+            "totals": {
+                "total_bytes": total_bytes,
+                "used_bytes": used_bytes,
+                "free_bytes": free_bytes,
+                "percent_used": percent_used
+            },
+            "accounts": accounts_data
+        }
+        
+    except Exception as e:
+        logging.error(f"[STORAGE_SUMMARY ERROR] Failed to fetch storage summary for user {user_id}: {str(e)}")
+        raise HTTPException(
+            status_code=500,
+            detail=f"Failed to fetch storage summary: {str(e)}"
+        )
```

**Nota:** La función `get_onedrive_storage_quota()` ya existe en `backend/onedrive.py` (línea 234-280) y devuelve:
```python
{
    "total": int (bytes),
    "used": int (bytes),
    "remaining": int (bytes),
    "state": str ("normal" | "nearing" | "critical" | "exceeded")
}
```

## DIFF FRONTEND

### frontend/src/app/app/page.tsx

**1. Nuevos types (después de línea 23):**

```diff
+type CloudStorageAccount = {
+  provider: string;
+  email: string;
+  total_bytes: number | null;
+  used_bytes: number | null;
+  free_bytes: number | null;
+  percent_used: number | null;
+  status: "ok" | "unavailable" | "error";
+};
+
+type CloudStorageSummary = {
+  totals: {
+    total_bytes: number;
+    used_bytes: number;
+    free_bytes: number;
+    percent_used: number;
+  };
+  accounts: CloudStorageAccount[];
+};
+
 type StorageSummary = {
   accounts: Account[];
   total_limit: number;
   total_usage: number;
   total_usage_percent: number;
 };
```

**2. Nuevo state (línea ~108):**

```diff
 function DashboardContent(...) {
   const [data, setData] = useState<StorageSummary | null>(null);
+  const [cloudStorage, setCloudStorage] = useState<CloudStorageSummary | null>(null);
   const [loading, setLoading] = useState(true);
```

**3. Fetch unificado (línea ~145):**

```diff
   const fetchSummary = async (signal?: AbortSignal) => {
     let didSoftTimeout = false;
     try {
       setLoading(true);
+      
+      // Fetch cloud storage summary (new unified endpoint)
+      const cloudRes = await authenticatedFetch("/cloud/storage-summary", { signal });
+      if (cloudRes.ok) {
+        const cloudJson = await cloudRes.json();
+        setCloudStorage(cloudJson);
+      } else {
+        console.warn("Failed to fetch cloud storage summary:", cloudRes.status);
+      }
+      
+      // Keep legacy endpoint for backwards compatibility (if needed)
       const res = await authenticatedFetch("/storage/summary", { signal });
```

**4. Dashboard cards (línea ~797):**

```diff
 <div className="bg-slate-800 rounded-xl p-5 shadow-lg border border-slate-700">
   <h2 className="text-xs text-slate-400 uppercase tracking-wide font-semibold mb-1">
     Total Espacio
   </h2>
   <p className="text-3xl font-bold text-white">
-    {formatStorageFromGB(data.total_limit / (1024 ** 3))}
+    {cloudStorage
+      ? formatStorageFromGB(cloudStorage.totals.total_bytes / (1024 ** 3))
+      : formatStorageFromGB(data.total_limit / (1024 ** 3))
+    }
   </p>
 </div>
 <div className="bg-slate-800 rounded-xl p-5 shadow-lg border border-slate-700">
   <h2 className="text-xs text-slate-400 uppercase tracking-wide font-semibold mb-1">
     Espacio Usado
   </h2>
   <p className="text-3xl font-bold text-white">
+    {cloudStorage
+      ? formatStorageFromGB(cloudStorage.totals.used_bytes / (1024 ** 3))
+      : formatStorageFromGB(data.total_usage / (1024 ** 3))
+    }
   </p>
 </div>
 <div className="bg-slate-800 rounded-xl p-5 shadow-lg border border-slate-700">
   <h2 className="text-xs text-slate-400 uppercase tracking-wide font-semibold mb-1">
     Espacio Libre
   </h2>
   <p className="text-3xl font-bold text-white">
+    {cloudStorage
+      ? formatStorageFromGB(cloudStorage.totals.free_bytes / (1024 ** 3))
+      : formatStorageFromGB((data.total_limit - data.total_usage) / (1024 ** 3))
+    }
   </p>
 </div>
 <div className="bg-slate-800 rounded-xl p-5 shadow-lg border border-slate-700">
   <h2 className="text-xs text-slate-400 uppercase tracking-wide font-semibold mb-1">
     % Utilizado
   </h2>
   <p className="text-3xl font-bold text-white">
+    {cloudStorage
+      ? cloudStorage.totals.percent_used.toFixed(1)
+      : data.total_usage_percent.toFixed(1)
+    }%
   </p>
 </div>
```

**5. Progress bar overview (línea ~868):**

```diff
 <p className="text-xs text-slate-400 mb-3">
-  {formatStorageFromGB(data.total_usage / (1024 ** 3))} usados de{" "}
-  {formatStorageFromGB(data.total_limit / (1024 ** 3))} ({formatStorageFromGB((data.total_limit - data.total_usage) / (1024 ** 3))} libre)
+  {cloudStorage
+    ? `${formatStorageFromGB(cloudStorage.totals.used_bytes / (1024 ** 3))} usados de ${formatStorageFromGB(cloudStorage.totals.total_bytes / (1024 ** 3))} (${formatStorageFromGB(cloudStorage.totals.free_bytes / (1024 ** 3))} libre)`
+    : `${formatStorageFromGB(data.total_usage / (1024 ** 3))} usados de ${formatStorageFromGB(data.total_limit / (1024 ** 3))} (${formatStorageFromGB((data.total_limit - data.total_usage) / (1024 ** 3))} libre)`
+  }
 </p>
 <ProgressBar
-  current={data.total_usage}
-  total={data.total_limit}
+  current={cloudStorage ? cloudStorage.totals.used_bytes : data.total_usage}
+  total={cloudStorage ? cloudStorage.totals.total_bytes : data.total_limit}
   height="lg"
 />
```

**6. Accounts table (línea ~970):**

```diff
 <tbody>
   {connectedAccounts.map((acc) => {
-    // Buscar data de storage en data.accounts (Google-only por ahora)
-    const storageData =
-      acc.provider === "google_drive"
-        ? data?.accounts.find(a => a.email === acc.provider_email)
-        : undefined;
+    // Buscar data de storage: Google en data.accounts o unified en cloudStorage.accounts
+    let storageData = undefined;
+    
+    if (cloudStorage) {
+      // Usar nuevo endpoint unificado
+      storageData = cloudStorage.accounts.find(
+        a => a.email === acc.provider_email && 
+             ((a.provider === "google_drive" && acc.provider === "google_drive") ||
+              (a.provider === "onedrive" && acc.provider === "onedrive"))
+      );
+    } else if (acc.provider === "google_drive" && data?.accounts) {
+      // Fallback a endpoint legacy (solo Google)
+      const legacyData = data.accounts.find(a => a.email === acc.provider_email);
+      if (legacyData) {
+        storageData = {
+          provider: "google_drive",
+          email: legacyData.email,
+          total_bytes: legacyData.limit,
+          used_bytes: legacyData.usage,
+          free_bytes: legacyData.limit - legacyData.usage,
+          percent_used: legacyData.usage_percent,
+          status: legacyData.error ? "error" : "ok"
+        };
+      }
+    }
     
     return (
       <tr ...>
         ...
         <td className="py-4 px-4">
-          {storageData ? (
+          {storageData && storageData.status === "ok" ? (
             <AccountStatusBadge
-              limit={storageData.limit}
-              usage={storageData.usage}
-              error={storageData.error}
+              limit={storageData.total_bytes || 0}
+              usage={storageData.used_bytes || 0}
+              error={undefined}
             />
+          ) : storageData && storageData.status === "unavailable" ? (
+            <span className="px-2 py-1 bg-amber-500/20 text-amber-300 text-xs font-medium rounded">
+              No disponible
+            </span>
           ) : (
             <span className="px-2 py-1 bg-blue-500/20 text-blue-300 text-xs font-medium rounded">
               Conectado
             </span>
           )}
         </td>
         <td className="py-4 px-4 text-slate-300">
-          {storageData ? formatStorageFromGB(storageData.usage / (1024 ** 3)) : "N/A"}
+          {storageData && storageData.used_bytes !== null
+            ? formatStorageFromGB(storageData.used_bytes / (1024 ** 3))
+            : "N/A"}
         </td>
         <td className="py-4 px-4 text-slate-300">
+          {storageData && storageData.total_bytes !== null
+            ? formatStorageFromGB(storageData.total_bytes / (1024 ** 3))
+            : "N/A"}
+        </td>
+        <td className="py-4 px-4">
+          {storageData && storageData.used_bytes !== null && storageData.total_bytes !== null ? (
+            <div className="w-full">
+              <div className="flex items-center justify-between mb-1">
+                <span className="text-xs text-slate-400">
+                  {storageData.percent_used?.toFixed(1)}%
+                </span>
+              </div>
+              <ProgressBar
+                current={storageData.used_bytes}
+                total={storageData.total_bytes}
+                height="sm"
+              />
+            </div>
+          ) : (
+            <span className="text-xs text-slate-500">N/A</span>
+          )}
         </td>
```

## RESPONSE JSON EXAMPLE

```json
{
  "totals": {
    "total_bytes": 3199023255552,
    "used_bytes": 514000000000,
    "free_bytes": 2685023255552,
    "percent_used": 16.07
  },
  "accounts": [
    {
      "provider": "google_drive",
      "email": "user@gmail.com",
      "total_bytes": 2000000000000,
      "used_bytes": 479400000000,
      "free_bytes": 1520600000000,
      "percent_used": 23.97,
      "status": "ok"
    },
    {
      "provider": "onedrive",
      "email": "user@outlook.com",
      "total_bytes": 1099511627776,
      "used_bytes": 34600000000,
      "free_bytes": 1064911627776,
      "percent_used": 3.15,
      "status": "ok"
    },
    {
      "provider": "onedrive",
      "email": "expired@outlook.com",
      "total_bytes": null,
      "used_bytes": null,
      "free_bytes": null,
      "percent_used": null,
      "status": "unavailable"
    }
  ]
}
```

## CARACTERÍSTICAS

✅ **Backend:**
- Endpoint unificado `/cloud/storage-summary` que agrega Google Drive + OneDrive
- Usa función existente `get_onedrive_storage_quota()` para OneDrive
- Refresco automático de tokens OneDrive si expiran (401)
- Manejo graceful de errores por cuenta (no falla todo si una cuenta tiene problemas)
- Status por cuenta: `ok`, `unavailable`, `error`

✅ **Frontend:**
- Dashboard muestra totales agregados (todas las nubes sumadas)
- Tabla de cuentas muestra uso/límite/progreso para Google Drive Y OneDrive
- Fallback a endpoint legacy `/storage/summary` para compatibilidad
- Estado "No disponible" cuando OneDrive no puede obtener quota

✅ **Sin tocar:**
- Stripe: 0 cambios
- Lógica existente de Google Drive: intacta
- Endpoints legacy: compatibles

## NOTAS TÉCNICAS

1. **OneDrive quota ya existe:** La función `get_onedrive_storage_quota()` en `backend/onedrive.py` ya implementa la llamada a Microsoft Graph API (`GET /me/drive`) y retorna `total`, `used`, `remaining` en bytes.

2. **Refresh automático:** Si OneDrive devuelve 401, el endpoint intenta refrescar el token automáticamente antes de reintentar.

3. **Backwards compatible:** El frontend intenta usar el nuevo endpoint pero puede funcionar con el legacy solo-Google si falla.

4. **Normalización:** Todos los bytes son `int`, todos los porcentajes son `float` con 2 decimales.
