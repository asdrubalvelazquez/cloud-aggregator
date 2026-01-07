"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { fetchOneDriveFiles, fetchOneDriveAccountInfo, renameOneDriveItem, getOneDriveDownloadUrl, fetchCloudStatus } from "@/lib/api";
import type { OneDriveListResponse, OneDriveItem, CloudAccountStatus } from "@/lib/api";
import OnedriveRowActionsMenu from "@/components/OnedriveRowActionsMenu";
import OneDriveRenameModal from "@/components/OneDriveRenameModal";
import ReconnectSlotsModal from "@/components/ReconnectSlotsModal";
import ContextMenu from "@/components/ContextMenu";

export default function OneDriveFilesPage() {
  const params = useParams();
  const router = useRouter();
  const accountId = params.id as string;

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


  // Check connection status before loading files
  useEffect(() => {
    const checkConnection = async () => {
      if (!accountId) return;

      setCheckingConnection(true);
      try {
        const cloudStatus = await fetchCloudStatus(true);
        
        // Find account by provider_account_uuid (OneDrive uses UUID, not numeric ID)
        const account = cloudStatus.accounts.find(
          (acc) => acc.provider_account_uuid === accountId
        );
        
        setAccountStatus(account || null);
        
        // Only proceed if account exists and is connected
        if (account && account.connection_status === "connected") {
          // Fetch account info
          fetchOneDriveAccountInfo(accountId)
            .then((info) => setAccountEmail(info.account_email))
            .catch((err) => console.error("Failed to fetch account info:", err));
          
          // Fetch files
          fetchFiles(null);
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

  // Global context menu blocker (capture phase) - prevents native menu in files container
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      // Only block if click is inside files container
      if (filesContainerRef.current?.contains(e.target as Node)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // Register in capture phase (before bubbling)
    document.addEventListener('contextmenu', handleContextMenu, true);

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu, true);
    };
  }, []);

  // Close context menu when account changes
  useEffect(() => {
    closeContextMenu();
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
        setError(e.message || "Error al cargar archivos de OneDrive");
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
    
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      fileId: file.id,
      fileName: file.name,
      mimeType: file.kind === "folder" ? "application/vnd.ms-onedrive.folder" : "application/octet-stream",
      webViewLink: file.webViewLink,
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

  return (
    <main className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center p-6">
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
        <div className="w-full max-w-6xl space-y-6">
          {/* Header */}
          <header className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold">OneDrive Files 🟦</h1>
              <p className="text-sm text-slate-400 mt-1">
                {accountEmail ? `Cuenta: ${accountEmail}` : `Cargando...`}
              </p>
            </div>
            <Link
              href="/app"
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium transition"
            >
              ← Volver al Dashboard
            </Link>
          </header>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-slate-300">
          {breadcrumb.map((crumb, index) => (
            <div key={index} className="flex items-center gap-2">
              {index > 0 && <span className="text-slate-500">/</span>}
              <button
                onClick={() => handleBreadcrumbClick(index)}
                className={`hover:text-blue-400 transition ${
                  index === breadcrumb.length - 1 ? "font-semibold text-white" : ""
                }`}
              >
                {crumb.name}
              </button>
            </div>
          ))}
        </nav>

        {/* Back button */}
        {breadcrumb.length > 1 && (
          <button
            onClick={handleBack}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium transition"
          >
            ← Atrás
          </button>
        )}

        {/* Rename status banner */}
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

        {/* Files table */}
        {!loading && !error && (
          <div 
            ref={filesContainerRef}
            className="bg-slate-800 rounded-lg shadow-lg overflow-hidden"
            onContextMenu={(e) => e.preventDefault()}
            onContextMenuCapture={(e) => e.preventDefault()}
          >
            {files.length === 0 ? (
              <div className="py-12 text-center text-slate-400">
                <p>Esta carpeta está vacía</p>
              </div>
            ) : (
              <div onClick={() => closeContextMenu()}>
              <table className="w-full">
                <thead>
                  <tr className="text-left border-b border-slate-700">
                    <th className="py-3 px-4 text-slate-300 font-semibold">Nombre</th>
                    <th className="py-3 px-4 text-slate-300 font-semibold">Tipo</th>
                    <th className="py-3 px-4 text-slate-300 font-semibold">Tamaño</th>
                    <th className="py-3 px-4 text-slate-300 font-semibold">Modificado</th>
                    <th className="py-3 px-4 text-slate-300 font-semibold text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((file) => (
                    <tr
                      key={file.id}
                      className="border-b border-slate-800 hover:bg-slate-700/40 transition"
                      onContextMenuCapture={(e) => handleRowContextMenu(e, file)}
                    >
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-2">
                          <span className="text-xl">
                            {file.kind === "folder" ? "📁" : "📄"}
                          </span>
                          {file.kind === "folder" ? (
                            <button
                              onClick={() => handleOpenFolder(file.id, file.name)}
                              className="font-medium text-blue-400 hover:text-blue-300 hover:underline transition"
                            >
                              {file.name}
                            </button>
                          ) : (
                            <span className="font-medium text-white">{file.name}</span>
                          )}
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-medium ${
                            file.kind === "folder"
                              ? "bg-blue-500/20 text-blue-300"
                              : "bg-slate-700 text-slate-300"
                          }`}
                        >
                          {file.kind === "folder" ? "Carpeta" : "Archivo"}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-slate-300">
                        {file.kind === "folder" ? "-" : formatSize(file.size)}
                      </td>
                      <td className="py-4 px-4 text-slate-300">
                        {formatDate(file.modifiedTime)}
                      </td>
                      <td className="py-4 px-4 text-center">
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
          </div>
        )}
        </div>
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
          copyDisabled={true}
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
