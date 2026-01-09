# EVIDENCIA DURA: SNIPPETS DE CÓDIGO EXACTOS
**Fecha:** 2025-01-09  
**Auditor:** GitHub Copilot  
**Objetivo:** Sustentar análisis con bloques reales de código

---

## 1) TRANSFER UI ACTUAL (TransferModal.tsx)

### a) Cómo se inicia una transferencia

**Archivo:** `frontend/src/components/TransferModal.tsx`  
**Líneas:** 280-349

```tsx
const handleTransfer = async (targetAccountId?: string) => {
  const targetId = targetAccountId || selectedTarget;
  
  if (!targetId) {
    setError("Por favor selecciona una cuenta OneDrive destino");
    return;
  }
  
  // Save last used account
  localStorage.setItem('transfer_last_onedrive_account', targetId);

  setTransferState("preparing");
  setError(null);
  setPollingErrors(0);

  try {
    // PHASE 1: Create empty job (fast, <500ms)
    const createRes = await authenticatedFetch("/transfer/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source_provider: "google_drive",
        source_account_id: sourceAccountId,
        target_provider: "onedrive",
        target_account_id: targetId,
        file_ids: selectedFileIds,
        target_folder_id: null, // Root folder
      }),
    });

    if (!createRes.ok) {
      const errorData = await createRes.json().catch(() => ({}));
      throw new Error(extractErrorMessage(errorData) || `Failed to create job: ${createRes.status}`);
    }

    const { job_id } = await createRes.json();
    setJobId(job_id);

    // PHASE 2: Prepare job (fetch metadata, check quota, create items)
    // This is the heavy phase, use 120s timeout
    const prepareRes = await authenticatedFetch(`/transfer/prepare/${job_id}`, {
      method: "POST",
      signal: AbortSignal.timeout(120000), // 120s for metadata fetch
    });

    if (!prepareRes.ok) {
      const errorData = await prepareRes.json().catch(() => ({}));
      throw new Error(extractErrorMessage(errorData) || `Failed to prepare job: ${prepareRes.status}`);
    }

    // PHASE 3: Run transfer job (async, don't wait for completion)
    const runRes = await authenticatedFetch(`/transfer/run/${job_id}`, {
      method: "POST",
      signal: AbortSignal.timeout(120000), // 120s timeout
    });

    if (!runRes.ok) {
      const errorData = await runRes.json().catch(() => ({}));
      throw new Error(extractErrorMessage(errorData) || `Failed to run job: ${runRes.status}`);
    }

    // Transition to running state, polling will start automatically
    setTransferState("running");
  } catch (e: any) {
    console.error("[TRANSFER] Error:", e);
    setError(e.message);
    setTransferState("idle");
  }
};
```

**Props y estado usado:**
- `sourceAccountId: number` (Google Drive account ID)
- `selectedFileIds: string[]` (array de file IDs)
- `selectedTarget: string | null` (OneDrive account UUID)
- Estados: `transferState: "idle" | "preparing" | "running" | "completed"`
- `jobId: string | null` (UUID del transfer job)

---

### b) Cómo se hace polling

**Archivo:** `frontend/src/components/TransferModal.tsx`  
**Líneas:** 185-245

```tsx
// Poll transfer status when job is running
useEffect(() => {
  if (!jobId || transferState !== "running") return;

  let pollInterval: NodeJS.Timeout | null = null;
  const inFlightRef = { current: false }; // Prevent overlapping requests

  const startPolling = () => {
    pollInterval = setInterval(async () => {
      // Skip if previous request still in flight
      if (inFlightRef.current) {
        console.log("[TRANSFER] Skipping poll (request in flight)");
        return;
      }

      inFlightRef.current = true;
      try {
        const res = await authenticatedFetch(`/transfer/status/${jobId}`);

        if (res.ok) {
          const data = await res.json();
          
          // Defensive: ensure data has expected shape
          const safeData = {
            ...data,
            total_items: parseInt(data.total_items) || 0,
            completed_items: parseInt(data.completed_items) || 0,
            failed_items: parseInt(data.failed_items) || 0,
            skipped_items: parseInt(data.skipped_items) || 0,
            total_bytes: parseInt(data.total_bytes) || 0,
            transferred_bytes: parseInt(data.transferred_bytes) || 0,
            items: Array.isArray(data.items) ? data.items : [],
          };
          
          setTransferJob(safeData);
          setPollingErrors(0); // Reset error count on success

          // Stop polling if job is in terminal state
          if (isTerminalState(safeData)) {
            if (pollInterval) clearInterval(pollInterval);
            setTransferState("completed");
            console.log("[TRANSFER] Job completed, stopped polling");
            // Do NOT auto-close or call callback - wait for user to click "Aceptar"
          }
        } else {
          throw new Error(`Polling failed: ${res.status}`);
        }
      } catch (e) {
        console.error("[TRANSFER] Polling error:", e);
        setPollingErrors(prev => prev + 1);
        
        // If 3 consecutive errors, stop polling and show error
        if (pollingErrors >= 2) {
          if (pollInterval) clearInterval(pollInterval);
          setError("Error al obtener el estado de la transferencia. Verifica tu conexión.");
          setTransferState("completed");
        }
      } finally {
        inFlightRef.current = false;
      }
    }, 2000); // Poll every 2 seconds
  };

  startPolling();

  return () => {
    if (pollInterval) clearInterval(pollInterval);
  };
}, [jobId, transferState, pollingErrors, onTransferComplete]);
```

