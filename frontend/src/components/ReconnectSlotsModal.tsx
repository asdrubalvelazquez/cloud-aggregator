"use client";

import { useEffect, useState } from "react";
import { CloudSlot, fetchUserSlots } from "@/lib/api";
import { supabase } from "@/lib/supabaseClient";

type ReconnectSlotsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onReconnect?: (slot: CloudSlot) => void;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

export default function ReconnectSlotsModal({
  isOpen,
  onClose,
  onReconnect,
}: ReconnectSlotsModalProps) {
  const [slots, setSlots] = useState<CloudSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadSlots();
    }
  }, [isOpen]);

  const loadSlots = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchUserSlots();
      setSlots(data.slots);
    } catch (err: any) {
      setError(err.message || "Error al cargar slots");
    } finally {
      setLoading(false);
    }
  };

  const handleReconnect = async (slot: CloudSlot) => {
    // Verificar que hay sesión activa (el token JWT se enviará automáticamente)
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) {
      setError("No hay sesión activa");
      return;
    }
    
    try {
      // CRITICAL FIX: window.location.href NO envía Authorization headers → 401
      // SOLUCIÓN: Fetch autenticado a /auth/google/login-url → recibe URL → redirect manual
      // SEGURIDAD: user_id derivado de JWT en backend, NO en querystring
      // mode=reauth → backend usa prompt=select_account (mejor UX)
      const { fetchGoogleLoginUrl } = await import("@/lib/api");
      const { url } = await fetchGoogleLoginUrl({ mode: "reauth" });
      window.location.href = url;
      
      // Callback opcional para lógica adicional
      if (onReconnect) {
        onReconnect(slot);
      }
    } catch (err) {
      setError(`Error al obtener URL de reconexión: ${err}`);
      console.error("handleReconnect error:", err);
    }
  };

  if (!isOpen) return null;

  const activeSlots = slots.filter((s) => s.is_active);
  const inactiveSlots = slots.filter((s) => !s.is_active);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden border border-slate-700">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-700">
          <h2 className="text-xl font-bold text-white">Mis Cuentas Cloud</h2>
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
              <p className="mt-3 text-slate-400">Cargando tus cuentas...</p>
            </div>
          )}

          {error && (
            <div className="bg-red-500/20 border border-red-500 rounded-lg p-4 text-red-100">
              <p className="font-semibold">Error</p>
              <p className="text-sm mt-1">{error}</p>
            </div>
          )}

          {!loading && !error && (
            <div className="space-y-6">
              {/* Active Slots */}
              <div>
                <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-3">
                  Cuentas Activas ({activeSlots.length})
                </h3>
                {activeSlots.length === 0 ? (
                  <p className="text-sm text-slate-500 italic py-4">
                    No tienes cuentas activas conectadas
                  </p>
                ) : (
                  <div className="space-y-3">
                    {activeSlots.map((slot) => (
                      <div
                        key={slot.id}
                        className="bg-slate-900/50 rounded-lg p-4 border border-emerald-500/30"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-lg">☁️</span>
                              <span className="font-medium text-white">
                                {slot.provider_email}
                              </span>
                              <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-xs font-semibold rounded">
                                ACTIVA
                              </span>
                            </div>
                            <p className="text-xs text-slate-400">
                              Slot #{slot.slot_number} • Conectada:{" "}
                              {new Date(slot.connected_at).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Inactive Slots (Historical) */}
              <div>
                <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-3">
                  Cuentas Históricas Desconectadas ({inactiveSlots.length})
                </h3>
                {inactiveSlots.length === 0 ? (
                  <p className="text-sm text-slate-500 italic py-4">
                    No tienes cuentas históricas desconectadas
                  </p>
                ) : (
                  <div className="space-y-3">
                    {inactiveSlots.map((slot) => (
                      <div
                        key={slot.id}
                        className="bg-slate-900/30 rounded-lg p-4 border border-slate-700"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-lg opacity-50">☁️</span>
                              <span className="font-medium text-slate-300">
                                {slot.provider_email}
                              </span>
                              <span className="px-2 py-0.5 bg-slate-700 text-slate-400 text-xs font-semibold rounded">
                                DESCONECTADA
                              </span>
                            </div>
                            <p className="text-xs text-slate-500">
                              Slot #{slot.slot_number} •{" "}
                              {slot.disconnected_at
                                ? `Desconectada: ${new Date(
                                    slot.disconnected_at
                                  ).toLocaleDateString()}`
                                : "Fecha desconocida"}
                            </p>
                          </div>
                          <button
                            onClick={() => handleReconnect(slot)}
                            className="ml-4 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold rounded-lg transition"
                          >
                            Reconectar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Info Box */}
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mt-6">
                <p className="text-sm text-blue-200">
                  💡 <strong>Plan FREE:</strong> Tienes 2 slots históricos
                  permanentes. Puedes desconectar y reconectar estas cuentas en
                  cualquier momento, pero no puedes agregar cuentas nuevas
                  distintas sin actualizar tu plan.
                </p>
              </div>
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
