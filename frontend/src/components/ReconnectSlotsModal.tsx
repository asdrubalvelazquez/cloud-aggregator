"use client";

import { useEffect, useState } from "react";
import { CloudAccountStatus, fetchCloudStatus, fetchGoogleLoginUrl, authenticatedFetch } from "@/lib/api";
import { supabase } from "@/lib/supabaseClient";

type ReconnectSlotsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onReconnect?: (account: CloudAccountStatus) => void;
  onDisconnect?: (account: CloudAccountStatus) => void;
};

// Reason labels for UI display
const REASON_LABELS: Record<string, string> = {
  "missing_refresh_token": "Falta token de renovación",
  "missing_access_token": "Falta token de acceso",
  "cloud_account_missing": "Cuenta no encontrada en BD",
  "account_is_active_false": "Cuenta marcada como inactiva",
  "token_expired": "Tokens expirados (refresh falló)",
  "slot_inactive": "Desconectada manualmente"
};

export default function ReconnectSlotsModal({
  isOpen,
  onClose,
  onReconnect,
  onDisconnect,
}: ReconnectSlotsModalProps) {
  const [accounts, setAccounts] = useState<CloudAccountStatus[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadCloudStatus();
    }
  }, [isOpen]);

  const loadCloudStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchCloudStatus();
      setAccounts(data.accounts);
      setSummary(data.summary);
    } catch (err: any) {
      setError(err.message || "Error al cargar estado de cuentas");
    } finally {
      setLoading(false);
    }
  };

  const handleReconnect = async (account: CloudAccountStatus) => {
    // Prevenir navegación si ya está reconectando
    if (reconnecting) {
      console.log("[RECONNECT] Already reconnecting, ignoring click");
      return;
    }
    
    // Verificar que hay sesión activa
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) {
      setError("No hay sesión activa");
      return;
    }
    
    try {
      setReconnecting(account.slot_log_id);
      setError(null);
      
      console.log("[RECONNECT] Fetching OAuth URL for:", account.provider_email, account.provider_account_id);
      // Fetch OAuth URL with reconnect mode
      const { url } = await fetchGoogleLoginUrl({ 
        mode: "reconnect",
        reconnect_account_id: account.provider_account_id
      });
      
      window.location.href = url;
      
      // Callback opcional
      if (onReconnect) {
        onReconnect(account);
      }
    } catch (err: any) {
      setError(`Error al obtener URL de reconexión: ${err.message || err}`);
      console.error("handleReconnect error:", err);
      setReconnecting(null);
    }
  };

  if (!isOpen) return null;

  const connected = accounts.filter((a) => a.connection_status === "connected");
  const needsReconnect = accounts.filter((a) => a.connection_status === "needs_reconnect");
  const disconnected = accounts.filter((a) => a.connection_status === "disconnected");

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden border border-slate-700">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-700">
          <div>
            <h2 className="text-xl font-bold text-white">Mis Cuentas Cloud</h2>
            {summary && (
              <p className="text-xs text-slate-400 mt-1">
                {summary.connected} conectadas • {summary.needs_reconnect} requieren reconexión • {summary.disconnected} desconectadas
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition text-2xl leading-none"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(80vh-140px)]">
          {loading && (
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
              <p className="mt-3 text-slate-400">Cargando estado de cuentas...</p>
            </div>
          )}

          {error && (
            <div className="bg-red-500/20 border border-red-500 rounded-lg p-4 text-red-100 mb-4">
              <p className="font-semibold">Error</p>
              <p className="text-sm mt-1">{error}</p>
            </div>
          )}

          {!loading && (
            <div className="space-y-6">
              {/* Section 1: Conectadas */}
              {connected.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-emerald-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                    <span>✅</span>
                    Cuentas Conectadas ({connected.length})
                  </h3>
                  <div className="space-y-3">
                    {connected.map((account) => (
                      <div
                        key={account.slot_log_id}
                        className="bg-slate-900/50 rounded-lg p-4 border border-emerald-500/30"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-lg">☁️</span>
                              <span className="font-medium text-white">
                                {account.provider_email}
                              </span>
                              <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-xs font-semibold rounded">
                                CONECTADA
                              </span>
                            </div>
                            <p className="text-xs text-slate-400">
                              Slot #{account.slot_number} • Tokens válidos
                            </p>
                          </div>
                          <button
                            onClick={async () => {
                              if (!account.cloud_account_id) return;
                              if (!confirm(`¿Desconectar ${account.provider_email}? Esta acción no se puede deshacer.`)) {
                                return;
                              }
                              
                              try {
                                const res = await authenticatedFetch("/auth/revoke-account", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ account_id: account.cloud_account_id }),
                                });

                                if (res.ok) {
                                  await loadCloudStatus();
                                  if (onDisconnect) {
                                    onDisconnect(account);
                                  }
                                } else {
                                  const errorData = await res.json();
                                  setError(errorData.detail || "Error al desconectar cuenta");
                                }
                              } catch (err: any) {
                                setError(err.message || "Error al desconectar cuenta");
                              }
                            }}
                            className="ml-4 px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-semibold rounded-lg transition"
                          >
                            Desconectar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Section 2: Requieren Reconexión */}
              {needsReconnect.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-amber-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                    <span>⚠️</span>
                    Requieren Reconexión ({needsReconnect.length})
                  </h3>
                  <p className="text-sm text-amber-300 mb-3">
                    Estas cuentas necesitan reautorización. Haz clic en "Reconectar" para restaurar el acceso.
                  </p>
                  <div className="space-y-3">
                    {needsReconnect.map((account) => (
                      <div
                        key={account.slot_log_id}
                        className="bg-amber-500/10 rounded-lg p-4 border border-amber-500/30"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-lg">☁️</span>
                              <span className="font-medium text-white">
                                {account.provider_email}
                              </span>
                              <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 text-xs font-semibold rounded">
                                NECESITA RECONEXIÓN
                              </span>
                            </div>
                            <p className="text-xs text-slate-400">
                              Slot #{account.slot_number}
                            </p>
                            {account.reason && (
                              <p className="text-xs text-amber-300 mt-1">
                                🔍 {REASON_LABELS[account.reason] || account.reason}
                              </p>
                            )}
                          </div>
                          <button
                            onClick={(e) => {
                              if (reconnecting === account.slot_log_id) {
                                e.preventDefault();
                                e.stopPropagation();
                                return;
                              }
                              handleReconnect(account);
                            }}
                            disabled={reconnecting === account.slot_log_id}
                            className="ml-4 px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition"
                          >
                            {reconnecting === account.slot_log_id ? "Redirigiendo..." : "Reconectar"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Section 3: Históricas Desconectadas */}
              {disconnected.length > 0 && (
                <div className="opacity-60">
                  <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                    <span>🔌</span>
                    Históricas Desconectadas ({disconnected.length})
                  </h3>
                  <div className="space-y-3">
                    {disconnected.map((account) => (
                      <div
                        key={account.slot_log_id}
                        className="bg-slate-900/30 rounded-lg p-4 border border-slate-700"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-lg opacity-50">☁️</span>
                              <span className="font-medium text-slate-300">
                                {account.provider_email}
                              </span>
                              <span className="px-2 py-0.5 bg-slate-700 text-slate-400 text-xs font-semibold rounded">
                                DESCONECTADA
                              </span>
                            </div>
                            <p className="text-xs text-slate-500">
                              Slot #{account.slot_number}
                            </p>
                          </div>
                          <button
                            onClick={(e) => {
                              if (reconnecting === account.slot_log_id) {
                                e.preventDefault();
                                e.stopPropagation();
                                return;
                              }
                              handleReconnect(account);
                            }}
                            disabled={reconnecting === account.slot_log_id}
                            className="ml-4 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition shadow-lg shadow-emerald-500/20"
                          >
                            {reconnecting === account.slot_log_id ? "Redirigiendo..." : "Reconectar"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Empty State */}
              {accounts.length === 0 && !loading && (
                <div className="text-center py-8">
                  <div className="text-5xl mb-4">☁️</div>
                  <p className="text-slate-300 mb-2">
                    No tienes cuentas cloud
                  </p>
                  <p className="text-sm text-slate-400">
                    Conecta tu primera cuenta de Google Drive
                  </p>
                </div>
              )}

              {/* Info Box */}
              {summary && summary.total_slots > 0 && (
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mt-6">
                  <p className="text-sm text-blue-200">
                    💡 <strong>Reconexión sin límites:</strong> Puedes reconectar tus cuentas en cualquier momento sin consumir slots nuevos, incluso con plan FREE lleno.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-6 border-t border-slate-700">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition font-medium"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
