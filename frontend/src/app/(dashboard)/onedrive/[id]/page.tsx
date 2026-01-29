"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useCloudStatusQuery, CLOUD_STATUS_KEY } from "@/queries/useCloudStatusQuery";
import { fetchOneDriveFiles, fetchOneDriveAccountInfo, renameOneDriveItem, getOneDriveDownloadUrl } from "@/lib/api";
import { authenticatedFetch } from "@/lib/api";
import type { OneDriveListResponse, OneDriveItem, CloudAccountStatus } from "@/lib/api";
import OnedriveRowActionsMenu from "@/components/OnedriveRowActionsMenu";
import OneDriveRenameModal from "@/components/OneDriveRenameModal";
import ReconnectSlotsModal from "@/components/ReconnectSlotsModal";
import ContextMenu from "@/components/ContextMenu";
import FileActionBar from "@/components/FileActionBar";

export default function OneDriveFilesPage() {
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

  // Account info
  const [accountEmail, setAccountEmail] = useState<string | null>(null);

  // Navigation state
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<{ id: string | null; name: string }[]>([
    { id: null, name: "Root" },
  ]);

  const [files, setFiles] = useState<OneDriveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // View mode state (list or grid)
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  
  // Filter states
  const [filterType, setFilterType] = useState<string>("all");
  const [filterOwner, setFilterOwner] = useState<string>("all");
  const [filterModified, setFilterModified] = useState<string>("all");

  // Rename modal state
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameItemId, setRenameItemId] = useState<string | null>(null);
  const [renameItemName, setRenameItemName] = useState<string>("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameStatus, setRenameStatus] = useState<string | null>(null);

  // Abort controller for cancelling requests
  const fetchAbortRef = useRef<AbortController | null>(null);
  const fetchSeqRef = useRef(0);

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

  // Close context menu
  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Ref for files container (to prevent native context menu)
  const filesContainerRef = useRef<HTMLDivElement>(null);

  // Multi-select state
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  // Smooth switching: keep previous files visible while loading new account
  const [displayFiles, setDisplayFiles] = useState<any[]>([]);
  const [isSwitchingAccount, setIsSwitchingAccount] = useState(false);

  // Reset UI state when cloud account changes (prevents stale menu/actionbar)
  useEffect(() => {
    setIsSwitchingAccount(true);  // Activate switching indicator
    
    setSelectedFiles(new Set());
    setContextMenu(null);
    
    // Close any open overlays/modals on cloud switch
    setShowRenameModal(false);
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

  // Consume cloud status from React Query (replaces CloudStatusContext)
  const { data: cloudStatus, error: cloudError } = useCloudStatusQuery();

  // Check connection status and load files
  useEffect(() => {
    if (!accountId) return;
    
    console.log("[OneDrive] Loading account:", accountId);
    
    // Clear state immediately for smooth transition
    setFiles([]);
    setCurrentFolderId("root");
    setSelectedFiles(new Set());
    setError(null);
    setLoading(true);
    
    // Wait for cloudStatus to load from React Query (cached, no refetch needed)
    if (!cloudStatus) {
      console.log("[OneDrive] Waiting for cloudStatus...");
      setCheckingConnection(true);
      if (cloudError) {
        setCheckingConnection(false);
        setLoading(false);
        console.error("[OneDrive] CloudStatus error:", cloudError);
      }
      return;
    }

    // Find account by provider_account_uuid (OneDrive uses UUID, not numeric ID)
    const account = cloudStatus.accounts.find(
      (acc) => acc.provider_account_uuid === accountId
    );
    
    setCheckingConnection(false);
    
    // Handle account not found
    if (!account) {
      console.warn("[OneDrive] Account not found:", accountId);
      setAccountStatus(null);
      setError("Cuenta no encontrada");
      setLoading(false);
      return;
    }
    
    setAccountStatus(account);

    const isConnected = account.connection_status === "connected";
    
    // Show reconnect modal if account needs reconnection
    if (!isConnected) {
      console.warn("[OneDrive] Account not connected:", account.connection_status);
      setShowReconnectModal(true);
      setError(`Esta cuenta ${account.connection_status === "disconnected" ? "está desconectada" : "necesita reconexión"}`);
      setLoading(false);
      return;
    }
    
    // Load files immediately
    console.log("[OneDrive] Fetching files...");
    
    // Fetch account info
    fetchOneDriveAccountInfo(accountId)
      .then((info) => setAccountEmail(info.account_email))
      .catch((err) => console.error("Failed to fetch account info:", err));
    
    // Fetch files
    fetchFiles(null);
    
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  // Close context menu when account changes
  useEffect(() => {
    console.log(`[PAGE_MOUNT] onedrive accountId=${accountId}`);
    closeContextMenu();
    
    return () => {
      console.log(`[PAGE_UNMOUNT] onedrive accountId=${accountId}`);
    };
  }, [accountId, closeContextMenu]);


  // Fetch files from OneDrive
  const fetchFiles = async (parentId: string | null = null) => {
    // Abort any in-flight fetch
    if (fetchAbortRef.current) {
      try {
        fetchAbortRef.current.abort();
      } catch (e) {
        // Ignore
      }
    }

    const seq = ++fetchSeqRef.current;
    const controller = new AbortController();
    fetchAbortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const data = await fetchOneDriveFiles(accountId, parentId || undefined);

      // Only update if this is still the latest request
      if (seq === fetchSeqRef.current) {
        setFiles(data.items || []);
        setCurrentFolderId(parentId);
      }
    } catch (e: any) {
      if (seq === fetchSeqRef.current) {
        const errorMessage = e.message || "Error al cargar archivos de OneDrive";
        setError(errorMessage);
        
        // If 401 error, invalidate cloud status cache to update modal
        if (errorMessage.includes("401") || errorMessage.includes("HTTP 401")) {
          console.log("[OneDrive] 401 detected, invalidating cloud status cache");
          queryClient.invalidateQueries({ queryKey: [CLOUD_STATUS_KEY] });
          // Show reconnect modal
          setShowReconnectModal(true);
        }
      }
    } finally {
      if (seq === fetchSeqRef.current) {
        setLoading(false);
        if (fetchAbortRef.current === controller) {
          fetchAbortRef.current = null;
        }
      }
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      fetchSeqRef.current += 1;
      if (fetchAbortRef.current) {
        try {
          fetchAbortRef.current.abort();
        } catch (e) {
          // Ignore
        }
        fetchAbortRef.current = null;
      }
    };
  }, []);

  const handleOpenFolder = (folderId: string, folderName: string) => {
    setBreadcrumb((prev) => [...prev, { id: folderId, name: folderName }]);
    fetchFiles(folderId);
  };

  const handleBreadcrumbClick = (index: number) => {
    const target = breadcrumb[index];
    const newTrail = breadcrumb.slice(0, index + 1);
    setBreadcrumb(newTrail);
    fetchFiles(target.id);
  };

  const handleBack = () => {
    if (breadcrumb.length > 1) {
      const newTrail = breadcrumb.slice(0, -1);
      const parent = newTrail[newTrail.length - 1];
      setBreadcrumb(newTrail);
      fetchFiles(parent.id);
    }
  };

  // Single-select handler (replaces previous selection)
  const toggleFileSelection = (fileId: string) => {
    setSelectedFiles(prev => {
      // If clicking the same file, toggle it off
      if (prev.has(fileId) && prev.size === 1) {
        return new Set();
      }
      // Otherwise, replace selection with only this file (single-select)
      return new Set([fileId]);
    });
  };

  const handleRename = (itemId: string, itemName: string) => {
    setRenameItemId(itemId);
    setRenameItemName(itemName);
    setShowRenameModal(true);
    setRenameStatus(null);
  };

  const handleRenameConfirm = async (newName: string) => {
    if (!renameItemId) return;

    setIsRenaming(true);
    setRenameStatus(null);

    try {
      await renameOneDriveItem(accountId, renameItemId, newName);
      setRenameStatus("success");
      setShowRenameModal(false);
      
      // Refresh files list
      fetchFiles(currentFolderId);
    } catch (err: any) {
      setRenameStatus(err.message || "Error al renombrar");
    } finally {
      setIsRenaming(false);
    }
  };

  const handleDownload = (itemId: string, itemName: string) => {
    const downloadUrl = getOneDriveDownloadUrl(accountId, itemId);
    window.open(downloadUrl, "_blank");
  };

  const handleRowContextMenu = (e: React.MouseEvent, file: OneDriveItem) => {
    e.preventDefault();
    e.stopPropagation();

    // Debug counter for app context menu opens
    if (typeof window !== "undefined") {
      (window as any).__appCtxOpens = ((window as any).__appCtxOpens || 0) + 1;
    }
    
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      fileId: file.id,
      fileName: file.name,
      mimeType: file.kind === "folder" ? "application/vnd.ms-onedrive.folder" : "application/octet-stream",
      webViewLink: file.webViewLink || undefined,
      isFolder: file.kind === "folder",
    });
  };

  const handleOpenInProvider = (fileId: string, fileName: string) => {
    const file = files.find(f => f.id === fileId);
    const webViewLink = file?.webViewLink || contextMenu?.webViewLink;
    
    if (webViewLink) {
      window.open(webViewLink, "_blank", "noopener,noreferrer");
    }
  };

  const handleShareInProvider = (fileId: string, fileName: string) => {
    const file = files.find(f => f.id === fileId);
    const webViewLink = file?.webViewLink || contextMenu?.webViewLink;
    
    if (webViewLink) {
      window.open(webViewLink, "_blank", "noopener,noreferrer");
    }
  };

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return "-";
    const date = new Date(dateStr);
    return date.toLocaleDateString("es-ES", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  // Get file icon based on file type
  const getFileIcon = (file: OneDriveItem): string => {
    if (file.kind === "folder") return "📁";
    const name = file.name?.toLowerCase() || "";
    
    if (name.endsWith(".pdf")) return "📕";
    if (name.endsWith(".docx") || name.endsWith(".doc")) return "📄";
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) return "📊";
    if (name.endsWith(".pptx") || name.endsWith(".ppt")) return "📽️";
    if (name.match(/\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/)) return "🖼️";
    if (name.match(/\.(mp4|avi|mov|mkv|wmv|webm)$/)) return "🎥";
    if (name.match(/\.(mp3|wav|ogg|m4a|flac|aac)$/)) return "🎵";
    if (name.match(/\.(zip|rar|7z|tar|gz|bz2)$/)) return "📦";
    if (name.match(/\.(txt|md|json|xml|csv|log)$/)) return "📝";
    return "📄";
  };

  // Derived filtered files (with filters applied)
  const filteredFiles = (() => {
    if (!displayFiles) return displayFiles;
    
    let filtered = [...displayFiles];
    
    // Filter by type
    if (filterType !== "all") {
      filtered = filtered.filter(file => {
        const name = file.name?.toLowerCase() || "";
        
        switch (filterType) {
          case "folder":
            return file.kind === "folder";
          case "document":
            return name.endsWith(".docx") || name.endsWith(".doc") || name.endsWith(".txt") || name.endsWith(".rtf");
          case "spreadsheet":
            return name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv");
          case "pdf":
            return name.endsWith(".pdf");
          case "image":
            return !!name.match(/\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/);
          case "video":
            return !!name.match(/\.(mp4|avi|mov|mkv|wmv|webm)$/);
          default:
            return true;
        }
      });
    }
    
    // Filter by owner (for now "yo" shows all, "shared" shows nothing since we don't have shared info)
    if (filterOwner !== "all") {
      if (filterOwner === "shared") {
        // OneDrive items don't have a shared property yet, so show nothing for "shared"
        filtered = [];
      }
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

  // Reset UI handler (debug only)
  const handleResetUI = async () => {
    if (!debug) return;
    
    // Close all modals
    setShowRenameModal(false);
    setShowReconnectModal(false);
    
    // Clear selections and menus
    setSelectedFiles(new Set());
    setContextMenu(null);
    
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

  // Recargar archivos cuando cambia la cuenta
  useEffect(() => {
    if (!accountId) {
      return;
    }

    // Limpiar estado anterior
    setFiles([]);
    setError(null);
    setIsSwitchingAccount(true);

    const loadFiles = async () => {
      try {
        const response = await authenticatedFetch(`/onedrive/${accountId}/files?folder_id=root`);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        setFiles(data.items || []);
        setIsSwitchingAccount(false);
      } catch (err: any) {
        console.error("Error loading files:", err);

        // Si es error 401 o token expirado, mostrar aviso de reconexión
        if (err.message && (err.message.includes('401') || err.message.includes('TOKEN'))) {
          setError("Esta cuenta necesita reconexión");
          setShowReconnectModal(true); // Activar modal de reconexión
        } else {
          setError("Error al cargar archivos");
        }

        setIsSwitchingAccount(false);
      }
    };

    loadFiles();
  }, [accountId]);

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
            <div>contextMenu: {contextMenu?.visible ? "open" : "closed"}</div>
            <div>modals: rename={String(showRenameModal)} reconnect={String(showReconnectModal)}</div>
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
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
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
                  ? `Tu acceso a OneDrive (${accountStatus.provider_email}) no está activo. Reconecta para ver archivos.`
                  : "Esta cuenta de OneDrive está desconectada."}
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
                className="w-full sm:w-auto px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition shadow-lg"
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
        <div className="w-full max-w-6xl space-y-4">
          {/* Breadcrumb Navigation */}
          <div className="flex items-center gap-2 text-sm">
            {breadcrumb.map((crumb, index) => (
              <div key={crumb.id || "root"} className="flex items-center gap-2">
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
                provider="onedrive"
                selectedCount={selectedFiles.size}
                singleSelected={
                  selectedFiles.size === 1 
                    ? (() => {
                        const fileId = Array.from(selectedFiles)[0];
                        const file = files.find(f => f.id === fileId);
                        return file ? {
                          id: file.id,
                          name: file.name,
                          isFolder: file.kind === "folder",
                          webViewLink: file.webViewLink || undefined
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
                      handleDownload(fileId, file.name);
                    }
                  });
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
                    if (file && file.kind !== "folder") {
                      handleRename(fileId, file.name);
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
                copyDisabled={true}
                copyDisabledReason="OneDrive → otras nubes aún no disponible (solo Google Drive → OneDrive en Phase 1)"
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

        {renameStatus && (
          <div className={`rounded-lg p-4 ${
            renameStatus === "success" 
              ? "bg-green-900/30 border border-green-700 text-green-300" 
              : "bg-red-900/30 border border-red-700 text-red-300"
          }`}>
            <p>{renameStatus === "success" ? "✅ Archivo renombrado exitosamente" : `❌ ${renameStatus}`}</p>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-4">
            <p className="text-red-300">{error}</p>
            <button
              onClick={() => fetchFiles(currentFolderId)}
              className="mt-2 px-3 py-1.5 bg-red-700 hover:bg-red-600 rounded text-sm font-medium transition"
            >
              Reintentar
            </button>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
          </div>
        )}



        {/* Files View - Google Drive Style (List or Grid) */}
        {!loading && !error && (
          <div 
            ref={filesContainerRef}
            className="bg-transparent rounded-lg overflow-hidden"
          >
            {/* Show filter results count when filters are active */}
            {hasActiveFilters && filteredFiles.length > 0 && (
              <div className="mb-3 text-sm text-slate-400">
                Mostrando {filteredFiles.length} de {displayFiles.length} archivos
              </div>
            )}

            {filteredFiles.length === 0 ? (
              <div className="py-12 text-center text-slate-400">
                <p>{hasActiveFilters ? "No hay archivos que coincidan con los filtros" : "Esta carpeta está vacía"}</p>
                {hasActiveFilters && (
                  <button 
                    onClick={clearFilters}
                    className="mt-3 text-blue-400 hover:text-blue-300 text-sm"
                  >
                    Limpiar filtros
                  </button>
                )}
              </div>
            ) : (
              <>
              {/* GRID VIEW */}
              {viewMode === "grid" && (
                <div 
                  className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 p-4 max-h-[600px] overflow-y-auto"
                  onClick={() => closeContextMenu()}
                >
                  {filteredFiles.map((file) => (
                    <div
                      key={`${accountId}:${file.id}`}
                      className={`
                        group relative rounded-xl p-3 transition-all cursor-pointer
                        ${selectedFiles.has(file.id) 
                          ? 'bg-blue-600/20 ring-2 ring-blue-500' 
                          : 'bg-slate-800/30 hover:bg-slate-800/50'
                        }
                      `}
                      onClick={(e) => {
                        const target = e.target as HTMLElement;
                        if (target.tagName === 'BUTTON' || target.closest('button')) return;
                        e.stopPropagation();
                        toggleFileSelection(file.id);
                      }}
                      onDoubleClick={(e) => {
                        const target = e.target as HTMLElement;
                        if (target.tagName === 'BUTTON' || target.closest('button')) return;
                        e.stopPropagation();
                        if (file.kind === "folder") {
                          handleOpenFolder(file.id, file.name);
                        } else if (file.webViewLink) {
                          window.open(file.webViewLink, "_blank", "noopener,noreferrer");
                        }
                      }}
                      onContextMenu={(e) => handleRowContextMenu(e, file)}
                    >
                    {/* File Icon - Large centered */}
                      <div className="flex justify-center items-center h-20 mb-3">
                        <span className="text-5xl">{getFileIcon(file)}</span>
                      </div>

                      {/* File Name - truncated */}
                      <div className="text-sm text-slate-200 text-center truncate px-1" title={file.name}>
                        {file.name}
                      </div>

                      {/* File Info - smaller text */}
                      <div className="text-xs text-slate-500 text-center mt-1">
                        {formatDate(file.modifiedTime)}
                      </div>

                      {/* Kebab menu - top right corner */}
                      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <OnedriveRowActionsMenu
                          fileId={file.id}
                          fileName={file.name}
                          webViewLink={file.webViewLink || undefined}
                          isFolder={file.kind === "folder"}
                          onOpenFolder={handleOpenFolder}
                          onRename={handleRename}
                          onDownload={handleDownload}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* LIST VIEW (Table) */}
              {viewMode === "list" && (
              <div className="max-h-[600px] overflow-y-auto" onClick={() => closeContextMenu()}>
              <table className="w-full">
                <thead>
                  <tr className="text-left border-b border-slate-700/50">
                    <th className="py-3 px-4 text-slate-400 font-normal text-xs tracking-wide">Nombre</th>
                    <th className="py-3 px-4 text-slate-400 font-normal text-xs tracking-wide">Propietario</th>
                    <th className="py-3 px-4 text-slate-400 font-normal text-xs tracking-wide">Fecha de modificación</th>
                    <th className="py-3 px-4 text-slate-400 font-normal text-xs tracking-wide">Tamaño del archivo</th>
                    <th className="py-3 px-4 text-slate-400 font-normal text-xs tracking-wide text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody className="bg-transparent">
                  {filteredFiles.map((file) => (
                    <tr
                      key={`${accountId}:${file.id}`}
                      className={`border-b border-slate-800/30 transition cursor-pointer ${
                        selectedFiles.has(file.id) 
                          ? 'bg-blue-600/20' 
                          : 'hover:bg-slate-800/30'
                      }`}
                      onClick={(e) => {
                        const target = e.target as HTMLElement;
                        if (target.tagName === 'BUTTON' || target.closest('button')) return;
                        e.stopPropagation();
                        toggleFileSelection(file.id);
                      }}
                      onDoubleClick={(e) => {
                        const target = e.target as HTMLElement;
                        if (target.tagName === 'BUTTON' || target.closest('button')) return;
                        e.stopPropagation();
                        if (file.kind === "folder") {
                          handleOpenFolder(file.id, file.name);
                        } else if (file.webViewLink) {
                          window.open(file.webViewLink, "_blank", "noopener,noreferrer");
                        }
                      }}
                      onContextMenu={(e) => handleRowContextMenu(e, file)}
                    >
                      {/* Nombre */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <span className="text-xl">{getFileIcon(file)}</span>
                          <span className="font-normal text-slate-200 text-sm">{file.name}</span>
                        </div>
                      </td>

                      {/* Propietario */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-semibold">
                            {accountEmail ? accountEmail.charAt(0).toUpperCase() : "?"}
                          </div>
                          <span className="text-slate-400 text-sm">yo</span>
                        </div>
                      </td>

                      {/* Fecha de modificación */}
                      <td className="py-3 px-4 text-slate-400 text-sm">
                        {formatDate(file.modifiedTime)}
                      </td>

                      {/* Tamaño del archivo */}
                      <td className="py-3 px-4 text-slate-400 text-sm">
                        {file.kind === "folder" ? "-" : formatSize(file.size)}
                      </td>

                      {/* Acciones */}
                      <td className="py-3 px-4 text-center">
                        <OnedriveRowActionsMenu
                          fileId={file.id}
                          fileName={file.name}
                          webViewLink={file.webViewLink || undefined}
                          isFolder={file.kind === "folder"}
                          onOpenFolder={handleOpenFolder}
                          onRename={handleRename}
                          onDownload={handleDownload}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              )}
              </>
            )}
          </div>
        )}
        </div>
        </>
      )}

      {/* Context Menu */}
      {contextMenu && (
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
          onOpenFolder={contextMenu.isFolder ? (id, name) => { handleOpenFolder(id, name); closeContextMenu(); } : undefined}
          onRename={(id, name) => { handleRename(id, name); closeContextMenu(); }}
          onDownload={(id, name) => { handleDownload(id, name); closeContextMenu(); }}
          onOpenInProvider={(id, name) => { handleOpenInProvider(id, name); closeContextMenu(); }}
          onShareInProvider={(id, name) => { handleShareInProvider(id, name); closeContextMenu(); }}
          copyDisabled={true} // Backend /transfer/create only supports Google Drive → OneDrive (Phase 1)
        />
      )}

      {/* Reconnect Modal */}
      <ReconnectSlotsModal
        isOpen={showReconnectModal}
        onClose={() => setShowReconnectModal(false)}
      />

      {/* Rename Modal */}
      <OneDriveRenameModal
        isOpen={showRenameModal}
        fileName={renameItemName}
        onClose={() => {
          setShowRenameModal(false);
          setRenameStatus(null);
        }}
        onConfirm={handleRenameConfirm}
        isRenaming={isRenaming}
      />
    </main>
  );
}