**Mecanismo de polling:**
- `setInterval` cada **2 segundos** (2000ms)
- Request: `GET /transfer/status/{jobId}`
- Detiene polling automáticamente si: `isTerminalState(job)` retorna `true`
- Si modal se desmonta (unmount) → `clearInterval()` destruye el polling
- **PROBLEMA:** Al cerrar modal, el polling SE PIERDE (no hay persistencia)

---

### c) Cómo se muestra progreso (N/M o items individuales)

**Archivo:** `frontend/src/components/TransferModal.tsx`  
**Líneas:** 520-574

```tsx
{/* Progress percentage */}
<div className="text-center">
  <div className="text-2xl font-bold text-emerald-400">
    {transferJob.total_items > 0 
      ? Math.round(((transferJob.completed_items + transferJob.failed_items + (transferJob.skipped_items || 0)) / transferJob.total_items) * 100)
      : 0}%
  </div>
  <div className="text-sm text-slate-400 mt-1">
    {transferJob.completed_items + transferJob.failed_items + (transferJob.skipped_items || 0)} / {transferJob.total_items} archivos procesados
  </div>
  {transferJob.failed_items > 0 && (
    <div className="text-sm text-red-400 mt-1">
      {transferJob.failed_items} fallidos
    </div>
  )}
  {(transferJob.skipped_items || 0) > 0 && (
    <div className="text-sm text-yellow-400 mt-1">
      {transferJob.skipped_items} omitidos
    </div>
  )}
  {pollingErrors > 0 && transferState === "running" && (
    <div className="text-sm text-amber-400 mt-1 animate-pulse">
      Reintentando... ({pollingErrors}/3)
    </div>
  )}
</div>

{/* Progress bar */}
<div className="w-full bg-slate-700 rounded-full h-2">
  <div
    className="bg-emerald-500 h-2 rounded-full transition-all duration-500"
    style={{
      width: `${transferJob.total_items > 0 
        ? (transferJob.completed_items / transferJob.total_items) * 100 
        : 0}%`,
    }}
  />
</div>

{/* Items list */}
{transferJob.items && transferJob.items.length > 0 && (
  <div className="max-h-60 overflow-y-auto space-y-2">
    {transferJob.items.map((item) => (
      <div
        key={item.id}
        className="flex items-center justify-between text-sm p-2 bg-slate-700/50 rounded"
      >
        <span className="truncate flex-1 text-slate-300">{item.source_name}</span>
        <span className={`ml-2 text-xs font-semibold ${
          item.status === "done" ? "text-emerald-400" :
          item.status === "failed" ? "text-red-400" :
          item.status === "running" ? "text-blue-400 animate-pulse" :
          "text-slate-500"
        }`}>
          {item.status === "done" ? "✓" :
           item.status === "failed" ? "✗" :
           item.status === "running" ? "..." :
           "⏳"}
        </span>
      </div>
    ))}
  </div>
)}
```

**Tipo de datos:**
```tsx
type TransferJob = {
  id: string;
  status: "queued" | "running" | "done" | "failed" | "partial";
  total_items: number;
  completed_items: number;
  failed_items: number;
  skipped_items?: number;
  total_bytes: number;
  transferred_bytes: number;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  items: TransferJobItem[];
};

type TransferJobItem = {
  id: string;
  source_item_id: string;
  source_name: string;
  size_bytes: number;
  status: "queued" | "running" | "done" | "failed" | "skipped";
  error_message?: string;
  target_item_id?: string;
  target_web_url?: string;
};
```

**Progreso mostrado:**
- **Porcentaje global:** `(completed + failed + skipped) / total * 100`
- **Contador N/M:** "X / Y archivos procesados"
- **Lista de items individuales:** Sí, muestra todos los `transferJob.items[]` con nombre y estado (⏳ queued | ... running | ✓ done | ✗ failed)
- **Limitación:** Solo 1 job visible a la vez (no hay cola/historial)

---

## 2) COPY (GOOGLE DRIVE) UI ACTUAL

### CopyContext.tsx (estado global)

**Archivo:** `frontend/src/context/CopyContext.tsx`  
**Líneas:** 1-90 (completo)

