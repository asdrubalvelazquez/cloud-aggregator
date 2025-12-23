"use client";

import { useEffect, useState, Suspense } from "react";
import { supabase } from "@/lib/supabaseClient";
import { authenticatedFetch } from "@/lib/api";
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

function DashboardContent() {
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
  const [showReconnectModal, setShowReconnectModal] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  const fetchSummary = async () => {
    try {
      setLoading(true);
      const res = await authenticatedFetch("/storage/summary");
      if (!res.ok) {
        throw new Error(`Error API: ${res.status}`);
      }
      const json = await res.json();
      setData(json);
      setError(null);
      setLastUpdated(Date.now());
    } catch (e: any) {
      setError(e.message || "Error al cargar datos");
    } finally {
      setLoading(false);
    }
  };

  const fetchQuota = async () => {
    try {
      const res = await authenticatedFetch("/me/plan");
      if (res.ok) {
        const quotaData = await res.json();
        setQuota(quotaData);
      }
    } catch (e) {
      // Silently fail - quota display is optional
      console.error("Failed to fetch quota:", e);
    }
  };

  useEffect(() => {
    // Verificar sesión de usuario
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.email) {
        setUserEmail(session.user.email);
        setUserId(session.user.id);
      }
    };
    checkSession();

    // Verificar si el usuario acaba de autenticarse (usando searchParams)
    const authStatus = searchParams?.get("auth");
    const authError = searchParams?.get("error");
    const allowedParam = searchParams?.get("allowed");

    if (authStatus === "success") {
      setToast({
        message: "Cuenta de Google conectada exitosamente",
        type: "success",
      });
      // Limpiar URL sin recargar la página
      window.history.replaceState({}, "", window.location.pathname);
      // Esperar 1 segundo antes de cargar los datos
      setTimeout(() => {
        fetchSummary();
        fetchQuota();
      }, 1000);
    } else if (authError === "cloud_limit_reached") {
      setToast({
        message: `Has usado tus slots históricos. Puedes reconectar tus cuentas anteriores desde "Ver mis cuentas", pero no puedes agregar cuentas nuevas en plan FREE.`,
        type: "warning",
      });
      window.history.replaceState({}, "", window.location.pathname);
      fetchSummary();
      fetchQuota();
    } else if (authError) {
      setToast({
        message: `Error de autenticación: ${authError}`,
        type: "error",
      });
      window.history.replaceState({}, "", window.location.pathname);
      fetchSummary();
      fetchQuota();
    } else {
      fetchSummary();
      fetchQuota();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

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
      const { url } = await fetchGoogleLoginUrl({ mode: "new" });
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
    await supabase.auth.signOut();
    router.push("/");
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
            <button
              onClick={handleConnectGoogle}
              disabled={!!quota && quota.historical_slots_used >= quota.historical_slots_total}
              className={
                !!quota && quota.historical_slots_used >= quota.historical_slots_total
                  ? "rounded-lg transition px-4 py-2 text-sm font-semibold bg-slate-600 text-slate-400 cursor-not-allowed"
                  : "rounded-lg transition px-4 py-2 text-sm font-semibold bg-emerald-500 hover:bg-emerald-600"
              }
              title={
                !!quota && quota.historical_slots_used >= quota.historical_slots_total
                  ? "Has usado todos tus slots históricos. Puedes reconectar tus cuentas anteriores desde 'Ver mis cuentas'"
                  : "Conectar una nueva cuenta de Google Drive"
              }
            >
              Conectar nueva cuenta
            </button>
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
          </div>
        )}

        {data && (
          <>
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
                  <h3 className="text-sm font-semibold text-slate-300">Uso Global de Almacenamiento</h3>
                  {lastUpdated && (
                    <span className="text-xs text-slate-500">
                      Última actualización: {getRelativeTime(lastUpdated)}
                    </span>
                  )}
                </div>
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
                  Cuentas conectadas ({data.accounts.length})
                </h2>
                <button
                  onClick={fetchSummary}
                  className="text-sm border border-slate-600 rounded-lg px-3 py-1.5 hover:bg-slate-700 transition font-medium"
                >
                  🔄 Refrescar
                </button>
              </div>

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
  return (
    <Suspense fallback={
      <main className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mb-4"></div>
          <p className="text-slate-300">Cargando...</p>
        </div>
      </main>
    }>
      <DashboardContent />
    </Suspense>
  );
}
