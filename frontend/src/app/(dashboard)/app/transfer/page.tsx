"use client";
import { useState, useEffect, useRef } from "react";
import { TransferWidget } from "@/components/transfer-queue/TransferWidget";
import { authenticatedFetch } from "@/lib/api";
import { CopyProgressBar } from "@/components/CopyProgressBar";
import UnifiedCopyModal from "@/components/UnifiedCopyModal";
import { toast } from "react-hot-toast";
import { useTransferQueue } from "@/hooks/useTransferQueue";
import { JobWithItems } from "@/types/transfer-queue";

// Tipos básicos
interface CloudAccount {
  id: string;
  provider: "google_drive" | "onedrive";
  email: string;
  provider_email: string; // Email associated with the provider account
  cloud_account_id: string | number; // ID numérico para GD, UUID para OneDrive
  provider_account_uuid?: string | null; // UUID for OneDrive routing
  can_reconnect?: boolean; // Optional property for reconnection status
  connection_status?: "connected" | "needs_reconnect" | "disconnected"; // Optional connection status
  has_refresh_token?: boolean; // Optional refresh token status
}

interface FileItem {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  isFolder: boolean;
}

// Helper function to get file icon based on mime type or file extension
function getFileIcon(file: FileItem): string {
  // Folders
  if (file.isFolder) {
    return "📁";
  }
  
  const mimeType = file.mimeType?.toLowerCase() || "";
  const fileName = file.name?.toLowerCase() || "";
  
  // Images
  if (mimeType.startsWith("image/") || /\.(jpg|jpeg|png|gif|bmp|svg|webp|ico)$/.test(fileName)) {
    return "🖼️";
  }
  
  // Videos
  if (mimeType.startsWith("video/") || /\.(mp4|avi|mov|mkv|wmv|flv|webm|m4v|mpg|mpeg)$/.test(fileName)) {
    return "🎬";
  }
  
  // Audio
  if (mimeType.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|flac|aac|wma)$/.test(fileName)) {
    return "🎵";
  }
  
  // PDFs
  if (mimeType.includes("pdf") || fileName.endsWith(".pdf")) {
    return "📕";
  }
  
  // Word documents
  if (mimeType.includes("word") || mimeType.includes("msword") || /\.(doc|docx)$/.test(fileName)) {
    return "📘";
  }
  
  // Excel
  if (mimeType.includes("excel") || mimeType.includes("spreadsheet") || /\.(xls|xlsx|csv)$/.test(fileName)) {
    return "📊";
  }
  
  // PowerPoint
  if (mimeType.includes("powerpoint") || mimeType.includes("presentation") || /\.(ppt|pptx)$/.test(fileName)) {
    return "📊";
  }
  
  // Archives
  if (/\.(zip|rar|7z|tar|gz|bz2)$/.test(fileName)) {
    return "📦";
  }
  
  // Code files
  if (/\.(js|ts|jsx|tsx|py|java|c|cpp|cs|php|rb|go|rs|swift)$/.test(fileName)) {
    return "💻";
  }
  
  // Text files
  if (mimeType.includes("text") || /\.(txt|md|log)$/.test(fileName)) {
    return "📝";
  }
  
  // APK/AAB (Android)
  if (/\.(apk|aab)$/.test(fileName)) {
    return "📱";
  }
  
  // Default file icon
  return "📄";
}