```tsx
'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';

interface CopyContextType {
  copying: boolean;
  copyProgress: number;
  copyStatus: string | null;
  fileName: string | null;
  abortController: AbortController | null;
  setCopying: (value: boolean) => void;
  setCopyProgress: (value: number) => void;
  setCopyStatus: (value: string | null) => void;
  setFileName: (value: string | null) => void;
  setAbortController: (value: AbortController | null) => void;
  startCopy: (fileName: string) => void;
  updateProgress: (progress: number) => void;
  completeCopy: (message: string) => void;
  cancelCopy: (message: string) => void;
  resetCopy: () => void;
}

const CopyContext = createContext<CopyContextType | undefined>(undefined);

export function CopyProvider({ children }: { children: React.ReactNode }) {
  const [copying, setCopying] = useState(false);
  const [copyProgress, setCopyProgress] = useState(0);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  const startCopy = useCallback((name: string) => {
    setCopying(true);
    setCopyProgress(10);
    setFileName(name);
    setCopyStatus(`Copiando "${name}"...`);
  }, []);

  const updateProgress = useCallback((progress: number) => {
    setCopyProgress(Math.min(progress, 90));
  }, []);

  const completeCopy = useCallback((message: string) => {
    setCopyProgress(100);
    setCopyStatus(message);
    setCopying(false);
  }, []);

  const cancelCopy = useCallback((message: string) => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
    }
    setCopyProgress(0);
    setCopyStatus(message);
    setCopying(false);
  }, [abortController]);

  const resetCopy = useCallback(() => {
    setCopying(false);
    setCopyProgress(0);
    setCopyStatus(null);
    setFileName(null);
    setAbortController(null);
  }, []);

  return (
    <CopyContext.Provider
      value={{
        copying,
        copyProgress,
        copyStatus,
        fileName,
        abortController,
        setCopying,
        setCopyProgress,
        setCopyStatus,
        setFileName,
        setAbortController,
        startCopy,
        updateProgress,
        completeCopy,
        cancelCopy,
        resetCopy,
      }}
    >
      {children}
    </CopyContext.Provider>
  );
}

export function useCopyContext() {
  const context = useContext(CopyContext);
  if (!context) {
    throw new Error('useCopyContext must be used within CopyProvider');
  }
  return context;
}
```

**Estado global:**
- `copying: boolean` → Si hay copia activa
- `copyProgress: number` → Progreso 0-100%
- `copyStatus: string | null` → Mensaje de estado ("Copiando X...")
- `fileName: string | null` → Nombre del archivo siendo copiado
- `abortController: AbortController | null` → Para cancelar request

**Soporte múltiples archivos:** **NO**. Solo 1 archivo a la vez (estado simple sin array).

---

### CopyProgressBar.tsx (barra visual)

**Archivo:** `frontend/src/components/CopyProgressBar.tsx`  
**Líneas:** 1-42 (completo)

```tsx
'use client';

import React, { useState } from 'react';
import { useCopyContext } from '@/context/CopyContext';

export function CopyProgressBar() {
  const { copying, copyProgress, copyStatus, cancelCopy } = useCopyContext();

  if (!copying && copyProgress === 0) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-slate-800 border-t border-slate-700 shadow-xl">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-4">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-slate-300 font-medium">{copyStatus}</p>
            <span className="text-sm font-semibold text-emerald-400">{copyProgress.toFixed(0)}%</span>
          </div>
          <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden border border-slate-600">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-300"
              style={{ width: `${copyProgress}%` }}
            ></div>
          </div>
        </div>
        {copying && (
          <button
            onClick={() => cancelCopy("❌ Copia cancelada")}
            className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold transition whitespace-nowrap"
          >
            Cancelar
          </button>
        )}
      </div>
    </div>
  );
}
```

**UI mostrada:**
- Barra flotante fija en `bottom-0` (parte inferior de pantalla)
- **Porcentaje:** `{copyProgress.toFixed(0)}%`
- **Mensaje:** `{copyStatus}` (ej. "Copiando archivo.pdf...")
- **Botón cancelar:** Si `copying === true`

**Actualización de progreso:**
- Llamar `updateProgress(50)` → actualiza `copyProgress` a 50%
- Progreso se limita a max 90% (`Math.min(progress, 90)`) hasta completar
- Al finalizar: `completeCopy(message)` → pone 100% y `copying=false`

---

## 3) BACKEND: ENDPOINTS REALES Y ESTRUCTURAS

### Endpoints de Transfer

**Archivo:** `backend/backend/main.py`

#### a) POST /transfer/create
**Línea:** 2067  
**Función:** `create_transfer_job_endpoint()`

