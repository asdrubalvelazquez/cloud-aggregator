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
  file_name: string;
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
  const [transferring, setTransferring] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [transferJob, setTransferJob] = useState<TransferJob | null>(null);

  // Fetch OneDrive accounts when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchOneDriveAccounts();
    }
  }, [isOpen]);

  // Poll transfer status when job is running
  useEffect(() => {
    if (!jobId || !transferring) return;

    const pollInterval = setInterval(async () => {
      try {
        const res = await authenticatedFetch(`/transfer/status/${jobId}`);

        if (res.ok) {
          const data = await res.json();
          setTransferJob(data);

          // Stop polling if job is done
          if (["done", "failed", "partial"].includes(data.status)) {
            setTransferring(false);
            clearInterval(pollInterval);
            onTransferComplete();
          }
        }
      } catch (e) {
        console.error("[TRANSFER] Polling error:", e);
      }
    }, 2000); // Poll every 2 seconds

    return () => clearInterval(pollInterval);
  }, [jobId, transferring, onTransferComplete]);

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

    setTransferring(true);
    setError(null);

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

      // Step 2: Run transfer job
      const runRes = await authenticatedFetch(`/transfer/run/${job_id}`, {
        method: "POST",
      });

      if (!runRes.ok) {
        const errorData = await runRes.json().catch(() => ({}));
        throw new Error(errorData.detail || `Failed to run job: ${runRes.status}`);
      }

      // Polling will start automatically via useEffect
    } catch (e: any) {
      console.error("[TRANSFER] Error:", e);
      setError(e.message);
      setTransferring(false);
    }
  };

  const handleClose = () => {
    if (transferring) {
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
    setTransferring(false);
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
        {!transferring && !transferJob && (
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

        {/* Transfer progress */}
        {transferring && transferJob && (
          <div className="space-y-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-emerald-400">
                {Math.round((transferJob.completed_items / transferJob.total_items) * 100)}%
              </div>
              <div className="text-sm text-slate-400 mt-1">
                {transferJob.completed_items} / {transferJob.total_items} archivos completados
              </div>
              {transferJob.failed_items > 0 && (
                <div className="text-sm text-red-400 mt-1">
                  {transferJob.failed_items} fallidos
                </div>
              )}
            </div>

            {/* Progress bar */}
            <div className="w-full bg-slate-700 rounded-full h-2">
              <div
                className="bg-emerald-500 h-2 rounded-full transition-all"
                style={{
                  width: `${(transferJob.completed_items / transferJob.total_items) * 100}%`,
                }}
              />
            </div>

            {/* Items list */}
            <div className="max-h-60 overflow-y-auto space-y-2">
              {transferJob.items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between text-sm p-2 bg-slate-700/50 rounded"
                >
                  <span className="truncate flex-1 text-slate-300">{item.file_name}</span>
                  <span className={`ml-2 text-xs font-semibold ${
                    item.status === "done" ? "text-emerald-400" :
                    item.status === "failed" ? "text-red-400" :
                    item.status === "running" ? "text-blue-400" :
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

            {/* Status message */}
            {transferJob.status === "done" && (
              <div className="text-center text-emerald-400 font-semibold">
                ✅ Transferencia completada
              </div>
            )}
            {transferJob.status === "failed" && (
              <div className="text-center text-red-400 font-semibold">
                ❌ Transferencia fallida
              </div>
            )}
            {transferJob.status === "partial" && (
              <div className="text-center text-amber-400 font-semibold">
                ⚠️ Transferencia parcial (algunos archivos fallaron)
              </div>
            )}

            {["done", "failed", "partial"].includes(transferJob.status) && (
              <div className="flex justify-end">
                <button
                  onClick={handleClose}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold transition"
                >
                  Cerrar
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
