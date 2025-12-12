"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useCopyContext } from "@/context/CopyContext";

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

  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copyOptions, setCopyOptions] = useState<CopyOptions | null>(null);
  
  // Modal state for selecting target account
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [modalFileId, setModalFileId] = useState<string | null>(null);
  const [modalFileName, setModalFileName] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<number | null>(null);

  useEffect(() => {
    const fetchFiles = async () => {
      try {
        setLoading(true);
        const res = await fetch(
          `${API_BASE_URL}/drive/${accountId}/files`
        );
        if (!res.ok) {
          throw new Error(`Error: ${res.status}`);
        }
        const data = await res.json();
        setFiles(data.files || []);
      } catch (e: any) {
        setError(e.message || "Error cargando archivos");
      } finally {
        setLoading(false);
      }
    };

    const fetchCopyOptions = async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/drive/${accountId}/copy-options`
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

    if (accountId) {
      fetchFiles();
      fetchCopyOptions();
    }
  }, [accountId]);

  const handleCopyFile = async (fileId: string, targetId: number, fileName: string) => {
    if (!targetId) {
      return;
    }

    try {
      startCopy(fileName);

      const res = await fetch(`${API_BASE_URL}/drive/copy-file`, {
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
                  <th className="py-3 px-4">Nombre</th>
                  <th className="py-3 px-4">Tipo</th>
                  <th className="py-3 px-4">Tamaño</th>
                  <th className="py-3 px-4">Ver</th>
                  <th className="py-3 px-4">Copiar</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr
                    key={file.id}
                    className="border-b border-slate-800 hover:bg-slate-700/40"
                  >
                    {/* Nombre */}
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-100">
                      {file.name}
                    </td>

                    {/* Tipo (extensión simple) */}
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                      {file.mimeType ? file.mimeType.split("/").pop() : "-"}
                    </td>

                    {/* Tamaño */}
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                      {file.size
                        ? `${(Number(file.size) / 1024 / 1024).toFixed(2)} MB`
                        : "-"}
                    </td>

                    {/* Ver */}
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {file.webViewLink && (
                        <a
                          href={file.webViewLink}
                          target="_blank"
                          rel="noreferrer"
                          className="text-emerald-400 hover:underline"
                        >
                          Abrir
                        </a>
                      )}
                    </td>

                    {/* Copiar */}
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <button
                        disabled={copying || !copyOptions || copyOptions.target_accounts.length === 0}
                        onClick={() => openCopyModal(file.id, file.name)}
                        className="rounded bg-emerald-500 hover:bg-emerald-600 px-3 py-1 text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {copying ? "Copiando..." : "Copiar"}
                      </button>
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