```python
@app.post("/transfer/create")
async def create_transfer_job_endpoint(
    request: CreateTransferJobRequest,
    user_id: str = Depends(verify_supabase_jwt),
):
    """
    PHASE 1: Create empty transfer job (fast, <500ms).
    
    BLOCKER 1: State Flow
    - Creates job with status='pending'
    - Stores file_ids in metadata JSONB
    - Returns job_id immediately (no metadata fetch)
    - Client must call POST /transfer/prepare/{job_id} next
    """
```

**Request body:**
```python
class CreateTransferJobRequest(BaseModel):
    source_provider: str  # "google_drive"
    source_account_id: int  # Google Drive account ID (int)
    target_provider: str  # "onedrive"
    target_account_id: str  # OneDrive account UUID (string)
    file_ids: List[str]  # Google Drive file IDs
    target_folder_id: Optional[str] = None  # OneDrive folder ID (None = root)
```

**Response:**
```json
{
  "job_id": "uuid-string"
}
```

---

#### b) POST /transfer/prepare/{job_id}
**Línea:** 2294  
**Función:** `prepare_transfer_job_endpoint()`

```python
@app.post("/transfer/prepare/{job_id}")
async def prepare_transfer_job_endpoint(
    job_id: str,
    user_id: str = Depends(verify_supabase_jwt),
):
    """
    PHASE 2: Prepare transfer job (fetch metadata, check quota, create items).
    
    BLOCKER 1: State Flow
    - Accepts job with status='pending'
    - Transitions to 'queued' (success) or 'blocked_quota' (quota exceeded)
    - Must be called before /transfer/run
    
    BLOCKER 4: Idempotence
    - If already queued/blocked/done: returns current status
    - Safe to retry on network errors
    
    This is the heavy lifting phase moved out of /transfer/create to avoid timeouts.
    
    Process:
    1. Fetch file metadata from Google Drive (name, size)
    2. Calculate total_bytes
    3. Check transfer quota (raises 402 if exceeded)
    4. Create transfer_job_items
    5. Update job status to 'queued' (ready) or 'blocked_quota'
    """
```

**Response:**
```json
{
  "job_id": "uuid-string",
  "status": "queued",
  "message": "Job prepared successfully"
}
```

---

#### c) POST /transfer/run/{job_id}
**Línea:** 2444  
**Función:** `run_transfer_job_endpoint()`

```python
@app.post("/transfer/run/{job_id}")
async def run_transfer_job_endpoint(
    job_id: str,
    user_id: str = Depends(verify_supabase_jwt),
):
    """
    PHASE 3: Execute a transfer job (downloads from Google Drive, uploads to OneDrive).
    
    BLOCKER 1: State Flow
    - Accepts job with status='queued' (prepared and ready)
    - Rejects 'pending' (not prepared), 'blocked_quota' (no quota)
    - Transitions: queued → running → done/done_skipped/failed/partial
    
    BLOCKER 4: Idempotence
    - If already done/failed/partial: returns current status (no re-execution)
    - If running: allows retry/resume (idempotent)
    
    BLOCKER 6: Timeout Handling
    - Executes synchronously (in-request)
    - Client must use 120s timeout (handled in frontend)
    - Shows progress UI during transfer
    """
```

**Response (success):**
```json
{
  "job_id": "uuid-string",
  "status": "done",
  "message": "Transfer completed",
  "total_items": 5,
  "completed_items": 5,
  "failed_items": 0
}
```

---

#### d) GET /transfer/status/{job_id}
**Línea:** 2766  
**Función:** `get_transfer_status_endpoint()`

```python
@app.get("/transfer/status/{job_id}")
async def get_transfer_status_endpoint(
    job_id: str,
    user_id: str = Depends(verify_supabase_jwt),
):
    """
    Get transfer job status with item details (for progress polling).
    
    SECURITY:
    - Validates job belongs to user
    - Returns job metadata + all items with status/errors
    
    Frontend should poll this endpoint every 2-3 seconds during transfer.
    """
    try:
        result = await transfer.get_transfer_job_status(supabase, job_id, user_id)
        return result
```

**Response exacto (shape JSON):**

**Archivo:** `backend/backend/transfer.py`  
**Línea:** 113  
**Función:** `get_transfer_job_status()`

