"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useCopyContext } from "@/context/CopyContext";
import { authenticatedFetch } from "@/lib/api";

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
    if (!targetId) {
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
        throw new Error(`Error: ${res.status}`);
      }

      const result = await res.json();
      clearInterval(progressInterval);
      
      const targetEmail = copyOptions?.target_accounts.find(a => a.id === targetId)?.email || "cuenta destino";
      completeCopy(`✅ Archivo "${fileName}" copiado exitosamente a ${targetEmail}`);
      
      // Limpiar modal y estado después de 3 segundos
      setTimeout(() => {
        setShowCopyModal(false);
        setModalFileId(null);
        setModalFileName(null);
        setSelectedTarget(null);
        resetCopy();
      }, 3000);
    } catch (e: any) {
      if (e.name === "AbortError") {
        cancelCopyGlobal("❌ Copia cancelada");
      } else {
        cancelCopyGlobal(`❌ Error: ${e.message}`);
      }
      setTimeout(() => {
        setShowCopyModal(false);
        setModalFileId(null);
        setModalFileName(null);
        setSelectedTarget(null);
        resetCopy();
      }, 3000);
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
    if (!selectedTarget || !modalFileId || !modalFileName) {
      return;
    }
    handleCopyFile(modalFileId, selectedTarget, modalFileName);
    closeCopyModal();
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
          {copyOptions && (
            <div className="text-sm text-slate-400">
              {copyOptions.source_account.email}
            </div>
          )}
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

        {/* Copy Success/Error Message */}
        {copyStatus && !copying && (
          <div
            className={`rounded-lg p-4 ${
              copyStatus.includes("✅")
                ? "bg-emerald-500/20 border border-emerald-500 text-emerald-100"
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

        {/* Files Table */}
        {!loading && !error && files.length > 0 && (
          <div className="bg-slate-800 rounded-xl p-4 shadow overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-slate-700">
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
                    className="border-b border-slate-800 hover:bg-slate-700/40 transition"
                  >
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

                    {/* Acciones */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
                        {/* Ver/Abrir */}
                        {file.mimeType === "application/vnd.google-apps.folder" ? (
                          <button
                            type="button"
                            onClick={() => handleOpenFolder(file.id, file.name)}
                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition flex items-center gap-1"
                          >
                            📂 Abrir
                          </button>
                        ) : (
                          file.webViewLink && (
                            <a
                              href={file.webViewLink}
                              target="_blank"
                              rel="noreferrer"
                              className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 text-white rounded-lg text-xs font-semibold transition flex items-center gap-1"
                            >
                              👁️ Ver
                            </a>
                          )
                        )}
                        
                        {/* Copiar */}
                        <button
                          disabled={copying || !copyOptions || copyOptions.target_accounts.length === 0}
                          onClick={() => openCopyModal(file.id, file.name)}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                        >
                          📋 Copiar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
                    : "bg-red-500/20 border border-red-500 text-red-100"
                }`}>
                  {copyStatus}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3 justify-end">
                <button
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
      </div>
    </main>
  );
}
