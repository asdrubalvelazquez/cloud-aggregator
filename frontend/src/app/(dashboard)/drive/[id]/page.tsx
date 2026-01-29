"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useCopyContext } from "@/context/CopyContext";
import { useCloudStatusQuery, CLOUD_STATUS_KEY } from "@/queries/useCloudStatusQuery";
import { authenticatedFetch } from "@/lib/api";
import type { CloudAccountStatus } from "@/lib/api";
import QuotaBadge from "@/components/QuotaBadge";
import RowActionsMenu from "@/components/RowActionsMenu";
import RenameModal from "@/components/RenameModal";
import ContextMenu from "@/components/ContextMenu";
import GooglePickerButton from "@/components/GooglePickerButton";
import { DriveLoadingState } from "@/components/DriveLoadingState";
import UnifiedCopyModal from "@/components/UnifiedCopyModal";
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
  const searchParams = useSearchParams();
  const accountId = params.id as string;
  const queryClient = useQueryClient();

  // Debug mode (persistent via localStorage)
  const debug =
    searchParams?.get("debug") === "1" ||
    (typeof window !== "undefined" && localStorage.getItem("ca_debug") === "1");
  const [lastClickTarget, setLastClickTarget] = useState<string>("");
  const [lastCtxTarget, setLastCtxTarget] = useState<string>("");

  // Save debug flag to localStorage when enabled via query param
  useEffect(() => {
    if (typeof window !== "undefined" && searchParams?.get("debug") === "1") {
      localStorage.setItem("ca_debug", "1");
    }
  }, [searchParams]);

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
  
  // View mode state (list or grid)
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  
  // Filter states
  const [filterType, setFilterType] = useState<string>("all");
  const [filterOwner, setFilterOwner] = useState<string>("all");
  const [filterModified, setFilterModified] = useState<string>("all");
  
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
    setShowReconnectModal(false);
    
    return () => {
      setIsSwitchingAccount(false);
    };
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
        const errorMessage = e.message || "Error al cargar archivos";
        setError(errorMessage);
        
        // If 401 error, invalidate cloud status cache to update modal
        if (errorMessage.includes("401") || errorMessage.includes("HTTP 401") || errorMessage.includes("Error API archivos: 401")) {
          console.log("[Drive] 401 detected, invalidating cloud status cache");
          queryClient.invalidateQueries({ queryKey: [CLOUD_STATUS_KEY] });
          // Show reconnect modal
          setShowReconnectModal(true);
        }
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

  // Consume cloud status from React Query (replaces CloudStatusContext)
  const { data: cloudStatus, error: cloudError } = useCloudStatusQuery();

  // Check connection status and load files
  useEffect(() => {
    if (!accountId) return;
    
    console.log("[Drive] Loading account:", accountId);
    
    // Clear state immediately for smooth transition
    setFiles([]);
    setCurrentFolderId("root");
    setSelectedFiles(new Set());
    setError(null);
    setNextPageToken(null);
    setLoading(true);
    
    // Wait for cloudStatus to load from React Query (cached, no refetch needed)
    if (!cloudStatus) {
      console.log("[Drive] Waiting for cloudStatus...");
      setCheckingConnection(true);
      if (cloudError) {
        setCheckingConnection(false);
        setLoading(false);
        console.error("[Drive] CloudStatus error:", cloudError);
      }
      return;
    }

    const accountIdNum = parseInt(accountId, 10);
    
    // Validate accountId is a valid number
    if (isNaN(accountIdNum)) {
      console.error("[Drive] Invalid accountId:", accountId);
      setAccountStatus(null);
      setCheckingConnection(false);
      setError("ID de cuenta inválido");
      setLoading(false);
      return;
    }
    
    // Find account by cloud_account_id
    const account = cloudStatus.accounts.find(
      (acc) => acc.cloud_account_id === accountIdNum
    );
    
    setCheckingConnection(false);
    
    // Handle account not found
    if (!account) {
      console.warn("[Drive] Account not found:", accountId);
      setAccountStatus(null);
      setError("Cuenta no encontrada");
      setLoading(false);
      return;
    }
    
    setAccountStatus(account);

    const isConnected = account.connection_status === "connected";
    
    // Show reconnect modal if account needs reconnection
    if (!isConnected) {
      console.log("[Drive] Account needs reconnection");
      setShowReconnectModal(true);
      setLoading(false);
      return;
    }
    
    // Load files immediately
    console.log("[Drive] Fetching files...");
    fetchFiles("root", null);
    fetchCopyOptions();
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
    // Allow selection of both files and folders
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
    const selectable = files.filter(f => f.mimeType !== "application/vnd.google-apps.folder");
    const selectableIds = new Set(selectable.map(f => f.id));

    setSelectedFiles(prev => {
      const allSelected = selectable.every(f => prev.has(f.id));
      if (allSelected) return new Set();
      return new Set(selectableIds);
    });
  }, [files]);

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
            alert(errorData.detail?.message || "Límite de transferencia alcanzado. Proceso detenido.");
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
      // Find the file to get its webViewLink
      const file = files.find(f => f.id === fileId);
      if (file && file.webViewLink) {
        // Open in new tab - user can download from Google Drive
        window.open(file.webViewLink, "_blank", "noopener,noreferrer");
      } else {
        // Fallback to direct download URL
        const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
        window.open(downloadUrl, "_blank", "noopener,noreferrer");
      }
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
  const handleRowClick = (fileId: string, mimeType: string) => {
    // Debounce to distinguish from double click
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
    }
    
    clickTimerRef.current = setTimeout(() => {
      setSelectedRowId(fileId);
      // Single-select behavior: clear previous selections and select only this file
      setSelectedFiles(new Set([fileId]));
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

  // Derived filtered and sorted files (use displayFiles for smooth transitions)
  const sortedFiles = (() => {
    if (!displayFiles) return displayFiles;
    
    // First apply filters
    let filtered = [...displayFiles];
    
    // Filter by type
    if (filterType !== "all") {
      filtered = filtered.filter(file => {
        const mimeType = file.mimeType || "";
        switch (filterType) {
          case "folder":
            return mimeType.includes("folder");
          case "document":
            return mimeType.includes("document") || mimeType.includes("text") || mimeType.includes("word");
          case "spreadsheet":
            return mimeType.includes("spreadsheet") || mimeType.includes("excel");
          case "presentation":
            return mimeType.includes("presentation") || mimeType.includes("powerpoint");
          case "pdf":
            return mimeType.includes("pdf");
          case "image":
            return mimeType.includes("image");
          case "video":
            return mimeType.includes("video");
          default:
            return true;
        }
      });
    }
    
    // Filter by owner (for now "yo" shows all, "shared" shows none since we only have own files)
    if (filterOwner !== "all") {
      // In the future, this would filter by file.owners or file.shared property
      // For now, all files are "mine" so "shared" shows nothing
      if (filterOwner === "shared") {
        filtered = filtered.filter(file => file.shared === true);
      }
      // "me" shows all files (default behavior)
    }
    
    // Filter by modification date
    if (filterModified !== "all") {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
      const yearAgo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
      
      filtered = filtered.filter(file => {
        if (!file.modifiedTime) return false;
        const modDate = new Date(file.modifiedTime);
        switch (filterModified) {
          case "today":
            return modDate >= today;
          case "week":
            return modDate >= weekAgo;
          case "month":
            return modDate >= monthAgo;
          case "year":
            return modDate >= yearAgo;
          default:
            return true;
        }
      });
    }
    
    // Then apply sorting if specified
    if (!sortBy) return filtered;
    
    const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });
    filtered.sort((a, b) => {
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
    if (sortDir === "desc") filtered.reverse();
    return filtered;
  })();
  
  // Check if any filters are active
  const hasActiveFilters = filterType !== "all" || filterOwner !== "all" || filterModified !== "all";
  
  // Clear all filters function
  const clearFilters = () => {
    setFilterType("all");
    setFilterOwner("all");
    setFilterModified("all");
  };

  const toggleSort = (key: "name" | "size" | "modifiedTime" | "mimeType") => {
    if (sortBy === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortBy(key);
      setSortDir("asc");
    }
  };

  // Reset UI handler (debug only)
  const handleResetUI = async () => {
    if (!debug) return;
    
    // Close all modals
    setShowCopyModal(false);
    setShowRenameModal(false);
    setShowReconnectModal(false);
    
    // Clear selections and menus
    setSelectedFiles(new Set());
    setContextMenu(null);
    setSelectedRowId(null);
    
    // Activate switching indicator
    setIsSwitchingAccount(true);
    
    // Reload files
    await fetchFiles(currentFolderId);
    
    // Deactivate switching indicator
    setIsSwitchingAccount(false);
  };

  // Disable debug handler
  const handleDisableDebug = () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("ca_debug");
      window.location.reload();
    }
  };

  return (
    <main 
      className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center p-6"
      onClickCapture={(e) => debug && setLastClickTarget((e.target as HTMLElement)?.tagName + "." + ((e.target as HTMLElement)?.className || ""))}
      onContextMenuCapture={(e) => debug && setLastCtxTarget((e.target as HTMLElement)?.tagName + "." + ((e.target as HTMLElement)?.className || ""))}
    >
      {/* Debug Panel */}
      {debug && (
        <div className="w-full max-w-6xl mb-4 rounded-lg border border-yellow-500/50 bg-slate-900/90 p-3 text-xs text-slate-200 font-mono">
          <div className="flex items-center justify-between mb-2">
            <span className="text-yellow-400 font-bold">🐛 DEBUG MODE</span>
            <div className="flex gap-2">
              <button
                onClick={handleResetUI}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded text-white font-semibold text-xs transition"
              >
                Reset UI
              </button>
              <button
                onClick={handleDisableDebug}
                className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-white font-semibold text-xs transition"
              >
                Disable Debug
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <div>debug=1</div>
            <div>accountId: {accountId}</div>
            <div>isSwitchingAccount: {String(isSwitchingAccount)}</div>
            <div>files: {files.length}, displayFiles: {displayFiles.length}</div>
            <div>selectedFiles.size: {selectedFiles.size}</div>
            <div>selectedRowId: {selectedRowId || "null"}</div>
            <div>contextMenu: {contextMenu?.visible ? "open" : "closed"}</div>
            <div>modals: copy={String(showCopyModal)} rename={String(showRenameModal)} reconnect={String(showReconnectModal)}</div>
            <div>loading: {String(loading)}, error: {error || "null"}</div>
            <div>currentFolderId: {currentFolderId || "root"}</div>
            <div className="col-span-2">lastClickTarget: {lastClickTarget}</div>
            <div className="col-span-2">lastCtxTarget: {lastCtxTarget}</div>
          </div>
        </div>
      )}

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
      {!checkingConnection && (!accountStatus || accountStatus.connection_status === "disconnected") && (
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
        {/* Banner de reauth si auth_notice */}
        {accountStatus.auth_notice && accountStatus.auth_notice.type === "reauth_required" && (
          <div className="w-full max-w-6xl mb-4 rounded-lg border border-yellow-400 bg-yellow-900/80 p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">⚠️</span>
              <span className="text-yellow-100 font-medium">
                Re-auth required to access files
                {accountStatus.auth_notice.reason && (
                  <span className="ml-2 text-yellow-200 text-sm">({accountStatus.auth_notice.reason})</span>
                )}
              </span>
            </div>
            <button
              onClick={() => setShowReconnectModal(true)}
              className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg font-semibold transition"
            >
              Reconnect
            </button>
          </div>
        )}
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

      <div className="w-full max-w-6xl space-y-4">
        {/* Breadcrumb Navigation */}
        <div className="flex items-center gap-2 text-sm">
          {breadcrumb.map((crumb, index) => (
            <div key={crumb.id} className="flex items-center gap-2">
              {index > 0 && <span className="text-slate-600">/</span>}
              <button
                onClick={() => handleBreadcrumbClick(index)}
                className={`${
                  index === breadcrumb.length - 1
                    ? "text-slate-300 font-medium"
                    : "text-slate-400 hover:text-slate-200"
                } transition`}
              >
                {crumb.name}
              </button>
            </div>
          ))}
        </div>

        {/* Filters Bar (hidden when files selected) or Action Bar - Google Drive Style */}
        <div className="flex items-center justify-between gap-3">
          {selectedFiles.size === 0 ? (
            <>
              <div className="flex items-center gap-2">
                {/* Tipo Filter */}
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className={`px-3 py-1.5 border rounded-lg text-sm transition cursor-pointer ${
                    filterType !== "all" 
                      ? "bg-blue-600/20 border-blue-500 text-blue-300" 
                      : "bg-transparent border-slate-700 text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  <option value="all">Tipo</option>
                  <option value="folder">📁 Carpetas</option>
                  <option value="document">📄 Documentos</option>
                  <option value="spreadsheet">📊 Hojas de cálculo</option>
                  <option value="presentation">📽️ Presentaciones</option>
                  <option value="pdf">📕 PDF</option>
                  <option value="image">🖼️ Imágenes</option>
                  <option value="video">🎥 Videos</option>
                </select>

                {/* Personas Filter */}
                <select
                  value={filterOwner}
                  onChange={(e) => setFilterOwner(e.target.value)}
                  className={`px-3 py-1.5 border rounded-lg text-sm transition cursor-pointer ${
                    filterOwner !== "all" 
                      ? "bg-blue-600/20 border-blue-500 text-blue-300" 
                      : "bg-transparent border-slate-700 text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  <option value="all">Personas</option>
                  <option value="me">👤 yo</option>
                  <option value="shared">👥 Compartidos conmigo</option>
                </select>

                {/* Modificado Filter */}
                <select
                  value={filterModified}
                  onChange={(e) => setFilterModified(e.target.value)}
                  className={`px-3 py-1.5 border rounded-lg text-sm transition cursor-pointer ${
                    filterModified !== "all" 
                      ? "bg-blue-600/20 border-blue-500 text-blue-300" 
                      : "bg-transparent border-slate-700 text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  <option value="all">Modificado</option>
                  <option value="today">📅 Hoy</option>
                  <option value="week">📅 Esta semana</option>
                  <option value="month">📅 Este mes</option>
                  <option value="year">📅 Este año</option>
                </select>

                {/* Clear Filters Button - Only show when filters are active */}
                {hasActiveFilters && (
                  <button
                    onClick={clearFilters}
                    className="px-3 py-1.5 bg-red-600/20 border border-red-500 text-red-300 rounded-lg text-sm hover:bg-red-600/30 transition flex items-center gap-1.5"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Limpiar filtros
                  </button>
                )}
              </div>
            </>
          ) : (
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
                        isFolder: file.mimeType === "application/vnd.google-apps.folder",
                        webViewLink: file.webViewLink
                      } : null;
                    })()
                  : null
              }
              onClearSelection={() => setSelectedFiles(new Set())}
              onShareInProvider={() => {
                if (selectedFiles.size === 1) {
                  const fileId = Array.from(selectedFiles)[0];
                  const file = files.find(f => f.id === fileId);
                  if (file && file.webViewLink) {
                    window.open(file.webViewLink, "_blank", "noopener,noreferrer");
                  }
                }
              }}
              onDownloadSelected={() => {
                const fileIds = Array.from(selectedFiles);
                fileIds.forEach(fileId => {
                  const file = files.find(f => f.id === fileId);
                  if (file) {
                    handleDownloadFile(fileId, file.name);
                  }
                });
              }}
              onCopySelected={() => {
                if (selectedFiles.size === 1) {
                  const fileId = Array.from(selectedFiles)[0];
                  const file = files.find(f => f.id === fileId);
                  if (file) {
                    setModalFileId(fileId);
                    setModalFileName(file.name);
                  }
                } else if (selectedFiles.size > 1) {
                  setModalFileId(null);
                  setModalFileName(`${selectedFiles.size} archivos seleccionados`);
                }
                setShowCopyModal(true);
              }}
              onGetLink={() => {
                if (selectedFiles.size === 1) {
                  const fileId = Array.from(selectedFiles)[0];
                  const file = files.find(f => f.id === fileId);
                  if (file && file.webViewLink) {
                    navigator.clipboard.writeText(file.webViewLink);
                    // Show toast notification
                    const toast = document.createElement('div');
                    toast.className = 'fixed bottom-4 right-4 bg-slate-800 border border-slate-600 text-white px-4 py-2 rounded-lg shadow-lg z-50';
                    toast.textContent = 'Enlace copiado al portapapeles';
                    document.body.appendChild(toast);
                    setTimeout(() => toast.remove(), 3000);
                  }
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
          )}

          {/* View Toggle & Actions */}
          <div className="flex items-center gap-2">
            {/* View Mode Toggle */}
            <div className="flex items-center border border-slate-700 rounded-lg overflow-hidden">
              <button
                onClick={() => setViewMode("list")}
                className={`p-2 transition ${
                  viewMode === "list"
                    ? "bg-blue-600 text-white"
                    : "text-slate-400 hover:bg-slate-800"
                }`}
                title="Vista de lista"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <button
                onClick={() => setViewMode("grid")}
                className={`p-2 transition ${
                  viewMode === "grid"
                    ? "bg-blue-600 text-white"
                    : "text-slate-400 hover:bg-slate-800"
                }`}
                title="Vista de cuadrícula"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
              </button>
            </div>

            {/* Info Button */}
            <button
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
              title="Información"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          </div>
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

        {/* Files View - Google Drive Style (List or Grid) */}
        {!loading && !error && files.length > 0 && (
          <div 
            ref={filesContainerRef}
            key={accountId} 
            className="bg-transparent rounded-xl overflow-hidden"
          >
            {/* Show filter results count when filters are active */}
            {hasActiveFilters && (
              <div className="mb-3 text-sm text-slate-400">
                Mostrando {sortedFiles.length} de {files.length} archivos
              </div>
            )}

            {/* GRID VIEW */}
            {viewMode === "grid" && (
              <div 
                className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 p-4 max-h-[600px] overflow-y-auto"
                onClick={() => setSelectedRowId(null)}
                onPointerDownCapture={() => contextMenu?.visible && closeContextMenu()}
              >
                {sortedFiles.map((file) => (
                  <div
                    key={`${accountId}:${file.id}`}
                    className={`
                      group relative rounded-xl p-3 transition-all cursor-pointer
                      ${selectedFiles.has(file.id) 
                        ? 'bg-blue-600/20 ring-2 ring-blue-500' 
                        : selectedRowId === file.id 
                        ? 'bg-slate-800/60' 
                        : 'bg-slate-800/30 hover:bg-slate-800/50'
                      }
                    `}
                    onClick={(e) => {
                      const target = e.target as HTMLElement;
                      if (target.tagName === 'INPUT' || target.closest('input')) return;
                      e.stopPropagation();
                      handleRowClick(file.id, file.mimeType);
                    }}
                    onDoubleClick={(e) => {
                      const target = e.target as HTMLElement;
                      if (target.tagName === 'INPUT' || target.closest('input')) return;
                      e.stopPropagation();
                      handleRowDoubleClick(file);
                    }}
                    onContextMenu={(e) => handleRowContextMenu(e, file)}
                  >
                    {/* Checkbox - top left corner */}
                    <div className={`absolute top-2 left-2 transition-opacity ${
                      selectedFiles.has(file.id) || selectedRowId === file.id 
                        ? 'opacity-100' 
                        : 'opacity-0 group-hover:opacity-100'
                    }`}>
                      <input
                        type="checkbox"
                        checked={selectedFiles.has(file.id)}
                        onChange={() => toggleFileSelection(file.id, file.mimeType)}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        disabled={file.mimeType === "application/vnd.google-apps.folder"}
                        className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-emerald-500 focus:ring-2 focus:ring-emerald-500 disabled:opacity-30 disabled:cursor-not-allowed"
                      />
                    </div>

                    {/* File Icon - Large centered */}
                    <div className="flex justify-center items-center h-20 mb-3">
                      <span className="text-5xl">{getFileIcon(file.mimeType)}</span>
                    </div>

                    {/* File Name - truncated */}
                    <div className="text-sm text-slate-200 text-center truncate px-1" title={file.name}>
                      {file.name}
                    </div>

                    {/* File Info - smaller text */}
                    <div className="text-xs text-slate-500 text-center mt-1">
                      {file.modifiedTime ? formatDate(file.modifiedTime) : ""}
                    </div>

                    {/* Kebab menu - top right corner */}
                    <div className={`absolute top-2 right-2 transition-opacity ${
                      selectedRowId === file.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}>
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
                  </div>
                ))}
              </div>
            )}

            {/* LIST VIEW (Table) */}
            {viewMode === "list" && (
            <div 
              className="max-h-[600px] overflow-y-auto"
              onClick={() => setSelectedRowId(null)}
              onPointerDownCapture={() => contextMenu?.visible && closeContextMenu()}
            >
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-slate-700 text-slate-400">
                  <th className="py-3 px-4">
                    <button
                      type="button"
                      onClick={() => toggleSort("name")}
                      className="flex items-center gap-1.5 hover:text-slate-200 transition"
                      aria-label="Ordenar por nombre"
                    >
                      <span className="font-normal text-xs">Nombre</span>
                      {sortBy === "name" && (
                        <span className="text-xs">{sortDir === "asc" ? "↑" : "↓"}</span>
                      )}
                    </button>
                  </th>
                  <th className="py-3 px-4">
                    <span className="font-normal text-xs">Propietario</span>
                  </th>
                  <th className="py-3 px-4">
                    <button
                      type="button"
                      onClick={() => toggleSort("modifiedTime")}
                      className="flex items-center gap-1.5 hover:text-slate-200 transition"
                      aria-label="Ordenar por fecha"
                    >
                      <span className="font-normal text-xs">Fecha de modificación</span>
                      {sortBy === "modifiedTime" && (
                        <span className="text-xs">{sortDir === "asc" ? "↑" : "↓"}</span>
                      )}
                    </button>
                  </th>
                  <th className="py-3 px-4">
                    <button
                      type="button"
                      onClick={() => toggleSort("size")}
                      className="flex items-center gap-1.5 hover:text-slate-200 transition"
                      aria-label="Ordenar por tamaño"
                    >
                      <span className="font-normal text-xs">Tamaño del archivo</span>
                      {sortBy === "size" && (
                        <span className="text-xs">{sortDir === "asc" ? "↑" : "↓"}</span>
                      )}
                    </button>
                  </th>
                  <th className="py-3 px-4 text-center w-12"></th>
                </tr>
              </thead>
              <tbody>
                {sortedFiles.map((file) => (
                  <tr
                    key={`${accountId}:${file.id}`}
                    className={`
                      border-b border-slate-800/50
                      transition-colors
                      cursor-pointer
                      ${selectedFiles.has(file.id)
                        ? 'bg-blue-600/20'
                        : selectedRowId === file.id 
                        ? 'bg-slate-800/40' 
                        : 'hover:bg-slate-800/20'
                      }
                    `}
                    onClick={(e) => {
                      const target = e.target as HTMLElement;
                      if (
                        target.tagName === 'BUTTON' ||
                        target.closest('button')
                      ) {
                        return;
                      }
                      e.stopPropagation();
                      // Single-select behavior: replace previous selection
                      setSelectedRowId(file.id);
                      setSelectedFiles(new Set([file.id]));
                    }}
                    onDoubleClick={(e) => {
                      const target = e.target as HTMLElement;
                      if (
                        target.tagName === 'BUTTON' ||
                        target.closest('button')
                      ) {
                        return;
                      }
                      e.stopPropagation();
                      if (file.mimeType === "application/vnd.google-apps.folder") {
                        handleOpenFolder(file.id, file.name);
                      } else if (file.webViewLink) {
                        window.open(file.webViewLink, "_blank", "noopener,noreferrer");
                      }
                    }}
                    onContextMenu={(e) => handleRowContextMenu(e, file)}
                  >
                    {/* Nombre con icono - Google Drive style */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <span className="text-lg">{getFileIcon(file.mimeType)}</span>
                        <span className="text-sm text-slate-200">{file.name}</span>
                      </div>
                    </td>

                    {/* Propietario - Always "yo" */}
                    <td className="px-4 py-2.5 text-sm text-slate-400">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-emerald-600 flex items-center justify-center text-xs text-white font-semibold">
                          {copyOptions?.source_account.email.charAt(0).toUpperCase()}
                        </div>
                        <span>yo</span>
                      </div>
                    </td>

                    {/* Fecha de modificación */}
                    <td className="px-4 py-2.5 text-sm text-slate-400">
                      {file.modifiedTime ? formatDate(file.modifiedTime) : "—"}
                    </td>

                    {/* Tamaño del archivo */}
                    <td className="px-4 py-2.5 text-sm text-slate-400">
                      {file.mimeType === "application/vnd.google-apps.folder" 
                        ? "—"
                        : file.size && Number(file.size) > 0
                        ? formatFileSize(Number(file.size))
                        : "—"}
                    </td>

                    {/* Acciones - Kebab Menu */}
                    <td className="px-4 py-2.5">
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
            )}
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

        {/* Unified Copy Modal (Google Drive → Google or OneDrive) */}
        <UnifiedCopyModal
          isOpen={showCopyModal}
          onClose={() => {
            setShowCopyModal(false);
            setModalFileId(null);
            setModalFileName(null);
          }}
          sourceAccountId={parseInt(accountId)}
          selectedFileIds={Array.from(selectedFiles)}
          selectedFileLabel={modalFileName || "archivo"}
          copyOptions={copyOptions}
          onSuccess={() => {
            // Refresh files and quota
            fetchFiles(currentFolderId, null);
            setQuotaRefreshKey(prev => prev + 1);
            setSelectedFiles(new Set());
          }}
          onViewInDestination={(targetAccountId, folderId) => {
            router.push(`/onedrive/${targetAccountId}/${folderId || "root"}`);
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