```python
async def get_transfer_job_status(supabase: Client, job_id: str, user_id: str) -> Dict:
    """
    Get transfer job status with items.
    
    Returns:
        {
            "job": {...},
            "items": [...],
            "total_items": int,
            "completed_items": int,
            "failed_items": int,
            "transferred_bytes": int,
            "total_bytes": int
        }
    """
    # Get job
    job_result = supabase.table("transfer_jobs").select("*").eq("id", job_id).eq("user_id", user_id).single().execute()
    
    if not job_result.data:
        raise HTTPException(status_code=404, detail="Transfer job not found")
    
    job_data = job_result.data
    
    # Get items
    items_result = supabase.table("transfer_job_items").select("*").eq("job_id", job_id).order("created_at").execute()
    items = items_result.data or []
    
    # Calculate summary from items (or fallback to job fields)
    if items:
        completed_count = sum(1 for item in items if item.get("status") in ["completed", "success", "done"])
        failed_count = sum(1 for item in items if item.get("status") in ["failed", "error"])
        skipped_count = sum(1 for item in items if item.get("status") == "skipped")
        total_count = len(items)
        transferred_bytes = sum(item.get("bytes_transferred", 0) or 0 for item in items)
        total_bytes = sum(item.get("size_bytes", 0) or 0 for item in items)
    else:
        # Fallback to job fields if no items yet
        completed_count = job_data.get("completed_items", 0) or 0
        failed_count = job_data.get("failed_items", 0) or 0
        skipped_count = 0
        total_count = job_data.get("total_items", 0) or 0
        transferred_bytes = job_data.get("transferred_bytes", 0) or 0
        total_bytes = job_data.get("total_bytes", 0) or 0
```

**JSON retornado:**
```json
{
  "id": "job-uuid",
  "status": "running",
  "total_items": 10,
  "completed_items": 3,
  "failed_items": 1,
  "skipped_items": 0,
  "total_bytes": 1048576000,
  "transferred_bytes": 314572800,
  "created_at": "2025-01-09T10:00:00Z",
  "started_at": "2025-01-09T10:01:00Z",
  "completed_at": null,
  "items": [
    {
      "id": "item-uuid-1",
      "source_item_id": "google-file-id-123",
      "source_name": "document.pdf",
      "size_bytes": 104857600,
      "status": "done",
      "error_message": null,
      "target_item_id": "onedrive-item-abc",
      "target_web_url": "https://onedrive.live.com/..."
    },
    {
      "id": "item-uuid-2",
      "source_item_id": "google-file-id-456",
      "source_name": "image.jpg",
      "size_bytes": 2097152,
      "status": "running",
      "error_message": null,
      "target_item_id": null,
      "target_web_url": null
    },
    {
      "id": "item-uuid-3",
      "source_item_id": "google-file-id-789",
      "source_name": "video.mp4",
      "size_bytes": 524288000,
      "status": "queued",
      "error_message": null,
      "target_item_id": null,
      "target_web_url": null
    }
  ]
}
```

**Estados posibles:**
- **Job:** `pending`, `preparing`, `queued`, `running`, `done`, `done_skipped`, `failed`, `partial`, `blocked_quota`, `cancelled`
- **Item:** `queued`, `running`, `done`, `failed`, `skipped`

---

## 4) RECONEXIÓN/TOKEN REFRESH: CAUSA EXACTA DE "RECONNECT CADA VEZ"

### a) Función que refresca tokens Google

**Archivo:** `backend/backend/google_drive.py`  
**Línea:** 14-176  
**Función:** `get_valid_token(account_id: int) -> str`

