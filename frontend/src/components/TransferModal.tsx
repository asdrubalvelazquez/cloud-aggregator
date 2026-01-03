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

  // Fetch OneDrive accounts when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchOneDriveAccounts();
    }
  }, [isOpen]);

  // Poll transfer status when job is running
  useEffect(() => {
    if (!jobId || transferState !== "running") return;

    const pollInterval = setInterval(async () => {
      try {
        const res = await authenticatedFetch(`/transfer/status/${jobId}`);

        if (res.ok) {
          const data = await res.json();
          setTransferJob(data);
          setPollingErrors(0); // Reset error count on success

          // Stop polling if job is done
          if (["done", "failed", "partial"].includes(data.status)) {
            setTransferState("completed");
            clearInterval(pollInterval);
            
            // Auto-close after 2 seconds if successful
            if (data.status === "done") {
              setTimeout(() => {
                handleClose();
                onTransferComplete();
              }, 2000);
            } else {
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
          clearInterval(pollInterval);
          setError("Error al obtener el estado de la transferencia. Verifica tu conexión.");
          setTransferState("completed");
        }
      }
    }, 1500); // Poll every 1.5 seconds

    return () => clearInterval(pollInterval);
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
        throw new Error(errorData.detail || `Failed to create job: ${createRes.status}`);
      }

      const { job_id } = await createRes.json();
      setJobId(job_id);

      // Step 2: Run transfer job (async, don't wait for completion)
      const runRes = await authenticatedFetch(`/transfer/run/${job_id}`, {
        method: "POST",
      });

      if (!runRes.ok) {
        const errorData = await runRes.json().catch(() => ({}));
        throw new Error(errorData.detail || `Failed to run job: ${runRes.status}`);
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
            {transferState === "completed" && (
              <>
                {transferJob.status === "done" && (
                  <div className="text-center text-emerald-400 font-semibold animate-fade-in">
                    ✅ Transferencia completada exitosamente
                  </div>
                )}
                {transferJob.status === "failed" && (
                  <div className="text-center text-red-400 font-semibold">
                    ❌ Transferencia fallida
                  </div>
                )}
                {transferJob.status === "partial" && (
                  <div className="text-center text-amber-400 font-semibold">
                    ⚠️ Transferencia parcial ({transferJob.completed_items} exitosos, {transferJob.failed_items} fallidos)
                  </div>
                )}

                <div className="flex justify-end gap-3">
                  {transferJob.status === "failed" && (
                    <button
                      onClick={() => {
                        setTransferState("idle");
                        setJobId(null);
                        setTransferJob(null);
                        setError(null);
                        setPollingErrors(0);
                      }}
                      className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-semibold transition"
                    >
                      Reintentar
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
            )}

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
