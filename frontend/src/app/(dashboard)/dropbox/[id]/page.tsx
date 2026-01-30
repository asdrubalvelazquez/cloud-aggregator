"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useCloudStatusQuery, CLOUD_STATUS_KEY } from "@/queries/useCloudStatusQuery";
import { authenticatedFetch } from "@/lib/api";
import type { CloudAccountStatus } from "@/lib/api";
import ReconnectSlotsModal from "@/components/ReconnectSlotsModal";
import ContextMenu from "@/components/ContextMenu";
import FileActionBar from "@/components/FileActionBar";

interface DropboxFile {
  ".tag": "file" | "folder";
  id: string;
  name: string;
  path_display: string;
  size?: number;
  client_modified?: string;
}

interface DropboxListResponse {
  entries: DropboxFile[];
  cursor: string;
  has_more: boolean;
}

// Transform Dropbox item to common format for shared components
interface CommonFileItem {
  id: string;
  name: string;
  kind: "file" | "folder";
  size: number;
  modifiedTime: string;
  webViewLink?: string;
  mimeType?: string;
}

function transformDropboxItem(item: DropboxFile): CommonFileItem {
  return {
    id: item.id,
    name: item.name,
    kind: item[".tag"] === "folder" ? "folder" : "file",
    size: item.size || 0,
    modifiedTime: item.client_modified || new Date().toISOString(),
    webViewLink: undefined, // Dropbox doesn't provide web links in list API
    mimeType: item[".tag"] === "folder" ? "application/vnd.dropbox.folder" : "application/octet-stream",
  };
}