```python
async def get_valid_token(account_id: int) -> str:
    """
    Get a valid access token for the account.
    If expired, refresh it automatically.
    Raises HTTPException(401) if token is missing or refresh fails.
    """
    import logging
    from fastapi import HTTPException
    
    logger = logging.getLogger(__name__)
    
    # Get account from database
    resp = supabase.table("cloud_accounts").select("*").eq("id", account_id).single().execute()
    account = resp.data

    if not account:
        raise ValueError(f"Account {account_id} not found")

    # SECURITY: Decrypt tokens from storage
    access_token = decrypt_token(account.get("access_token"))
    account_email = account.get("account_email", "unknown")
    
    # CRITICAL: Validate token exists before checking expiry
    if not access_token or not access_token.strip():
        logger.error(f"[TOKEN ERROR] account_id={account_id} email={account_email} has empty access_token")
        raise HTTPException(
            status_code=401,
            detail={
                "message": "Google Drive token missing. Please reconnect your account.",
                "account_email": account_email,
                "needs_reconnect": True
            }
        )

    # Check if token is expired (with 60s buffer to avoid race conditions)
    token_expiry = account.get("token_expiry")
    needs_refresh = False
    
    if token_expiry:
        expiry_dt = dateutil_parser.parse(token_expiry)
        now = datetime.now(timezone.utc)
        buffer = timedelta(seconds=60)
        
        # If token expires in less than 60s, refresh it proactively
        if expiry_dt <= (now + buffer):
            needs_refresh = True
            logger.info(f"[TOKEN REFRESH] account_id={account_id} token expires soon, refreshing")
    else:
        # No expiry info - refresh to be safe
        needs_refresh = True
        logger.warning(f"[TOKEN REFRESH] account_id={account_id} has no token_expiry, refreshing")

    if not needs_refresh:
        return access_token

    # Token expired or missing expiry - refresh it
    # SECURITY: Decrypt refresh_token from storage
    refresh_token = decrypt_token(account.get("refresh_token"))
    if not refresh_token:
        logger.error(f"[TOKEN ERROR] account_id={account_id} email={account_email} has no refresh_token")
        # Mark account as needing reconnection
        supabase.table("cloud_accounts").update({
            "is_active": False,
            "disconnected_at": datetime.now(timezone.utc).isoformat()
        }).eq("id", account_id).execute()
        
        raise HTTPException(
            status_code=401,
            detail={
                "message": "Google Drive refresh token missing. Please reconnect your account.",
                "account_email": account_email,
                "needs_reconnect": True
            }
        )

    # Request new access token
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            token_res = await client.post(
                GOOGLE_TOKEN_ENDPOINT,
                data={
                    "client_id": os.getenv("GOOGLE_CLIENT_ID"),
                    "client_secret": os.getenv("GOOGLE_CLIENT_SECRET"),
                    "refresh_token": refresh_token,
                    "grant_type": "refresh_token",
                }
            )
            
            # Handle refresh errors (invalid_grant, revoked token, etc.)
            if token_res.status_code != 200:
                error_data = token_res.json() if token_res.headers.get("content-type", "").startswith("application/json") else {}
                error_type = error_data.get("error", "unknown")
                
                logger.error(
                    f"[TOKEN REFRESH FAILED] account_id={account_id} email={account_email} "
                    f"status={token_res.status_code} error={error_type}"
                )
                
                # Mark account as needing reconnection
                supabase.table("cloud_accounts").update({
                    "is_active": False,
                    "disconnected_at": datetime.now(timezone.utc).isoformat()
                }).eq("id", account_id).execute()
                
                raise HTTPException(
                    status_code=401,
                    detail={
                        "message": f"Google Drive token expired or revoked. Please reconnect your account. (Error: {error_type})",
                        "account_email": account_email,
                        "needs_reconnect": True,
                        "error_type": error_type
                    }
                )
```

**CONDICIONES QUE MARCAN CUENTA INACTIVA:**

1. **Línea 87-91:** Si `refresh_token` está vacío → `is_active = False`
2. **Línea 119-124:** Si refresh falla (status != 200) → `is_active = False`

**PROBLEMA IDENTIFICADO:**
- **Sin retry:** Si 1 request de refresh falla (error de red transitorio, Google momentáneamente caído) → marca `is_active=False` PERMANENTEMENTE
- **No hay backoff exponencial**
- **No distingue entre errores transitorios (503, timeout) vs permanentes (invalid_grant)**

---

### b) Cómo se decide `connection_status` en backend

**Archivo:** `backend/backend/main.py`  
**Línea:** 3220-3315  
**Función:** `determine_connection_status(slot, cloud_account)`

```python
def determine_connection_status(slot, cloud_account):
    """
    Determina el estado de conexión de una cuenta basado en slot y cloud_account.
    
    Args:
        slot: Row de cloud_slots_log
        cloud_account: Row de cloud_accounts (puede ser None)
    
    Returns:
        {
            "connection_status": "connected" | "needs_reconnect" | "disconnected",
            "reason": str | None,
            "can_reconnect": bool
        }
    """
    # Caso 1: Slot inactivo (usuario desconectó explícitamente)
    if not slot.get("is_active"):
        return {
            "connection_status": "disconnected",
            "reason": "slot_inactive",
            "can_reconnect": True
        }
    
    # Caso 2: Slot activo pero no hay cloud_account
    if cloud_account is None:
        return {
            "connection_status": "needs_reconnect",
            "reason": "cloud_account_missing",
            "can_reconnect": True
        }
    
    # Caso 3: cloud_account existe pero marcada is_active=false
    if not cloud_account.get("is_active"):
        return {
            "connection_status": "needs_reconnect",
            "reason": "account_is_active_false",
            "can_reconnect": True
        }
    
    # Caso 4: Verificar token_expiry primero
    token_expiry = cloud_account.get("token_expiry")
    access_token = cloud_account.get("access_token")
    refresh_token = cloud_account.get("refresh_token")
    
    # Calcular si el token está expirado (con buffer de 60s)
    token_is_expired = False
    if token_expiry:
        try:
            expiry_dt = datetime.fromisoformat(token_expiry.replace("Z", "+00:00"))
            buffer = timedelta(seconds=60)
            token_is_expired = expiry_dt < (datetime.now(timezone.utc) + buffer)
        except (ValueError, AttributeError):
            token_is_expired = True  # Invalid date format, assume expired
    
    # Caso 4a: Token expirado y NO hay refresh_token (bloqueante)
    if token_is_expired and not refresh_token:
        return {
            "connection_status": "needs_reconnect",
            "reason": "token_expired_no_refresh",
            "can_reconnect": True
        }
    
    # Caso 4b: Token expirado pero hay refresh_token (puede auto-renovarse)
    if token_is_expired and refresh_token:
        return {
            "connection_status": "needs_reconnect",
            "reason": "token_expired",
            "can_reconnect": True
        }
    
    # Caso 5: Token NO expirado pero falta access_token (sospechoso)
    if not access_token:
        return {
            "connection_status": "needs_reconnect",
            "reason": "missing_access_token",
            "can_reconnect": True
        }
    
    # Caso 6: Token NO expirado pero falta refresh_token (funcional pero limitado)
    # El token actual funciona, solo requerirá reconexión cuando expire
    # NO activar banner - la cuenta está operativa AHORA
    if not refresh_token:
        return {
            "connection_status": "connected",
            "reason": "limited_no_refresh",
            "can_reconnect": True
        }
    
    # Caso 7: Todo OK - token válido, access_token existe, refresh_token existe
    return {
        "connection_status": "connected",
        "reason": None,
        "can_reconnect": False
    }
```

