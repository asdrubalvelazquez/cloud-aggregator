# FASE 1: Cross-Provider Transfer (Google Drive → OneDrive)

## 📋 RESUMEN EJECUTIVO

Se implementó sistema completo de transferencia entre providers con:
- **Backend**: 3 endpoints REST + helper module + migración SQL
- **Frontend**: Modal de transferencia con selector de cuenta OneDrive + polling de progreso
- **Arquitectura**: Job queue con tracking item-by-item (partial success support)
- **Patrón**: Create job → Run job (in-request) → Poll status (no background workers)

---

## 🗄️ 1. MIGRACIÓN SQL

### Archivo: `backend/migrations/add_cross_provider_transfer.sql`

```sql
-- Cross-Provider Transfer System (Phase 1: Google Drive → OneDrive)

-- Transfer Jobs Table
CREATE TABLE IF NOT EXISTS transfer_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Source and target configuration
    source_provider TEXT NOT NULL, -- 'google_drive'
    source_account_id INTEGER NOT NULL REFERENCES cloud_accounts(id) ON DELETE CASCADE,
    target_provider TEXT NOT NULL, -- 'onedrive'
    target_account_id INTEGER NOT NULL REFERENCES cloud_accounts(id) ON DELETE CASCADE,
    target_folder_id TEXT, -- OneDrive folder ID (NULL = root)
    
    -- Job status tracking
    status TEXT NOT NULL DEFAULT 'queued', -- queued, running, done, failed, partial
    total_items INTEGER NOT NULL CHECK (total_items > 0),
    completed_items INTEGER NOT NULL DEFAULT 0 CHECK (completed_items >= 0),
    failed_items INTEGER NOT NULL DEFAULT 0 CHECK (failed_items >= 0),
    
    -- Bandwidth tracking
    total_bytes BIGINT NOT NULL DEFAULT 0 CHECK (total_bytes >= 0),
    transferred_bytes BIGINT NOT NULL DEFAULT 0 CHECK (transferred_bytes >= 0),
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    
    -- Constraints
    CHECK (started_at IS NULL OR started_at >= created_at),
    CHECK (completed_at IS NULL OR completed_at >= created_at),
    CHECK (completed_items + failed_items <= total_items)
);

COMMENT ON TABLE transfer_jobs IS 'Cross-provider file transfer jobs (Phase 1: Google Drive → OneDrive)';
COMMENT ON COLUMN transfer_jobs.status IS 'queued=pending, running=in progress, done=all success, failed=all failed, partial=some failed';

-- Transfer Job Items Table (individual files)
CREATE TABLE IF NOT EXISTS transfer_job_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_job_id UUID NOT NULL REFERENCES transfer_jobs(id) ON DELETE CASCADE,
    
    -- File identification
    source_item_id TEXT NOT NULL, -- Google Drive file ID
    file_name TEXT NOT NULL,
    size_bytes BIGINT NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
    
    -- Transfer status
    status TEXT NOT NULL DEFAULT 'queued', -- queued, running, done, failed
    error_message TEXT,
    target_item_id TEXT, -- OneDrive item ID (populated on success)
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    
    CHECK (started_at IS NULL OR started_at >= created_at),
    CHECK (completed_at IS NULL OR completed_at >= created_at)
);

COMMENT ON TABLE transfer_job_items IS 'Individual file items within a transfer job (for partial success tracking)';

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_transfer_jobs_user_id ON transfer_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_transfer_jobs_status ON transfer_jobs(status);
CREATE INDEX IF NOT EXISTS idx_transfer_jobs_created_at ON transfer_jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_transfer_job_items_job_id ON transfer_job_items(transfer_job_id);
CREATE INDEX IF NOT EXISTS idx_transfer_job_items_status ON transfer_job_items(status);

-- Verification query
DO $$
DECLARE
    transfer_jobs_count INTEGER;
    transfer_job_items_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO transfer_jobs_count FROM transfer_jobs;
    SELECT COUNT(*) INTO transfer_job_items_count FROM transfer_job_items;
    
    RAISE NOTICE 'Migration completed successfully!';
    RAISE NOTICE 'transfer_jobs: % rows', transfer_jobs_count;
    RAISE NOTICE 'transfer_job_items: % rows', transfer_job_items_count;
END $$;
```

**Aplicar migración:**
```bash
# En Supabase Dashboard > SQL Editor
# Pegar contenido de add_cross_provider_transfer.sql y ejecutar
```

---

## 🐍 2. BACKEND