export default function DropboxFilesPage() {
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

  // File management state
  const [files, setFiles] = useState<CommonFileItem[]>([]);
  const [displayFiles, setDisplayFiles] = useState<CommonFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState("");
  const [breadcrumb, setBreadcrumb] = useState<{ path: string; name: string }[]>([
    { path: "", name: "Dropbox" },
  ]);
  const [accountEmail, setAccountEmail] = useState<string>("");

  // UI state
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
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
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [showReconnectModal, setShowReconnectModal] = useState(false);
  const [isSwitchingAccount, setIsSwitchingAccount] = useState(false);

  // Fetch sequence for cancellation
  const fetchSeqRef = useRef(0);
  const fetchAbortRef = useRef<AbortController | null>(null);

  // Reset UI state when cloud account changes
  useEffect(() => {
    setIsSwitchingAccount(true);
    setSelectedFiles(new Set());
    setContextMenu(null);
    setShowReconnectModal(false);
  }, [accountId]);

  // Update display files when new files arrive
  useEffect(() => {
    setDisplayFiles(files);
    setIsSwitchingAccount(false);
  }, [files, accountId]);

  // Clear stale selections when files list changes
  useEffect(() => {
    setSelectedFiles(prev => {
      if (prev.size === 0) return prev;
      const currentFileIds = new Set(files.map(f => f.id));
      const newSet = new Set([...prev].filter(id => currentFileIds.has(id)));
      return newSet.size === prev.size ? prev : newSet;
    });
  }, [files]);

  // Consume cloud status from React Query
  const { data: cloudStatus, error: cloudError } = useCloudStatusQuery();

  // Consume cloud status from React Query
  const { data: cloudStatus, error: cloudError } = useCloudStatusQuery();

  // Check connection status and load files
  useEffect(() => {
    if (!accountId) return;

    console.log("[Dropbox] Loading account:", accountId);

    // Clear state immediately for smooth transition
    setFiles([]);
    setCurrentPath("");
    setBreadcrumb([{ path: "", name: "Dropbox" }]);
    setSelectedFiles(new Set());
    setError(null);
    setLoading(true);

    // Wait for cloudStatus to load from React Query
    if (!cloudStatus) {
      console.log("[Dropbox] Waiting for cloudStatus...");
      setCheckingConnection(true);
      if (cloudError) {
        setCheckingConnection(false);
        setLoading(false);
        console.error("[Dropbox] CloudStatus error:", cloudError);
      }
      return;
    }

    // Find account by provider_account_uuid
    const account = cloudStatus.accounts.find(
      (acc) => acc.provider_account_uuid === accountId
    );

    setCheckingConnection(false);

    // Handle account not found
    if (!account) {
      console.warn("[Dropbox] Account not found:", accountId);
      setAccountStatus(null);
      setError("Cuenta no encontrada");
      setLoading(false);
      return;
    }

    setAccountStatus(account);

    const isConnected = account.connection_status === "connected";

    // Show reconnect modal if account needs reconnection
    if (!isConnected) {
      console.warn("[Dropbox] Account not connected:", account.connection_status);
      setShowReconnectModal(true);
      setError(`Esta cuenta ${account.connection_status === "disconnected" ? "está desconectada" : "necesita reconexión"}`);
      setLoading(false);
      return;
    }

    // Load files immediately
    console.log("[Dropbox] Fetching files...");

    // Fetch account email (if needed)
    setAccountEmail(account.provider_email || "");

    // Fetch files
    fetchFiles("");

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, cloudStatus, cloudError]);

  // Refresh cloudStatus after reconnect succeeds
  useEffect(() => {
    const handleReconnect = () => {
      console.log("[Dropbox] Reconnect successful, invalidating cache...");
      queryClient.invalidateQueries({ queryKey: [CLOUD_STATUS_KEY] });
    };

    window.addEventListener("cloudReconnected", handleReconnect);
    return () => window.removeEventListener("cloudReconnected", handleReconnect);
  }, [queryClient]);

  const fetchFiles = async (path: string) => {
    const seq = ++fetchSeqRef.current;
    const controller = new AbortController();
    fetchAbortRef.current = controller;

    try {
      setLoading(true);
      setError(null);

      const url = `/api/dropbox/${accountId}/files${path ? `?path=${encodeURIComponent(path)}` : ""}`;
      const response = await authenticatedFetch(url, { signal: controller.signal });

      if (seq !== fetchSeqRef.current) return; // Stale request

      if (!response.ok) {
        if (response.status === 401) {
          setError("Sesión expirada. Por favor reconecta.");
          setShowReconnectModal(true);
          return;
        }
        throw new Error(`Error al cargar archivos: ${response.statusText}`);
      }

      const data: DropboxListResponse = await response.json();
      const transformed = data.entries.map(transformDropboxItem);
      
      if (seq === fetchSeqRef.current) {
        setFiles(transformed);
        setCurrentPath(path);
      }
    } catch (err) {
      if (seq === fetchSeqRef.current) {
        if (err instanceof Error && err.name === "AbortError") {
          return; // Ignore aborted requests
        }
        const errorMessage = err instanceof Error ? err.message : "Error desconocido";
        setError(errorMessage);
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

  const handleOpenFolder = (file: CommonFileItem) => {
    // Get the original Dropbox path
    const path = currentPath ? `${currentPath}/${file.name}` : `/${file.name}`;
    
    setBreadcrumb((prev) => [...prev, { path, name: file.name }]);
    fetchFiles(path);
  };

  const handleBreadcrumbClick = (index: number) => {
    const target = breadcrumb[index];
    const newTrail = breadcrumb.slice(0, index + 1);
    setBreadcrumb(newTrail);
    fetchFiles(target.path);
  };

  // Single-select handler
  const toggleFileSelection = (fileId: string) => {
    setSelectedFiles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(fileId)) {
        newSet.delete(fileId);
      } else {
        newSet.clear();
        newSet.add(fileId);
      }
      return newSet;
    });
  };

  // Multi-select with Ctrl/Cmd
  const handleFileClick = (e: React.MouseEvent, file: CommonFileItem) => {
    if (debug) {
      setLastClickTarget(`${file.name} (${file.id.slice(0, 8)})`);
    }

    const isMultiSelect = e.ctrlKey || e.metaKey;

    if (isMultiSelect) {
      e.stopPropagation();
      setSelectedFiles(prev => {
        const newSet = new Set(prev);
        if (newSet.has(file.id)) {
          newSet.delete(file.id);
        } else {
          newSet.add(file.id);
        }
        return newSet;
      });
    } else if (file.kind === "folder") {
      handleOpenFolder(file);
    } else {
      toggleFileSelection(file.id);
    }
  };

  // Context menu handlers
  const handleRowContextMenu = (e: React.MouseEvent, file: CommonFileItem) => {
    e.preventDefault();
    e.stopPropagation();

    if (debug) {
      setLastCtxTarget(`${file.name} (${file.id.slice(0, 8)})`);
    }

    // Select file if not already selected
    if (!selectedFiles.has(file.id)) {
      setSelectedFiles(new Set([file.id]));
    }

    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      fileId: file.id,
      fileName: file.name,
      mimeType: file.mimeType || "",
      webViewLink: file.webViewLink,
      isFolder: file.kind === "folder",
    });
  };

  const closeContextMenu = () => {
    setContextMenu(null);
  };

  // File actions
  const handleDownload = async (fileId: string, fileName: string) => {
    // Dropbox download not implemented yet - show toast
    const toast = document.createElement("div");
    toast.className = "fixed bottom-4 right-4 bg-slate-800 border border-slate-600 text-white px-4 py-2 rounded-lg shadow-lg z-50";
    toast.textContent = "Descarga de archivos de Dropbox próximamente disponible";
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  };

  const handleOpenInProvider = (fileId: string, fileName: string) => {
    // Dropbox doesn't provide webViewLink in list API
    const toast = document.createElement("div");
    toast.className = "fixed bottom-4 right-4 bg-slate-800 border border-slate-600 text-white px-4 py-2 rounded-lg shadow-lg z-50";
    toast.textContent = "Vista en Dropbox próximamente disponible";
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  };

  const handleShareInProvider = (fileId: string, fileName: string) => {
    const toast = document.createElement("div");
    toast.className = "fixed bottom-4 right-4 bg-slate-800 border border-slate-600 text-white px-4 py-2 rounded-lg shadow-lg z-50";
    toast.textContent = "Compartir en Dropbox próximamente disponible";
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  };

  // Formatting helpers
  const formatSize = (bytes: number): string => {
    if (!bytes) return "—";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  };

  const formatDate = (dateString: string): string => {
    if (!dateString) return "—";
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "Hoy";
    if (diffDays === 1) return "Ayer";
    if (diffDays < 7) return `Hace ${diffDays} días`;

    return new Intl.DateTimeFormat("es-ES", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(date);
  };

  const getFileIcon = (file: CommonFileItem) => {
    if (file.kind === "folder") {
      return "📁";
    }
    
    const ext = file.name.split(".").pop()?.toLowerCase();
    const iconMap: Record<string, string> = {
      pdf: "📄",
      doc: "📝", docx: "📝",
      xls: "📊", xlsx: "📊",
      ppt: "📊", pptx: "📊",
      zip: "📦", rar: "📦", "7z": "📦",
      jpg: "🖼️", jpeg: "🖼️", png: "🖼️", gif: "🖼️",
      mp4: "🎬", avi: "🎬", mov: "🎬",
      mp3: "🎵", wav: "🎵",
      txt: "📃",
    };
    
    return iconMap[ext || ""] || "📄";
  };

  return (
    <main className="flex min-h-screen flex-col items-center p-8 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Debug Panel */}
      {debug && (
        <div className="w-full max-w-6xl mb-4 bg-yellow-900/30 border border-yellow-600 rounded-lg p-3 text-xs font-mono text-yellow-200">
          <div className="grid grid-cols-2 gap-2">
            <div>accountId: {accountId}</div>
            <div>selectedFiles: {selectedFiles.size}</div>
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
                  ? `Tu acceso a Dropbox (${accountStatus.provider_email}) no está activo. Reconecta para ver archivos.`
                  : "Esta cuenta de Dropbox está desconectada."}
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
              <div key={index} className="flex items-center gap-2">
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

          {/* Action Bar (when files selected) */}
          <div className="flex items-center justify-between">
            {selectedFiles.size > 0 && !isSwitchingAccount && (
              <FileActionBar
                provider="onedrive"
                selectedCount={selectedFiles.size}
                singleSelected={
                  selectedFiles.size === 1
                    ? (() => {
                        const fileId = Array.from(selectedFiles)[0];
                        const file = files.find((f) => f.id === fileId);
                        return file
                          ? {
                              id: file.id,
                              name: file.name,
                              isFolder: file.kind === "folder",
                              webViewLink: file.webViewLink,
                            }
                          : null;
                      })()
                    : null
                }
                onClearSelection={() => setSelectedFiles(new Set())}
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
                  const toast = document.createElement("div");
                  toast.className = "fixed bottom-4 right-4 bg-slate-800 border border-slate-600 text-white px-4 py-2 rounded-lg shadow-lg z-50";
                  toast.textContent = "Enlaces compartidos de Dropbox próximamente disponibles";
                  document.body.appendChild(toast);
                  setTimeout(() => toast.remove(), 3000);
                }}
                onPreviewSingle={() => {
                  if (selectedFiles.size === 1) {
                    const fileId = Array.from(selectedFiles)[0];
                    const file = files.find(f => f.id === fileId);
                    if (file) {
                      handleOpenInProvider(fileId, file.name);
                    }
                  }
                }}
                onRefresh={() => fetchFiles(currentPath)}
                copyDisabled={true}
                copyDisabledReason="Transferencia de Dropbox → otras nubes próximamente disponible"
              />
            )}

            {/* View Toggle & Actions */}
            <div className="flex items-center gap-2 ml-auto">
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

        {/* Error banner */}
        {error && !loading && (
          <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-lg p-4">
            <p>❌ {error}</p>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="bg-slate-800 rounded-lg p-8 border border-slate-700 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-slate-300">Cargando archivos de Dropbox...</p>
          </div>
        )}

        {/* File List View */}
        {!loading && !error && viewMode === "list" && (
          <div className="bg-slate-800/50 rounded-lg border border-slate-700 overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-900/50">
                  <th className="py-3 px-4 text-left text-slate-400 font-medium text-sm">Nombre</th>
                  <th className="py-3 px-4 text-left text-slate-400 font-medium text-sm">Propietario</th>
                  <th className="py-3 px-4 text-left text-slate-400 font-medium text-sm">Última modificación</th>
                  <th className="py-3 px-4 text-left text-slate-400 font-medium text-sm">Tamaño</th>
                </tr>
              </thead>
              <tbody>
                {displayFiles.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-16 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <div className="text-6xl opacity-50">📂</div>
                        <p className="text-slate-400 text-lg">Esta carpeta está vacía</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  displayFiles.map((file) => (
                    <tr
                      key={file.id}
                      className={`border-b border-slate-700 hover:bg-slate-700/50 transition cursor-pointer ${
                        selectedFiles.has(file.id) ? "bg-blue-900/30" : ""
                      }`}
                      onClick={(e) => handleFileClick(e, file)}
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
                        {file.kind === "folder" ? "—" : formatSize(file.size)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            </div>
          </div>
        )}

        {/* Grid View */}
        {!loading && !error && viewMode === "grid" && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {displayFiles.length === 0 ? (
              <div className="col-span-full py-16 text-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="text-6xl opacity-50">📂</div>
                  <p className="text-slate-400 text-lg">Esta carpeta está vacía</p>
                </div>
              </div>
            ) : (
              displayFiles.map((file) => (
                <div
                  key={file.id}
                  className={`bg-slate-800/50 border border-slate-700 rounded-lg p-4 hover:bg-slate-700/50 transition cursor-pointer ${
                    selectedFiles.has(file.id) ? "ring-2 ring-blue-500" : ""
                  }`}
                  onClick={(e) => handleFileClick(e, file)}
                  onContextMenu={(e) => handleRowContextMenu(e, file)}
                >
                  <div className="flex flex-col items-center gap-2">
                    <div className="text-5xl">{getFileIcon(file)}</div>
                    <span className="text-slate-200 text-sm text-center truncate w-full">{file.name}</span>
                    <span className="text-slate-400 text-xs">{file.kind === "folder" ? "Carpeta" : formatSize(file.size)}</span>
                  </div>
                </div>
              ))
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
          onOpenFolder={contextMenu.isFolder ? (id, name) => { 
            const file = files.find(f => f.id === id);
            if (file) handleOpenFolder(file);
            closeContextMenu();
          } : undefined}
          onDownload={(id, name) => { handleDownload(id, name); closeContextMenu(); }}
          onOpenInProvider={(id, name) => { handleOpenInProvider(id, name); closeContextMenu(); }}
          onShareInProvider={(id, name) => { handleShareInProvider(id, name); closeContextMenu(); }}
          copyDisabled={true}
        />
      )}

      {/* Reconnect Modal */}
      <ReconnectSlotsModal
        isOpen={showReconnectModal}
        onClose={() => setShowReconnectModal(false)}
      />
    </main>
  );
}