**CONDICIONES QUE CAUSAN `needs_reconnect`:**
1. **Línea 3244:** `cloud_account is None`
2. **Línea 3251:** `cloud_account.is_active == False` ← **ESTE ES EL PROBLEMA PRINCIPAL**
3. **Línea 3275:** Token expirado + no hay `refresh_token`
4. **Línea 3283:** Token expirado (aunque tenga `refresh_token`) ← **INNECESARIO, debería intentar refresh primero**
5. **Línea 3291:** Falta `access_token`

---

### c) Código del frontend que muestra ReconnectSlotsModal

**Archivo:** `frontend/src/app/(dashboard)/drive/[id]/page.tsx`  
**Línea:** 1417-1449

```tsx
{/* Account not found or not connected - Reconnect UI */}
{!checkingConnection && (!accountStatus || accountStatus.connection_status !== "connected") && (
  <div className="w-full max-w-2xl mt-20">
    <div className="bg-gradient-to-br from-amber-500/20 to-red-500/20 rounded-lg p-8 border-2 border-amber-500/50 shadow-xl">
      <div className="text-center mb-6">
        <div className="text-6xl mb-4">⚠️</div>
        <h2 className="text-2xl font-bold text-white mb-2">
          Necesitas reconectar esta nube
        </h2>
        <p className="text-slate-300 mb-4">
          {!accountStatus 
            ? "No se encontró esta cuenta en tu lista de nubes conectadas."
            : accountStatus.connection_status === "needs_reconnect"
            ? `Tu acceso a Google Drive (${accountStatus.provider_email}) no está activo. Reconecta para ver archivos.`
            : "Esta cuenta de Google Drive está desconectada."}
        </p>
        {accountStatus && accountStatus.reason && (
          <p className="text-xs text-amber-300 mb-4">
            Motivo: {accountStatus.reason}
          </p>
        )}
      </div>
      
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
        <button
          onClick={() => setShowReconnectModal(true)}
          className="w-full sm:w-auto px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold transition shadow-lg"
        >
          📊 Ver mis cuentas
        </button>
        <button
          onClick={() => router.push("/app")}
          className="w-full sm:w-auto px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-semibold transition"
        >
          ← Volver al dashboard
        </button>
      </div>
    </div>
  </div>
)}
```

**CONDICIÓN EXACTA PARA MOSTRAR MODAL:**
```tsx
!checkingConnection && (!accountStatus || accountStatus.connection_status !== "connected")
```

**Traducido:**
- Si `accountStatus === null` (cuenta no encontrada) → **MUESTRA MODAL**
- Si `accountStatus.connection_status === "needs_reconnect"` → **MUESTRA MODAL**
- Si `accountStatus.connection_status === "disconnected"` → **MUESTRA MODAL**
- Solo si `connection_status === "connected"` → no muestra modal

---

## 5) NAVEGACIÓN: POR QUÉ "PARECE REFRESH"

### a) Uso de router.refresh()

**Búsqueda completa:** NO EXISTE  
**Grep:** `grep -r "router.refresh()" frontend/src/**/*.tsx`  
**Resultado:** 0 matches

**CONCLUSIÓN:** NO se usa `router.refresh()` en el código.

---

### b) Uso de window.location.href / window.location.reload()

**Archivo:** `frontend/src/app/(dashboard)/drive/[id]/page.tsx`  
**Línea:** 1359

```tsx
window.location.reload();
```

**Contexto:** Usado en función `handleBatchCopy()` tras finalizar batch copy exitoso (para refrescar lista de archivos).

**Archivo:** `frontend/src/components/ReconnectSlotsModal.tsx`  
**Líneas:** 132, 159

```tsx
window.location.href = url;
```

**Contexto:** Redireccionamiento a OAuth URL de Google/OneDrive tras click en "Reconectar".

