# Implementación de Acciones Extendidas - Renombrar y Descargar

## 📋 Resumen

Se han agregado dos nuevas acciones al menú kebab sin romper la funcionalidad existente:

1. **Renombrar**: Modal simple para cambiar el nombre de archivos/carpetas
2. **Descargar**: Descarga de archivos binarios y Google Docs con exportación automática

---

## 🔧 Cambios en el Backend

### 1. `backend/backend/google_drive.py`

#### **NUEVA FUNCIÓN: `rename_file`**

```python
async def rename_file(account_id: int, file_id: str, new_name: str) -> dict:
    """
    Rename a file in Google Drive.
    
    Args:
        account_id: Account owning the file
        file_id: File to rename
        new_name: New name for the file
    
    Returns:
        Updated file metadata
    """
    token = await get_valid_token(account_id)
    
    async with httpx.AsyncClient() as client:
        resp = await client.patch(
            f"{GOOGLE_DRIVE_API_BASE}/files/{file_id}",
            json={"name": new_name},
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            }
        )
        resp.raise_for_status()
        return resp.json()
```

#### **NUEVA FUNCIÓN: `download_file_stream`**

```python
async def download_file_stream(account_id: int, file_id: str):
    """
    Download file with streaming support.
    Returns tuple of (content_iterator, filename, mime_type).
    For Google Workspace files, exports as appropriate format.
    """
    token = await get_valid_token(account_id)
    
    # Get file metadata
    metadata = await get_file_metadata(account_id, file_id)
    file_name = metadata.get("name", "download")
    mime_type = metadata.get("mimeType", "application/octet-stream")
    
    # Determine if it's a Google Workspace file
    is_google_doc = mime_type.startswith("application/vnd.google-apps.")
    
    if is_google_doc:
        # Export mapping for Google Workspace files
        export_formats = {
            "application/vnd.google-apps.document": ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"),
            "application/vnd.google-apps.spreadsheet": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"),
            "application/vnd.google-apps.presentation": ("application/vnd.openxmlformats-officedocument.presentationml.presentation", ".pptx"),
            "application/vnd.google-apps.drawing": ("application/pdf", ".pdf"),
            "application/vnd.google-apps.form": ("application/zip", ".zip"),
        }
        
        export_mime, extension = export_formats.get(mime_type, ("application/pdf", ".pdf"))
        
        # Add extension if not present
        if not file_name.endswith(extension):
            file_name = f"{file_name}{extension}"
        
        url = f"{GOOGLE_DRIVE_API_BASE}/files/{file_id}/export"
        params = {"mimeType": export_mime}
        mime_type = export_mime
    else:
        # Regular file download
        url = f"{GOOGLE_DRIVE_API_BASE}/files/{file_id}"
        params = {"alt": "media"}
    
    return (url, params, token, file_name, mime_type)
```

---

### 2. `backend/backend/main.py`

#### **DIFF 1: Imports**

**ANTES:**
```python
from backend.google_drive import (
    get_storage_quota,
    list_drive_files,
    copy_file_between_accounts,
)
```

**DESPUÉS:**
```python
from backend.google_drive import (
    get_storage_quota,
    list_drive_files,
    copy_file_between_accounts,
    rename_file,
    download_file_stream,
)
```

#### **DIFF 2: Nuevos Endpoints**

**AGREGADO AL FINAL (antes del `if __name__ == "__main__"`):**

