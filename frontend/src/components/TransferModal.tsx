"use client";

import { useState, useEffect, useRef } from "react";
import { authenticatedFetch } from "@/lib/api";

type OneDriveAccount = {
  cloud_account_id: string;  // UUID string from cloud_provider_accounts.id
  account_email: string;
};

type TransferModalProps = {
  isOpen: boolean;
  onClose: () => void;
  sourceAccountId: number;
  selectedFileIds: string[];
  onTransferComplete: () => void;
};

type TransferJob = {
  id: string;
  status: "queued" | "running" | "done" | "failed" | "partial";
  total_items: number;
  completed_items: number;
  failed_items: number;
  skipped_items?: number;
  total_bytes: number;
  transferred_bytes: number;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  items: TransferJobItem[];
};

type TransferJobItem = {
  id: string;
  source_item_id: string;
  source_name: string;  // Changed from file_name to match backend
  size_bytes: number;
  status: "queued" | "running" | "done" | "failed" | "skipped";
  error_message?: string;
  target_item_id?: string;
  target_web_url?: string;
};

export default function TransferModal({
  isOpen,
  onClose,
  sourceAccountId,
  selectedFileIds,
  onTransferComplete,
}: TransferModalProps) {
  const [targetAccounts, setTargetAccounts] = useState<OneDriveAccount[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);  // UUID string
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Transfer execution state
  const [transferState, setTransferState] = useState<"idle" | "preparing" | "running" | "completed">("idle");
  const [jobId, setJobId] = useState<string | null>(null);
  const [transferJob, setTransferJob] = useState<TransferJob | null>(null);
  const [pollingErrors, setPollingErrors] = useState(0);
  
  // Flag to track if auto-start has been attempted
  const autoStartAttemptedRef = useRef(false);

  // Helper: Detect if job is in terminal state
  const isTerminalState = (job: any): boolean => {
    if (!job) return false;
    
    const status = (job.status || "").toLowerCase();
    
    // Known terminal states
    if (["done", "completed", "success", "failed", "error", "partial"].includes(status)) {
      return true;
    }
    
    // Defensive: check if all items processed (completed + failed === total)
    const total = parseInt(job.total_items) || 0;
    const completed = parseInt(job.completed_items) || 0;
    const failed = parseInt(job.failed_items) || 0;
    
    if (total > 0 && (completed + failed >= total)) {
      return true;
    }
    
    return false;
  };

  // Helper: Determine final result type
  const getFinalResultType = (job: any): "success" | "partial" | "failed" => {
    if (!job) return "failed";
    
    const completed = parseInt(job.completed_items) || 0;
    const failed = parseInt(job.failed_items) || 0;
    
    if (failed === 0 && completed > 0) return "success";
    if (failed > 0 && completed > 0) return "partial";
    return "failed";
  };

  // Helper: Format bytes to human-readable
  const formatBytes = (bytes: number): string => {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  // Helper: Extract error message from backend response
  const extractErrorMessage = (errorData: any): string => {
    if (typeof errorData === "string") return errorData;
    if (errorData?.message) return errorData.message;
    if (errorData?.detail) return errorData.detail;
    if (errorData?.error) return errorData.error;
    return "Error desconocido";
  };

  // Fetch OneDrive accounts when modal opens
  useEffect(() => {
    if (isOpen) {
      autoStartAttemptedRef.current = false;  // Reset flag on modal open
      fetchOneDriveAccounts();
    }
  }, [isOpen]);
  
  // Auto-select account when loaded (does NOT execute transfer)
  useEffect(() => {
    if (!isOpen || autoStartAttemptedRef.current || transferState !== "idle") return;
    if (loading || targetAccounts.length === 0) return;
    
    // Auto-select logic (NO auto-execute)
    autoStartAttemptedRef.current = true;
    
    // Get last used account from localStorage
    const lastUsedAccount = localStorage.getItem('transfer_last_onedrive_account');
    
    if (targetAccounts.length === 1) {
      // Only 1 account: auto-select
      const account = targetAccounts[0];
      console.log('[TRANSFER] Auto-selecting single account:', account.account_email);
      setSelectedTarget(account.cloud_account_id);
    } else if (lastUsedAccount && targetAccounts.find(a => a.cloud_account_id === lastUsedAccount)) {
      // Multiple accounts but last used is available: auto-select
      console.log('[TRANSFER] Auto-selecting last used account');
      setSelectedTarget(lastUsedAccount);
    } else if (targetAccounts.length > 1) {
      // Multiple accounts, no preference: auto-select first
      const account = targetAccounts[0];
      console.log('[TRANSFER] Auto-selecting first account:', account.account_email);
      setSelectedTarget(account.cloud_account_id);
    }
    // If no accounts, error will be shown in UI (handled in render)
  }, [isOpen, loading, targetAccounts, transferState]);

  // Poll transfer status when job is running
  useEffect(() => {
    if (!jobId || transferState !== "running") return;

    let pollInterval: NodeJS.Timeout | null = null;

    const startPolling = () => {
      pollInterval = setInterval(async () => {
        try {
          const res = await authenticatedFetch(`/transfer/status/${jobId}`);

          if (res.ok) {
            const data = await res.json();
            
            // Defensive: ensure data has expected shape
            const safeData = {
              ...data,
              total_items: parseInt(data.total_items) || 0,
              completed_items: parseInt(data.completed_items) || 0,
              failed_items: parseInt(data.failed_items) || 0,
              skipped_items: parseInt(data.skipped_items) || 0,
              total_bytes: parseInt(data.total_bytes) || 0,
              transferred_bytes: parseInt(data.transferred_bytes) || 0,
              items: Array.isArray(data.items) ? data.items : [],
            };
            
            setTransferJob(safeData);
            setPollingErrors(0); // Reset error count on success

            // Stop polling if job is in terminal state
            if (isTerminalState(safeData)) {
              if (pollInterval) clearInterval(pollInterval);
              setTransferState("completed");
              // Do NOT auto-close or call callback - wait for user to click "Aceptar"
            }
          } else {
            throw new Error(`Polling failed: ${res.status}`);
          }
        } catch (e) {
          console.error("[TRANSFER] Polling error:", e);
          setPollingErrors(prev => prev + 1);
          
          // If 3 consecutive errors, stop polling and show error
          if (pollingErrors >= 2) {
            if (pollInterval) clearInterval(pollInterval);
            setError("Error al obtener el estado de la transferencia. Verifica tu conexión.");
            setTransferState("completed");
          }
        }
      }, 1500); // Poll every 1.5 seconds
    };

    startPolling();

    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [jobId, transferState, pollingErrors, onTransferComplete]);

  const fetchOneDriveAccounts = async () => {
    setLoading(true);
    setError(null);

    try {
      // Use authenticatedFetch with correct JWT handling
      const res = await authenticatedFetch("/transfer/targets/onedrive");

      if (!res.ok) {
        throw new Error(`Failed to fetch accounts: ${res.status}`);
      }

      const data = await res.json();
      
      // Transform response to match expected type
      const onedriveAccounts = data.accounts.map((acc: any) => ({
        cloud_account_id: acc.id,
        account_email: acc.email,
      }));
      
      setTargetAccounts(onedriveAccounts);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTransfer = async (targetAccountId?: string) => {
    const targetId = targetAccountId || selectedTarget;
    
    if (!targetId) {
      setError("Por favor selecciona una cuenta OneDrive destino");
      return;
    }
    
    // Save last used account
    localStorage.setItem('transfer_last_onedrive_account', targetId);

    setTransferState("preparing");
    setError(null);
    setPollingErrors(0);

    try {
      // Step 1: Create transfer job
      const createRes = await authenticatedFetch("/transfer/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source_provider: "google_drive",
          source_account_id: sourceAccountId,
          target_provider: "onedrive",
          target_account_id: targetId,
          file_ids: selectedFileIds,
          target_folder_id: null, // Root folder
        }),
      });

      if (!createRes.ok) {
        const errorData = await createRes.json().catch(() => ({}));
        throw new Error(extractErrorMessage(errorData) || `Failed to create job: ${createRes.status}`);
      }

      const { job_id } = await createRes.json();
      setJobId(job_id);

      // Step 2: Run transfer job (async, don't wait for completion)
      const runRes = await authenticatedFetch(`/transfer/run/${job_id}`, {
        method: "POST",
      });

      if (!runRes.ok) {
        const errorData = await runRes.json().catch(() => ({}));
        throw new Error(extractErrorMessage(errorData) || `Failed to run job: ${runRes.status}`);
      }

      // Transition to running state, polling will start automatically
      setTransferState("running");
    } catch (e: any) {
      console.error("[TRANSFER] Error:", e);
      setError(e.message);
      setTransferState("idle");
    }
  };

  const handleClose = () => {
    // Allow closing/hiding always (no confirmation)
    onClose();
    // Reset state
    setSelectedTarget(null);
    setError(null);
    setJobId(null);
    setTransferJob(null);
    setTransferState("idle");
    setPollingErrors(0);
    autoStartAttemptedRef.current = false;
  };

  const handleAcceptResult = () => {
    // User confirmed result - close modal and trigger refresh
    onTransferComplete();
    handleClose();
  };

  const handleRetryPolling = () => {
    if (jobId) {
      setError(null);
      setPollingErrors(0);
      setTransferState("running");
    }
  };

  const handleRetryTransfer = () => {
    setTransferState("idle");
    setJobId(null);
    setTransferJob(null);
    setError(null);
    setPollingErrors(0);
    autoStartAttemptedRef.current = false;
    // Will trigger auto-start again
    if (targetAccounts.length > 0) {
      setTimeout(() => {
        if (selectedTarget) {
          handleTransfer(selectedTarget);
        }
      }, 100);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-slate-800 rounded-lg p-6 max-w-2xl w-full mx-4 border border-slate-700 shadow-2xl max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-white">
            Copiar a OneDrive
          </h2>
          <button
            onClick={handleClose}
            className="text-slate-400 hover:text-white transition"
            title={transferState === "running" || transferState === "preparing" ? "Ocultar (la transferencia continuará)" : "Cerrar"}
          >
            ✕
          </button>
        </div>

        {/* File count */}
        <div className="mb-4 text-sm text-slate-400">
          {selectedFileIds.length} archivo{selectedFileIds.length > 1 ? "s" : ""} seleccionado{selectedFileIds.length > 1 ? "s" : ""}
        </div>

        {/* Target account selector */}
        {transferState === "idle" && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Cuenta OneDrive destino:
              </label>
              {loading ? (
                <p className="text-sm text-slate-400">Cargando cuentas...</p>
              ) : targetAccounts.length === 0 ? (
                <p className="text-sm text-amber-400">
                  ⚠️ No tienes cuentas OneDrive conectadas. Ve a <a href="/dashboard" className="underline">Mis Cuentas Cloud</a> para conectar una.
                </p>
              ) : (
                <select
                  value={selectedTarget || ""}
                  onChange={(e) => setSelectedTarget(e.target.value || null)}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">Seleccionar cuenta...</option>
                  {targetAccounts.map((account) => (
                    <option key={account.cloud_account_id} value={account.cloud_account_id}>
                      {account.account_email}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {error && (
              <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded p-3">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={handleClose}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleTransfer()}
                disabled={!selectedTarget || loading || targetAccounts.length === 0}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg font-semibold transition"
              >
                Iniciar transferencia
              </button>
            </div>
          </div>
        )}

        {/* Preparing state */}
        {transferState === "preparing" && (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-slate-600 border-t-emerald-500 mb-4"></div>
            <p className="text-slate-300 font-semibold">Preparando transferencia...</p>
            <p className="text-sm text-slate-400 mt-2">Creando trabajo de copia</p>
          </div>
        )}

        {/* Transfer progress */}
        {(transferState === "running" || transferState === "completed") && (
          transferJob ? (
            <div className="space-y-4">
            {/* Progress percentage */}
            <div className="text-center">
              <div className="text-2xl font-bold text-emerald-400">
                {transferJob.total_items > 0 
                  ? Math.round((transferJob.completed_items / transferJob.total_items) * 100)
                  : 0}%
              </div>
              <div className="text-sm text-slate-400 mt-1">
                {transferJob.completed_items} / {transferJob.total_items} archivos completados
              </div>
              {transferJob.failed_items > 0 && (
                <div className="text-sm text-red-400 mt-1">
                  {transferJob.failed_items} fallidos
                </div>
              )}
              {pollingErrors > 0 && transferState === "running" && (
                <div className="text-sm text-amber-400 mt-1 animate-pulse">
                  Reintentando... ({pollingErrors}/3)
                </div>
              )}
            </div>

            {/* Progress bar */}
            <div className="w-full bg-slate-700 rounded-full h-2">
              <div
                className="bg-emerald-500 h-2 rounded-full transition-all duration-500"
                style={{
                  width: `${transferJob.total_items > 0 
                    ? (transferJob.completed_items / transferJob.total_items) * 100 
                    : 0}%`,
                }}
              />
            </div>

            {/* Items list */}
            {transferJob.items && transferJob.items.length > 0 && (
              <div className="max-h-60 overflow-y-auto space-y-2">
                {transferJob.items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between text-sm p-2 bg-slate-700/50 rounded"
                  >
                    <span className="truncate flex-1 text-slate-300">{item.source_name}</span>
                    <span className={`ml-2 text-xs font-semibold ${
                      item.status === "done" ? "text-emerald-400" :
                      item.status === "failed" ? "text-red-400" :
                      item.status === "running" ? "text-blue-400 animate-pulse" :
                      "text-slate-500"
                    }`}>
                      {item.status === "done" ? "✓" :
                       item.status === "failed" ? "✗" :
                       item.status === "running" ? "..." :
                       "⏳"}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Error message */}
            {error && transferState === "completed" && (
              <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded p-3">
                {error}
              </div>
            )}

            {/* Status message */}
            {transferState === "completed" && (() => {
              const resultType = getFinalResultType(transferJob);
              const completed = transferJob?.completed_items || 0;
              const failed = transferJob?.failed_items || 0;
              const skipped = transferJob?.skipped_items || 0;
              const total = transferJob?.total_items || 0;
              const transferred = transferJob?.transferred_bytes || 0;
              
              // Get webUrl from first successful item
              const firstSuccessfulItem = transferJob?.items?.find(
                item => (item.status === "done" || item.status === "skipped") && item.target_web_url
              );
              const hasWebUrl = !!firstSuccessfulItem?.target_web_url;
              
              return (
                <>
                  {/* Result summary card */}
                  <div className={`rounded-lg p-4 border ${
                    resultType === "success" ? "bg-emerald-500/10 border-emerald-500/30" :
                    resultType === "partial" ? "bg-amber-500/10 border-amber-500/30" :
                    "bg-red-500/10 border-red-500/30"
                  }`}>
                    {/* Title */}
                    <div className={`text-center font-bold text-xl mb-3 ${
                      resultType === "success" ? "text-emerald-400" :
                      resultType === "partial" ? "text-amber-400" :
                      "text-red-400"
                    }`}>
                      {resultType === "success" && "✅ Transferencia completada"}
                      {resultType === "partial" && "✅ Transferencia completada"}
                      {resultType === "failed" && "❌ Transferencia fallida"}
                    </div>
                    
                    {/* Confirmation message */}
                    <p className="text-center text-slate-300 mb-4">
                      {resultType === "success" && total === 1 && "El archivo fue copiado a OneDrive correctamente."}
                      {resultType === "success" && total > 1 && `Los ${total} archivos fueron copiados a OneDrive correctamente.`}
                      {resultType === "partial" && `${completed} ${completed === 1 ? 'archivo fue copiado' : 'archivos fueron copiados'} correctamente, pero ${failed} ${failed === 1 ? 'falló' : 'fallaron'}.`}
                      {resultType === "failed" && "No se pudo completar la transferencia. Verifica tu conexión e intenta nuevamente."}
                    </p>
                    
                    {/* Details summary */}
                    <div className="text-sm text-slate-400 space-y-1 mb-4">
                      <div className="flex justify-between">
                        <span>Éxito:</span>
                        <span className="font-semibold text-emerald-400">{completed}</span>
                      </div>
                      {skipped > 0 && (
                        <div className="flex justify-between">
                          <span>Omitidos (ya existían):</span>
                          <span className="font-semibold text-yellow-400">{skipped}</span>
                        </div>
                      )}
                      {failed > 0 && (
                        <div className="flex justify-between">
                          <span>Fallidos:</span>
                          <span className="font-semibold text-red-400">{failed}</span>
                        </div>
                      )}
                      {transferred > 0 && (
                        <div className="flex justify-between">
                          <span>Transferidos:</span>
                          <span className="font-semibold">{formatBytes(transferred)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex justify-center gap-3">
                    {hasWebUrl && (
                      <button
                        onClick={() => window.open(firstSuccessfulItem?.target_web_url, '_blank')}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition"
                        title="Abrir archivo en OneDrive"
                      >
                        Ver en OneDrive
                      </button>
                    )}
                    <button
                      onClick={handleAcceptResult}
                      className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold transition"
                    >
                      Aceptar
                    </button>
                  </div>
                </>
              );
            })()}

            {/* Running status */}
            {transferState === "running" && (
              <div className="text-center text-blue-400 font-semibold animate-pulse">
                🔄 Copiando archivos...
              </div>
            )}
            </div>
          ) : transferState === "running" ? (
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-slate-600 border-t-emerald-500 mb-4"></div>
              <p className="text-slate-300 font-semibold">Preparando transferencia...</p>
              <p className="text-sm text-slate-400 mt-2">Obteniendo estado inicial</p>
              <div className="mt-6">
                <button
                  onClick={handleClose}
                  className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-lg transition"
                >
                  Ocultar
                </button>
              </div>
            </div>
          ) : null
        )}
      </div>
    </div>
  );
}