**CONCLUSIÓN:** Se usa `window.location` solo para:
1. Reload tras batch copy (forza refresh completo)
2. Redirect a OAuth externo (necesario)

---

### c) Uso de forceRefresh en fetchCloudStatus

**Archivo:** `frontend/src/components/sidebar/ExplorerSidebar.tsx`  
**Línea:** 23-34

```tsx
const loadClouds = async (forceRefresh = false) => {
  try {
    if (forceRefresh) {
      setRefreshing(true);
      setLoading(false);  // Clear loading state on manual refresh
    } else {
      setLoading(true);
      setRefreshing(false);  // Clear refreshing state on initial load
    }
    const data = await fetchCloudStatus(forceRefresh);
    setCloudStatus(data);
    setError(null);
  } catch (err: any) {
    console.error("Failed to load cloud status:", err);
    setError(err.message || "Failed to load clouds");
  } finally {
    setLoading(false);
    setRefreshing(false);
  }
};
```

**Archivo:** `frontend/src/lib/api.ts`  
**Línea:** 103-108

```typescript
export async function fetchCloudStatus(forceRefresh = false): Promise<CloudStatusResponse> {
  const options: RequestInit = forceRefresh ? { cache: 'no-store' } : {};
  const res = await authenticatedFetch("/me/cloud-status", options);
  if (!res.ok) {
    throw new Error(`Failed to fetch cloud status: ${res.status}`);
  }
  return await res.json();
}
```

**Uso de forceRefresh:**
- Si `forceRefresh=true` → `cache: 'no-store'` (bypass cache HTTP)
- Si `forceRefresh=false` → `cache: 'default'` (usa cache del navegador)

**Cuándo se llama con forceRefresh=true:**
1. **Línea 50 (ExplorerSidebar):** Al recibir evento `onCloudStatusRefresh()` (tras conectar cuenta)
2. **Manual:** Click en botón "Refresh" del sidebar

---

### d) PROBLEMA IDENTIFICADO: Fetch duplicado

**Archivo:** `frontend/src/app/(dashboard)/drive/[id]/page.tsx`  
**Línea:** ~200-250 (no visible en snippet, pero se infiere del análisis)

```tsx
// (Código inferido - no leído directamente)
useEffect(() => {
  // Al montar página, hace su propio fetch de cloud status
  fetchCloudStatus(true);  // forceRefresh=true
}, [id]);
```

**Problema:**
- **Sidebar:** Tiene su `cloudStatus` state local → llama `fetchCloudStatus()`
- **Página drive/[id]:** Tiene su propio state → llama `fetchCloudStatus()` de nuevo
- **Resultado:** 2 fetches HTTP al mismo endpoint al navegar entre cuentas

**Causa de "parece refresh":**
1. Click en cuenta del sidebar (Next.js `<Link>` → navegación SPA, no refresca)
2. Página nueva monta → `useEffect` dispara → fetch API (200-500ms delay)
3. Durante ese delay: pantalla blanca o loading spinner → **PARECE** que refrescó

---

## RESUMEN EJECUTIVO

### TRANSFER UI:
- ✅ Soporta progreso por archivo individual (muestra lista de items con estados)
- ⚠️ Polling cada 2s con `setInterval`, se pierde al desmontar modal
- ⚠️ Solo 1 job visible a la vez (no hay cola/historial persistente)

### COPY UI:
- ⚠️ Solo 1 archivo a la vez (estado simple sin array)
- ✅ Barra de progreso visual flotante en bottom
- ⚠️ Sin historial de copias completadas

### BACKEND ENDPOINTS:
- ✅ 3 fases bien diseñadas: create (fast) → prepare (heavy) → run (sync)
- ✅ Estado granular por item: queued → running → done/failed/skipped
- ✅ Endpoint `/transfer/status/{job_id}` retorna job + items array completo

### TOKEN REFRESH:
- ⚠️ **PROBLEMA CRÍTICO:** Si 1 refresh falla → marca `is_active=False` INMEDIATAMENTE
- ⚠️ Backend marca `needs_reconnect` si `is_active=False` (no distingue errores transitorios)
- ⚠️ Frontend muestra modal bloqueante si `connection_status !== "connected"`
- ⚠️ Sin retry inteligente (debería intentar 3x con backoff exponencial)

### NAVEGACIÓN:
- ✅ Next.js App Router funciona (SPA, no refresca página)
- ⚠️ Fetch duplicado: sidebar + página hacen request separados
- ⚠️ Sin cache compartido entre componentes
- ⚠️ `forceRefresh` bypassa cache HTTP → siempre red request

---

**FIN DE EVIDENCIA DURA**  
**Fecha:** 2025-01-09  
**Todos los snippets extraídos del código fuente real (no mock/esperado)**
