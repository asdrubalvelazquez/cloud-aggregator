# DIFFS EXACTOS - Cross-Provider Transfer Phase 1

## 📄 1. BACKEND - main.py

### Import agregado (línea 30):
```diff
from backend import google_drive
from backend import onedrive
from backend import stripe_utils
+ from backend import transfer
```

### 3 nuevos endpoints (después del endpoint OneDrive rename, ~línea 2012):
```diff
     except HTTPException:
         raise
     except Exception as e:
         logging.exception(f"[ONEDRIVE] Rename failed for account {request.account_id}, item {request.item_id}")
         raise HTTPException(status_code=500, detail=f"Rename failed: {str(e)}")


+ # ============================================================================
+ # CROSS-PROVIDER TRANSFER ENDPOINTS (Phase 1: Google Drive → OneDrive)
+ # ============================================================================
+ 
+ class CreateTransferJobRequest(BaseModel):
+     source_provider: str  # "google_drive"
+     source_account_id: int
+     target_provider: str  # "onedrive"
+     target_account_id: int
+     file_ids: List[str]  # Google Drive file IDs
+     target_folder_id: Optional[str] = None  # OneDrive folder ID (None = root)
+ 
+ @app.post("/transfer/create")
+ async def create_transfer_job_endpoint(
+     request: CreateTransferJobRequest,
+     user_id: str = Depends(verify_supabase_jwt),
+ ):
+     """
+     Create a new cross-provider transfer job.
+     
+     SECURITY:
+     - Validates that both source and target accounts belong to user
+     - Creates job + items in database (status='queued')
+     - Returns job_id for subsequent /transfer/run call
+     
+     PHASE 1 ONLY SUPPORTS: Google Drive → OneDrive
+     """
+     try:
+         # Validate providers
+         if request.source_provider != "google_drive":
+             raise HTTPException(status_code=400, detail="Phase 1 only supports source_provider='google_drive'")
+         if request.target_provider != "onedrive":
+             raise HTTPException(status_code=400, detail="Phase 1 only supports target_provider='onedrive'")
+         
+         if not request.file_ids:
+             raise HTTPException(status_code=400, detail="file_ids cannot be empty")
+         
+         # Verify source account ownership
+         source_check = (
+             supabase.table("cloud_accounts")
+             .select("id,provider")
+             .eq("id", request.source_account_id)
+             .eq("user_id", user_id)
+             .single()
+             .execute()
+         )
+         if not source_check.data:
+             raise HTTPException(status_code=404, detail="Source account not found or doesn't belong to you")
+         if source_check.data["provider"] != request.source_provider:
+             raise HTTPException(status_code=400, detail=f"Source account provider mismatch")
+         
+         # Verify target account ownership
+         target_check = (
+             supabase.table("cloud_accounts")
+             .select("id,provider")
+             .eq("id", request.target_account_id)
+             .eq("user_id", user_id)
+             .single()
+             .execute()
+         )
+         if not target_check.data:
+             raise HTTPException(status_code=404, detail="Target account not found or doesn't belong to you")
+         if target_check.data["provider"] != request.target_provider:
+             raise HTTPException(status_code=400, detail=f"Target account provider mismatch")
+         
+         # Get file metadata from Google Drive to populate sizes
+         from backend.google_drive import get_valid_token
+         google_token = await get_valid_token(request.source_account_id)
+         
+         file_items = []
+         for file_id in request.file_ids:
+             try:
+                 async with httpx.AsyncClient() as client:
+                     # Get file metadata (name + size)
+                     resp = await client.get(
+                         f"https://www.googleapis.com/drive/v3/files/{file_id}",
+                         params={"fields": "name,size,mimeType"},
+                         headers={"Authorization": f"Bearer {google_token}"},
+                         timeout=10.0
+                     )
+                     if resp.status_code == 200:
+                         data = resp.json()
+                         file_items.append({
+                             "source_item_id": file_id,
+                             "file_name": data.get("name", "unknown"),
+                             "size_bytes": int(data.get("size", 0))
+                         })
+                     else:
+                         logging.warning(f"[TRANSFER] Could not fetch metadata for file {file_id}: {resp.status_code}")
+                         file_items.append({
+                             "source_item_id": file_id,
+                             "file_name": f"file_{file_id}",
+                             "size_bytes": 0
+                         })
+             except Exception as e:
+                 logging.warning(f"[TRANSFER] Error fetching metadata for file {file_id}: {e}")
+                 file_items.append({
+                     "source_item_id": file_id,
+                     "file_name": f"file_{file_id}",
+                     "size_bytes": 0
+                 })
+         
+         # Create transfer job
+         job_id = await transfer.create_transfer_job(
+             user_id=user_id,
+             source_provider=request.source_provider,
+             source_account_id=request.source_account_id,
+             target_provider=request.target_provider,
+             target_account_id=request.target_account_id,
+             target_folder_id=request.target_folder_id,
+             total_items=len(file_items),
+             total_bytes=sum(item["size_bytes"] for item in file_items)
+         )
+         
+         # Create transfer job items
+         await transfer.create_transfer_job_items(job_id, file_items)
+         
+         logging.info(f"[TRANSFER] Created job {job_id} for user {user_id}: {len(file_items)} files")
+         return {"job_id": str(job_id)}
+         
+     except HTTPException:
+         raise
+     except Exception as e:
+         logging.exception(f"[TRANSFER] Failed to create job for user {user_id}")
+         raise HTTPException(status_code=500, detail=f"Failed to create transfer job: {str(e)}")
+ 
+ 
+ @app.post("/transfer/run/{job_id}")
+ async def run_transfer_job_endpoint(
+     job_id: str,
+     user_id: str = Depends(verify_supabase_jwt),
+ ):
+     """
+     Execute a transfer job (downloads from Google Drive, uploads to OneDrive).
+     
+     SECURITY:
+     - Validates job belongs to user
+     - Only runs jobs with status='queued'
+     - Updates job/item status atomically
+     
+     NOTE: Executes in-request (no background worker). For large transfers,
+     client should show progress UI and handle potential timeouts gracefully.
+     """
+     try:
+         # Load job and verify ownership
+         job_result = (
+             supabase.table("transfer_jobs")
+             .select("*")
+             .eq("id", job_id)
+             .eq("user_id", user_id)
+             .single()
+             .execute()
+         )
+         
+         if not job_result.data:
+             raise HTTPException(status_code=404, detail="Transfer job not found or doesn't belong to you")
+         
+         job = job_result.data
+         
+         if job["status"] != "queued":
+             raise HTTPException(status_code=400, detail=f"Job status is '{job['status']}', expected 'queued'")
+         
+         # Update job status to 'running'
+         await transfer.update_job_status(job_id, status="running", started_at=True)
+         
+         # Load items to transfer
+         items_result = (
+             supabase.table("transfer_job_items")
+             .select("*")
+             .eq("transfer_job_id", job_id)
+             .eq("status", "queued")
+             .execute()
+         )
+         
+         items = items_result.data
+         if not items:
+             # No items to process
+             await transfer.update_job_status(job_id, status="done", completed_at=True)
+             return {"job_id": job_id, "status": "done", "message": "No items to transfer"}
+         
+         # Get tokens
+         from backend.google_drive import get_valid_token
+         google_token = await get_valid_token(job["source_account_id"])
+         
+         # Get OneDrive token (decrypt + refresh if needed)
+         from backend.onedrive import refresh_onedrive_token
+         target_account_result = (
+             supabase.table("cloud_provider_accounts")
+             .select("access_token,refresh_token")
+             .eq("cloud_account_id", job["target_account_id"])
+             .single()
+             .execute()
+         )
+         if not target_account_result.data:
+             raise HTTPException(status_code=500, detail="Target OneDrive account tokens not found")
+         
+         encrypted_access = target_account_result.data["access_token"]
+         encrypted_refresh = target_account_result.data["refresh_token"]
+         
+         from backend.crypto import decrypt_token
+         onedrive_access_token = decrypt_token(encrypted_access)
+         onedrive_refresh_token = decrypt_token(encrypted_refresh)
+         
+         # Try token, refresh if 401
+         async with httpx.AsyncClient() as test_client:
+             test_resp = await test_client.get(
+                 "https://graph.microsoft.com/v1.0/me/drive",
+                 headers={"Authorization": f"Bearer {onedrive_access_token}"},
+                 timeout=10.0
+             )
+             if test_resp.status_code == 401:
+                 logging.info(f"[TRANSFER] OneDrive token expired, refreshing...")
+                 onedrive_access_token = await refresh_onedrive_token(
+                     job["target_account_id"],
+                     onedrive_refresh_token
+                 )
+         
+         # Process each item
+         for item in items:
+             try:
+                 # Download from Google Drive
+                 async with httpx.AsyncClient() as client:
+                     download_resp = await client.get(
+                         f"https://www.googleapis.com/drive/v3/files/{item['source_item_id']}?alt=media",
+                         headers={"Authorization": f"Bearer {google_token}"},
+                         timeout=300.0  # 5 minutes for large files
+                     )
+                     
+                     if download_resp.status_code != 200:
+                         error_msg = f"Google Drive download failed: {download_resp.status_code}"
+                         await transfer.update_item_status(
+                             item["id"],
+                             status="failed",
+                             error_message=error_msg
+                         )
+                         await transfer.update_job_status(job_id, increment_failed=True)
+                         continue
+                     
+                     file_data = download_resp.content
+                 
+                 # Upload to OneDrive (chunked)
+                 target_folder_path = job.get("target_folder_id") or "root"
+                 upload_result = await transfer.upload_to_onedrive_chunked(
+                     access_token=onedrive_access_token,
+                     file_name=item["file_name"],
+                     file_data=file_data,
+                     folder_id=target_folder_path
+                 )
+                 
+                 # Mark item as done
+                 await transfer.update_item_status(
+                     item["id"],
+                     status="done",
+                     target_item_id=upload_result.get("id")
+                 )
+                 
+                 # Increment job counters
+                 await transfer.update_job_status(
+                     job_id,
+                     increment_completed=True,
+                     add_transferred_bytes=len(file_data)
+                 )
+                 
+                 logging.info(f"[TRANSFER] Item {item['id']} transferred successfully: {item['file_name']}")
+                 
+             except Exception as e:
+                 logging.exception(f"[TRANSFER] Failed to transfer item {item['id']}: {item['file_name']}")
+                 await transfer.update_item_status(
+                     item["id"],
+                     status="failed",
+                     error_message=str(e)[:500]  # Truncate long errors
+                 )
+                 await transfer.update_job_status(job_id, increment_failed=True)
+         
+         # Determine final job status
+         final_result = (
+             supabase.table("transfer_jobs")
+             .select("total_items,completed_items,failed_items")
+             .eq("id", job_id)
+             .single()
+             .execute()
+         )
+         
+         total = final_result.data["total_items"]
+         completed = final_result.data["completed_items"]
+         failed = final_result.data["failed_items"]
+         
+         if completed == total:
+             final_status = "done"
+         elif failed == total:
+             final_status = "failed"
+         else:
+             final_status = "partial"
+         
+         await transfer.update_job_status(job_id, status=final_status, completed_at=True)
+         
+         logging.info(f"[TRANSFER] Job {job_id} completed: {completed}/{total} successful, {failed} failed")
+         return {
+             "job_id": job_id,
+             "status": final_status,
+             "total_items": total,
+             "completed_items": completed,
+             "failed_items": failed
+         }
+         
+     except HTTPException:
+         raise
+     except Exception as e:
+         logging.exception(f"[TRANSFER] Job {job_id} execution failed")
+         # Try to mark job as failed
+         try:
+             await transfer.update_job_status(job_id, status="failed", completed_at=True)
+         except:
+             pass
+         raise HTTPException(status_code=500, detail=f"Transfer execution failed: {str(e)}")
+ 
+ 
+ @app.get("/transfer/status/{job_id}")
+ async def get_transfer_status_endpoint(
+     job_id: str,
+     user_id: str = Depends(verify_supabase_jwt),
+ ):
+     """
+     Get transfer job status with item details (for progress polling).
+     
+     SECURITY:
+     - Validates job belongs to user
+     - Returns job metadata + all items with status/errors
+     
+     Frontend should poll this endpoint every 2-3 seconds during transfer.
+     """
+     try:
+         result = await transfer.get_transfer_job_status(job_id, user_id)
+         return result
+         
+     except HTTPException:
+         raise
+     except Exception as e:
+         logging.exception(f"[TRANSFER] Failed to get status for job {job_id}")
+         raise HTTPException(status_code=500, detail=f"Failed to get transfer status: {str(e)}")
+ 

 @app.get("/drive/picker-token")
```

