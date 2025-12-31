"use client";

import { useCallback, useEffect, useState, Suspense } from "react";
import { supabase } from "@/lib/supabaseClient";
import { authenticatedFetch, fetchCloudStatus } from "@/lib/api";
import type { CloudStatusResponse } from "@/lib/api";
import { useRouter, useSearchParams } from "next/navigation";
import Toast from "@/components/Toast";
import ProgressBar from "@/components/ProgressBar";
import AccountStatusBadge from "@/components/AccountStatusBadge";
import { formatStorage, formatStorageFromGB } from "@/lib/formatStorage";
import ReconnectSlotsModal from "@/components/ReconnectSlotsModal";

type Account = {
  id: number;
  email: string;
  limit: number;
  usage: number;
  usage_percent: number;
  error?: string;
};

type StorageSummary = {
  accounts: Account[];
  total_limit: number;
  total_usage: number;
  total_usage_percent: number;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

type ToastMessage = {
  message: string;
  type: "success" | "error" | "warning";
} | null;

type QuotaInfo = {
  plan: string;
  used: number;
  limit: number;
  remaining: number;
  // DEPRECATED (ambiguous):
  clouds_allowed: number;
  clouds_connected: number;
  clouds_remaining: number;
  // NEW EXPLICIT FIELDS (preferred):
  historical_slots_used: number;      // Lifetime slots consumed
  historical_slots_total: number;     // Slots allowed by plan
  active_clouds_connected: number;    // Currently active accounts
} | null;

type BillingQuota = {
  plan: string;
  plan_type: string;
  copies: {
    used: number;
    limit: number | null;
    is_lifetime: boolean;
  };
  transfer: {
    used_bytes: number;
    limit_bytes: number | null;
    used_gb: number;
    limit_gb: number | null;
    is_lifetime: boolean;
  };
  max_file_bytes: number;
  max_file_gb: number;
} | null;

type DashboardRouteParams = {
  authStatus: string | null;
  authError: string | null;
  reconnectStatus: string | null;
  allowedParam: string | null;
  slotId: string | null;
};

function SearchParamsBridge({
  onChange,
}: {
  onChange: (key: string, params: DashboardRouteParams) => void;
}) {
  const searchParams = useSearchParams();
  const key = searchParams.toString();

  useEffect(() => {
    onChange(key, {
      authStatus: searchParams.get("auth"),
      authError: searchParams.get("error"),
      reconnectStatus: searchParams.get("reconnect"),
      allowedParam: searchParams.get("allowed"),
      slotId: searchParams.get("slot_id"),
    });
  }, [key, searchParams, onChange]);

  return null;
}

function DashboardContent({
  routeParams,
  routeParamsKey,
}: {
  routeParams: DashboardRouteParams;
  routeParamsKey: string | null;
}) {
  const [data, setData] = useState<StorageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [quota, setQuota] = useState<QuotaInfo>(null);
  const [billingQuota, setBillingQuota] = useState<BillingQuota>(null);
  const [cloudStatus, setCloudStatus] = useState<CloudStatusResponse | null>(null);
  const [showReconnectModal, setShowReconnectModal] = useState(false);
  const router = useRouter();

  const withTimeout = async <T,>(promise: Promise<T>, ms: number): Promise<T> => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("timeout")), ms);
        }),
      ]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  };

  const fetchSummary = async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      const res = await authenticatedFetch("/storage/summary", { signal });
      if (!res.ok) {
        throw new Error(`Error API: ${res.status}`);
      }
      const json = await res.json();
      setData(json);
      setError(null);
      setLastUpdated(Date.now());
    } catch (e: any) {
      if (e.name === "AbortError") {
        setError("La carga tardó demasiado. Intenta recargar la página.");
      } else {
        setError(e.message || "Error al cargar datos");
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchQuota = async (signal?: AbortSignal) => {
    try {
      const res = await authenticatedFetch("/me/plan", { signal });
      if (res.ok) {
        const quotaData = await res.json();
        setQuota(quotaData);
      }
    } catch (e: any) {
      // Silently fail - quota display is optional
      if (e.name !== "AbortError") {
        console.error("Failed to fetch quota:", e);
      }
    }
  };

  const fetchBillingQuota = async (signal?: AbortSignal) => {
    try {
      const res = await authenticatedFetch("/billing/quota", { signal });
      if (res.ok) {
        const billingData = await res.json();
        setBillingQuota(billingData);
      }
    } catch (e: any) {
      if (e.name !== "AbortError") {
        console.error("Failed to fetch billing quota:", e);
      }
    }
  };

  const fetchCloudStatusData = async (forceRefresh = false) => {
    try {
      const data = await fetchCloudStatus(forceRefresh);
      // TEMPORAL DEBUG: Verificar que needs_reconnect baja después de reconectar
      console.log("[DEBUG - fetchCloudStatus]", {
        connected: data.summary.connected,
        needs_reconnect: data.summary.needs_reconnect,
        disconnected: data.summary.disconnected,
        forceRefresh,
        accounts: data.accounts.map(a => ({
          email: a.provider_email,
          status: a.connection_status,
          reason: a.reason,
        }))
      });
      setCloudStatus(data);
    } catch (e) {
      console.error("Failed to fetch cloud status:", e);
    }
  };

  useEffect(() => {
    // AbortController con timeout de 10s para evitar fetch colgados
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, 10000);

    // Verificar sesión de usuario
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.email) {
          setUserEmail(session.user.email);
          setUserId(session.user.id);
        }
      } catch (error) {
        console.error("Error checking session:", error);
      }
    };
    checkSession();

    // Verificar si el usuario acaba de autenticarse (usando search params)
    const { authStatus, authError, reconnectStatus } = routeParams;
      
    if (authStatus === "success") {
      // CRITICAL: Refresh Supabase session after OAuth redirect
      // Ensures auth token is fresh before calling /me/* endpoints
      const refreshAndLoad = async () => {
        try {
          const { data, error } = await withTimeout(supabase.auth.refreshSession(), 10000);
          if (error) {
            console.error("[OAUTH] Failed to refresh session:", error);
            
            // FIX 3: Fallback seguro - signOut y redirect a login
            await supabase.auth.signOut();
            window.location.href = "/login?reason=session_expired&next=/app";
            return;
          }
          
          console.log("[OAUTH] Session refreshed successfully:", {
            user: data.session?.user?.email,
            expires_at: data.session?.expires_at,
          });
          
          setToast({
            message: "Cuenta de Google conectada exitosamente",
            type: "success",
          });
          
          // Clean URL after successful refresh
          window.history.replaceState({}, "", window.location.pathname);
          
          // Load dashboard data with fresh session
          fetchSummary(abortController.signal);
          fetchQuota(abortController.signal);
          fetchBillingQuota(abortController.signal);
          fetchCloudStatusData();
        } catch (err) {
          console.error("[OAUTH] Exception refreshing session:", err);
          setToast({
            message: "Error inesperado. Recarga la página.",
            type: "error",
          });
        }
      };
      
      // Execute refresh after 500ms delay (allow cookies to settle)
      setTimeout(refreshAndLoad, 500);
    } else if (reconnectStatus === "success") {
      const slotId = routeParams.slotId;
      
      // Clear URL immediately
      window.history.replaceState({}, "", window.location.pathname);
      
      // CRITICAL: Refresh session before validating reconnection
      const validateReconnect = async () => {
        try {
          // Refresh Supabase session first (OAuth redirect may have stale token)
          const { data: sessionData, error: sessionError } = await withTimeout(
            supabase.auth.refreshSession(),
            10000
          );
          if (sessionError) {
            console.error("[RECONNECT] Failed to refresh session:", sessionError);
            
            // FIX 3: Fallback seguro - signOut y redirect a login
            await supabase.auth.signOut();
            window.location.href = "/login?reason=session_expired&next=/app";
            return;
          }
          
          console.log("[RECONNECT] Session refreshed successfully");
          
          // Fetch fresh cloud status to verify actual connection state
          const data = await fetchCloudStatus(true);  // forceRefresh = true
          
          // If slot_id provided, validate that specific slot is now connected
          if (slotId) {
            // Normalize both IDs to string for comparison (slot_log_id could be number or string)
            const normalizedSlotId = String(slotId);
            const reconnectedSlot = data.accounts.find(
              (acc: any) => String(acc.slot_log_id) === normalizedSlotId && acc.connection_status === "connected"
            );
            
            if (reconnectedSlot) {
              setToast({
                message: `✅ Cuenta ${reconnectedSlot.provider_email} reconectada exitosamente`,
                type: "success",
              });
            } else {
              // Slot not found or not connected - show warning
              setToast({
                message: "⚠️ La reconexión no se completó correctamente. Intenta nuevamente.",
                type: "warning",
              });
            }
          } else {
            // No slot_id provided, use generic success message
            setToast({
              message: "✅ Cuenta reconectada exitosamente",
              type: "success",
            });
          }
          
          // Update all data
          setCloudStatus(data);
          fetchSummary(abortController.signal);
          fetchQuota(abortController.signal);
          fetchBillingQuota(abortController.signal);
        } catch (error) {
          console.error("Failed to validate reconnect:", error);
          const message =
            (error as any)?.message === "timeout"
              ? "⚠️ La validación tardó demasiado. Recarga la página."
              : "⚠️ Error al validar reconexión. Actualiza la página.";
          setToast({
            message,
            type: "warning",
          });
        }
      };
      
      // Execute validation after 500ms delay (allow cookies to settle)
      setTimeout(validateReconnect, 500);
    } else if (authError === "cloud_limit_reached") {
      setToast({
        message: `Has usado tus slots históricos. Puedes reconectar tus cuentas anteriores desde "Ver mis cuentas", pero no puedes agregar cuentas nuevas en plan FREE.`,
        type: "warning",
      });
      window.history.replaceState({}, "", window.location.pathname);
      fetchSummary(abortController.signal);
      fetchBillingQuota(abortController.signal);
      fetchCloudStatusData();
    } else if (authError) {
      setToast({
        message: `Error de autenticación: ${authError}`,
        type: "error",
      });
      window.history.replaceState({}, "", window.location.pathname);
      fetchSummary(abortController.signal);
      fetchQuota(abortController.signal);
      fetchBillingQuota(abortController.signal);
      fetchCloudStatusData();
    } else {
      fetchSummary(abortController.signal);
      fetchQuota(abortController.signal);
      fetchBillingQuota(abortController.signal);
      fetchCloudStatusData();
    }

    // Cleanup: clear timeout and abort requests on unmount
    return () => {
      clearTimeout(timeoutId);
      abortController.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeParamsKey]);

  const handleConnectGoogle = async () => {
    if (!userId) {
      setError("No hay sesión de usuario activa. Recarga la página.");
      return;
    }
    
    try {
      // CRITICAL FIX: window.location.href NO envía Authorization headers → 401
      // SOLUCIÓN: Fetch autenticado a /auth/google/login-url → recibe URL → redirect manual
      // SEGURIDAD: user_id derivado de JWT en backend, NO en querystring
      const { fetchGoogleLoginUrl } = await import("@/lib/api");
      const { url } = await fetchGoogleLoginUrl({ mode: "connect" });
      window.location.href = url;
    } catch (err) {
      setError(`Error al obtener URL de Google: ${err}`);
      console.error("handleConnectGoogle error:", err);
    }
  };

  const handleDisconnectAccount = async (accountId: number, accountEmail: string) => {
    if (!confirm(`¿Desconectar la cuenta ${accountEmail}? Esta acción no se puede deshacer.`)) {
      return;
    }

    setLoading(true);
    try {
      const res = await authenticatedFetch("/auth/revoke-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: accountId }),
      });

      if (res.ok) {
        setToast({
          message: `Cuenta ${accountEmail} desconectada exitosamente`,
          type: "success",
        });
        // Recargar datos
        fetchSummary();
        fetchQuota();
        fetchBillingQuota();
      } else {
        const errorData = await res.json();
        throw new Error(errorData.detail || "Error al desconectar cuenta");
      }
    } catch (err: any) {
      setToast({
        message: err.message || "Error al desconectar cuenta",
        type: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    // Ensure no lingering loading/error UI survives after sign-out
    setLoading(false);
    setError(null);
    setToast(null);

    try {
      await supabase.auth.signOut();
    } finally {
      // Use replace so back button doesn't land on /app with stale state
      router.replace("/");
    }
  };

  const getRelativeTime = (timestamp: number): string => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return "hace un momento";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `hace ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `hace ${hours}h`;
    return `hace ${Math.floor(hours / 24)}d`;
  };

  // Filtrar y ordenar cuentas
  const filteredAndSortedAccounts = data?.accounts
    .filter((acc) => acc.email.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      const diff = a.usage_percent - b.usage_percent;
      return sortOrder === "desc" ? -diff : diff;
    }) || [];

  return (
    <main className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center p-6">
      {/* Toast Notifications */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      <div className="w-full max-w-6xl space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Cloud Aggregator 🌥️</h1>
            {userEmail && (
              <p className="text-sm text-slate-400 mt-1">{userEmail}</p>
            )}
            {quota && (
              <>
                <p className="text-xs text-slate-500 mt-1">
                  Plan: {quota.plan.toUpperCase()} • Slots históricos: {quota.historical_slots_used} / {quota.historical_slots_total}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Cuentas conectadas: {quota.active_clouds_connected}
                </p>
                {quota.historical_slots_used >= quota.historical_slots_total && (
                  <p className="text-xs text-slate-400 italic mt-0.5">
                    Puedes reconectar tus cuentas anteriores en cualquier momento
                  </p>
                )}
                <p className={`text-xs mt-1 ${quota.remaining <= 3 ? "text-amber-400 font-semibold" : "text-slate-500"}`}>
                  Copias este mes: {quota.used} / {quota.limit}
                  {quota.remaining <= 3 && " ⚠️"}
                </p>
              </>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setShowReconnectModal(true)}
              className="rounded-lg transition px-4 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700"
            >
              📊 Ver mis cuentas
            </button>
            {(() => {
              // FIX: Explicit boolean to avoid TS error (boolean | null not assignable)
              const limitReached = quota ? quota.historical_slots_used >= quota.historical_slots_total : false;
              return (
                <>
                  <button
                    onClick={handleConnectGoogle}
                    disabled={limitReached}
                    className={
                      limitReached
                        ? "rounded-lg transition px-4 py-2 text-sm font-semibold bg-slate-600 text-slate-400 cursor-not-allowed"
                        : "rounded-lg transition px-4 py-2 text-sm font-semibold bg-emerald-500 hover:bg-emerald-600"
                    }
                    title={
                      limitReached
                        ? "Has usado todos tus slots históricos. Puedes reconectar tus cuentas anteriores desde 'Ver mis cuentas'"
                        : "Conectar una nueva cuenta de Google Drive"
                    }
                  >
                    Conectar nueva cuenta
                  </button>
                  
                  {/* CTA upgrade cuando límite alcanzado (solo FREE y PLUS) */}
                  {limitReached && billingQuota && billingQuota.plan !== "pro" && (
                    <a
                      href="/pricing"
                      className="rounded-lg transition px-4 py-2 text-sm font-semibold bg-purple-600 hover:bg-purple-700 text-white flex items-center gap-2"
                    >
                      <span>🚀</span>
                      <span>
                        {billingQuota.plan === "free" ? "Actualizar a PLUS o PRO" : "Actualizar a PRO"}
                      </span>
                    </a>
                  )}
                </>
              );
            })()}
            <button
              onClick={handleLogout}
              className="rounded-lg bg-slate-700 hover:bg-slate-600 transition px-4 py-2 text-sm font-semibold"
            >
              Salir
            </button>
          </div>
        </header>

        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div>
            <p className="mt-4 text-slate-300">Cargando resumen de almacenamiento…</p>
          </div>
        )}

        {error && !loading && (
          <div className="bg-red-500/20 border border-red-500 rounded-lg p-4 text-red-100">
            <p className="font-semibold">Error al cargar datos</p>
            <p className="text-sm mt-1">{error}</p>
            <button
              onClick={() => {
                setError(null);
                fetchSummary();
                fetchQuota();
                fetchBillingQuota();
                fetchCloudStatusData();
              }}
              className="mt-3 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold transition"
            >
              Reintentar
            </button>
          </div>
        )}

        {data && (
          <>
            {/* Plan & Límites de Billing */}
            {billingQuota && (
              <section className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-6 shadow-lg border border-slate-700">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <h2 className="text-xl font-bold text-white">Plan & Límites</h2>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${
                        billingQuota.plan === "free"
                          ? "bg-slate-600 text-slate-200"
                          : billingQuota.plan === "plus"
                          ? "bg-blue-600 text-white"
                          : "bg-purple-600 text-white"
                      }`}
                    >
                      {billingQuota.plan}
                    </span>
                  </div>
                  {(billingQuota.plan === "free" || billingQuota.plan === "plus") && (
                    <a
                      href="/pricing"
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold transition"
                    >
                      {billingQuota.plan === "free" ? "⬆️ Actualizar plan" : "🚀 Actualizar a PRO"}
                    </a>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Copias */}
                  <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-semibold text-slate-300">
                        📋 Copias {billingQuota.copies.is_lifetime ? "(Lifetime)" : "(Mes)"}
                      </h3>
                      {billingQuota.copies.limit !== null && (
                        <span className="text-xs text-slate-400">
                          {billingQuota.copies.used} / {billingQuota.copies.limit}
                        </span>
                      )}
                    </div>
                    {billingQuota.copies.limit !== null ? (
                      <>
                        <ProgressBar
                          current={billingQuota.copies.used}
                          total={billingQuota.copies.limit}
                          height="sm"
                        />
                        <p className="text-xs text-slate-400 mt-2">
                          {Math.max(0, billingQuota.copies.limit - billingQuota.copies.used)} restantes
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-emerald-400 font-semibold">Ilimitadas ✨</p>
                    )}
                  </div>

                  {/* Transferencia */}
                  <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-semibold text-slate-300">
                        📡 Transferencia {billingQuota.transfer.is_lifetime ? "(Lifetime)" : "(Mes)"}
                      </h3>
                      {billingQuota.transfer.limit_gb !== null && (
                        <span className="text-xs text-slate-400">
                          {billingQuota.transfer.used_gb.toFixed(2)} / {billingQuota.transfer.limit_gb} GB
                        </span>
                      )}
                    </div>
                    {billingQuota.transfer.limit_bytes !== null && billingQuota.transfer.limit_bytes > 0 ? (
                      <>
                        <ProgressBar
                          current={billingQuota.transfer.used_bytes}
                          total={billingQuota.transfer.limit_bytes}
                          height="sm"
                        />
                        <p className="text-xs text-slate-400 mt-2">
                          {Math.max(0, 
                            (billingQuota.transfer.limit_bytes - billingQuota.transfer.used_bytes) /
                            (1024 ** 3)
                          ).toFixed(2)}{" "}
                          GB restantes
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-emerald-400 font-semibold">Ilimitada ✨</p>
                    )}
                  </div>

                  {/* Máximo por archivo */}
                  <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
                    <h3 className="text-sm font-semibold text-slate-300 mb-2">📄 Máx por archivo</h3>
                    <p className="text-2xl font-bold text-white">
                      {billingQuota.max_file_gb.toFixed(1)} GB
                    </p>
                    {billingQuota.plan !== "pro" ? (
                      <a
                        href="/pricing"
                        className="text-xs text-blue-400 hover:text-blue-300 mt-2 inline-block underline cursor-pointer transition"
                      >
                        {billingQuota.plan === "free" && "Actualiza a PLUS para 10 GB →"}
                        {billingQuota.plan === "plus" && "Actualiza a PRO para 50 GB →"}
                      </a>
                    ) : (
                      <p className="text-xs text-slate-400 mt-2">Límite máximo 🎉</p>
                    )}
                  </div>
                </div>
              </section>
            )}

            {/* Tarjetas de resumen con barra de progreso global */}
            <section className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-slate-800 rounded-xl p-5 shadow-lg border border-slate-700">
                  <h2 className="text-xs text-slate-400 uppercase tracking-wide font-semibold mb-1">
                    Total Espacio
                  </h2>
                  <p className="text-3xl font-bold text-white">
                    {formatStorageFromGB(data.total_limit / (1024 ** 3))}
                  </p>
                </div>
                <div className="bg-slate-800 rounded-xl p-5 shadow-lg border border-slate-700">
                  <h2 className="text-xs text-slate-400 uppercase tracking-wide font-semibold mb-1">
                    Usado
                  </h2>
                  <p className="text-3xl font-bold text-emerald-400">
                    {formatStorageFromGB(data.total_usage / (1024 ** 3))}
                  </p>
                </div>
                <div className="bg-slate-800 rounded-xl p-5 shadow-lg border border-slate-700">
                  <h2 className="text-xs text-slate-400 uppercase tracking-wide font-semibold mb-1">
                    Libre
                  </h2>
                  <p className="text-3xl font-bold text-blue-400">
                    {formatStorageFromGB((data.total_limit - data.total_usage) / (1024 ** 3))}
                  </p>
                </div>
                <div className="bg-slate-800 rounded-xl p-5 shadow-lg border border-slate-700">
                  <h2 className="text-xs text-slate-400 uppercase tracking-wide font-semibold mb-1">
                    % Utilizado
                  </h2>
                  <p className="text-3xl font-bold text-white">
                    {data.total_usage_percent.toFixed(2)}%
                  </p>
                </div>
              </div>

              {/* Barra de progreso global */}
              <div className="bg-slate-800 rounded-xl p-5 shadow-lg border border-slate-700">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-slate-300">Storage Overview</h3>
                  {lastUpdated && (
                    <span className="text-xs text-slate-500">
                      Última actualización: {getRelativeTime(lastUpdated)}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mb-1">
                  <span className="text-slate-500">Separate accounts. Consolidated view for management.</span>
                </p>
                <p className="text-xs text-slate-500 mb-1 italic">
                  Storage limits are enforced by Google Drive. Transfers only occur when you confirm an action.
                </p>
                <p className="text-xs text-slate-400 mb-3">
                  {formatStorageFromGB(data.total_usage / (1024 ** 3))} usados de{" "}
                  {formatStorageFromGB(data.total_limit / (1024 ** 3))} ({formatStorageFromGB((data.total_limit - data.total_usage) / (1024 ** 3))} libre)
                </p>
                <ProgressBar
                  current={data.total_usage}
                  total={data.total_limit}
                  height="lg"
                />
              </div>
            </section>

            {/* Tabla de cuentas mejorada */}
            <section className="bg-slate-800 rounded-xl p-6 shadow-lg border border-slate-700">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-white">
                  Cuentas conectadas ({cloudStatus?.summary.connected || 0})
                </h2>
                <button
                  onClick={() => {
                    fetchSummary();
                    fetchCloudStatusData();
                  }}
                  className="text-sm border border-slate-600 rounded-lg px-3 py-1.5 hover:bg-slate-700 transition font-medium"
                >
                  🔄 Refrescar
                </button>
              </div>

              {/* Alert para cuentas que necesitan reconexión */}
              {cloudStatus && cloudStatus.summary.needs_reconnect > 0 && (
                <div className="bg-amber-500/20 border border-amber-500 rounded-lg p-3 text-sm mb-4">
                  <div className="flex items-start gap-2">
                    <span className="text-amber-400 text-lg">⚠️</span>
                    <div className="flex-1">
                      <p className="text-amber-200 font-semibold">
                        {cloudStatus.summary.needs_reconnect} cuenta(s) necesitan reconexión
                      </p>
                      <p className="text-amber-300 text-xs mt-1">
                        Estas cuentas requieren reautorización. Haz clic en "Ver mis cuentas" para reconectarlas.
                      </p>
                    </div>
                    <button
                      onClick={() => setShowReconnectModal(true)}
                      className="px-3 py-1 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded transition"
                    >
                      Ver detalles
                    </button>
                  </div>
                </div>
              )}

              {/* Búsqueda y Sorting */}
              <div className="flex gap-3 mb-4">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    placeholder="Buscar por email..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full px-4 py-2 pl-10 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
                  />
                  <svg className="w-5 h-5 text-slate-400 absolute left-3 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <button
                  onClick={() => setSortOrder(sortOrder === "desc" ? "asc" : "desc")}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg hover:bg-slate-600 transition font-medium text-sm"
                >
                  % Usado
                  <svg className={`w-4 h-4 transition-transform ${sortOrder === "asc" ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>

              {data.accounts.length === 0 ? (
                <div className="text-center py-12 bg-slate-900/50 rounded-lg border-2 border-dashed border-slate-700">
                  <div className="text-5xl mb-4">☁️</div>
                  <p className="text-slate-300 mb-2">
                    Aún no hay cuentas conectadas
                  </p>
                  <p className="text-sm text-slate-400">
                    Haz clic en <strong>"Conectar nueva cuenta de Google Drive"</strong> para empezar
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left border-b border-slate-700">
                        <th className="py-3 px-4 text-slate-300 font-semibold">Email</th>
                        <th className="py-3 px-4 text-slate-300 font-semibold">Estado</th>
                        <th className="py-3 px-4 text-slate-300 font-semibold">Uso</th>
                        <th className="py-3 px-4 text-slate-300 font-semibold">Límite</th>
                        <th className="py-3 px-4 text-slate-300 font-semibold">Progreso</th>
                        <th className="py-3 px-4 text-slate-300 font-semibold text-center">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAndSortedAccounts.map((acc) => (
                        <tr
                          key={acc.id}
                          className="border-b border-slate-800 hover:bg-slate-700/40 transition"
                        >
                          <td className="py-4 px-4">
                            <div className="flex items-center gap-2">
                              <span className="text-2xl">📧</span>
                              <span className="font-medium text-white">{acc.email}</span>
                            </div>
                          </td>
                          <td className="py-4 px-4">
                            <AccountStatusBadge
                              limit={acc.limit}
                              usage={acc.usage}
                              error={acc.error}
                            />
                          </td>
                          <td className="py-4 px-4 text-slate-300">
                            {formatStorageFromGB(acc.usage / (1024 ** 3))}
                          </td>
                          <td className="py-4 px-4 text-slate-300">
                            {formatStorageFromGB(acc.limit / (1024 ** 3))}
                          </td>
                          <td className="py-4 px-4">
                            <div className="w-32">
                              <ProgressBar
                                current={acc.usage}
                                total={acc.limit}
                                height="sm"
                                showPercentage={false}
                              />
                            </div>
                          </td>
                          <td className="py-4 px-4 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <a
                                href={`/drive/${acc.id}`}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition"
                              >
                                📁 Ver archivos
                              </a>
                              <button
                                onClick={() => handleDisconnectAccount(acc.id, acc.email)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-red-400 hover:text-red-300 text-xs font-medium transition"
                                title="Desconectar cuenta"
                              >
                                Desconectar
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {/* Modal de slots históricos */}
      <ReconnectSlotsModal
        isOpen={showReconnectModal}
        onClose={() => setShowReconnectModal(false)}
      />
    </main>
  );
}

export default function AppDashboard() {
  const [routeParamsKey, setRouteParamsKey] = useState<string | null>("init");
  const [routeParams, setRouteParams] = useState<DashboardRouteParams>({
    authStatus: null,
    authError: null,
    reconnectStatus: null,
    allowedParam: null,
    slotId: null,
  });

  const handleParamsChange = useCallback(
    (key: string, params: DashboardRouteParams) => {
      setRouteParamsKey(key);
      setRouteParams(params);
    },
    []
  );

  return (
    <>
      <Suspense
        fallback={
          <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-500" />
        }
      >
        <SearchParamsBridge onChange={handleParamsChange} />
      </Suspense>
      <DashboardContent routeParams={routeParams} routeParamsKey={routeParamsKey} />
    </>
  );
}