### 2.1 Helper Module: `backend/backend/transfer.py`

**Creado nuevo archivo** con 8 funciones async:

```python
# Key functions (280 lines total):

async def create_transfer_job(
    user_id: str,
    source_provider: str,
    source_account_id: int,
    target_provider: str,
    target_account_id: int,
    target_folder_id: Optional[str],
    total_items: int,
    total_bytes: int
) -> UUID:
    """Creates a new transfer job and returns job_id"""

async def create_transfer_job_items(
    job_id: UUID,
    items: List[Dict[str, Any]]
) -> None:
    """Batch insert transfer job items"""

async def get_transfer_job_status(
    job_id: str,
    user_id: str
) -> dict:
    """Get job status with all items (for polling). Validates ownership."""

async def update_job_status(
    job_id: str,
    status: Optional[str] = None,
    increment_completed: bool = False,
    increment_failed: bool = False,
    add_transferred_bytes: Optional[int] = None,
    started_at: bool = False,
    completed_at: bool = False
) -> None:
    """Atomically update job counters"""

async def update_item_status(
    item_id: str,
    status: Optional[str] = None,
    error_message: Optional[str] = None,
    target_item_id: Optional[str] = None,
    started_at: bool = False,
    completed_at: bool = False
) -> None:
    """Update individual item status"""

async def upload_to_onedrive_chunked(
    access_token: str,
    file_name: str,
    file_data: bytes,
    folder_id: str = "root"
) -> dict:
    """
    Upload file to OneDrive using chunked upload session (10MB chunks).
    Returns OneDrive item metadata.
    
    Pattern:
    1. Create upload session: POST /drive/{folder_id}:/file.txt:/createUploadSession
    2. Upload chunks: PUT {uploadUrl} with Content-Range header
    3. OneDrive returns item metadata on final chunk
    """
```

### 2.2 REST Endpoints: `backend/backend/main.py`

**Agregado al final de imports:**
```python
from backend import transfer
```

**3 nuevos endpoints:**

#### POST /transfer/create
```python
class CreateTransferJobRequest(BaseModel):
    source_provider: str  # "google_drive"
    source_account_id: int
    target_provider: str  # "onedrive"
    target_account_id: int
    file_ids: List[str]  # Google Drive file IDs
    target_folder_id: Optional[str] = None

@app.post("/transfer/create")
async def create_transfer_job_endpoint(
    request: CreateTransferJobRequest,
    user_id: str = Depends(verify_supabase_jwt),
):
    """
    Creates transfer job + items.
    
    Security:
    - Validates both accounts belong to user
    - Fetches Google Drive file metadata (name + size)
    
    Returns: {"job_id": "uuid"}
    """
```

**Ejemplo request:**
```json
POST /transfer/create
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "source_provider": "google_drive",
  "source_account_id": 123,
  "target_provider": "onedrive",
  "target_account_id": 456,
  "file_ids": ["1abc...", "2def..."],
  "target_folder_id": null
}
```

**Ejemplo response:**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

#### POST /transfer/run/{job_id}
```python
@app.post("/transfer/run/{job_id}")
async def run_transfer_job_endpoint(
    job_id: str,
    user_id: str = Depends(verify_supabase_jwt),
):
    """
    Executes transfer job (downloads from Google, uploads to OneDrive).
    
    Security:
    - Validates job belongs to user
    - Only runs jobs with status='queued'
    
    Process:
    1. Load job + items
    2. Get Google Drive token (refresh if needed)
    3. Get OneDrive token (decrypt + refresh if 401)
    4. For each item:
       - Download from Google Drive (alt=media)
       - Upload to OneDrive (chunked, 10MB chunks)
       - Update item status (done/failed)
       - Update job counters
    5. Determine final job status (done/failed/partial)
    
    NOTE: Executes in-request (no background worker).
    """
```

**Ejemplo response:**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "done",
  "total_items": 5,
  "completed_items": 5,
  "failed_items": 0
}
```

#### GET /transfer/status/{job_id}
```python
@app.get("/transfer/status/{job_id}")
async def get_transfer_status_endpoint(
    job_id: str,
    user_id: str = Depends(verify_supabase_jwt),
):
    """
    Get job status with item details (for progress polling).
    
    Security: Validates job belongs to user
    
    Frontend should poll every 2-3 seconds during transfer.
    """
