"use client";

import { useState, useEffect } from "react";
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
  status: "queued" | "running" | "done" | "failed";
  error_message?: string;
  target_item_id?: string;
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
      fetchOneDriveAccounts();
    }
  }, [isOpen]);

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
              
              const resultType = getFinalResultType(safeData);
              
              // Auto-close after 2 seconds if full success
              if (resultType === "success") {
                setTimeout(() => {
                  handleClose();
                  onTransferComplete();
                }, 2000);
              } else {
                // Partial or failed: call callback but don't auto-close
                onTransferComplete();
              }
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

  const handleTransfer = async () => {
    if (!selectedTarget) {
      setError("Por favor selecciona una cuenta OneDrive destino");
      return;
    }

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
          target_account_id: selectedTarget,
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
    if (transferState === "running" || transferState === "preparing") {
      if (!confirm("¿Seguro que quieres cerrar? La transferencia seguirá en proceso.")) {
        return;
      }
    }
    onClose();
    // Reset state
    setSelectedTarget(null);
    setError(null);
    setJobId(null);
    setTransferJob(null);
    setTransferState("idle");
    setPollingErrors(0);
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
                onClick={handleTransfer}
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
        {(transferState === "running" || transferState === "completed") && transferJob && (
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
              const total = transferJob?.total_items || 0;
              const transferred = transferJob?.transferred_bytes || 0;
              
              return (
                <>
                  {/* Result summary card */}
                  <div className={`rounded-lg p-4 border ${
                    resultType === "success" ? "bg-emerald-500/10 border-emerald-500/30" :
                    resultType === "partial" ? "bg-amber-500/10 border-amber-500/30" :
                    "bg-red-500/10 border-red-500/30"
                  }`}>
                    {/* Title */}
                    <div className={`text-center font-bold text-lg mb-2 ${
                      resultType === "success" ? "text-emerald-400" :
                      resultType === "partial" ? "text-amber-400" :
                      "text-red-400"
                    }`}>
                      {resultType === "success" && "✅ Transferencia completada"}
                      {resultType === "partial" && "⚠️ Transferencia completada con errores"}
                      {resultType === "failed" && "❌ Transferencia fallida"}
                    </div>
                    
                    {/* Details */}
                    <div className="text-sm text-slate-300 space-y-1">
                      <div className="flex justify-between">
                        <span>Copiados:</span>
                        <span className="font-semibold">{completed} / {total}</span>
                      </div>
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
                  <div className="flex justify-end gap-3">
                    {(resultType === "failed" || resultType === "partial") && (
                      <button
                        onClick={handleRetryTransfer}
                        className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-semibold transition"
                        title="Reintentar transferencia desde el inicio"
                      >
                        Reintentar
                      </button>
                    )}
                    {pollingErrors > 0 && transferState === "completed" && (
                      <button
                        onClick={handleRetryPolling}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition"
                        title="Reintentar obtener estado actualizado"
                      >
                        Actualizar estado
                      </button>
                    )}
                    <button
                      onClick={handleClose}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold transition"
                    >
                      Cerrar
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
        )}
      </div>
    </div>
  );
}