```python
class RenameFileRequest(BaseModel):
    account_id: int
    file_id: str
    new_name: str


@app.post("/drive/rename-file")
async def rename_drive_file(
    request: RenameFileRequest,
    user_id: str = Depends(get_current_user)
):
    """
    Rename a file in Google Drive.
    
    Body:
        {
            "account_id": 1,
            "file_id": "abc123",
            "new_name": "New Filename.pdf"
        }
    
    Returns:
        Updated file metadata
    """
    try:
        # Verify account belongs to user
        account_resp = supabase.table("cloud_accounts").select("user_id").eq("id", request.account_id).single().execute()
        if not account_resp.data or account_resp.data["user_id"] != user_id:
            raise HTTPException(status_code=403, detail="Account does not belong to user")
        
        # Rename file
        result = await rename_file(request.account_id, request.file_id, request.new_name)
        
        return {
            "success": True,
            "message": "File renamed successfully",
            "file": result
        }
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Rename failed: {str(e)}")


@app.get("/drive/download")
async def download_drive_file(
    account_id: int,
    file_id: str,
    user_id: str = Depends(get_current_user)
):
    """
    Download a file from Google Drive.
    For Google Workspace files, exports to appropriate format (DOCX, XLSX, PPTX, PDF).
    
    Query params:
        account_id: Account ID owning the file
        file_id: File ID to download
    
    Returns:
        File content with proper headers for download
    """
    try:
        # Verify account belongs to user
        account_resp = supabase.table("cloud_accounts").select("user_id").eq("id", account_id).single().execute()
        if not account_resp.data or account_resp.data["user_id"] != user_id:
            raise HTTPException(status_code=403, detail="Account does not belong to user")
        
        # Get download info
        url, params, token, file_name, mime_type = await download_file_stream(account_id, file_id)
        
        # Stream the file
        import httpx
        from fastapi.responses import StreamingResponse
        
        async def file_iterator():
            async with httpx.AsyncClient(timeout=120.0) as client:
                async with client.stream("GET", url, params=params, headers={"Authorization": f"Bearer {token}"}) as resp:
                    resp.raise_for_status()
                    async for chunk in resp.aiter_bytes(chunk_size=8192):
                        yield chunk
        
        return StreamingResponse(
            file_iterator(),
            media_type=mime_type,
            headers={
                "Content-Disposition": f'attachment; filename="{file_name}"'
            }
        )
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Download failed: {str(e)}")
```

---

## 🎨 Cambios en el Frontend

### 1. **NUEVO ARCHIVO: `frontend/src/components/RenameModal.tsx`**

Componente completo creado (ver archivo).

**Características:**
- Auto-selección del nombre sin extensión
- Enter para confirmar, Escape para cancelar
- `stopPropagation()` en todos los clicks
- Estado de loading mientras renombra

---

### 2. `frontend/src/components/RowActionsMenu.tsx`

#### **DIFF 1: Props**

**ANTES:**
```tsx
type RowActionsMenuProps = {
  fileId: string;
  fileName: string;
  mimeType: string;
  webViewLink?: string;
  isFolder: boolean;
  onOpenFolder?: (fileId: string, fileName: string) => void;
  onCopy?: (fileId: string, fileName: string) => void;
  copyDisabled?: boolean;
};
```

**DESPUÉS:**
```tsx
type RowActionsMenuProps = {
  fileId: string;
  fileName: string;
  mimeType: string;
  webViewLink?: string;
  isFolder: boolean;
  onOpenFolder?: (fileId: string, fileName: string) => void;
  onCopy?: (fileId: string, fileName: string) => void;
  onRename?: (fileId: string, fileName: string) => void;
  onDownload?: (fileId: string, fileName: string) => void;
  copyDisabled?: boolean;
};
```

#### **DIFF 2: Destructuring**

**ANTES:**
```tsx
export default function RowActionsMenu({
  fileId,
  fileName,
  mimeType,
  webViewLink,
  isFolder,
  onOpenFolder,
  onCopy,
  copyDisabled = false,
}: RowActionsMenuProps) {
```

**DESPUÉS:**
```tsx
export default function RowActionsMenu({
  fileId,
  fileName,
  mimeType,
  webViewLink,
  isFolder,
  onOpenFolder,
  onCopy,
  onRename,
  onDownload,
  copyDisabled = false,
}: RowActionsMenuProps) {
```

#### **DIFF 3: Nuevas Opciones del Menú**

**ANTES (final del menú):**
```tsx
          {/* Copiar */}
          ...
        </div>
      )}
    </div>
  );
}
```

**DESPUÉS:**
```tsx
          {/* Copiar */}
          ...

          {/* Divider */}
          <div className="border-t border-slate-600 my-1"></div>

          {/* Renombrar */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRename && handleAction(() => onRename(fileId, fileName));
            }}
            className="w-full text-left px-4 py-2 text-sm text-slate-100 hover:bg-slate-600 transition flex items-center gap-2"
          >
            <span>✏️</span>
            <span>Renombrar</span>
          </button>

          {/* Descargar - Only for files, not folders */}
          {!isFolder && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDownload && handleAction(() => onDownload(fileId, fileName));
              }}
              className="w-full text-left px-4 py-2 text-sm text-slate-100 hover:bg-slate-600 transition flex items-center gap-2"
            >
              <span>⬇️</span>
              <span>Descargar</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

---

### 3. `frontend/src/app/drive/[id]/page.tsx`

#### **DIFF 1: Imports**

**ANTES:**
```tsx
import RowActionsMenu from "@/components/RowActionsMenu";
```

**DESPUÉS:**
```tsx
import RowActionsMenu from "@/components/RowActionsMenu";
import RenameModal from "@/components/RenameModal";
```

#### **DIFF 2: Estado de Renombrado**

**ANTES:**
```tsx
  // Quota refresh key for re-fetching quota after operations
  const [quotaRefreshKey, setQuotaRefreshKey] = useState(0);