```

**Ejemplo response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "user_id": "user-uuid",
  "source_provider": "google_drive",
  "source_account_id": 123,
  "target_provider": "onedrive",
  "target_account_id": 456,
  "status": "running",
  "total_items": 5,
  "completed_items": 3,
  "failed_items": 1,
  "total_bytes": 50000000,
  "transferred_bytes": 30000000,
  "created_at": "2024-01-15T10:00:00Z",
  "started_at": "2024-01-15T10:00:05Z",
  "completed_at": null,
  "items": [
    {
      "id": "item-uuid-1",
      "source_item_id": "google-file-id-1",
      "file_name": "document.pdf",
      "size_bytes": 10000000,
      "status": "done",
      "error_message": null,
      "target_item_id": "onedrive-item-id-1",
      "created_at": "2024-01-15T10:00:00Z"
    },
    {
      "id": "item-uuid-2",
      "source_item_id": "google-file-id-2",
      "file_name": "image.jpg",
      "size_bytes": 5000000,
      "status": "done",
      "error_message": null,
      "target_item_id": "onedrive-item-id-2",
      "created_at": "2024-01-15T10:00:00Z"
    },
    {
      "id": "item-uuid-3",
      "source_item_id": "google-file-id-3",
      "file_name": "video.mp4",
      "size_bytes": 15000000,
      "status": "running",
      "error_message": null,
      "target_item_id": null,
      "created_at": "2024-01-15T10:00:00Z"
    },
    {
      "id": "item-uuid-4",
      "source_item_id": "google-file-id-4",
      "file_name": "archive.zip",
      "size_bytes": 20000000,
      "status": "failed",
      "error_message": "OneDrive upload failed: 503 Service Unavailable",
      "target_item_id": null,
      "created_at": "2024-01-15T10:00:00Z"
    },
    {
      "id": "item-uuid-5",
      "source_item_id": "google-file-id-5",
      "file_name": "spreadsheet.xlsx",
      "size_bytes": 0,
      "status": "queued",
      "error_message": null,
      "target_item_id": null,
      "created_at": "2024-01-15T10:00:00Z"
    }
  ]
}
```

---

## 🎨 3. FRONTEND

### 3.1 Transfer Modal Component: `frontend/src/components/TransferModal.tsx`

**Nuevo componente** con funcionalidad completa:

```typescript
type TransferModalProps = {
  isOpen: boolean;
  onClose: () => void;
  sourceAccountId: number;
  selectedFileIds: string[];
  onTransferComplete: () => void;
};

// Features:
// - Dropdown con cuentas OneDrive disponibles
// - Creación de job + ejecución automática
// - Polling de status cada 2 segundos
// - Progress bar con % completado
// - Lista de items con status individual (✓ ✗ ⏳)
// - Mensajes de estado final (done/failed/partial)
```

### 3.2 Google Drive Files Page: `frontend/src/app/drive/[id]/page.tsx`

**Modificaciones:**

1. **Import agregado:**
```typescript
import TransferModal from "@/components/TransferModal";
```

2. **State agregado:**
```typescript
const [showTransferModal, setShowTransferModal] = useState(false);
```

3. **Botón agregado en toolbar (después de "Copiar seleccionados"):**
```typescript
<button
  type="button"
  onClick={() => setShowTransferModal(true)}
  disabled={batchCopying}
  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold transition"
  title="Copiar archivos seleccionados a OneDrive"
>
  Copiar a OneDrive...
</button>
```

4. **Modal agregado al final del componente:**
```typescript
<TransferModal
  isOpen={showTransferModal}
  onClose={() => setShowTransferModal(false)}
  sourceAccountId={parseInt(accountId)}
  selectedFileIds={Array.from(selectedFiles)}
  onTransferComplete={() => {
    setQuotaRefreshKey(prev => prev + 1);
  }}
/>
```

---

## 📊 4. FLUJO DE USUARIO

1. Usuario en página Google Drive Files selecciona archivos (checkboxes)
2. Click en botón **"Copiar a OneDrive..."** (azul, al lado de "Copiar seleccionados")
3. Se abre **TransferModal** con:
   - Dropdown de cuentas OneDrive conectadas
   - Botón "Iniciar transferencia"
4. Al hacer click en "Iniciar transferencia":
   - POST `/transfer/create` → recibe `job_id`
   - POST `/transfer/run/{job_id}` → inicia ejecución
   - Polling GET `/transfer/status/{job_id}` cada 2 segundos
5. Modal muestra:
   - Progress bar con % completado
   - Lista de archivos con status individual
   - Contadores (X/Y completados, Z fallidos)
6. Al finalizar:
   - Mensaje de estado (✅ ❌ ⚠️)
   - Botón "Cerrar"
   - Refresh de quota badge (opcional)

