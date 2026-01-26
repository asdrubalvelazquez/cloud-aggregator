"use client";
import { useState, useEffect } from "react";
import { TransferQueuePanel } from "@/components/transfer-queue/TransferQueuePanel";
import { authenticatedFetch } from "@/lib/api";
import { CopyProgressBar } from "@/components/CopyProgressBar";
import UnifiedCopyModal from "@/components/UnifiedCopyModal";
import { toast } from "react-hot-toast";

// Tipos básicos
interface CloudAccount {
  id: string;
  provider: "google_drive" | "onedrive";
  email: string;
}

interface FileItem {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  isFolder: boolean;
}

export default function CloudTransferPage() {
  const [accounts, setAccounts] = useState<CloudAccount[]>([]);
  const [sourceAccount, setSourceAccount] = useState<string | null>(null);
  const [destAccount, setDestAccount] = useState<string | null>(null);
  const [sourceFiles, setSourceFiles] = useState<FileItem[]>([]);
  const [destFolders, setDestFolders] = useState<FileItem[]>([]);
  const [destPath, setDestPath] = useState<string>("root");
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [isTransferring, setIsTransferring] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedAccountNeedsReconnect, setSelectedAccountNeedsReconnect] = useState(false);

  // Cargar cuentas conectadas
  useEffect(() => {
    console.log('[DEBUG] Iniciando carga de cuentas...');

    authenticatedFetch("/me/cloud-status")
      .then(async (res) => {
        console.log('[DEBUG] Respuesta recibida, status:', res.status);

        if (!res.ok) throw new Error("Error al cargar cuentas");

        const data = await res.json();
        console.log('[DEBUG] Data completa del backend:', data);
        if (data.accounts && data.accounts.length > 0) {
          console.log('[DEBUG] Primera cuenta COMPLETA:', JSON.stringify(data.accounts[0], null, 2));
          console.log('[DEBUG] Todas las cuentas:', data.accounts);
          console.log('[DEBUG] Campos disponibles en primera cuenta:', Object.keys(data.accounts[0]));
        }

        const accountsArray = Array.isArray(data) ? data : data.accounts || [];
        console.log('[DEBUG] Array de cuentas a setear:', accountsArray);
        console.log('[DEBUG] Cantidad de cuentas:', accountsArray.length);

        setAccounts(accountsArray);
      })
      .catch((err) => {
        console.error('[DEBUG] Error al cargar cuentas:', err);
        setError("No se pudieron cargar las cuentas conectadas");
      });
  }, []);

  useEffect(() => {
    console.log('[DEBUG] Estado de accounts cambió:', accounts);
    console.log('[DEBUG] Cantidad en estado:', accounts.length);
  }, [accounts]);

  // Cargar archivos de la cuenta origen
  useEffect(() => {
    if (!sourceAccount) {
      setSourceFiles([]);
      setSelectedAccountNeedsReconnect(false);
      return;
    }

    const account = accounts.find(a => a.cloud_account_id === sourceAccount);
    
    if (account?.can_reconnect) {
      setSelectedAccountNeedsReconnect(true);
      setSourceFiles([]);
      return;
    }

    setSelectedAccountNeedsReconnect(false);

    console.log('[DEBUG] Cargando archivos para cuenta:', sourceAccount);
    console.log('[DEBUG] Account completa:', account);
    console.log('[DEBUG] Provider:', account?.provider);

    // Usar endpoint correcto según provider
    const provider = account?.provider;
    const endpoint = provider === 'onedrive' 
      ? `/onedrive/${sourceAccount}/files?folder_id=root`
      : `/drive/${sourceAccount}/files?folder_id=root`;
    
    console.log('[DEBUG] Endpoint a llamar:', endpoint);

    authenticatedFetch(endpoint)
      .then(async (res) => {
        console.log('[DEBUG] Response status:', res.status);
        
        if (!res.ok) {
          const errorText = await res.text();
          console.error('[DEBUG] Error response:', errorText);
          throw new Error(`HTTP ${res.status}: ${errorText}`);
        }
        
        const data = await res.json();
        console.log('[DEBUG] Response data:', data);
        console.log('[DEBUG] Files count:', data.files?.length || 0);
        
        // OneDrive usa "items", Google Drive usa "files"
        const filesList = data.items || data.files || [];

        console.log('[DEBUG] Lista de archivos/items:', filesList);
        console.log('[DEBUG] Cantidad:', filesList.length);

        setSourceFiles(
          filesList.map((f: any) => ({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType || f.type || 'file',
            size: f.size || 0,
            isFolder: f.isFolder || f.mimeType === "application/vnd.google-apps.folder" || f.mimeType === "folder" || f.type === "folder",
          }))
        );
      })
      .catch((err) => {
        console.error('[DEBUG] Error al cargar archivos:', err);
        setError("No se pudieron cargar los archivos de origen");
      });
  }, [sourceAccount, accounts]);

  // Cargar carpetas de la cuenta destino
  useEffect(() => {
    if (!destAccount) {
      setDestFolders([]);
      return;
    }

    console.log('[DEBUG] Cargando carpetas para cuenta destino:', destAccount);

    const account = accounts.find(a => a.cloud_account_id === destAccount);
    const endpoint = account?.provider === 'onedrive'
      ? `/onedrive/${destAccount}/folders?parent_id=${destPath}`
      : `/drive/${destAccount}/folders?parent_id=${destPath}`;

    console.log('[DEBUG] Endpoint a llamar para carpetas destino:', endpoint);

    authenticatedFetch(endpoint)
      .then(async (res) => {
        console.log('[DEBUG] Response status:', res.status);

        if (!res.ok) {
          const errorText = await res.text();
          console.error('[DEBUG] Error response:', errorText);
          throw new Error(`HTTP ${res.status}: ${errorText}`);
        }

        const data = await res.json();
        console.log('[DEBUG] Response data:', data);

        const foldersList = data.items || data.folders || [];

        setDestFolders(
          foldersList.map((f: any) => ({
            id: f.id,
            name: f.name,
            isFolder: true,
          }))
        );
      })
      .catch((err) => {
        console.error('[DEBUG] Error al cargar carpetas destino:', err);
        setError("No se pudieron cargar las carpetas de destino");
      });
  }, [destAccount, destPath, accounts]);

  // Selección de archivos
  const toggleFile = (id: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAll = () => setSelectedFiles(new Set(sourceFiles.map((f) => f.id)));
  const clearAll = () => setSelectedFiles(new Set());

  // Transferir archivos
  const handleTransfer = async () => {
    setError(null);
    setSuccess(null);
    if (!sourceAccount || !destAccount) {
      setError("Selecciona ambas cuentas");
      return;
    }
    if (selectedFiles.size === 0) {
      setError("Selecciona al menos un archivo");
      return;
    }
    setIsTransferring(true);
    try {
      const res = await authenticatedFetch("/transfer/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_account: sourceAccount,
          dest_account: destAccount,
          file_ids: Array.from(selectedFiles),
          dest_folder: destPath,
        }),
      });
      if (!res.ok) throw new Error();
      setSuccess("Transferencia iniciada correctamente");
      setSelectedFiles(new Set());
      toast.success("Transferencia iniciada");
    } catch {
      setError("Error al iniciar la transferencia");
      toast.error("Error al transferir archivos");
    } finally {
      setIsTransferring(false);
    }
  };

  const handleReconnect = async (accountId: string | null) => {
    if (!accountId) return;

    const account = accounts.find(a => a.cloud_account_id === accountId);
    if (!account) return;

    // Construir la URL base del API
    const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://cloud-aggregator-api.fly.dev';
    
    let reconnectUrl: string;
    
    // OneDrive usa un endpoint diferente al de Google
    if (account.provider === 'onedrive') {
      reconnectUrl = `${apiBaseUrl}/auth/onedrive/login-url?mode=reconnect&reconnect_account_id=${accountId}`;
    } else if (account.provider === 'google' || account.provider === 'google_drive') {
      reconnectUrl = `${apiBaseUrl}/auth/google?mode=reconnect&reconnect_account_id=${accountId}`;
    } else {
      console.error('[ERROR] Provider no soportado:', account.provider);
      return;
    }
    
    console.log('[DEBUG] Redirigiendo a reconexión:', reconnectUrl);
    console.log('[DEBUG] Provider:', account.provider);
    console.log('[DEBUG] Account ID:', accountId);
    
    // Para OneDrive, el endpoint devuelve JSON con la URL, necesitamos hacer fetch primero
    if (account.provider === 'onedrive') {
      try {
        const response = await authenticatedFetch(`/auth/onedrive/login-url?mode=reconnect&reconnect_account_id=${accountId}`);
        
        if (!response.ok) {
          console.error('[ERROR] Fallo al obtener URL de OneDrive:', response.status);
          toast.error('Error al iniciar reconexión de OneDrive');
          return;
        }
        
        const data = await response.json();
        console.log('[DEBUG] Respuesta de login-url:', data);
        
        if (data.login_url) {
          window.location.href = data.login_url;
        } else {
          console.error('[ERROR] No se recibió login_url en la respuesta');
          toast.error('Error al obtener URL de autenticación');
        }
      } catch (error) {
        console.error('[ERROR] Error al llamar login-url:', error);
        toast.error('Error al iniciar reconexión');
      }
    } else {
      // Google puede redirigir directamente
      window.location.href = reconnectUrl;
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 flex flex-col">
      <div className="max-w-5xl w-full mx-auto py-8 px-2">
        <h1 className="text-2xl font-bold mb-6">Transferencias Cloud-to-Cloud</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-[500px]">
          {/* Panel Origen */}
          <div className="bg-slate-800 rounded-lg p-4 flex flex-col h-full">
            <div className="mb-2 font-semibold">Cuenta Origen</div>
            <div className="text-xs text-yellow-400 mb-2">
              DEBUG: {accounts.length} cuentas en estado
              <br />
              Providers: {accounts.map(a => a.provider).join(', ')}
            </div>
            <select
              className="mb-4 p-2 rounded bg-slate-700 text-slate-200"
              value={sourceAccount || ""}
              onChange={(e) => setSourceAccount(e.target.value || null)}
            >
              <option value="">Selecciona una cuenta</option>
              {accounts
                .filter(a => 
                  a.provider === "google" || 
                  a.provider === "google_drive" || 
                  a.provider === "onedrive"
                )
                .map(a => (
                  <option key={a.cloud_account_id} value={a.cloud_account_id}>
                    {a.provider === "google" || a.provider === "google_drive" ? "Google Drive" : "OneDrive"} - {a.provider_email}
                  </option>
                ))}
            </select>
            <div className="flex-1 overflow-y-auto border rounded bg-slate-900">
              {!sourceAccount ? (
                <div className="p-4 text-slate-400">Selecciona una cuenta para ver archivos</div>
              ) : selectedAccountNeedsReconnect ? (
                <div className="bg-yellow-900/20 border border-yellow-600 rounded-lg p-6 m-4">
                  <div className="flex items-start gap-3">
                    <div className="text-3xl">⚠️</div>
                    <div className="flex-1">
                      <h3 className="text-yellow-400 font-semibold text-lg mb-2">
                        Esta Cuenta Necesita Reconexión
                      </h3>
                      <p className="text-slate-300 mb-4">
                        La cuenta seleccionada requiere reautorización para acceder a los archivos.
                        Por favor, reconecta la cuenta para continuar.
                      </p>
                      <button
                        onClick={() => {
                          console.log('[DEBUG] Account ID seleccionado:', sourceAccount);
                          console.log('[DEBUG] Account completa:', accounts.find(a => a.cloud_account_id === sourceAccount));
                          handleReconnect(sourceAccount);
                        }}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
                      >
                        🔄 Reconectar Ahora
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <ul>
                  {sourceFiles.map((file) => (
                    <li key={file.id} className="flex items-center px-2 py-1 border-b border-slate-800 hover:bg-slate-700">
                      <input
                        type="checkbox"
                        checked={selectedFiles.has(file.id)}
                        onChange={() => toggleFile(file.id)}
                        className="mr-2"
                      />
                      <span className={file.isFolder ? "font-semibold" : ""}>{file.isFolder ? "📁" : "📄"} {file.name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="mt-2 flex gap-2">
              <button onClick={selectAll} className="text-xs px-2 py-1 bg-slate-700 rounded hover:bg-slate-600">Seleccionar Todo</button>
              <button onClick={clearAll} className="text-xs px-2 py-1 bg-slate-700 rounded hover:bg-slate-600">Limpiar</button>
            </div>
          </div>
          {/* Panel Destino */}
          <div className="bg-slate-800 rounded-lg p-4 flex flex-col h-full">
            <div className="mb-2 font-semibold">Cuenta Destino</div>
            <select
              className="mb-4 p-2 rounded bg-slate-700 text-slate-200"
              value={destAccount || ""}
              onChange={(e) => setDestAccount(e.target.value || null)}
            >
              <option value="">Selecciona una cuenta</option>
              {accounts
                .filter(a => 
                  a.provider === "google" || 
                  a.provider === "google_drive" || 
                  a.provider === "onedrive"
                )
                .map(a => (
                  <option key={a.cloud_account_id} value={a.cloud_account_id}>{a.provider === "google" || a.provider === "google_drive" ? "Google Drive" : "OneDrive"} - {a.provider_email}</option>
                ))}
            </select>
            <div className="flex-1 overflow-y-auto border rounded bg-slate-900">
              {destFolders.length === 0 ? (
                <div className="p-4 text-slate-400">Selecciona una cuenta para ver carpetas</div>
              ) : (
                <ul>
                  {destFolders.map((folder) => (
                    <li key={folder.id} className="flex items-center px-2 py-1 border-b border-slate-800 hover:bg-slate-700 cursor-pointer"
                      onClick={() => setDestPath(folder.id)}
                    >
                      <span className="font-semibold">📁 {folder.name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="mt-2 text-xs text-slate-400">Carpeta destino seleccionada: {destPath}</div>
          </div>
        </div>
        {/* Botón Transferir */}
        <div className="flex justify-center mt-6">
          <button
            className="px-6 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-50"
            onClick={handleTransfer}
            disabled={isTransferring || !sourceAccount || !destAccount || selectedFiles.size === 0}
          >
            {isTransferring ? "Transfiriendo..." : "Transferir Archivos →"}
          </button>
        </div>
        {/* Mensajes de error/éxito */}
        {error && <div className="mt-4 text-red-400 text-center">{error}</div>}
        {success && <div className="mt-4 text-green-400 text-center">{success}</div>}
        {/* Panel de cola de transferencias */}
        <div className="mt-10">
          <TransferQueuePanel />
        </div>
      </div>
    </div>
  );
}