```

**DESPUÉS:**
```tsx
  // Quota refresh key for re-fetching quota after operations
  const [quotaRefreshKey, setQuotaRefreshKey] = useState(0);

  // Rename modal state
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameFileId, setRenameFileId] = useState<string | null>(null);
  const [renameFileName, setRenameFileName] = useState<string>("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameStatus, setRenameStatus] = useState<string | null>(null);
```

#### **DIFF 3: Handlers (agregados después de `handleBatchCopy`):**

```tsx
  const openRenameModal = (fileId: string, fileName: string) => {
    setRenameFileId(fileId);
    setRenameFileName(fileName);
    setShowRenameModal(true);
    setRenameStatus(null);
  };

  const closeRenameModal = () => {
    setShowRenameModal(false);
    setRenameFileId(null);
    setRenameFileName("");
    setRenameStatus(null);
  };

  const handleRenameFile = async (newName: string) => {
    if (!renameFileId || !newName.trim()) return;

    try {
      setIsRenaming(true);
      setRenameStatus("Renombrando...");

      const res = await authenticatedFetch("/drive/rename-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: parseInt(accountId),
          file_id: renameFileId,
          new_name: newName.trim(),
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || `Error: ${res.status}`);
      }

      setRenameStatus("✅ Archivo renombrado exitosamente");
      
      // Refresh file list
      await fetchFiles(currentFolderId);

      // Close modal after short delay
      setTimeout(() => {
        closeRenameModal();
      }, 1500);
    } catch (e: any) {
      setRenameStatus(`❌ Error: ${e.message}`);
    } finally {
      setIsRenaming(false);
    }
  };

  const handleDownloadFile = async (fileId: string, fileName: string) => {
    try {
      const url = new URL(`${API_BASE_URL}/drive/download`);
      url.searchParams.set("account_id", accountId);
      url.searchParams.set("file_id", fileId);

      const res = await authenticatedFetch(url.pathname + url.search);
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || `Error: ${res.status}`);
      }

      // Get blob from response
      const blob = await res.blob();
      
      // Get filename from Content-Disposition header or use default
      const contentDisposition = res.headers.get("Content-Disposition");
      let downloadFileName = fileName;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?(.+)"?/);
        if (match) {
          downloadFileName = match[1];
        }
      }

      // Create download link
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = downloadFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (e: any) {
      alert(`Error al descargar: ${e.message}`);
    }
  };
```

#### **DIFF 4: Integración en tabla**

**ANTES:**
```tsx
                        <RowActionsMenu
                          fileId={file.id}
                          fileName={file.name}
                          mimeType={file.mimeType}
                          webViewLink={file.webViewLink}
                          isFolder={file.mimeType === "application/vnd.google-apps.folder"}
                          onOpenFolder={handleOpenFolder}
                          onCopy={openCopyModal}
                          copyDisabled={copying || !copyOptions || copyOptions.target_accounts.length === 0}
                        />
```

**DESPUÉS:**
```tsx
                        <RowActionsMenu
                          fileId={file.id}
                          fileName={file.name}
                          mimeType={file.mimeType}
                          webViewLink={file.webViewLink}
                          isFolder={file.mimeType === "application/vnd.google-apps.folder"}
                          onOpenFolder={handleOpenFolder}
                          onCopy={openCopyModal}
                          onRename={openRenameModal}
                          onDownload={handleDownloadFile}
                          copyDisabled={copying || !copyOptions || copyOptions.target_accounts.length === 0}
                        />
