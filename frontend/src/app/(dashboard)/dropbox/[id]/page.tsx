"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { authenticatedFetch } from "@/lib/api";
import { toast } from "react-hot-toast";
import { ChevronRightIcon, FolderIcon, DocumentIcon } from "@heroicons/react/24/outline";

interface DropboxItem {
  id: string;
  name: string;
  kind: "folder" | "file";
  size?: number;
  path_display: string;
  client_modified?: string;
}

export default function DropboxFilesPage() {
  const params = useParams();
  const router = useRouter();
  const accountId = params.id as string;

  const [currentPath, setCurrentPath] = useState<string>("");
  const [breadcrumb, setBreadcrumb] = useState<{ path: string; name: string }[]>([
    { path: "", name: "Root" },
  ]);
  const [files, setFiles] = useState<DropboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (accountId) {
      loadFiles(currentPath);
    }
  }, [accountId, currentPath]);

  const loadFiles = async (path: string) => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await authenticatedFetch(`/dropbox/${accountId}/files?path=${encodeURIComponent(path)}`);
      
      if (!response.ok) {
        if (response.status === 401) {
          toast.error("Tu sesión ha expirado. Por favor inicia sesión de nuevo.");
          router.push("/login");
          return;
        }
        const errorData = await response.json();
        throw new Error(errorData.detail?.message || "Error al cargar archivos");
      }
      
      const data = await response.json();
      setFiles(data.items || []);
    } catch (err: any) {
      console.error("[Dropbox] Error loading files:", err);
      setError(err.message || "Error al cargar archivos");
      toast.error(err.message || "Error al cargar archivos de Dropbox");
    } finally {
      setLoading(false);
    }
  };

  const handleFolderClick = (item: DropboxItem) => {
    if (item.kind === "folder") {
      const newPath = item.path_display;
      setCurrentPath(newPath);
      
      // Update breadcrumb
      const newBreadcrumb = [...breadcrumb];
      newBreadcrumb.push({ path: newPath, name: item.name });
      setBreadcrumb(newBreadcrumb);
    }
  };

  const handleBreadcrumbClick = (index: number) => {
    const clickedCrumb = breadcrumb[index];
    setCurrentPath(clickedCrumb.path);
    setBreadcrumb(breadcrumb.slice(0, index + 1));
  };

  const formatBytes = (bytes: number | undefined) => {
    if (!bytes || bytes === 0) return "0 B";
    
    const gb = bytes / (1024 ** 3);
    const mb = bytes / (1024 ** 2);
    const kb = bytes / 1024;
    
    if (gb >= 1) {
      return `${gb.toFixed(2)} GB`;
    } else if (mb >= 1) {
      return `${mb.toFixed(2)} MB`;
    } else if (kb >= 1) {
      return `${kb.toFixed(2)} KB`;
    } else {
      return `${bytes} B`;
    }
  };

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return "";
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString("es-ES", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch {
      return "";
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => router.back()}
          className="text-blue-400 hover:text-blue-300 mb-4 inline-flex items-center gap-2"
        >
          ← Volver
        </button>
        <h1 className="text-3xl font-bold">Dropbox Files</h1>
      </div>

      {/* Breadcrumb */}
      <div className="bg-gray-900 rounded-lg p-4 mb-4 flex items-center gap-2 flex-wrap">
        {breadcrumb.map((crumb, index) => (
          <div key={index} className="flex items-center gap-2">
            {index > 0 && <ChevronRightIcon className="w-4 h-4 text-gray-500" />}
            <button
              onClick={() => handleBreadcrumbClick(index)}
              className={`hover:text-blue-400 transition-colors ${
                index === breadcrumb.length - 1 ? "text-white font-medium" : "text-gray-400"
              }`}
            >
              {crumb.name}
            </button>
          </div>
        ))}
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-4 mb-4">
          <p className="text-red-400">{error}</p>
          <button
            onClick={() => loadFiles(currentPath)}
            className="mt-2 text-sm text-blue-400 hover:text-blue-300"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
        </div>
      )}

      {/* Files List */}
      {!loading && !error && (
        <div className="bg-gray-900 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-800 border-b border-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Nombre
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Tamaño
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Modificado
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {files.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-6 py-12 text-center text-gray-500">
                      Esta carpeta está vacía
                    </td>
                  </tr>
                ) : (
                  files.map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => handleFolderClick(item)}
                      className={`hover:bg-gray-800 transition-colors ${
                        item.kind === "folder" ? "cursor-pointer" : ""
                      }`}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          {item.kind === "folder" ? (
                            <FolderIcon className="w-5 h-5 text-blue-400" />
                          ) : (
                            <DocumentIcon className="w-5 h-5 text-gray-400" />
                          )}
                          <span className="font-medium">{item.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-gray-400">
                        {item.kind === "file" ? formatBytes(item.size) : "—"}
                      </td>
                      <td className="px-6 py-4 text-gray-400">
                        {item.kind === "file" ? formatDate(item.client_modified) : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