---

## 📄 2. FRONTEND - drive/[id]/page.tsx

### Import agregado (línea 14):
```diff
 import ContextMenu from "@/components/ContextMenu";
 import GooglePickerButton from "@/components/GooglePickerButton";
 import { DriveLoadingState } from "@/components/DriveLoadingState";
+ import TransferModal from "@/components/TransferModal";
```

### State agregado (después de rename modal state, ~línea 96):
```diff
   const [renameStatus, setRenameStatus] = useState<string | null>(null);

+   // Transfer modal state (Google Drive → OneDrive)
+   const [showTransferModal, setShowTransferModal] = useState(false);
+ 
   // Row selection state (visual highlight)
```

### Botón agregado en toolbar (~línea 1183, después del botón "Copiar seleccionados"):
```diff
                     ) : "Copiar seleccionados"}
                   </button>
+                   <button
+                     type="button"
+                     onClick={() => setShowTransferModal(true)}
+                     disabled={batchCopying}
+                     className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold transition"
+                     title="Copiar archivos seleccionados a OneDrive"
+                   >
+                     Copiar a OneDrive...
+                   </button>
                 </div>
```

### Modal agregado al final del componente (~línea 1579, antes del cierre):
```diff
           />
         )}
+
+         {/* Transfer Modal (Google Drive → OneDrive) */}
+         <TransferModal
+           isOpen={showTransferModal}
+           onClose={() => setShowTransferModal(false)}
+           sourceAccountId={parseInt(accountId)}
+           selectedFileIds={Array.from(selectedFiles)}
+           onTransferComplete={() => {
+             // Optionally refresh files or show success message
+             setQuotaRefreshKey(prev => prev + 1);
+           }}
+         />
       </div>
     </main>
```

---

## 📋 ARCHIVOS NUEVOS

### 1. backend/migrations/add_cross_provider_transfer.sql
Ver contenido completo en `CROSS_PROVIDER_TRANSFER_PHASE1.md` sección 1.

### 2. backend/backend/transfer.py
Archivo completo (280 líneas) - Ver documentación completa en archivo principal.

### 3. frontend/src/components/TransferModal.tsx
Archivo completo (362 líneas) - Ver documentación completa en archivo principal.

---

## 🎯 RESUMEN DE CAMBIOS

**Backend:**
- ✅ 1 import agregado
- ✅ 3 endpoints nuevos (~310 líneas)
- ✅ 1 helper module nuevo (280 líneas)
- ✅ 1 migración SQL (127 líneas)

**Frontend:**
- ✅ 1 import agregado
- ✅ 1 state agregado
- ✅ 1 botón agregado
- ✅ 1 modal agregado
- ✅ 1 componente nuevo (362 líneas)

**Total:** ~1100 líneas nuevas, 5 líneas modificadas