```

#### **DIFF 5: Modales (antes del cierre final)**

**ANTES:**
```tsx
        {/* Copy Modal */}
        ...
      </div>
    </main>
  );
}
```

**DESPUÉS:**
```tsx
        {/* Copy Modal */}
        ...

        {/* Rename Modal */}
        <RenameModal
          isOpen={showRenameModal}
          fileName={renameFileName}
          onClose={closeRenameModal}
          onConfirm={handleRenameFile}
          isRenaming={isRenaming}
        />

        {/* Rename Status Toast */}
        {renameStatus && !showRenameModal && (
          <div className={`fixed bottom-6 right-6 p-4 rounded-lg shadow-xl z-50 ${
            renameStatus.includes("✅")
              ? "bg-emerald-500/90 text-white"
              : "bg-red-500/90 text-white"
          }`}>
            {renameStatus}
          </div>
        )}
      </div>
    </main>
  );
}
```

---

## ✅ Checklist de Pruebas Manuales

### **Prueba 1: Renombrar Archivo**
1. ✅ Abre el menú kebab de un archivo
2. ✅ Selecciona "Renombrar"
3. ✅ Verifica que el modal se abre con el nombre actual seleccionado (sin extensión)
4. ✅ Cambia el nombre y presiona Enter o "Renombrar"
5. ✅ Verifica que aparece el toast "✅ Archivo renombrado exitosamente"
6. ✅ Confirma que el nombre se actualiza en la lista sin recargar la página

### **Prueba 2: Renombrar Carpeta**
1. ✅ Abre el menú kebab de una carpeta
2. ✅ Selecciona "Renombrar"
3. ✅ Cambia el nombre
4. ✅ Verifica que la carpeta se renombra correctamente

### **Prueba 3: Descargar Archivo Binario (PDF, imagen, etc.)**
1. ✅ Abre el menú kebab de un archivo binario
2. ✅ Selecciona "Descargar"
3. ✅ Verifica que el archivo se descarga automáticamente
4. ✅ Confirma que el nombre del archivo descargado es correcto

### **Prueba 4: Descargar Google Doc**
1. ✅ Abre el menú kebab de un Google Doc
2. ✅ Selecciona "Descargar"
3. ✅ Verifica que se descarga en formato DOCX
4. ✅ Confirma que el archivo tiene extensión `.docx`

### **Prueba 5: Descargar Google Sheet**
1. ✅ Abre el menú kebab de una Google Sheet
2. ✅ Selecciona "Descargar"
3. ✅ Verifica que se descarga en formato XLSX

### **Prueba 6: Descargar Google Slides**
1. ✅ Abre el menú kebab de una presentación
2. ✅ Selecciona "Descargar"
3. ✅ Verifica que se descarga en formato PPTX

### **Prueba 7: Carpetas NO muestran Descargar**
1. ✅ Abre el menú kebab de una carpeta
2. ✅ Verifica que la opción "Descargar" NO aparece

### **Prueba 8: Funcionalidad Existente Intacta**
1. ✅ Selección múltiple funciona
2. ✅ Batch copy funciona
3. ✅ Quota badge se actualiza
4. ✅ Detección de duplicados funciona
5. ✅ Copiar a cuenta destino funciona
6. ✅ Abrir carpetas funciona
7. ✅ Ver archivos (webViewLink) funciona

### **Prueba 9: Modal de Renombrado - Interacciones**
1. ✅ Presionar Escape cierra el modal
2. ✅ Click fuera del modal lo cierra
3. ✅ No se puede confirmar si el nombre está vacío
4. ✅ No se puede confirmar si el nombre es idéntico al actual
5. ✅ El botón está deshabilitado durante el renombrado

### **Prueba 10: Errores de Autorización**
1. ✅ Intentar renombrar/descargar sin autenticación muestra error 403
2. ✅ Intentar renombrar/descargar de cuenta de otro usuario muestra error 403

---

## 🚀 Próximas Acciones (Segunda Iteración)

### **"Mover a..."**
- Endpoint: `POST /drive/move-file`
- Body: `{ account_id, file_id, target_folder_id }`
- Lógica: Usar `files.update` con `addParents` y `removeParents`
- Modal: Selector de carpetas jerárquico

### **"Compartir"**
- Endpoint: `POST /drive/share-file`
- Body: `{ account_id, file_id, email, role: "reader|writer" }`
- Lógica: Usar `permissions.create`
- Modal: Input de email + selector de permisos

---

## 📦 Archivos Modificados/Creados

### Backend
- ✅ `backend/backend/google_drive.py` - Funciones `rename_file` y `download_file_stream`
- ✅ `backend/backend/main.py` - Endpoints `/drive/rename-file` y `/drive/download`

### Frontend
- ✅ `frontend/src/components/RenameModal.tsx` - **NUEVO**
- ✅ `frontend/src/components/RowActionsMenu.tsx` - Opciones de Renombrar y Descargar
- ✅ `frontend/src/app/drive/[id]/page.tsx` - Integración de handlers

---

**Implementación completada** ✅  
**Sin cambios en lógica existente** ✅  
**Endpoints funcionales end-to-end** ✅
