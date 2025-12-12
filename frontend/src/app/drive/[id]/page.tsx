"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

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

  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copyOptions, setCopyOptions] = useState<CopyOptions | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<number | null>(null);
  const [copying, setCopying] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const loadingCopy = copying;

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

  const handleCopyFile = async (fileId: string, targetId: number) => {
    if (!targetId) {
      setCopyStatus("Selecciona una cuenta destino");
      return;
    }

    try {
      setCopying(true);
      setCopyStatus("Copiando archivo...");

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
      });

      if (!res.ok) {
        throw new Error(`Error: ${res.status}`);
      }

      const result = await res.json();
      setCopyStatus(
        `✅ Archivo "${result.file.name}" copiado exitosamente a ${copyOptions?.target_accounts.find(a => a.id === targetId)?.email}`
      );
      setSelectedFile(null);
      setSelectedTarget(null);

      setTimeout(() => setCopyStatus(null), 5000);
    } catch (e: any) {
      setCopyStatus(`❌ Error: ${e.message}`);
    } finally {
      setCopying(false);
    }
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
  
  const handleCopyClick = (fileId: string) => {
    const fallbackTarget = copyOptions?.target_accounts?.[0]?.id ?? null;
    const target = selectedTarget ?? fallbackTarget;
    if (!target) {
      setCopyStatus("Selecciona una cuenta destino");
      return;
    }
    handleCopyFile(fileId, target);
  };

  return (
    <main className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center p-6">
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

        {/* Copy Status Message */}
        {copyStatus && (
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
                        disabled={loadingCopy}
                        onClick={() => handleCopyClick(file.id)}
                        className="rounded bg-emerald-500 hover:bg-emerald-600 px-3 py-1 text-xs font-semibold disabled:opacity-50"
                      >
                        {loadingCopy ? "Copiando..." : "Copiar"}
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
      </div>
    </main>
  );
}