---

## 🔒 5. SEGURIDAD

✅ **Autenticación**: Todos los endpoints requieren JWT (`verify_supabase_jwt`)  
✅ **Autorización**: Valida que ambas cuentas (source + target) pertenezcan al usuario  
✅ **RLS Compliance**: Usa `user_id` en queries para respetar políticas de Supabase  
✅ **Token Refresh**: Refresca tokens de Google Drive y OneDrive si expiran (401)  
✅ **Error Handling**: Captura errores por archivo (partial success), no interrumpe todo el job  
✅ **Input Validation**: Verifica providers ('google_drive', 'onedrive'), file_ids no vacío  

---

## 📈 6. ESCALABILIDAD

⚠️ **Limitación actual**: Ejecución in-request (sin background workers)
- Para <10 archivos: OK
- Para >10 archivos: Cliente debe esperar (timeout potencial)

**Próximas fases (NO implementadas):**
- FASE 2: OneDrive → Google Drive
- FASE 3: Google Drive → Google Drive (cross-account)
- FASE 4: OneDrive → OneDrive (cross-account)
- FASE 5: Background workers con Celery/RQ para transfers largos
- FASE 6: Resume support (re-run failed items)

---

## 🧪 7. TESTING MANUAL

```bash
# 1. Aplicar migración SQL en Supabase
# 2. Deploy backend (Fly.io)
# 3. Deploy frontend (Vercel auto-deploy)

# 4. Test en UI:
# - Ir a página Google Drive Files
# - Seleccionar 2-3 archivos
# - Click "Copiar a OneDrive..."
# - Seleccionar cuenta OneDrive destino
# - Click "Iniciar transferencia"
# - Observar progress bar + items list
# - Verificar archivos en OneDrive

# 5. Test con archivos grandes (>10MB):
# - Verificar que se use chunked upload
# - Logs deben mostrar "Uploading chunk X/Y"

# 6. Test partial failure:
# - Desconectar OneDrive mid-transfer (simular 401)
# - Verificar que algunos items fallen, otros completen
# - Job status debe ser "partial"
```

---

## 📋 8. CHECKLIST PRE-DEPLOY

- [x] SQL migration creada (`add_cross_provider_transfer.sql`)
- [x] Backend helper module (`transfer.py`)
- [x] Backend endpoints (`/transfer/create`, `/transfer/run`, `/transfer/status`)
- [x] Frontend modal component (`TransferModal.tsx`)
- [x] Frontend integration (botón + modal en Drive files page)
- [ ] **Aplicar migración SQL en Supabase** (PENDIENTE)
- [ ] **Test manual con 1 archivo pequeño** (PENDIENTE)
- [ ] **Test manual con 1 archivo grande (>10MB)** (PENDIENTE)
- [ ] **AUTORIZACIÓN PARA COMMIT/DEPLOY** (PENDIENTE)

---

## 🚀 9. COMANDOS PARA DEPLOY

```bash
# NO EJECUTAR SIN AUTORIZACIÓN

# Backend (Fly.io)
cd backend
fly deploy

# Frontend (Vercel auto-deploy)
git add .
git commit -m "feat: Cross-provider transfer (Google Drive → OneDrive) - Phase 1"
git push origin main
```

---

## 📝 10. NOTAS FINALES

- **NO toca Stripe/billing**: Transfers entre providers NO incrementan quota (decisión pendiente)
- **NO usa Google Picker**: Usa file_ids de archivos ya listados en página Drive
- **NO cancela mid-transfer**: Una vez iniciado, completa todos los items (o falla por error)
- **Respeta rate limits**: OneDrive tiene límites, pero chunked upload ayuda

**Compliance:**
- Solo copia archivos explícitamente seleccionados por usuario
- Usuario autoriza acceso a ambas cuentas (source + target)
- Tokens nunca se loguean en backend
- Errores se reportan de forma granular (por archivo)

---

## 📦 ARCHIVOS MODIFICADOS/CREADOS

### Nuevos:
- `backend/migrations/add_cross_provider_transfer.sql` (127 líneas)
- `backend/backend/transfer.py` (280 líneas)
- `frontend/src/components/TransferModal.tsx` (362 líneas)

### Modificados:
- `backend/backend/main.py` (+310 líneas: import + 3 endpoints)
- `frontend/src/app/drive/[id]/page.tsx` (+15 líneas: import + state + botón + modal)

**Total:** ~1100 líneas nuevas
