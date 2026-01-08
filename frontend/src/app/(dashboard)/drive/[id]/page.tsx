"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useCopyContext } from "@/context/CopyContext";
import { authenticatedFetch, fetchCloudStatus } from "@/lib/api";
import type { CloudAccountStatus } from "@/lib/api";
import QuotaBadge from "@/components/QuotaBadge";
import RowActionsMenu from "@/components/RowActionsMenu";
import RenameModal from "@/components/RenameModal";
import ContextMenu from "@/components/ContextMenu";
import GooglePickerButton from "@/components/GooglePickerButton";
import { DriveLoadingState } from "@/components/DriveLoadingState";
import TransferModal from "@/components/TransferModal";
import ReconnectSlotsModal from "@/components/ReconnectSlotsModal";
import FileActionBar from "@/components/FileActionBar";

type File = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdTime: string;
  modifiedTime: string;
  webViewLink: string;
};

type TargetAccount = {
  provider: "google_drive" | "onedrive";
  account_id: string;
  email: string;
};

type CopyOptions = {
  source_account: {
    id: number;
    email: string;
  };
  target_accounts: TargetAccount[];
};

type CopyJob = {
  status: "idle" | "running" | "done" | "error";
  total: number;
  completed: number;
  currentFile?: string;
  error?: string;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

export default function DriveFilesPage() {
  const params = useParams();
  const router = useRouter();
  const accountId = params.id as string;

  // Connection status state
  const [accountStatus, setAccountStatus] = useState<CloudAccountStatus | null>(null);
  const [checkingConnection, setCheckingConnection] = useState(true);
  const [showReconnectModal, setShowReconnectModal] = useState(false);

  // Use global copy context
  const {
    copying,
    copyProgress,
    copyStatus,
    startCopy,
    updateProgress,
    completeCopy,
    cancelCopy: cancelCopyGlobal,
    resetCopy,
  } = useCopyContext();

  // Folder navigation state
  const [currentFolderId, setCurrentFolderId] = useState<string>("root");
  const [breadcrumb, setBreadcrumb] = useState<
    { id: string; name: string }[]
  >([{ id: "root", name: "Drive" }]);

  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copyOptions, setCopyOptions] = useState<CopyOptions | null>(null);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  
  // Sorting state (non-destructive)
  const [sortBy, setSortBy] = useState<"name" | "size" | "modifiedTime" | "mimeType" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  
  // Modal state for selecting target account
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [modalFileId, setModalFileId] = useState<string | null>(null);
  const [modalFileName, setModalFileName] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null); // Format: "provider:account_id"

  // Multi-select state
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [batchCopying, setBatchCopying] = useState(false);
  const [batchCopyingFromMenu, setBatchCopyingFromMenu] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0, currentFileName: "" });
  const [batchResults, setBatchResults] = useState<{ success: number; failed: number; skipped: number } | null>(null);

  // CopyJob state (single source of truth for modal UI)
  const [copyJob, setCopyJob] = useState<CopyJob>({ status: "idle", total: 0, completed: 0 });
  const autoCloseTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Quota refresh key for re-fetching quota after operations
  const [quotaRefreshKey, setQuotaRefreshKey] = useState(0);

  // Rename modal state
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameFileId, setRenameFileId] = useState<string | null>(null);
  const [renameFileName, setRenameFileName] = useState<string>("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameStatus, setRenameStatus] = useState<string | null>(null);

  // Transfer modal state (Google Drive → OneDrive)
  const [showTransferModal, setShowTransferModal] = useState(false);

  // Row selection state (visual highlight)
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const clickTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Smooth switching: keep previous files visible while loading new account
  const [displayFiles, setDisplayFiles] = useState<any[]>([]);
  const [isSwitchingAccount, setIsSwitchingAccount] = useState(false);

  // Copy lock ref (synchronous guard against double submit)
  const copyLockRef = useRef(false);
  
  // Loading ref to prevent race conditions in folder navigation
  const loadingRef = useRef(false);
  
  // Abort controller for cancelling in-flight fetch requests
  const fetchAbortRef = useRef<AbortController | null>(null);
  
  // Request sequence for anti-race conditions
  const fetchSeqRef = useRef(0);
  
  // Failsafe timeout to prevent infinite loading
  const failsafeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Polling cleanup refs (to prevent ghost polling after modal close/navigation)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyingRef = useRef(false);

  // Sync copying state to ref for timeout checks
  useEffect(() => {
    copyingRef.current = copying;
  }, [copying]);

  // Reset UI state when cloud account changes (prevents stale menu/actionbar)
  useEffect(() => {
    setIsSwitchingAccount(true);  // Activate switching indicator
    
    setSelectedFiles(new Set());
    setContextMenu(null);
    setSelectedRowId(null);
    
    // Close any open overlays/modals on cloud switch
    setShowCopyModal(false);
    setShowRenameModal(false);
    setShowTransferModal(false);
    setShowReconnectModal(false);
  }, [accountId]);

  // Update display files when new files arrive (smooth transition)
  useEffect(() => {
    setDisplayFiles(files);
    setIsSwitchingAccount(false);
  }, [files, accountId]);

  // Clear stale selections when files list changes (after fetch)
  useEffect(() => {
    setSelectedFiles(prev => {
      if (prev.size === 0) return prev;
      // Remove selections for files that no longer exist
      const currentFileIds = new Set(files.map(f => f.id));
      const newSet = new Set([...prev].filter(id => currentFileIds.has(id)));
      return newSet.size === prev.size ? prev : newSet;
    });
  }, [files]);

  // Centralized cleanup function for polling timers
  const cleanupPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    fileId: string;
    fileName: string;
    mimeType: string;
    webViewLink?: string;
    isFolder: boolean;
  } | null>(null);

  // Close context menu (declared early to avoid hoisting issues in useEffect)
  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Ref for files container (to prevent native context menu)
  const filesContainerRef = useRef<HTMLDivElement>(null);

  // Google Picker selected files (user explicitly grants access to these files)
  const [pickerFiles, setPickerFiles] = useState<Array<{
    id: string;
    name: string;
    mimeType: string;
    sizeBytes?: number;
  }>>([]);

  // Fetch files from a specific folder
  const fetchFiles = async (
    folderId: string = "root",
    pageToken?: string | null
  ) => {
    // Abort any in-flight fetch request
    if (fetchAbortRef.current) {
      try {
        fetchAbortRef.current.abort();
      } catch (e) {
        // Ignore abort errors
      }
    }
    
    // Increment sequence number (anti-race)
    const seq = ++fetchSeqRef.current;
    
    // Create new AbortController for this request
    const controller = new AbortController();
    fetchAbortRef.current = controller;
    
    // Setup timeout (20 seconds)
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 20000);
    
    // Acquire lock and set loading
    loadingRef.current = true;
    setLoading(true);
    
    // Failsafe: Force loading off after 8s if still stuck
    if (failsafeTimeoutRef.current) {
      clearTimeout(failsafeTimeoutRef.current);
    }
    failsafeTimeoutRef.current = setTimeout(() => {
      if (loadingRef.current && seq === fetchSeqRef.current) {
        loadingRef.current = false;
        setLoading(false);
        setError("La carga tardó demasiado. Intenta de nuevo.");
      }
    }, 8000);
    
    try {
      const url = new URL(`${API_BASE_URL}/drive/${accountId}/files`);
      url.searchParams.set("folder_id", folderId);
      if (pageToken) {
        url.searchParams.set("page_token", pageToken);
      }

      const res = await authenticatedFetch(url.pathname + url.search, {
        signal: controller.signal
      });
      
      // Only update UI if this is still the latest request
      if (seq !== fetchSeqRef.current) return;
      
      if (!res.ok) throw new Error(`Error API archivos: ${res.status}`);

      const json = await res.json();
      
      // Double-check sequence before updating state
      if (seq === fetchSeqRef.current) {
        setFiles(json.files || []);
        setCurrentFolderId(folderId);
        setNextPageToken(json.nextPageToken ?? null);
        setError(null);
      }
    } catch (e: any) {
      // Only update error if this is still the latest request
      if (seq !== fetchSeqRef.current) return;
      
      // Handle abort (user navigated away or timeout)
      if (e.name === 'AbortError') {
        // Don't show error for aborted requests (user navigated away)
        return;
      } else {
        setError(e.message || "Error al cargar archivos");
      }
    } finally {
      // Always clear per-request timeout (even for out-of-date requests)
      clearTimeout(timeoutId);

      // Only cleanup if this is still the latest request
      if (seq === fetchSeqRef.current) {
        if (failsafeTimeoutRef.current) {
          clearTimeout(failsafeTimeoutRef.current);
          failsafeTimeoutRef.current = null;
        }
        loadingRef.current = false;
        setLoading(false);
        // Clear abort ref if this was the active controller
        if (fetchAbortRef.current === controller) {
          fetchAbortRef.current = null;
        }
      }
    }
  };

  // Cleanup on unmount: abort in-flight requests and clear timers to avoid stuck loading on back/forward navigation
  useEffect(() => {
    return () => {
      // Invalidate any pending work so stale completions don't win
      fetchSeqRef.current += 1;

      if (fetchAbortRef.current) {
        try {
          fetchAbortRef.current.abort();
        } catch (e) {
          // ignore
        }
        fetchAbortRef.current = null;
      }

      if (failsafeTimeoutRef.current) {
        clearTimeout(failsafeTimeoutRef.current);
        failsafeTimeoutRef.current = null;
      }

      loadingRef.current = false;
      // Ensure we don't restore this route with a cached "loading=true" state
      setLoading(false);
      
      // Cleanup polling timers on unmount
      cleanupPolling();
    };
  }, [cleanupPolling]);

  // Close context menu and cleanup polling when account changes (prevents stale menu after navigation)
  useEffect(() => {
    closeContextMenu();
    cleanupPolling();
  }, [accountId, closeContextMenu, cleanupPolling]);

  // Check connection status before loading files
  useEffect(() => {
    const checkConnection = async () => {
      if (!accountId) return;

      setCheckingConnection(true);
      try {
        const cloudStatus = await fetchCloudStatus(true);
        const accountIdNum = parseInt(accountId, 10);
        
        // Find account by cloud_account_id
        const account = cloudStatus.accounts.find(
          (acc) => acc.cloud_account_id === accountIdNum
        );
        
        setAccountStatus(account || null);
        
        // Only proceed if account exists and is connected
        if (account && account.connection_status === "connected") {
          fetchFiles("root", null);
          fetchCopyOptions();
        }
      } catch (err) {
        console.error("Failed to check connection status:", err);
        setError("Error al verificar estado de conexión");
      } finally {
        setCheckingConnection(false);
      }
    };

    checkConnection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  // Auto-close modal when copyJob completes successfully
  useEffect(() => {
    if (copyJob.status === "done" && showCopyModal) {
      // Clear any existing timer
      if (autoCloseTimerRef.current) {
        clearTimeout(autoCloseTimerRef.current);
      }

      // Set new timer for auto-close
      autoCloseTimerRef.current = setTimeout(() => {
        closeCopyModal();
        autoCloseTimerRef.current = null;
      }, 800);

      // Cleanup on unmount or status change
      return () => {
        if (autoCloseTimerRef.current) {
          clearTimeout(autoCloseTimerRef.current);
          autoCloseTimerRef.current = null;
        }
      };
    }
  }, [copyJob.status, showCopyModal]);

  const fetchCopyOptions = async () => {
    try {
      const res = await authenticatedFetch(
        `/drive/${accountId}/copy-options`
      );
      if (!res.ok) {
        throw new Error(`Error: ${res.status}`);
      }
      const data = await res.json();
      setCopyOptions(data);
    } catch (e: any) {
      console.error("Error loading copy options:", e);
    }
  };

  const handleOpenFolder = async (folderId: string, folderName: string) => {
    // Actualizar breadcrumb
    setBreadcrumb((prev) => [...prev, { id: folderId, name: folderName }]);
    // Cargar contenido de esa carpeta
    try {
      await fetchFiles(folderId, null);
    } catch (e: any) {
      console.error("[handleOpenFolder] Error:", e);
      // fetchFiles ya maneja setError y libera loading
    }
  };

  const handleBreadcrumbClick = async (index: number) => {
    const target = breadcrumb[index];
    const newTrail = breadcrumb.slice(0, index + 1);
    setBreadcrumb(newTrail);
    try {
      await fetchFiles(target.id, null);
    } catch (e: any) {
      console.error("[handleBreadcrumbClick] Error:", e);
      // fetchFiles ya maneja setError y libera loading
    }
  };

  const handleCopyFile = async (fileId: string, targetValue: string, fileName: string) => {
    if (!targetValue || copying) {
      return;
    }

    // Parse provider:account_id
    const [provider, account_id] = targetValue.split(":");
    if (!provider || !account_id) {
      cancelCopyGlobal("❌ Formato de cuenta inválido");
      return;
    }

    try {
      startCopy(fileName);

      if (provider === "google_drive") {
        // Google Drive → Google Drive (existing flow)
        const targetId = parseInt(account_id);
        const res = await authenticatedFetch("/drive/copy-file", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
          source_account_id: parseInt(accountId),
          target_account_id: targetId,
          file_id: fileId,
        }),
        signal: AbortSignal.timeout(180000),
      });

      // Simular progreso durante la respuesta
      const progressInterval = setInterval(() => {
        updateProgress(Math.min(copyProgress + Math.random() * 30, 90));
      }, 500);

      if (!res.ok) {
        clearInterval(progressInterval);
        
        // Parse error response with correlation_id (try JSON, fallback to text)
        let errorData: any = {};
        let errorMessage = "Error desconocido";
        let correlationId = "N/A";
        
        try {
          errorData = await res.json();
          correlationId = errorData.correlation_id || errorData.detail?.correlation_id || "N/A";
          
          // Handle structured error detail (may be string or object)
          const detail = errorData.detail || errorData;
          
          // SPECIAL HANDLING: Account needs reconnection (409 Conflict)
          if (res.status === 409 && detail.error === "target_account_needs_reconnect") {
            errorMessage = `⚠️ La cuenta destino necesita reconexión. Ve a "Mis Cuentas Cloud" (botón arriba) para reconectarla y vuelve a intentar.`;
          }
          else if (res.status === 409 && detail.error === "source_account_needs_reconnect") {
            errorMessage = `⚠️ La cuenta origen necesita reconexión. Ve a "Mis Cuentas Cloud" para reconectarla.`;
          }
          // Special handling for 413 FILE_TOO_LARGE
          else if (res.status === 413 && detail.code === "FILE_TOO_LARGE") {
            const fileSizeGB = detail.file?.size_gb || 0;
            const limitGB = detail.limits?.max_file_gb || 0;
            const excessGB = (fileSizeGB - limitGB).toFixed(2);
            const planTier = detail.plan?.tier || "FREE";
            const suggestedPlan = detail.action?.to || "PLUS";
            
            errorMessage = `Archivo demasiado grande para tu plan ${planTier}. ` +
              `Tamaño: ${fileSizeGB}GB, Límite: ${limitGB}GB (excede por ${excessGB}GB). ` +
              `Actualiza a plan ${suggestedPlan} para archivos más grandes.`;
          } 
          // Generic message extraction (handle both string and object detail)
          else if (typeof detail === "string") {
            errorMessage = detail;
          } else if (detail.message) {
            errorMessage = detail.message;
          } else if (typeof detail === "object" && Object.keys(detail).length > 0) {
            // Fallback: extract first useful property (avoid [object Object])
            const keys = Object.keys(detail);
            const firstKey = keys.find(k => typeof detail[k] === "string" && detail[k].length > 0) || keys[0];
            errorMessage = detail[firstKey] || "Error en el servidor. Verifica logs.";
          } else {
            errorMessage = errorData.message || "Error desconocido";
          }
        } catch {
          // If JSON parse fails, use text response
          const textResponse = await res.text().catch(() => "Error desconocido");
          errorMessage = textResponse;
        }
        
        // Log detailed error info to console for debugging
        console.error("[COPY ERROR]", {
          status: res.status,
          correlationId,
          fileName,
          fileId,
          sourceAccountId: parseInt(accountId),
          targetAccountId: targetId,
          errorData,
          timestamp: new Date().toISOString()
        });
        
        // Throw error with proper status code and correlation_id
        throw new Error(`Error ${res.status}: ${errorMessage} (ID: ${correlationId})`);
      }

      const result = await res.json();
      clearInterval(progressInterval);
      
      // Check if file is a duplicate
      if (result.duplicate) {
        completeCopy(`ℹ️ El archivo "${fileName}" ya existe en la cuenta destino. No se realizó copia ni se consumió cuota.`);
      } else {
        const targetEmail = copyOptions?.target_accounts.find(a => `${a.provider}:${a.account_id}` === targetValue)?.email || "cuenta destino";
        completeCopy(`✅ Archivo "${fileName}" copiado exitosamente a ${targetEmail}`);
      }
      
      // Refresh quota (only if not duplicate, but refresh anyway for consistency)
      setQuotaRefreshKey(prev => prev + 1);
      
      // Limpiar modal y estado (5s para duplicados, 3s para resto)
      const displayDuration = result.duplicate ? 5000 : 3000;
      setTimeout(() => {
        setShowCopyModal(false);
        setModalFileId(null);
        setModalFileName(null);
        setSelectedTarget(null);
        resetCopy();
      }, displayDuration);
      } else if (provider === "onedrive") {
        // Google Drive → OneDrive (transfer flow)
        const createRes = await authenticatedFetch("/transfer/create", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            source_provider: "google_drive",
            source_account_id: parseInt(accountId),
            target_provider: "onedrive",
            target_account_id: account_id, // UUID string
            file_ids: [fileId], // CRITICAL: Backend expects file_ids: List[str], NOT files array
          }),
        });

        if (!createRes.ok) {
          const errorData = await createRes.json().catch(() => ({}));
          throw new Error(errorData.detail || `Error ${createRes.status}: No se pudo crear la transferencia`);
        }

        const createResult = await createRes.json();
        const job_id = createResult.job_id;

        // Polling para transfer status
        let polling = true;
        const pollInterval = setInterval(async () => {
          if (!polling) return;

          try {
            const statusRes = await authenticatedFetch(`/transfer/status/${job_id}`);
            if (!statusRes.ok) {
              polling = false;
              clearInterval(pollInterval);
              throw new Error(`Error polling transfer status`);
            }

            const status = await statusRes.json();
            
            if (status.status === "done") {
              polling = false;
              clearInterval(pollInterval);
              const targetEmail = copyOptions?.target_accounts.find(a => `${a.provider}:${a.account_id}` === targetValue)?.email || "OneDrive";
              completeCopy(`✅ Archivo "${fileName}" transferido exitosamente a ${targetEmail}`);
              setQuotaRefreshKey(prev => prev + 1);
              
              setTimeout(() => {
                setShowCopyModal(false);
                setModalFileId(null);
                setModalFileName(null);
                setSelectedTarget(null);
                resetCopy();
              }, 3000);
            } else if (status.status === "failed") {
              polling = false;
              clearInterval(pollInterval);
              throw new Error(`Transfer failed: ${status.error_message || "Unknown error"}`);
            } else {
              // Update progress (status === "running")
              const progress = Math.min((status.processed_count / status.total_count) * 100, 95);
              updateProgress(progress);
            }
          } catch (pollErr: any) {
            polling = false;
            clearInterval(pollInterval);
            throw pollErr;
          }
        }, 2000);
      }
    } catch (e: any) {
      // Log exception to console
      console.error("[COPY EXCEPTION]", {
        error: e.message,
        fileName,
        fileId,
        timestamp: new Date().toISOString()
      });
      
      if (e.name === "AbortError") {
        cancelCopyGlobal("❌ Copia cancelada");
      } else {
        cancelCopyGlobal(`❌ ${e.message}`);
      }
      setTimeout(() => {
        setShowCopyModal(false);
        setModalFileId(null);
        setModalFileName(null);
        setSelectedTarget(null);
        resetCopy();
      }, 3000);
    } finally {
      // Always release lock
      copyLockRef.current = false;
    }
  };

  const cancelCopy = () => {
    cancelCopyGlobal("❌ Copia cancelada");
  };

  const openCopyModal = (fileId: string, fileName: string) => {
    // Detectar si hay múltiples archivos seleccionados
    if (selectedFiles.size > 1) {
      // Si el archivo clickeado no está en la selección, agregarlo
      if (!selectedFiles.has(fileId)) {
        setSelectedFiles(prev => new Set([...prev, fileId]));
      }
      // Abrir modal en modo batch
      setModalFileId(null);
      setModalFileName(`${selectedFiles.size} archivos seleccionados`);
      setBatchCopyingFromMenu(true);
    } else {
      // Modo individual (1 archivo o ninguno seleccionado)
      setModalFileId(fileId);
      setModalFileName(fileName);
      setBatchCopyingFromMenu(false);
    }
    setSelectedTarget(null);
    setShowCopyModal(true);
  };

  const closeCopyModal = () => {
    // Always allow closing (user can hide modal even during copy)
    
    // Cleanup any active polling
    cleanupPolling();
    
    // Clear auto-close timer if exists
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }

    // Reset all modal state
    setShowCopyModal(false);
    setModalFileId(null);
    setModalFileName(null);
    setSelectedTarget(null);
    setBatchCopyingFromMenu(false);
    setBatchResults(null);

    // Reset copyJob to idle
    setCopyJob({ status: "idle", total: 0, completed: 0 });
  };

  const confirmCopy = () => {
    // Si es modo batch desde el menú, ejecutar batch copy
    if (batchCopyingFromMenu && selectedFiles.size > 1) {
      if (!selectedTarget || batchCopying) {
        return;
      }
      executeBatchCopy(Array.from(selectedFiles), selectedTarget);
      return;
    }
    
    // Modo individual
    // Synchronous lock check (prevents race conditions with React state)
    if (copyLockRef.current || !selectedTarget || !modalFileId || !modalFileName || copying) {
      return;
    }
    
    // Set lock immediately (synchronous)
    copyLockRef.current = true;
    
    // Execute copy (lock will be released in handleCopyFile's finally block)
    handleCopyFile(modalFileId, selectedTarget, modalFileName);
  };

  // Multi-select handlers
  const toggleFileSelection = useCallback((fileId: string, mimeType: string) => {
    // Only allow selection of files (not folders)
    if (mimeType === "application/vnd.google-apps.folder") return;

    setSelectedFiles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(fileId)) {
        newSet.delete(fileId);
      } else {
        newSet.add(fileId);
      }
      return newSet;
    });
  }, []);

  const selectAllFiles = useCallback(() => {
    const selectableFiles = files.filter(f => f.mimeType !== "application/vnd.google-apps.folder");
    if (selectedFiles.size === selectableFiles.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(selectableFiles.map(f => f.id)));
    }
  }, [files, selectedFiles]);

  // Función unificada para ejecutar batch copy (desde botón o menú)
  const executeBatchCopy = async (fileIds: string[], targetValue: string) => {
    if (fileIds.length === 0) {
      alert("Selecciona archivos para copiar");
      return;
    }

    // Parse provider:account_id
    const [provider, account_id] = targetValue.split(":");
    if (!provider || !account_id) {
      alert("Formato de cuenta inválido");
      return;
    }

    // Only Google→Google supported in batch for now
    if (provider !== "google_drive") {
      alert("Batch copy solo está disponible para Google Drive → Google Drive. Usa 'Copiar a OneDrive...' para transferencias OneDrive.");
      return;
    }

    const targetId = parseInt(account_id);

    // Initialize copyJob
    setCopyJob({ status: "running", total: fileIds.length, completed: 0 });

    setBatchCopying(true);
    setBatchProgress({ current: 0, total: fileIds.length, currentFileName: "" });
    setBatchResults(null);

    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    const fileArray = fileIds;
    
    let requestsStarted = 0;
    let requestsFinished = 0;

    // AUDIT LOG: Total files to copy
    console.groupCollapsed(`[BATCH_COPY] Starting batch copy (${fileArray.length} files)`);
    console.warn("[BATCH_COPY] Batch metadata", {
      totalFiles: fileArray.length,
      sourceAccountId: accountId,
      targetAccountId: selectedTarget,
      timestamp: new Date().toISOString()
    });
    console.groupEnd();

    for (let i = 0; i < fileArray.length; i++) {
      const fileId = fileArray[i];
      const file = files.find(f => f.id === fileId);
      
      // Use fallback if file not found in local state (pagination/refresh)
      // Ensure fileId is string for slice operation
      const fileIdStr = String(fileId);
      const fileName = file?.name ?? `file_${fileIdStr.slice(-6)}`;
      const fileSize = file?.size ?? 0;
      
      if (!file) {
        console.warn("[BATCH_COPY] File not found in local state, using fallback metadata", { 
          fileId, 
          index: i, 
          fallbackName: fileName 
        });
      }

      // AUDIT LOG: Current file being copied
      console.groupCollapsed(`[BATCH_COPY] File ${i + 1}/${fileArray.length}: ${fileName}`);
      console.warn("[BATCH_COPY] File details", {
        index: i + 1,
        total: fileArray.length,
        fileId,
        fileName: fileName,
        fileSize: fileSize,
        hasLocalMetadata: !!file
      });

      try {
        requestsStarted++;
        
        // Update both progress states (copyJob for modal, batchProgress for button)
        setCopyJob(prev => ({ ...prev, completed: i + 1, currentFile: fileName }));
        setBatchProgress({ current: i + 1, total: fileArray.length, currentFileName: fileName });

        const res = await authenticatedFetch("/drive/copy-file", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source_account_id: parseInt(accountId),
            target_account_id: targetId,
            file_id: fileId,
          }),
          signal: AbortSignal.timeout(180000),
        });

        // AUDIT LOG: Response status
        requestsFinished++;
        console.warn("[BATCH_COPY] Response received", {
          index: i + 1,
          fileId,
          fileName: fileName,
          status: res.status,
          ok: res.ok,
          requestsProgress: `${requestsFinished}/${requestsStarted}`
        });

        if (!res.ok) {
          // Handle account needs reconnection (409)
          if (res.status === 409) {
            const errorData = await res.json().catch(() => ({}));
            const detail = errorData.detail || {};
            
            console.error("[BATCH_COPY] 409 Conflict detected", {
              error: detail.error,
              message: detail.message,
              stoppingAt: i + 1,
              remaining: fileArray.length - i
            });
            
            if (detail.error === "target_account_needs_reconnect") {
              console.error("[BATCH_COPY] CRITICAL: Target account needs reconnection - STOPPING");
              console.groupEnd();
              alert("⚠️ Cuenta destino necesita reconexión.\n\nVe a 'Mis Cuentas Cloud' (botón arriba) para reconectarla.\n\nProceso de copia detenido.");
              failedCount += (fileArray.length - i);
              break;
            }
            if (detail.error === "source_account_needs_reconnect") {
              console.error("[BATCH_COPY] CRITICAL: Source account needs reconnection - STOPPING");
              console.groupEnd();
              alert("⚠️ Cuenta origen necesita reconexión.\n\nVe a 'Mis Cuentas Cloud' para reconectarla.\n\nProceso de copia detenido.");
              failedCount += (fileArray.length - i);
              break;
            }
            // Generic 409 handling - count as failed but continue with remaining files
            console.error("[BATCH_COPY] 409 Conflict (non-critical) - CONTINUING", {
              error: detail.error,
              message: detail.message,
              fileId,
              fileName,
              willContinue: true
            });
            console.groupEnd();
            failedCount++;
            continue;
          }

          // Handle quota exceeded
          if (res.status === 402) {
            const errorData = await res.json().catch(() => ({}));
            console.error("[BATCH_COPY] CRITICAL: Quota exceeded - STOPPING", {
              stoppingAt: i + 1,
              remaining: fileArray.length - i
            });
            console.groupEnd();
            alert(errorData.detail?.message || "Límite de copias alcanzado. Proceso detenido.");
            failedCount += (fileArray.length - i);
            break;
          }

          // Handle rate limit
          if (res.status === 429) {
            const errorData = await res.json().catch(() => ({}));
            const retryAfter = errorData.detail?.retry_after || 10;
            console.warn("[BATCH_COPY] 429 Rate limit - RETRYING", {
              fileId,
              retryAfter,
              willRetry: true
            });
            console.groupEnd();
            console.log(`Rate limit hit, waiting ${retryAfter}s...`);
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
            i--; // Retry same file
            continue;
          }

          // Generic error - count as failed and continue
          console.error("[BATCH_COPY] Copy failed (non-critical) - CONTINUING", {
            fileId,
            fileName: fileName,
            status: res.status,
            willContinue: true
          });
          console.groupEnd();
          failedCount++;
          continue;
        }

        const result = await res.json();
        
        // AUDIT LOG: Success result
        console.warn("[BATCH_COPY] File copied successfully", {
          index: i + 1,
          fileId,
          fileName: fileName,
          duplicate: result.duplicate || false
        });
        console.groupEnd();
        
        // Check if file is a duplicate
        if (result.duplicate) {
          skippedCount++;
        } else {
          successCount++;
        }

        // Wait 11 seconds between requests to respect rate limiting
        if (i < fileArray.length - 1) {
          console.warn("[BATCH_COPY] Waiting 11s before next file...");
          await new Promise(resolve => setTimeout(resolve, 11000));
        }

      } catch (e: any) {
        console.error("[BATCH_COPY] Exception during copy - CONTINUING", {
          fileId,
          fileName: fileName,
          error: e.message,
          index: i + 1,
          willContinue: true
        });
        console.groupEnd();
        failedCount++;
      }
    }

    console.groupCollapsed("[BATCH_COPY] Batch complete");
    console.warn("[BATCH_COPY] Final results", {
      success: successCount,
      failed: failedCount,
      skipped: skippedCount,
      total: fileArray.length,
      requestsStarted,
      requestsFinished,
      allRequestsFinished: requestsStarted === requestsFinished
    });
    console.groupEnd();

    setBatchResults({ success: successCount, failed: failedCount, skipped: skippedCount });
    setBatchCopying(false);
    
    // Update copyJob status based on results
    if (failedCount === fileArray.length) {
      // All failed
      setCopyJob(prev => ({ 
        ...prev, 
        status: "error", 
        error: `Todos los archivos fallaron (${failedCount}/${fileArray.length})` 
      }));
    } else if (failedCount > 0) {
      // Partial success (treat as done but show in results)
      setCopyJob(prev => ({ ...prev, status: "done", completed: prev.total }));
    } else {
      // All success
      setCopyJob(prev => ({ ...prev, status: "done", completed: prev.total }));
    }
    
    // Limpia selectedFiles después de batch copy (ambos modos: botón y menú)
    setSelectedFiles(new Set());

    // Refresh quota badge
    setQuotaRefreshKey(prev => prev + 1);
  };

  // Wrapper para handleBatchCopy desde el botón (mantiene compatibilidad)
  const handleBatchCopy = async () => {
    if (selectedFiles.size === 0 || !selectedTarget) {
      alert("Selecciona archivos y una cuenta destino");
      return;
    }
    await executeBatchCopy(Array.from(selectedFiles), selectedTarget); // selectedTarget is now string
  };

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

  const handleOpenInProvider = (fileId: string, fileName: string) => {
    // Find the file to get its webViewLink
    const file = files.find(f => f.id === fileId);
    const webViewLink = file?.webViewLink || contextMenu?.webViewLink;
    
    if (webViewLink) {
      window.open(webViewLink, "_blank", "noopener,noreferrer");
    } else {
      // Fallback to generic Google Drive URL
      window.open(`https://drive.google.com/file/d/${fileId}`, "_blank", "noopener,noreferrer");
    }
  };

  const handleShareInProvider = (fileId: string, fileName: string) => {
    // Find the file to get its webViewLink
    const file = files.find(f => f.id === fileId);
    const webViewLink = file?.webViewLink || contextMenu?.webViewLink;
    
    if (webViewLink) {
      // Open webViewLink directly (user can access Share UI from Google Drive)
      window.open(webViewLink, "_blank", "noopener,noreferrer");
    } else {
      // Fallback to generic Google Drive URL
      window.open(`https://drive.google.com/file/d/${fileId}`, "_blank", "noopener,noreferrer");
    }
  };

  // Row click handlers
  const handleRowClick = (fileId: string) => {
    // Debounce to distinguish from double click
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
    }
    
    clickTimerRef.current = setTimeout(() => {
      setSelectedRowId(fileId);
    }, 250);
  };

  const handleRowDoubleClick = (file: File) => {
    // Cancel single click timer
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
    }

    // Open folder or file
    if (file.mimeType === "application/vnd.google-apps.folder") {
      handleOpenFolder(file.id, file.name);
    } else if (file.webViewLink) {
      window.open(file.webViewLink, "_blank", "noopener,noreferrer");
    }
  };

  const handleRowContextMenu = (e: React.MouseEvent, file: File) => {
    e.preventDefault();
    e.stopPropagation();

    // Debug counter for app context menu opens
    if (typeof window !== "undefined") {
      (window as any).__appCtxOpens = ((window as any).__appCtxOpens || 0) + 1;
    }

    // Select the row
    setSelectedRowId(file.id);

    // Show context menu
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      fileId: file.id,
      fileName: file.name,
      mimeType: file.mimeType,
      webViewLink: file.webViewLink,
      isFolder: file.mimeType === "application/vnd.google-apps.folder",
    });
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString("es-ES", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  // Get file icon based on MIME type
  const getFileIcon = (mimeType: string): string => {
    if (mimeType.includes("folder")) return "📁";
    if (mimeType.includes("document")) return "📄";
    if (mimeType.includes("spreadsheet")) return "📊";
    if (mimeType.includes("presentation")) return "📽️";
    if (mimeType.includes("pdf")) return "📕";
    if (mimeType.includes("image")) return "🖼️";
    if (mimeType.includes("video")) return "🎥";
    if (mimeType.includes("audio")) return "🎵";
    if (mimeType.includes("zip") || mimeType.includes("archive")) return "📦";
    if (mimeType.includes("text")) return "📝";
    return "📄";
  };

  // Get friendly file type name
  const getFileTypeName = (mimeType: string): string => {
    if (mimeType === "application/vnd.google-apps.folder") return "Carpeta";
    if (mimeType === "application/vnd.google-apps.document") return "Google Docs";
    if (mimeType === "application/vnd.google-apps.spreadsheet") return "Google Sheets";
    if (mimeType === "application/vnd.google-apps.presentation") return "Google Slides";
    if (mimeType === "application/vnd.google-apps.form") return "Google Forms";
    if (mimeType === "application/vnd.google-apps.drawing") return "Google Drawing";
    if (mimeType === "application/vnd.google-apps.shortcut") return "Acceso directo";
    if (mimeType.includes("pdf")) return "PDF";
    if (mimeType.includes("image")) return "Imagen";
    if (mimeType.includes("video")) return "Video";
    if (mimeType.includes("audio")) return "Audio";
    if (mimeType.includes("text")) return "Texto";
    if (mimeType.includes("zip")) return "Archivo comprimido";
    
    // Fallback: extract extension from MIME
    const parts = mimeType.split("/");
    return parts[parts.length - 1].toUpperCase();
  };

  // Derived sorted files (use displayFiles for smooth transitions)
  const sortedFiles = (() => {
    if (!displayFiles || !sortBy) return displayFiles;
    const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });
    const arr = [...displayFiles];
    arr.sort((a, b) => {
      let av: any;
      let bv: any;
      switch (sortBy) {
        case "name":
          av = a.name || ""; bv = b.name || "";
          return collator.compare(av, bv);
        case "mimeType":
          av = a.mimeType || ""; bv = b.mimeType || "";
          return collator.compare(av, bv);
        case "size":
          av = typeof a.size === "number" ? a.size : (typeof a.size === "string" ? parseInt(a.size as any) || 0 : 0);
          bv = typeof b.size === "number" ? b.size : (typeof b.size === "string" ? parseInt(b.size as any) || 0 : 0);
          return av - bv;
        case "modifiedTime":
          av = a.modifiedTime ? Date.parse(a.modifiedTime) : 0;
          bv = b.modifiedTime ? Date.parse(b.modifiedTime) : 0;
          return av - bv;
        default:
          return 0;
      }
    });
    if (sortDir === "desc") arr.reverse();
    return arr;
  })();

  const toggleSort = (key: "name" | "size" | "modifiedTime" | "mimeType") => {
    if (sortBy === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortBy(key);
      setSortDir("asc");
    }
  };

  return (
    <main className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center p-6">
      {/* Checking connection state */}
      {checkingConnection && (
        <div className="w-full max-w-2xl mt-20">
          <div className="bg-slate-800 rounded-lg p-8 border border-slate-700 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto mb-4"></div>
            <p className="text-slate-300">Verificando estado de conexión...</p>
          </div>
        </div>
      )}

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

      {/* Normal UI - Only show if connected */}
      {!checkingConnection && accountStatus && accountStatus.connection_status === "connected" && (
        <>
      {/* Floating Progress Bar (Sticky) */}
      {copying && (
        <div className="fixed bottom-0 left-0 right-0 bg-slate-800 border-t border-slate-700 shadow-xl z-40">
          <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-4">
            <div className="flex-1">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-slate-300 font-medium">{copyStatus}</p>
                <span className="text-sm font-semibold text-emerald-400">{Math.round(copyProgress)}%</span>
              </div>
              <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden border border-slate-600">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-300"
                  style={{ width: `${copyProgress}%` }}
                />
              </div>
            </div>
            <button
              onClick={cancelCopy}
              className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold transition whitespace-nowrap"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="w-full max-w-6xl space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/app"
              className="text-emerald-400 hover:text-emerald-300 transition font-medium"
            >
              Dashboard
            </Link>
            <h1 className="text-2xl md:text-3xl font-bold">
              Archivos de Google Drive
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <GooglePickerButton
              accountId={parseInt(accountId)}
              onFilesPicked={(files) => setPickerFiles(files)}
              disabled={copying || batchCopying}
            />
            {pickerFiles.length > 0 && (
              <span className="text-xs text-slate-400">
                Picker: {pickerFiles.length}
              </span>
            )}
            <QuotaBadge refreshKey={quotaRefreshKey} />
            {copyOptions && (
              <div className="text-sm text-slate-400">
                {copyOptions.source_account.email}
              </div>
            )}
          </div>
        </header>

        {/* Breadcrumb Navigation con botón Atrás */}
        <div className="flex items-center justify-between bg-slate-800 rounded-lg p-4 border border-slate-700">
          {/* Switching account indicator */}
          {isSwitchingAccount && (
            <div className="absolute top-2 right-4 flex items-center gap-2 text-xs text-slate-400">
              <div className="animate-spin rounded-full h-3 w-3 border-b border-emerald-500"></div>
              <span>Cargando cuenta...</span>
            </div>
          )}
          
          <nav className="flex items-center gap-2 text-sm">\n            {breadcrumb.map((crumb, idx) => (
              <span key={crumb.id} className="flex items-center gap-2">
                {idx > 0 && <span className="text-slate-600">›</span>}
                <button
                  type="button"
                  className={`hover:text-emerald-400 transition font-medium ${
                    idx === breadcrumb.length - 1
                      ? "text-white"
                      : "text-slate-400"
                  }`}
                  onClick={() => handleBreadcrumbClick(idx)}
                >
                  {idx === 0 && "🏠 "}
                  {crumb.name}
                </button>
              </span>
            ))}
          </nav>
          
          {/* Botón Atrás */}
          {breadcrumb.length > 1 && (
            <button
              type="button"
              onClick={() => handleBreadcrumbClick(breadcrumb.length - 2)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-xs font-semibold transition"
            >
              ← Atrás
            </button>
          )}
        </div>

        {/* Copy Status with Progress Bar */}
        {/* (Progreso ahora en floating bar sticky abajo) */}

        {/* Copy Success/Error Message (solo cuando modal cerrado) */}
        {copyStatus && !copying && !showCopyModal && (
          <div
            className={`rounded-lg p-4 ${
              copyStatus.includes("✅")
                ? "bg-emerald-500/20 border border-emerald-500 text-emerald-100"
                : copyStatus.includes("ℹ️")
                ? "bg-blue-500/20 border border-blue-500 text-blue-100"
                : "bg-red-500/20 border border-red-500 text-red-100"
            }`}
          >
            {copyStatus}
          </div>
        )}

        {/* Loading State */}
        {loading && <DriveLoadingState />}

        {/* Error State */}
        {error && !loading && (
          <p className="text-center text-red-400">Error: {error}</p>
        )}

        {/* Empty State */}
        {!loading && !error && files.length === 0 && (
          <p className="text-center text-slate-400">
            No hay archivos en esta cuenta
          </p>
        )}

        {/* Batch Copy Toolbar */}
        {!loading && !error && files.length > 0 && (
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={selectAllFiles}
                  className="text-sm text-emerald-400 hover:text-emerald-300 transition"
                >
                  {selectedFiles.size === files.filter(f => f.mimeType !== "application/vnd.google-apps.folder").length && selectedFiles.size > 0
                    ? "Deseleccionar todos"
                    : "Seleccionar todos"}
                </button>
                {selectedFiles.size > 0 && (
                  <span className="text-sm text-slate-400">
                    {selectedFiles.size} archivo{selectedFiles.size > 1 ? "s" : ""} seleccionado{selectedFiles.size > 1 ? "s" : ""}
                  </span>
                )}
              </div>
              {selectedFiles.size > 0 && copyOptions && (
                <div className="flex items-center gap-3">
                  <select
                    value={selectedTarget || ""}
                    onChange={(e) => setSelectedTarget(e.target.value || null)}
                    className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">Seleccionar cuenta destino...</option>
                    {copyOptions.target_accounts.map((account) => {
                      const value = `${account.provider}:${account.account_id}`;
                      const providerIcon = account.provider === "google_drive" ? "📁" : "🟦";
                      return (
                        <option key={value} value={value}>
                          {providerIcon} {account.email}
                        </option>
                      );
                    })}
                  </select>
                  <button
                    type="button"
                    onClick={handleBatchCopy}
                    disabled={!selectedTarget || batchCopying}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold transition"
                    title={batchCopying && batchProgress.currentFileName ? `Procesando: ${batchProgress.currentFileName}` : ""}
                  >
                    {batchCopying ? (
                      <div className="flex flex-col items-center">
                        <span>Copiando {batchProgress.current}/{batchProgress.total}</span>
                        {batchProgress.currentFileName && (
                          <span className="text-xs opacity-75 truncate max-w-[200px]">{batchProgress.currentFileName}</span>
                        )}
                      </div>
                    ) : "Copiar seleccionados"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowTransferModal(true)}
                    disabled={batchCopying}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold transition"
                    title="Copiar archivos seleccionados a OneDrive"
                  >
                    Copiar a OneDrive...
                  </button>
                </div>
              )}
            </div>
            
            {/* Rate limit warning */}
            {selectedFiles.size > 0 && (
              <div className="text-xs text-slate-400 flex items-center gap-1.5">
                <span>⏱️</span>
                <span>La copia puede tardar ~11s por archivo debido a límites de Google API</span>
              </div>
            )}
          </div>
        )}

        {/* File Action Bar - MultCloud style */}
        <FileActionBar
          provider="google_drive"
          selectedCount={selectedFiles.size}
          singleSelected={
            selectedFiles.size === 1 
              ? (() => {
                  const fileId = Array.from(selectedFiles)[0];
                  const file = files.find(f => f.id === fileId);
                  return file ? {
                    id: file.id,
                    name: file.name,
                    isFolder: file.mimeType === "application/vnd.google-apps.folder"
                  } : null;
                })()
              : null
          }
          onClearSelection={() => setSelectedFiles(new Set())}
          onDownloadSelected={() => {
            // Download all selected files
            const fileIds = Array.from(selectedFiles);
            fileIds.forEach(fileId => {
              const file = files.find(f => f.id === fileId);
              if (file) {
                handleDownloadFile(fileId, file.name);
              }
            });
          }}
          onCopySelected={() => {
            // Open copy modal for selected files
            if (selectedFiles.size === 1) {
              const fileId = Array.from(selectedFiles)[0];
              const file = files.find(f => f.id === fileId);
              if (file) {
                openCopyModal(fileId, file.name);
              }
            } else if (selectedFiles.size > 1) {
              // Batch copy
              setModalFileId(null);
              setModalFileName(`${selectedFiles.size} archivos seleccionados`);
              setBatchCopyingFromMenu(true);
              setSelectedTarget(null);
              setShowCopyModal(true);
            }
          }}
          onRenameSingle={() => {
            if (selectedFiles.size === 1) {
              const fileId = Array.from(selectedFiles)[0];
              const file = files.find(f => f.id === fileId);
              if (file && file.mimeType !== "application/vnd.google-apps.folder") {
                openRenameModal(fileId, file.name);
              }
            }
          }}
          onPreviewSingle={() => {
            if (selectedFiles.size === 1) {
              const fileId = Array.from(selectedFiles)[0];
              const file = files.find(f => f.id === fileId);
              if (file && file.webViewLink) {
                window.open(file.webViewLink, "_blank", "noopener,noreferrer");
              }
            }
          }}
          onRefresh={() => fetchFiles(currentFolderId)}
          copyDisabled={copying || !copyOptions || copyOptions.target_accounts.length === 0}
          copyDisabledReason={
            !copyOptions 
              ? "Cargando opciones..."
              : copyOptions.target_accounts.length === 0
              ? "Necesitas conectar al menos 2 cuentas"
              : undefined
          }
        />

        {/* Batch Results Toast */}
        {batchResults && (
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <h3 className="font-semibold mb-2">Resultado de copia múltiple:</h3>
            <div className="flex gap-4 text-sm">
              <span className="text-emerald-400">✅ Éxito: {batchResults.success}</span>
              {batchResults.skipped > 0 && (
                <span className="text-blue-400">ℹ️ Omitidos (ya existían): {batchResults.skipped}</span>
              )}
              <span className="text-red-400">❌ Fallidos: {batchResults.failed}</span>
            </div>
            <button
              onClick={() => setBatchResults(null)}
              className="mt-3 text-xs text-slate-400 hover:text-white transition"
            >
              Cerrar
            </button>
          </div>
        )}

        {/* Files Table */}
        {!loading && !error && files.length > 0 && (
          <div 
            ref={filesContainerRef}
            key={accountId} 
            className="bg-slate-800 rounded-xl p-4 shadow overflow-x-auto"
          >
            <div 
              onClick={() => setSelectedRowId(null)}
              onPointerDownCapture={() => contextMenu?.visible && closeContextMenu()}
            >
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-slate-700">
                  <th className="py-3 px-2 w-10"></th>
                  <th className="py-3 px-4">
                    <button
                      type="button"
                      onClick={() => toggleSort("name")}
                      className="flex items-center gap-2 hover:text-slate-200"
                      aria-label="Ordenar por nombre"
                    >
                      Nombre
                      {sortBy === "name" && (
                        <span className="text-[10px] font-semibold">{sortDir === "asc" ? "▲" : "▼"}</span>
                      )}
                    </button>
                  </th>
                  <th className="py-3 px-4">
                    <button
                      type="button"
                      onClick={() => toggleSort("mimeType")}
                      className="flex items-center gap-2 hover:text-slate-200"
                      aria-label="Ordenar por tipo"
                    >
                      Tipo
                      {sortBy === "mimeType" && (
                        <span className="text-[10px] font-semibold">{sortDir === "asc" ? "▲" : "▼"}</span>
                      )}
                    </button>
                  </th>
                  <th className="py-3 px-4">
                    <button
                      type="button"
                      onClick={() => toggleSort("size")}
                      className="flex items-center gap-2 hover:text-slate-200"
                      aria-label="Ordenar por tamaño"
                    >
                      Tamaño
                      {sortBy === "size" && (
                        <span className="text-[10px] font-semibold">{sortDir === "asc" ? "▲" : "▼"}</span>
                      )}
                    </button>
                  </th>
                  <th className="py-3 px-4">
                    <button
                      type="button"
                      onClick={() => toggleSort("modifiedTime")}
                      className="flex items-center gap-2 hover:text-slate-200"
                      aria-label="Ordenar por fecha"
                    >
                      Modificado
                      {sortBy === "modifiedTime" && (
                        <span className="text-[10px] font-semibold">{sortDir === "asc" ? "▲" : "▼"}</span>
                      )}
                    </button>
                  </th>
                  <th className="py-3 px-4 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {sortedFiles.map((file) => (
                  <tr
                    key={`${accountId}:${file.id}`}
                    className={`
                      border-b border-slate-800 
                      transition-colors
                      cursor-pointer
                      ${selectedRowId === file.id 
                        ? 'bg-blue-500/10 hover:bg-blue-500/15 outline outline-1 outline-blue-400/40' 
                        : 'hover:bg-white/5'
                      }
                    `}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRowClick(file.id);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      handleRowDoubleClick(file);
                    }}
                    onContextMenu={(e) => handleRowContextMenu(e, file)}
                  >
                    {/* Checkbox */}
                    <td className="px-2 py-3">
                      <input
                        type="checkbox"
                        checked={selectedFiles.has(file.id)}
                        onChange={() => toggleFileSelection(file.id, file.mimeType)}
                        onClick={(e) => e.stopPropagation()}
                        disabled={file.mimeType === "application/vnd.google-apps.folder"}
                        title={file.mimeType === "application/vnd.google-apps.folder" ? "No se pueden copiar carpetas" : ""}
                        className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-emerald-500 focus:ring-2 focus:ring-emerald-500 disabled:opacity-30 disabled:cursor-not-allowed"
                      />
                    </td>

                    {/* Nombre con icono */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{getFileIcon(file.mimeType)}</span>
                        <span className="text-sm font-medium text-slate-100">{file.name}</span>
                      </div>
                    </td>

                    {/* Tipo */}
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-700 text-slate-200">
                        {getFileTypeName(file.mimeType)}
                      </span>
                    </td>

                    {/* Tamaño */}
                    <td className="px-4 py-3 text-sm text-slate-300">
                      {file.size && Number(file.size) > 0
                        ? formatFileSize(Number(file.size))
                        : "-"}
                    </td>

                    {/* Fecha de modificación */}
                    <td className="px-4 py-3 text-sm text-slate-300">
                      {file.modifiedTime ? formatDate(file.modifiedTime) : "-"}
                    </td>

                    {/* Acciones - Kebab Menu */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center">
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
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}

        {/* Warning: Need 2+ accounts */}
        {copyOptions && copyOptions.target_accounts.length === 0 && (
          <div className="bg-amber-500/20 border border-amber-500 rounded-lg p-4 text-amber-100 text-sm">
            ⚠️ Necesitas conectar al menos 2 cuentas para copiar archivos.
            <Link href="/" className="underline ml-1">
              Conectar más cuentas
            </Link>
          </div>
        )}

        {/* Copy Modal */}
        {showCopyModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-slate-800 rounded-lg shadow-xl w-full max-w-md p-6 border border-slate-700">
              <h2 className="text-xl font-bold text-white mb-4">
                {batchCopyingFromMenu ? "Copiar archivos seleccionados" : `Copiar: ${modalFileName}`}
              </h2>
              
              <p className="text-slate-300 mb-4">
                {batchCopyingFromMenu 
                  ? `Copiar ${selectedFiles.size} archivo${selectedFiles.size > 1 ? 's' : ''} a:` 
                  : "Selecciona la cuenta destino donde deseas copiar este archivo:"}
              </p>

              {/* Disclaimer */}
              <p className="text-xs text-slate-400 italic mb-4 border-l-2 border-slate-600 pl-3">
                Manual action — requires confirmation.
              </p>

              {/* Dropdown Select */}
              <div className="mb-6">
                <select
                  value={selectedTarget || ""}
                  onChange={(e) => setSelectedTarget(e.target.value || null)}
                  disabled={copyJob.status === "running"}
                  className="w-full bg-slate-700 text-slate-100 border border-slate-600 rounded-lg px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="">-- Selecciona una nube --</option>
                  {copyOptions?.target_accounts && copyOptions.target_accounts.length > 0 ? (
                    copyOptions.target_accounts.map((account) => {
                      const value = `${account.provider}:${account.account_id}`;
                      const providerIcon = account.provider === "google_drive" ? "📁" : "🟦";
                      return (
                        <option key={value} value={value}>
                          {providerIcon} {account.email}
                        </option>
                      );
                    })
                  ) : (
                    <option disabled>No hay cuentas destino disponibles</option>
                  )}
                </select>
              </div>

              {/* Progress (unified view using copyJob for batch) */}
              {copyJob.status === "running" && (
                <div className="mb-6 space-y-3">
                  {copyJob.total > 0 ? (
                    <>
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-slate-300 font-semibold">
                          Copiando {copyJob.completed} / {copyJob.total}
                        </p>
                        <span className="text-sm text-emerald-400">
                          {Math.round((copyJob.completed / copyJob.total) * 100)}%
                        </span>
                      </div>
                      {copyJob.currentFile && (
                        <p className="text-xs text-slate-400 truncate">
                          Archivo actual: <span className="text-slate-300">{copyJob.currentFile}</span>
                        </p>
                      )}
                      <div className="w-full h-3 bg-slate-700 rounded-full overflow-hidden border border-slate-600">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-300"
                          style={{ width: `${(copyJob.completed / copyJob.total) * 100}%` }}
                        />
                      </div>
                      <p className="text-xs text-slate-400 flex items-center gap-1.5">
                        <span>⏱️</span>
                        <span>En cola: {copyJob.total - copyJob.completed} archivo(s)</span>
                      </p>
                    </>
                  ) : (
                    <div className="flex items-center gap-3 text-slate-300">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-emerald-400"></div>
                      <p className="text-sm">Preparando copia...</p>
                    </div>
                  )}
                </div>
              )}

              {/* Progress Bar (shown during single file copy) */}
              {!batchCopyingFromMenu && copying && (
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm text-slate-300">{copyStatus}</p>
                    <span className="text-sm font-semibold text-emerald-400">{Math.round(copyProgress)}%</span>
                  </div>
                  <div className="w-full h-3 bg-slate-700 rounded-full overflow-hidden border border-slate-600">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-300"
                      style={{ width: `${copyProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Status Message (single file) */}
              {!batchCopyingFromMenu && copyStatus && !copying && (
                <div className={`mb-6 p-3 rounded-lg text-sm font-medium ${
                  copyStatus.includes("✅")
                    ? "bg-emerald-500/20 border border-emerald-500 text-emerald-100"
                    : copyStatus.includes("ℹ️")
                    ? "bg-blue-500/20 border border-blue-500 text-blue-100"
                    : "bg-red-500/20 border border-red-500 text-red-100"
                }`}>
                  {copyStatus}
                </div>
              )}

              {/* Results (success or partial) */}
              {copyJob.status === "done" && (
                <div className="mb-6 p-4 bg-slate-700/50 rounded-lg border border-slate-600">
                  {batchResults ? (
                    <>
                      <h3 className="font-semibold text-white mb-2">Resultado:</h3>
                      <div className="space-y-1 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="text-emerald-400">✅ Éxito:</span>
                          <span className="text-white font-semibold">{batchResults.success}</span>
                        </div>
                        {batchResults.skipped > 0 && (
                          <div className="flex items-center gap-2">
                            <span className="text-blue-400">ℹ️ Omitidos (ya existían):</span>
                            <span className="text-white font-semibold">{batchResults.skipped}</span>
                          </div>
                        )}
                        {batchResults.failed > 0 && (
                          <div className="flex items-center gap-2">
                            <span className="text-red-400">❌ Fallidos:</span>
                            <span className="text-white font-semibold">{batchResults.failed}</span>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-emerald-300">✅ Copia completada</p>
                  )}
                </div>
              )}

              {/* Error state */}
              {copyJob.status === "error" && copyJob.error && (
                <div className="mb-6 p-4 bg-red-500/20 rounded-lg border border-red-500">
                  <h3 className="font-semibold text-red-100 mb-2">❌ Error:</h3>
                  <p className="text-sm text-red-200">{copyJob.error}</p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={closeCopyModal}
                  className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-lg text-sm font-semibold transition"
                >
                  {copyJob.status === "running" ? "Ocultar" : "Cerrar"}
                </button>
                <button
                  type="button"
                  onClick={confirmCopy}
                  disabled={!selectedTarget || copyJob.status === "running" || copyJob.status === "done"}
                  className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold transition"
                >
                  {copyJob.status === "running" 
                    ? `Copiando... (${copyJob.completed}/${copyJob.total})` 
                    : copyJob.status === "done"
                    ? "Completado"
                    : "Copiar"}
                </button>
              </div>
            </div>
          </div>
        )}

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

        {/* Context Menu */}
        {contextMenu?.visible && (
          <ContextMenu
            visible={contextMenu.visible}
            x={contextMenu.x}
            y={contextMenu.y}
            fileId={contextMenu.fileId}
            fileName={contextMenu.fileName}
            mimeType={contextMenu.mimeType}
            webViewLink={contextMenu.webViewLink}
            isFolder={contextMenu.isFolder}
            onClose={closeContextMenu}
            onOpenFolder={(id, name) => handleOpenFolder(id, name)}
            onCopy={(id, name) => openCopyModal(id, name)}
            onRename={(id, name) => openRenameModal(id, name)}
            onDownload={(id, name) => handleDownloadFile(id, name)}
            onOpenInProvider={(id, name) => handleOpenInProvider(id, name)}
            onShareInProvider={(id, name) => handleShareInProvider(id, name)}
            copyDisabled={copying || !copyOptions || copyOptions.target_accounts.length === 0}
          />
        )}

        {/* Transfer Modal (Google Drive → OneDrive) */}
        <TransferModal
          isOpen={showTransferModal}
          onClose={() => setShowTransferModal(false)}
          sourceAccountId={parseInt(accountId)}
          selectedFileIds={Array.from(selectedFiles)}
          onTransferComplete={() => {
            // Optionally refresh files or show success message
            setQuotaRefreshKey(prev => prev + 1);
          }}
        />
      </div>
      </>
      )}

      {/* Reconnect Modal */}
      <ReconnectSlotsModal
        isOpen={showReconnectModal}
        onClose={() => setShowReconnectModal(false)}
      />
    </main>
  );
}
