"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useCopyContext } from "@/context/CopyContext";
import { authenticatedFetch } from "@/lib/api";
import QuotaBadge from "@/components/QuotaBadge";
import RowActionsMenu from "@/components/RowActionsMenu";
import RenameModal from "@/components/RenameModal";
import ContextMenu from "@/components/ContextMenu";

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
  id: number;
  email: string;
};

type CopyOptions = {
  source_account: {
    id: number;
    email: string;
  };
  target_accounts: TargetAccount[];
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

export default function DriveFilesPage() {
  const params = useParams();
  const accountId = params.id as string;

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
  const [selectedTarget, setSelectedTarget] = useState<number | null>(null);

  // Multi-select state
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [batchCopying, setBatchCopying] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [batchResults, setBatchResults] = useState<{ success: number; failed: number; skipped: number } | null>(null);

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

  // Copy lock ref (synchronous guard against double submit)
  const copyLockRef = useRef(false);

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

  // Fetch files from a specific folder
  const fetchFiles = async (
    folderId: string = "root",
    pageToken?: string | null
  ) => {
    try {
      setLoading(true);
      const url = new URL(`${API_BASE_URL}/drive/${accountId}/files`);
      url.searchParams.set("folder_id", folderId);
      if (pageToken) {
        url.searchParams.set("page_token", pageToken);
      }

      const res = await authenticatedFetch(url.pathname + url.search);
      if (!res.ok) throw new Error(`Error API archivos: ${res.status}`);

      const json = await res.json();
      setFiles(json.files || []);
      setCurrentFolderId(folderId);
      setNextPageToken(json.nextPageToken ?? null);
      setError(null);
    } catch (e: any) {
      setError(e.message || "Error al cargar archivos");
    } finally {
      setLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    if (accountId) {
      fetchFiles("root", null);
      fetchCopyOptions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

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

  const handleOpenFolder = (folderId: string, folderName: string) => {
    // Actualizar breadcrumb
    setBreadcrumb((prev) => [...prev, { id: folderId, name: folderName }]);
    // Cargar contenido de esa carpeta
    fetchFiles(folderId, null);
  };

  const handleBreadcrumbClick = (index: number) => {
    const target = breadcrumb[index];
    const newTrail = breadcrumb.slice(0, index + 1);
    setBreadcrumb(newTrail);
    fetchFiles(target.id, null);
  };

  const handleCopyFile = async (fileId: string, targetId: number, fileName: string) => {
    if (!targetId || copying) {
      return;
    }

    try {
      startCopy(fileName);

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
          errorMessage = errorData.message || errorData.detail?.message || errorData.detail || "Error desconocido";
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
        const targetEmail = copyOptions?.target_accounts.find(a => a.id === targetId)?.email || "cuenta destino";
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
    setModalFileId(fileId);
    setModalFileName(fileName);
    setSelectedTarget(null);
    setShowCopyModal(true);
  };

  const closeCopyModal = () => {
    setShowCopyModal(false);
    setModalFileId(null);
    setModalFileName(null);
    setSelectedTarget(null);
  };

  const confirmCopy = () => {
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
  const toggleFileSelection = (fileId: string, mimeType: string) => {
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
  };

  const selectAllFiles = () => {
    const selectableFiles = files.filter(f => f.mimeType !== "application/vnd.google-apps.folder");
    if (selectedFiles.size === selectableFiles.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(selectableFiles.map(f => f.id)));
    }
  };

  const handleBatchCopy = async () => {
    if (selectedFiles.size === 0 || !selectedTarget) {
      alert("Selecciona archivos y una cuenta destino");
      return;
    }

    setBatchCopying(true);
    setBatchProgress({ current: 0, total: selectedFiles.size });
    setBatchResults(null);

    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    const fileArray = Array.from(selectedFiles);

    for (let i = 0; i < fileArray.length; i++) {
      const fileId = fileArray[i];
      const file = files.find(f => f.id === fileId);
      if (!file) continue;

      try {
        setBatchProgress({ current: i + 1, total: fileArray.length });

        const res = await authenticatedFetch("/drive/copy-file", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source_account_id: parseInt(accountId),
            target_account_id: selectedTarget,
            file_id: fileId,
          }),
          signal: AbortSignal.timeout(180000),
        });

        if (!res.ok) {
          // Handle quota exceeded
          if (res.status === 402) {
            const errorData = await res.json().catch(() => ({}));
            alert(errorData.detail?.message || "Límite de copias alcanzado. Proceso detenido.");
            failedCount += (fileArray.length - i);
            break;
          }

          // Handle rate limit
          if (res.status === 429) {
            const errorData = await res.json().catch(() => ({}));
            const retryAfter = errorData.detail?.retry_after || 10;
            console.log(`Rate limit hit, waiting ${retryAfter}s...`);
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
            i--; // Retry same file
            continue;
          }

          failedCount++;
          continue;
        }

        const result = await res.json();
        
        // Check if file is a duplicate
        if (result.duplicate) {
          skippedCount++;
        } else {
          successCount++;
        }

        // Wait 11 seconds between requests to respect rate limiting
        if (i < fileArray.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 11000));
        }

      } catch (e: any) {
        console.error("Batch copy error:", e);
        failedCount++;
      }
    }

    setBatchResults({ success: successCount, failed: failedCount, skipped: skippedCount });
    setBatchCopying(false);
    setSelectedFiles(new Set());

    // Refresh quota badge
    setQuotaRefreshKey(prev => prev + 1);
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

  const closeContextMenu = () => {
    setContextMenu(null);
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

  // Derived sorted files
  const sortedFiles = (() => {
    if (!files || !sortBy) return files;
    const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });
    const arr = [...files];
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
              href="/"
              className="text-emerald-400 hover:text-emerald-300 transition"
            >
              ← Volver
            </Link>
            <h1 className="text-2xl md:text-3xl font-bold">
              Archivos de Google Drive
            </h1>
          </div>
          <div className="flex items-center gap-4">
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
          <nav className="flex items-center gap-2 text-sm">
            {breadcrumb.map((crumb, idx) => (
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
        {loading && <p className="text-center text-slate-300">Cargando archivos…</p>}

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
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 flex items-center justify-between gap-4">
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
                  onChange={(e) => setSelectedTarget(parseInt(e.target.value))}
                  className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">Seleccionar cuenta destino...</option>
                  {copyOptions.target_accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.email}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleBatchCopy}
                  disabled={!selectedTarget || batchCopying}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold transition"
                >
                  {batchCopying ? `Copiando ${batchProgress.current}/${batchProgress.total}...` : "Copiar seleccionados"}
                </button>
              </div>
            )}
          </div>
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

        {/* Files Table */}
        {!loading && !error && files.length > 0 && (
          <div className="bg-slate-800 rounded-xl p-4 shadow overflow-x-auto">
            <div onClick={() => setSelectedRowId(null)}>
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
                    key={file.id}
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
                        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
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
                Copiar: {modalFileName}
              </h2>
              
              <p className="text-slate-300 mb-4">
                Selecciona la cuenta destino donde deseas copiar este archivo:
              </p>

              {/* Dropdown Select */}
              <div className="mb-6">
                <select
                  value={selectedTarget || ""}
                  onChange={(e) => setSelectedTarget(e.target.value ? parseInt(e.target.value) : null)}
                  className="w-full bg-slate-700 text-slate-100 border border-slate-600 rounded-lg px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
                >
                  <option value="">-- Selecciona una nube --</option>
                  {copyOptions?.target_accounts && copyOptions.target_accounts.length > 0 ? (
                    copyOptions.target_accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.email}
                      </option>
                    ))
                  ) : (
                    <option disabled>No hay cuentas destino disponibles</option>
                  )}
                </select>
              </div>

              {/* Progress Bar (shown during copy) */}
              {copying && (
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

              {/* Status Message */}
              {copyStatus && !copying && (
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

              {/* Action Buttons */}
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    if (copying) {
                      cancelCopy();
                    } else {
                      closeCopyModal();
                    }
                  }}
                  className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-lg text-sm font-semibold transition"
                >
                  {copying ? "Cancelar Copia" : "Cerrar"}
                </button>
                <button
                  type="button"
                  onClick={confirmCopy}
                  disabled={!selectedTarget || copying}
                  className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold transition"
                >
                  {copying ? "Copiando..." : "Copiar"}
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
            copyDisabled={copying || !copyOptions || copyOptions.target_accounts.length === 0}
          />
        )}
      </div>
    </main>
  );
}