export default function CloudTransferPage() {
  const [accounts, setAccounts] = useState<CloudAccount[]>([]);
  const [sourceAccount, setSourceAccount] = useState<string | null>(null);
  const [destAccount, setDestAccount] = useState<string | null>(null);
  const [sourceFiles, setSourceFiles] = useState<FileItem[]>([]);
  const [destFiles, setDestFiles] = useState<FileItem[]>([]); // Cambio: carpetas Y archivos
  const [destPath, setDestPath] = useState<string>("root");
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [isTransferring, setIsTransferring] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedAccountNeedsReconnect, setSelectedAccountNeedsReconnect] = useState(false);
  const [destAccountNeedsReconnect, setDestAccountNeedsReconnect] = useState(false);
  const [refreshDestKey, setRefreshDestKey] = useState(0); // Para refrescar destino
  const [transferProgress, setTransferProgress] = useState(0); // Progress 0-100
  const [transferStatus, setTransferStatus] = useState<string>(""); // Current status text
  const [currentJobId, setCurrentJobId] = useState<string | null>(null); // Active job ID
  const [recentlyTransferredFiles, setRecentlyTransferredFiles] = useState<Set<string>>(new Set()); // Highlight new files
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  
  // Hook for transfer queue management
  const { addJob } = useTransferQueue();

  // Cargar cuentas conectadas
  useEffect(() => {
    authenticatedFetch("/me/cloud-status")
      .then(async (res) => {
        if (!res.ok) throw new Error("Error al cargar cuentas");

        const data = await res.json();
        const accountsArray = Array.isArray(data) ? data : data.accounts || [];
        setAccounts(accountsArray);
      })
      .catch((err) => {
        console.error('Error al cargar cuentas:', err);
        setError("No se pudieron cargar las cuentas conectadas");
      });
  }, []);

  // Cargar archivos de la cuenta origen
  useEffect(() => {
    if (!sourceAccount) {
      setSourceFiles([]);
      setSelectedAccountNeedsReconnect(false);
      return;
    }

    const account = accounts.find(a => String(a.cloud_account_id) === String(sourceAccount));
    
    if (account?.can_reconnect) {
      setSelectedAccountNeedsReconnect(true);
      setSourceFiles([]);
      return;
    }

    setSelectedAccountNeedsReconnect(false);

    // Usar endpoint correcto según provider e ID correcto
    const provider = account?.provider;
    const accountId = provider === 'onedrive' 
      ? (account?.provider_account_uuid || sourceAccount)
      : sourceAccount;
    
    const endpoint = provider === 'onedrive' 
      ? `/onedrive/${accountId}/files?folder_id=root`
      : `/drive/${accountId}/files?folder_id=root`;

    console.log('Cargando archivos:', { provider, accountId, endpoint });

    authenticatedFetch(endpoint)
      .then(async (res) => {
        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`HTTP ${res.status}: ${errorText}`);
        }
        
        const data = await res.json();
        
        // OneDrive usa "items", Google Drive usa "files"
        const filesList = data.items || data.files || [];

        setSourceFiles(
          filesList.map((f: any) => ({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType || f.type || 'file',
            size: f.size || 0,
            isFolder: f.isFolder || f.mimeType === "application/vnd.google-apps.folder" || f.mimeType === "folder" || f.type === "folder",
          }))
        );
      })
      .catch((err) => {
        console.error('Error al cargar archivos:', err);
        setError("No se pudieron cargar los archivos de origen");
      });
  }, [sourceAccount, accounts]);

  // Cargar archivos y carpetas de la cuenta destino
  useEffect(() => {
    if (!destAccount) {
      setDestFiles([]);
      setDestAccountNeedsReconnect(false);
      return;
    }

    const account = accounts.find(a => String(a.cloud_account_id) === String(destAccount));
    
    // Verificar si la cuenta necesita reconexión
    if (account?.can_reconnect) {
      setDestAccountNeedsReconnect(true);
      setDestFiles([]);
      return;
    }

    setDestAccountNeedsReconnect(false);

    // Usar el endpoint correcto con ID correcto según provider
    const provider = account?.provider;
    const accountId = provider === 'onedrive'
      ? (account?.provider_account_uuid || destAccount)
      : destAccount;
    
    const endpoint = provider === 'onedrive'
      ? `/onedrive/${accountId}/files?parent_id=${destPath}`
      : `/drive/${accountId}/files?folder_id=${destPath}`;

    console.log('Cargando archivos destino:', { provider, accountId, endpoint });

    authenticatedFetch(endpoint)
      .then(async (res) => {
        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`HTTP ${res.status}: ${errorText}`);
        }

        const data = await res.json();

        // OneDrive usa "items", Google Drive usa "files"
        const filesList = data.items || data.files || [];

        // MOSTRAR TODO: carpetas Y archivos
        setDestFiles(
          filesList.map((f: any) => ({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType || f.type || 'file',
            size: f.size || 0,
            isFolder: f.isFolder || 
                     f.mimeType === "application/vnd.google-apps.folder" || 
                     f.mimeType === "folder" || 
                     f.type === "folder" ||
                     f.kind === "folder",
          }))
        );
        
        // Limpiar error si se cargó correctamente
        if (error === "No se pudieron cargar las carpetas de destino" || 
            error === "La cuenta destino necesita reconexión") {
          setError(null);
        }
      })
      .catch((err) => {
        console.error('Error al cargar archivos destino:', err);
        setError("No se pudieron cargar los archivos de destino");
      });
  }, [destAccount, destPath, accounts, refreshDestKey]); // Agregar refreshDestKey

  // Selección de archivos
  const toggleFile = (id: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAll = () => setSelectedFiles(new Set(sourceFiles.map((f) => f.id)));
  const clearAll = () => setSelectedFiles(new Set());

  // Poll job status for progress updates
  const pollJobStatus = async (jobId: string, selectedFileNames: string[]) => {
    const poll = async () => {
      try {
        const res = await authenticatedFetch(`/transfer/status/${jobId}`);
        if (!res.ok) {
          console.error("[Transfer] Error polling status:", res.status);
          return;
        }
        
        const job: JobWithItems = await res.json();
        console.log("[Transfer] Poll status:", job.status, "completed:", job.completed_items, "/", job.total_items);
        
        const progress = job.total_items > 0 ? (job.completed_items / job.total_items) * 100 : 0;
        
        // Update job in queue for panel
        addJob({
          ...job,
          source_provider: job.source_provider,
          target_provider: job.target_provider,
        });
        
        // Check if job is done - include all terminal states
        const terminalStates = ["done", "done_skipped", "partial", "failed", "cancelled"];
        const isTerminal = terminalStates.includes(job.status);
        const allItemsProcessed = job.total_items > 0 && 
          (job.completed_items + (job.failed_items || 0) + (job.skipped_items || 0)) >= job.total_items;
        
        if (isTerminal || allItemsProcessed) {
          console.log("[Transfer] Job completed! status:", job.status, "isTerminal:", isTerminal, "allItemsProcessed:", allItemsProcessed);
          
          // Stop polling FIRST
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
            console.log("[Transfer] Polling stopped");
          }
          
          // Update UI state
          setIsTransferring(false);
          setCurrentJobId(null);
          setTransferProgress(100);
          
          if (job.status === "done" || job.status === "done_skipped" || (allItemsProcessed && job.failed_items === 0)) {
            setTransferStatus("¡Transferencia completada!");
            const message = job.status === "done_skipped" 
              ? `✅ ${job.total_items} archivos ya existían en destino`
              : `✅ Se transfirieron ${job.completed_items} archivos exitosamente`;
            setSuccess(message);
            toast.success(message);
            
            // Mark files as recently transferred for highlighting
            setRecentlyTransferredFiles(new Set(selectedFileNames));
            
            // Clear highlight after 10 seconds
            setTimeout(() => {
              setRecentlyTransferredFiles(new Set());
            }, 10000);
          } else if (job.status === "partial" || (allItemsProcessed && job.failed_items > 0 && job.completed_items > 0)) {
            setTransferStatus("Transferencia parcial");
            setSuccess(`⚠️ Transferencia parcial: ${job.completed_items}/${job.total_items} archivos completados`);
            toast.success(`Transferencia parcial completada`);
          } else if (job.status === "failed") {
            setTransferStatus("Error");
            setError(`❌ La transferencia falló`);
            toast.error("Error en la transferencia");
          } else if (job.status === "cancelled") {
            setTransferStatus("Cancelada");
            setError("Transferencia cancelada");
            toast.error("Transferencia cancelada");
          }
          
          // Refresh destination files immediately
          setRefreshDestKey(prev => prev + 1);
          
          // Clear progress after a delay
          setTimeout(() => {
            setTransferProgress(0);
            setTransferStatus("");
          }, 3000);
          
          return; // Exit poll function
        }
        
        // Job still running - update progress
        setTransferProgress(progress);
        setTransferStatus(`Transfiriendo... ${job.completed_items}/${job.total_items} archivos`);
        
      } catch (error) {
        console.error("[Transfer] Error polling:", error);
      }
    };
    
    // Start polling every 2 seconds
    pollingRef.current = setInterval(poll, 2000);
    // Also poll immediately
    poll();
  };

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  // Transferir archivos
  const handleTransfer = async () => {
    setError(null);
    setSuccess(null);
    setTransferProgress(0);
    setTransferStatus("Iniciando transferencia...");
    
    if (!sourceAccount || !destAccount) {
      setError("Selecciona ambas cuentas");
      return;
    }
    if (selectedFiles.size === 0) {
      setError("Selecciona al menos un archivo");
      return;
    }

    // Obtener providers de las cuentas usando cloud_account_id
    const sourceAcc = accounts.find(a => String(a.cloud_account_id) === String(sourceAccount));
    const destAcc = accounts.find(a => String(a.cloud_account_id) === String(destAccount));

    if (!sourceAcc || !destAcc) {
      console.error("Cuentas no encontradas:", { sourceAccount, destAccount, accounts });
      setError("Cuentas no encontradas. Por favor recarga la página.");
      return;
    }

    // Get selected file names for highlighting later
    const selectedFileNames = sourceFiles
      .filter(f => selectedFiles.has(f.id))
      .map(f => f.name);

    setIsTransferring(true);
    try {
      // Support all transfers: Google Drive ↔ OneDrive, GD→GD, OD→OD
      // Same-provider transfers are now allowed (e.g., between different accounts)
      if (sourceAccount === destAccount) {
        throw new Error("Las cuentas de origen y destino deben ser diferentes.");
      }

      // Determine account IDs based on provider
      let source_account_id: number | string;
      let target_account_id: number | string;

      if (sourceAcc.provider === "google_drive") {
        source_account_id = Number(sourceAcc.cloud_account_id);
        if (isNaN(source_account_id)) {
          throw new Error("ID de cuenta origen inválido");
        }
      } else if (sourceAcc.provider === "onedrive") {
        source_account_id = sourceAcc.provider_account_uuid || String(sourceAcc.cloud_account_id);
      } else {
        throw new Error(`Proveedor de origen no soportado: ${sourceAcc.provider}`);
      }

      if (destAcc.provider === "google_drive") {
        target_account_id = Number(destAcc.cloud_account_id);
        if (isNaN(target_account_id)) {
          throw new Error("ID de cuenta destino inválido");
        }
      } else if (destAcc.provider === "onedrive") {
        target_account_id = destAcc.provider_account_uuid || String(destAcc.cloud_account_id);
      } else {
        throw new Error(`Proveedor de destino no soportado: ${destAcc.provider}`);
      }

      const payload = {
        source_provider: sourceAcc.provider,
        source_account_id: source_account_id,
        target_provider: destAcc.provider,
        target_account_id: target_account_id,
        file_ids: Array.from(selectedFiles),
        target_folder_id: destPath === "root" ? null : destPath,
      };

      console.log("Creating transfer job...", payload);
      setTransferStatus("Creando trabajo de transferencia...");

      // Create empty job
      const createRes = await authenticatedFetch("/transfer/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!createRes.ok) {
        const errorData = await createRes.json().catch(() => ({}));
        throw new Error(errorData.detail?.message || errorData.message || "Error al crear transferencia");
      }

      const { job_id } = await createRes.json();
      console.log("FASE 1 completada: Job ID =", job_id);
      setCurrentJobId(job_id);
      setTransferProgress(10);

      // FASE 2: Preparar job (fetch metadata, check quota, create items)
      console.log("FASE 2: Preparando job...");
      setTransferStatus("Preparando archivos...");
      const prepareRes = await authenticatedFetch(`/transfer/prepare/${job_id}`, {
        method: "POST",
      });

      if (!prepareRes.ok) {
        const errorData = await prepareRes.json().catch(() => ({}));
        throw new Error(errorData.detail?.message || errorData.message || "Error al preparar transferencia");
      }

      console.log("FASE 2 completada");
      setTransferProgress(20);

      // Register job in transfer queue and open the panel
      const initialJob: JobWithItems = {
        id: job_id,
        source_provider: sourceAcc.provider,
        target_provider: destAcc.provider,
        status: "running",
        total_items: selectedFiles.size,
        completed_items: 0,
        failed_items: 0,
        total_bytes: 0,
        transferred_bytes: 0,
        created_at: new Date().toISOString(),
        items: [],
      };
      addJob(initialJob);
      // Widget will automatically show when there are active jobs

      // FASE 3: Ejecutar transferencia
      console.log("FASE 3: Ejecutando transferencia...");
      setTransferStatus(`Transfiriendo ${selectedFiles.size} archivos...`);
      
      // Start the transfer (don't await - let it run in background)
      authenticatedFetch(`/transfer/run/${job_id}`, {
        method: "POST",
      }).then(async (runRes) => {
        if (!runRes.ok) {
          const errorData = await runRes.json().catch(() => ({}));
          console.error("Error en FASE 3:", errorData);
        }
      }).catch(err => {
        console.error("Error running transfer:", err);
      });

      // Clear selection
      setSelectedFiles(new Set());
      
      // Start polling for progress
      pollJobStatus(job_id, selectedFileNames);
      
      toast.success("🚀 Transferencia iniciada - Ver progreso arriba");
      
    } catch (err: any) {
      console.error('Error al iniciar transferencia:', err);
      setError(err.message || "Error al iniciar la transferencia");
      toast.error(err.message || "Error al transferir archivos");
      setIsTransferring(false);
      setTransferProgress(0);
      setTransferStatus("");
      setCurrentJobId(null);
    }
    // Note: Don't set isTransferring=false here - polling will handle it when job completes
  };

  const handleReconnect = async (accountId: string | null) => {
    if (!accountId) return;

    const account = accounts.find(a => String(a.cloud_account_id) === String(accountId));
    if (!account) return;

    // Construir la URL base del API
    const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://cloud-aggregator-api.fly.dev';
    
    let reconnectUrl: string;
    
    // OneDrive usa un endpoint diferente al de Google
    if (account.provider === 'onedrive') {
      reconnectUrl = `${apiBaseUrl}/auth/onedrive/login-url?mode=reconnect&reconnect_account_id=${accountId}`;
    } else if (account.provider === 'google_drive') {
      reconnectUrl = `${apiBaseUrl}/auth/google?mode=reconnect&reconnect_account_id=${accountId}`;
    } else {
      console.error('[ERROR] Provider no soportado:', account.provider);
      return;
    }
    
    // Para OneDrive, el endpoint devuelve JSON con la URL, necesitamos hacer fetch primero
    if (account.provider === 'onedrive') {
      try {
        const response = await authenticatedFetch(`/auth/onedrive/login-url?mode=reconnect&reconnect_account_id=${accountId}`);
        
        if (!response.ok) {
          console.error('[ERROR] Fallo al obtener URL de OneDrive:', response.status);
          toast.error('Error al iniciar reconexión de OneDrive');
          return;
        }
        
        const data = await response.json();
        
        if (data.login_url) {
          window.location.href = data.login_url;
        } else {
          console.error('[ERROR] No se recibió login_url en la respuesta');
          toast.error('Error al obtener URL de autenticación');
        }
      } catch (error) {
        console.error('[ERROR] Error al llamar login-url:', error);
        toast.error('Error al iniciar reconexión');
      }
    } else {
      // Google puede redirigir directamente
      window.location.href = reconnectUrl;
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 flex flex-col">
      <div className="max-w-5xl w-full mx-auto py-8 px-2">
        <h1 className="text-2xl font-bold mb-6">Transferencias Cloud-to-Cloud</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-[500px]">
          {/* Panel Origen */}
          <div className="bg-slate-800 rounded-lg p-4 flex flex-col h-full">
            <div className="mb-2 font-semibold">Cuenta Origen</div>
            <select
              className="mb-4 p-2 rounded bg-slate-700 text-slate-200"
              value={sourceAccount || ""}
              onChange={(e) => setSourceAccount(e.target.value || null)}
            >
              <option value="">Selecciona una cuenta</option>
              {accounts
                .filter(a => 
                  a.provider === "google_drive" || 
                  a.provider === "onedrive"
                )
                .map(a => (
                  <option key={a.cloud_account_id} value={a.cloud_account_id}>
                    {a.provider === "google_drive" ? "Google Drive" : "OneDrive"} - {a.provider_email}
                  </option>
                ))}
            </select>
            <div className="flex-1 overflow-y-auto border rounded bg-slate-900 max-h-[400px]">
              {!sourceAccount ? (
                <div className="p-4 text-slate-400">Selecciona una cuenta para ver archivos</div>
              ) : selectedAccountNeedsReconnect ? (
                <div className="bg-yellow-900/20 border border-yellow-600 rounded-lg p-6 m-4">
                  <div className="flex items-start gap-3">
                    <div className="text-3xl">⚠️</div>
                    <div className="flex-1">
                      <h3 className="text-yellow-400 font-semibold text-lg mb-2">
                        Esta Cuenta Necesita Reconexión
                      </h3>
                      <p className="text-slate-300 mb-4">
                        La cuenta seleccionada requiere reautorización para acceder a los archivos.
                        Por favor, reconecta la cuenta para continuar.
                      </p>
                      <button
                        onClick={() => {
                          handleReconnect(sourceAccount);
                        }}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
                      >
                        🔄 Reconectar Ahora
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <ul>
                  {sourceFiles.map((file) => (
                    <li key={file.id} className="flex items-center px-2 py-1 border-b border-slate-800 hover:bg-slate-700">
                      <input
                        type="checkbox"
                        checked={selectedFiles.has(file.id)}
                        onChange={() => toggleFile(file.id)}
                        className="mr-2"
                      />
                      <span className={file.isFolder ? "font-semibold" : ""}>{getFileIcon(file)} {file.name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="mt-2 flex gap-2">
              <button onClick={selectAll} className="text-xs px-2 py-1 bg-slate-700 rounded hover:bg-slate-600">Seleccionar Todo</button>
              <button onClick={clearAll} className="text-xs px-2 py-1 bg-slate-700 rounded hover:bg-slate-600">Limpiar</button>
            </div>
          </div>
          {/* Panel Destino */}
          <div className="bg-slate-800 rounded-lg p-4 flex flex-col h-full">
            <div className="mb-2 font-semibold">Cuenta Destino</div>
            <select
              className="mb-4 p-2 rounded bg-slate-700 text-slate-200"
              value={destAccount || ""}
              onChange={(e) => setDestAccount(e.target.value || null)}
            >
              <option value="">Selecciona una cuenta</option>
              {accounts
                .filter(a => 
                  a.provider === "google_drive" || 
                  a.provider === "onedrive"
                )
                .map(a => (
                  <option key={a.cloud_account_id} value={a.cloud_account_id}>{a.provider === "google_drive" ? "Google Drive" : "OneDrive"} - {a.provider_email}</option>
                ))}
            </select>
            <div className="flex-1 overflow-y-auto border rounded bg-slate-900 max-h-[400px]">
              {!destAccount ? (
                <div className="p-4 text-slate-400">Selecciona una cuenta para ver archivos</div>
              ) : destAccountNeedsReconnect ? (
                <div className="bg-yellow-900/20 border border-yellow-600 rounded-lg p-6 m-4">
                  <div className="flex items-start gap-3">
                    <div className="text-3xl">⚠️</div>
                    <div className="flex-1">
                      <h3 className="text-yellow-400 font-semibold text-lg mb-2">
                        Esta Cuenta Necesita Reconexión
                      </h3>
                      <p className="text-slate-300 mb-4">
                        La cuenta destino seleccionada requiere reautorización para acceder a las carpetas.
                        Por favor, reconecta la cuenta para continuar.
                      </p>
                      <button
                        onClick={() => {
                          handleReconnect(destAccount);
                        }}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
                      >
                        🔄 Reconectar Ahora
                      </button>
                    </div>
                  </div>
                </div>
              ) : destFiles.length === 0 ? (
                <div className="p-4 text-slate-400">No hay archivos en esta carpeta</div>
              ) : (
                <ul>
                  {destFiles.map((file) => {
                    const isRecentlyTransferred = recentlyTransferredFiles.has(file.name);
                    return (
                      <li 
                        key={file.id} 
                        className={`flex items-center px-2 py-1 border-b border-slate-800 hover:bg-slate-700 ${
                          file.isFolder ? 'cursor-pointer' : ''
                        } ${
                          isRecentlyTransferred 
                            ? 'bg-emerald-900/40 border-l-4 border-l-emerald-500 animate-pulse' 
                            : ''
                        }`}
                        onClick={() => file.isFolder && setDestPath(file.id)}
                      >
                        <span className={`${file.isFolder ? "font-semibold" : ""} ${isRecentlyTransferred ? "text-emerald-300" : ""}`}>
                          {isRecentlyTransferred ? "✨ " : ""}{getFileIcon(file)} {file.name}
                          {isRecentlyTransferred && <span className="ml-2 text-xs text-emerald-400">(nuevo)</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="mt-2 text-xs text-slate-400">
              Carpeta destino: {destPath === "root" ? "Raíz" : "Carpeta seleccionada"}
              {destPath !== "root" && (
                <button 
                  onClick={() => setDestPath("root")}
                  className="ml-2 text-blue-400 hover:text-blue-300"
                >
                  ← Volver a raíz
                </button>
              )}
            </div>
          </div>
        </div>
        
        {/* Progress Bar - Visible during transfer */}
        {(isTransferring || transferProgress > 0) && (
          <div className="mt-6 bg-slate-800 rounded-lg p-4 border border-slate-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-slate-300">
                {transferStatus || "Preparando..."}
              </span>
              <span className="text-sm font-bold text-emerald-400">
                {transferProgress.toFixed(0)}%
              </span>
            </div>
            <div className="w-full h-3 bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ease-out ${
                  transferProgress === 100 
                    ? "bg-gradient-to-r from-emerald-500 to-emerald-400" 
                    : "bg-gradient-to-r from-blue-500 to-blue-400"
                }`}
                style={{ width: `${transferProgress}%` }}
              />
            </div>
            {transferProgress === 100 && (
              <div className="mt-2 text-center text-emerald-400 text-sm animate-pulse">
                ✅ ¡Transferencia completada exitosamente!
              </div>
            )}
          </div>
        )}
        
        {/* Botón Transferir */}
        <div className="flex justify-center mt-6">
          <button
            className="px-6 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-50 transition-all"
            onClick={handleTransfer}
            disabled={isTransferring || !sourceAccount || !destAccount || selectedFiles.size === 0}
          >
            {isTransferring ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                </svg>
                Transfiriendo...
              </span>
            ) : (
              "Transferir Archivos →"
            )}
          </button>
        </div>
        {/* Mensajes de error/éxito */}
        {error && <div className="mt-4 text-red-400 text-center">{error}</div>}
        {success && <div className="mt-4 text-green-400 text-center">{success}</div>}
      </div>
      
      {/* Widget de Transferencias compacto (estilo Google Drive) */}
      <div className="fixed bottom-4 right-4 z-50">
        <TransferWidget />
      </div>
    </div>
  );
}
