"use client";

import { useState, useEffect, useRef } from "react";
import { authenticatedFetch } from "@/lib/api";
import { useTransferQueue } from "@/hooks/useTransferQueue";
import { JobWithItems } from "@/types/transfer-queue";

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
  onViewInDestination?: (targetAccountId: string, folderId: string) => void;
};

export default function TransferModal({
  isOpen,
  onClose,
  sourceAccountId,
  selectedFileIds,
  onTransferComplete,
  onViewInDestination,
}: TransferModalProps) {
  const { addJob, openPanel } = useTransferQueue();
  
  const [targetAccounts, setTargetAccounts] = useState<OneDriveAccount[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);

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

    setIsTransferring(true);
    setError(null);

    try {
      // PHASE 1: Create empty job (fast, <500ms)
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

      // PHASE 2: Prepare job (fetch metadata, check quota, create items)
      const prepareRes = await authenticatedFetch(`/transfer/prepare/${job_id}`, {
        method: "POST",
        signal: AbortSignal.timeout(120000), // 120s for metadata fetch
      });

      if (!prepareRes.ok) {
        const errorData = await prepareRes.json().catch(() => ({}));
        throw new Error(extractErrorMessage(errorData) || `Failed to prepare job: ${prepareRes.status}`);
      }

      // PHASE 3: Run transfer job (async, don't wait for completion)
      const runRes = await authenticatedFetch(`/transfer/run/${job_id}`, {
        method: "POST",
        signal: AbortSignal.timeout(120000), // 120s timeout
      });

      if (!runRes.ok) {
        const errorData = await runRes.json().catch(() => ({}));
        throw new Error(extractErrorMessage(errorData) || `Failed to run job: ${runRes.status}`);
      }

      // Fetch initial job status
      const statusRes = await authenticatedFetch(`/transfer/status/${job_id}`);
      if (statusRes.ok) {
        const jobData: JobWithItems = await statusRes.json();
        
        // Add job to queue
        addJob(jobData);
        
        // Open transfer panel
        openPanel();
        
        // Close modal and trigger completion callback
        onTransferComplete();
        handleClose();
      }
    } catch (e: any) {
      console.error("[TRANSFER] Error:", e);
      setError(e.message);
    } finally {
      setIsTransferring(false);
    }
  };

  const handleClose = () => {
    onClose();
    // Reset state
    setSelectedTarget(null);
    setError(null);
    setIsTransferring(false);
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
            title={isTransferring ? "Ocultar (la transferencia continuará)" : "Cerrar"}
          >
            ✕
          </button>
        </div>

        {/* File count */}
        <div className="mb-4 text-sm text-slate-400">
          {selectedFileIds.length} archivo{selectedFileIds.length > 1 ? "s" : ""} seleccionado{selectedFileIds.length > 1 ? "s" : ""}
        </div>

        {/* Target account selector */}
        {!isTransferring && (
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

        {/* Transferring state */}
        {isTransferring && (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-slate-600 border-t-emerald-500 mb-4"></div>
            <p className="text-slate-300 font-semibold">Iniciando transferencia...</p>
            <p className="text-sm text-slate-400 mt-2">Creando trabajo de copia</p>
          </div>
        )}
      </div>
    </div>
  );
}
