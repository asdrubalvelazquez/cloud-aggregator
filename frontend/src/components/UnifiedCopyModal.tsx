"use client";

import { useState } from "react";
import { authenticatedFetch } from "@/lib/api";
import { useTransferQueue } from "@/hooks/useTransferQueue";
import { JobWithItems } from "@/types/transfer-queue";

type TargetAccount = {
  provider: "google_drive" | "onedrive";
  account_id: string;
  email: string;
};

type UnifiedCopyModalProps = {
  isOpen: boolean;
  onClose: () => void;
  sourceAccountId: number;
  selectedFileIds: string[];
  selectedFileLabel: string;
  copyOptions: {
    source_account: { id: number; email: string };
    target_accounts: TargetAccount[];
  } | null;
  onSuccess: () => void;
  onViewInDestination?: (targetAccountId: string, folderId?: string) => void;
};

type DestinationType = "google_drive" | "onedrive";

export default function UnifiedCopyModal({
  isOpen,
  onClose,
  sourceAccountId,
  selectedFileIds,
  selectedFileLabel,
  copyOptions,
  onSuccess,
  onViewInDestination,
}: UnifiedCopyModalProps) {
  const { addJob, openPanel } = useTransferQueue();
  
  const [destinationType, setDestinationType] = useState<DestinationType>("google_drive");
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [copyProgress, setCopyProgress] = useState(0);
  const [copyStatus, setCopyStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // Helper: Extract error message from backend response
  const extractErrorMessage = (errorData: any): string => {
    if (typeof errorData === "string") return errorData;
    if (errorData?.message) return errorData.message;
    if (errorData?.detail) return errorData.detail;
    if (errorData?.error) return errorData.error;
    return "Error desconocido";
  };

  // Reset modal state
  const resetModal = () => {
    setDestinationType("google_drive");
    setSelectedTarget(null);
    setCopying(false);
    setCopyProgress(0);
    setCopyStatus("");
    setError(null);
  };

  const handleClose = () => {
    if (copying) {
      // Don't close during active copy
      return;
    }
    resetModal();
    onClose();
  };

  // Filter accounts by destination type
  const availableAccounts = copyOptions?.target_accounts.filter(
    acc => acc.provider === destinationType
  ) || [];

  // Handle Google Drive copy (existing flow)
  const handleGoogleDriveCopy = async () => {
    if (!selectedTarget || copying) return;

    const targetId = parseInt(selectedTarget);
    setCopying(true);
    setCopyProgress(0);
    setCopyStatus("Iniciando copia...");
    setError(null);

    try {
      // Copy each file sequentially
      for (let i = 0; i < selectedFileIds.length; i++) {
        const fileId = selectedFileIds[i];
        setCopyStatus(`Copiando archivo ${i + 1} de ${selectedFileIds.length}...`);

        const res = await authenticatedFetch("/drive/copy-file", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source_account_id: sourceAccountId,
            target_account_id: targetId,
            file_id: fileId,
          }),
          signal: AbortSignal.timeout(180000),
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          const correlationId = errorData.correlation_id || "N/A";
          
          // Handle specific errors
          if (res.status === 409 && errorData.detail?.error === "target_account_needs_reconnect") {
            throw new Error("⚠️ La cuenta destino necesita reconexión.");
          }
          if (res.status === 409 && errorData.detail?.error === "source_account_needs_reconnect") {
            throw new Error("⚠️ La cuenta origen necesita reconexión.");
          }
          if (res.status === 413 && errorData.detail?.code === "FILE_TOO_LARGE") {
            const fileSizeGB = errorData.detail.file?.size_gb || 0;
            const limitGB = errorData.detail.limits?.max_file_gb || 0;
            throw new Error(`Archivo demasiado grande (${fileSizeGB}GB, límite: ${limitGB}GB).`);
          }
          
          throw new Error(`Error ${res.status}: ${extractErrorMessage(errorData.detail || errorData)} (ID: ${correlationId})`);
        }

        const result = await res.json();
        
        // Update progress
        const progress = ((i + 1) / selectedFileIds.length) * 100;
        setCopyProgress(progress);
        
        if (result.duplicate) {
          setCopyStatus(`Archivo ${i + 1} ya existe (no copiado)`);
        } else {
          setCopyStatus(`✅ Archivo ${i + 1} de ${selectedFileIds.length} copiado`);
        }
      }

      // Success
      setCopyStatus(`✅ ${selectedFileIds.length} archivo(s) copiado(s) exitosamente`);
      setCopyProgress(100);
      
      setTimeout(() => {
        onSuccess();
        handleClose();
      }, 1500);
      
    } catch (e: any) {
      console.error("[UNIFIED_COPY_GOOGLE] Error:", e);
      setError(e.message);
      setCopyStatus("❌ Error en la copia");
    } finally {
      setCopying(false);
    }
  };

  // Handle OneDrive copy (TransferModal flow)
  const handleOneDriveCopy = async () => {
    if (!selectedTarget || copying) return;

    setCopying(true);
    setCopyStatus("Creando trabajo de transferencia...");
    setError(null);

    try {
      // Derive source provider from API endpoint context:
      // Backend endpoint /drive/{account_id}/copy-options queries cloud_accounts table (Google Drive only)
      // Therefore: source is always google_drive when this modal is invoked with valid copyOptions
      // Target: destinationType is real user selection from UI dropdown
      const requestedSourceProvider = "google_drive"; // Derived from /drive/ API endpoint (backend constraint)
      const requestedTargetProvider = destinationType; // Real: user-selected "google_drive" or "onedrive"
      
      // PHASE 1: Create empty job
      const createRes = await authenticatedFetch("/transfer/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_provider: requestedSourceProvider,
          source_account_id: sourceAccountId,
          target_provider: requestedTargetProvider,
          target_account_id: selectedTarget, // UUID string
          file_ids: selectedFileIds,
          target_folder_id: null,
        }),
      });

      if (!createRes.ok) {
        const errorData = await createRes.json().catch(() => ({}));
        throw new Error(extractErrorMessage(errorData) || `Error ${createRes.status}`);
      }

      const { job_id } = await createRes.json();
      setCopyStatus("Preparando transferencia...");

      // PHASE 2: Prepare job
      const prepareRes = await authenticatedFetch(`/transfer/prepare/${job_id}`, {
        method: "POST",
        signal: AbortSignal.timeout(120000),
      });

      if (!prepareRes.ok) {
        const errorData = await prepareRes.json().catch(() => ({}));
        throw new Error(extractErrorMessage(errorData) || `Error ${prepareRes.status}`);
      }

      setCopyStatus("Iniciando transferencia...");

      // PHASE 3: Run transfer job
      const runRes = await authenticatedFetch(`/transfer/run/${job_id}`, {
        method: "POST",
        signal: AbortSignal.timeout(120000),
      });

      if (!runRes.ok) {
        const errorData = await runRes.json().catch(() => ({}));
        throw new Error(extractErrorMessage(errorData) || `Error ${runRes.status}`);
      }

      // Fetch initial job status
      const statusRes = await authenticatedFetch(`/transfer/status/${job_id}`);
      if (statusRes.ok) {
        const jobData: JobWithItems = await statusRes.json();
        
        // CRITICAL: Merge backend response with requested providers (backend may not return them)
        const jobWithProviders: JobWithItems = {
          ...jobData,
          source_provider: jobData.source_provider || requestedSourceProvider,
          target_provider: jobData.target_provider || requestedTargetProvider,
        };
        
        // Add job to queue
        addJob(jobWithProviders);
        
        // Open transfer panel
        openPanel();
        
        // Success - close modal
        setCopyStatus("✅ Transferencia iniciada");
        setTimeout(() => {
          onSuccess();
          handleClose();
        }, 800);
      }
      
    } catch (e: any) {
      console.error("[UNIFIED_COPY_ONEDRIVE] Error:", e);
      setError(e.message);
      setCopyStatus("❌ Error en la transferencia");
    } finally {
      setCopying(false);
    }
  };

  const handleCopy = () => {
    if (destinationType === "google_drive") {
      handleGoogleDriveCopy();
    } else {
      handleOneDriveCopy();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-lg shadow-xl w-full max-w-md p-6 border border-slate-700">
        {/* Header */}
        <h2 className="text-xl font-bold text-white mb-4">
          Copiar: {selectedFileLabel}
        </h2>

        {/* Destination Type Selector */}
        <div className="mb-4">
          <label className="text-sm font-semibold text-slate-300 mb-2 block">
            Destino:
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setDestinationType("google_drive");
                setSelectedTarget(null);
              }}
              disabled={copying}
              className={`flex-1 px-4 py-2 rounded-lg text-sm font-semibold transition ${
                destinationType === "google_drive"
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-700 text-slate-300 hover:bg-slate-600"
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              📁 Google Drive
            </button>
            <button
              type="button"
              onClick={() => {
                setDestinationType("onedrive");
                setSelectedTarget(null);
              }}
              disabled={copying}
              className={`flex-1 px-4 py-2 rounded-lg text-sm font-semibold transition ${
                destinationType === "onedrive"
                  ? "bg-blue-600 text-white"
                  : "bg-slate-700 text-slate-300 hover:bg-slate-600"
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              🟦 OneDrive
            </button>
          </div>
        </div>

        {/* Account Dropdown */}
        <div className="mb-6">
          <label className="text-sm font-semibold text-slate-300 mb-2 block">
            Cuenta destino:
          </label>
          <select
            value={selectedTarget || ""}
            onChange={(e) => setSelectedTarget(e.target.value || null)}
            disabled={copying || availableAccounts.length === 0}
            className="w-full bg-slate-700 text-slate-100 border border-slate-600 rounded-lg px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="">-- Selecciona una cuenta --</option>
            {availableAccounts.length > 0 ? (
              availableAccounts.map((account) => {
                const value = account.account_id;
                const providerIcon = account.provider === "google_drive" ? "📁" : "🟦";
                return (
                  <option key={value} value={value}>
                    {providerIcon} {account.email}
                  </option>
                );
              })
            ) : (
              <option disabled>
                No hay cuentas {destinationType === "google_drive" ? "Google Drive" : "OneDrive"} disponibles
              </option>
            )}
          </select>
        </div>

        {/* Progress Bar */}
        {copying && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-slate-300">{copyStatus}</p>
              <span className="text-sm font-semibold text-emerald-400">
                {Math.round(copyProgress)}%
              </span>
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
          <div
            className={`mb-6 p-3 rounded-lg text-sm font-medium ${
              copyStatus.includes("✅")
                ? "bg-emerald-500/20 border border-emerald-500 text-emerald-100"
                : copyStatus.includes("❌")
                ? "bg-red-500/20 border border-red-500 text-red-100"
                : "bg-blue-500/20 border border-blue-500 text-blue-100"
            }`}
          >
            {copyStatus}
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-3 rounded-lg bg-red-500/20 border border-red-500 text-red-100 text-sm">
            {error}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={handleClose}
            disabled={copying}
            className="px-4 py-2 bg-slate-600 hover:bg-slate-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold transition"
          >
            {copying ? "Copiando..." : "Cancelar"}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!selectedTarget || copying || availableAccounts.length === 0}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold transition"
          >
            {copying ? "Procesando..." : "Copiar"}
          </button>
        </div>

        {/* Warning for no accounts */}
        {availableAccounts.length === 0 && !copying && (
          <div className="mt-4 p-3 rounded-lg bg-amber-500/20 border border-amber-500 text-amber-100 text-xs">
            ⚠️ No hay cuentas {destinationType === "google_drive" ? "Google Drive" : "OneDrive"} disponibles.
            Conecta más cuentas para poder copiar.
          </div>
        )}
      </div>
    </div>
  );
}
