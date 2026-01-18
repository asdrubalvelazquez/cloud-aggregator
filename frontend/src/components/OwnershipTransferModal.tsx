"use client";

import { useState } from "react";
import { authenticatedFetch } from "@/lib/api";

type OwnershipTransferModalProps = {
  isOpen: boolean;
  transferToken: string;
  onClose: () => void;
  onSuccess: () => void;
};

export default function OwnershipTransferModal({
  isOpen,
  transferToken,
  onClose,
  onSuccess,
}: OwnershipTransferModalProps) {
  const [isTransferring, setIsTransferring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleTransfer = async () => {
    setIsTransferring(true);
    setError(null);

    try {
      const res = await authenticatedFetch("/cloud/transfer-ownership", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ transfer_token: transferToken }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const errorMessage = errorData.detail || `Error ${res.status}`;
        throw new Error(errorMessage);
      }

      const result = await res.json();

      if (result.success) {
        onSuccess();
      } else {
        throw new Error("Transfer failed");
      }
    } catch (err: any) {
      console.error("[OWNERSHIP_TRANSFER] Error:", err);
      setError(err.message || "Error al transferir la cuenta");
      setIsTransferring(false);
    }
  };

  const handleCancel = () => {
    if (!isTransferring) {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl max-w-md w-full p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-white">
              Transferir Cuenta
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              OneDrive
            </p>
          </div>
          {!isTransferring && (
            <button
              onClick={handleCancel}
              className="text-gray-400 hover:text-white transition text-2xl leading-none"
              aria-label="Cerrar"
            >
              ×
            </button>
          )}
        </div>

        {/* Body */}
        <div className="mb-6">
          <p className="text-gray-300 leading-relaxed">
            Esta cuenta de OneDrive ya está conectada a otro usuario.
          </p>
          <p className="text-gray-300 leading-relaxed mt-2">
            ¿Deseas transferirla a tu cuenta?
          </p>
          
          {error && (
            <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3">
          <button
            onClick={handleCancel}
            disabled={isTransferring}
            className="flex-1 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 disabled:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition"
          >
            Cancelar
          </button>
          <button
            onClick={handleTransfer}
            disabled={isTransferring}
            className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition flex items-center justify-center gap-2"
          >
            {isTransferring ? (
              <>
                <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                Transfiriendo...
              </>
            ) : (
              "Transferir"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
