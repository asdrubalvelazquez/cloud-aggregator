"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { fetchOneDriveFiles, fetchOneDriveAccountInfo, renameOneDriveItem, getOneDriveDownloadUrl } from "@/lib/api";
import type { OneDriveListResponse, OneDriveItem } from "@/lib/api";
import OnedriveRowActionsMenu from "@/components/OnedriveRowActionsMenu";
import OneDriveRenameModal from "@/components/OneDriveRenameModal";

export default function OneDriveFilesPage() {
  const params = useParams();
  const accountId = params.id as string;

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

  // Fetch account info on mount
  useEffect(() => {
    if (accountId) {
      fetchOneDriveAccountInfo(accountId)
        .then((info) => setAccountEmail(info.account_email))
        .catch((err) => console.error("Failed to fetch account info:", err));
    }
  }, [accountId]);

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

  // Initial load
  useEffect(() => {
    if (accountId) {
      fetchFiles(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

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
          <div className="bg-slate-800 rounded-lg shadow-lg overflow-hidden">
            {files.length === 0 ? (
              <div className="py-12 text-center text-slate-400">
                <p>Esta carpeta está vacía</p>
              </div>
            ) : (
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
            )}
          </div>
        )}
      </div>

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
