"use client";

import { useEffect, useState } from "react";

type Account = {
  id: number;
  account_email: string;
  google_account_id: string;
  limit_gb?: number | null;
  usage_gb?: number | null;
  error?: string;
};

type StorageSummary = {
  accounts: Account[];
  total_limit_gb: number;
  total_usage_gb: number;
  total_free_gb: number | null;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

export default function Home() {
  const [data, setData] = useState<StorageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authMessage, setAuthMessage] = useState<string | null>(null);

  const fetchSummary = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/storage/summary`);
      if (!res.ok) {
        throw new Error(`Error API: ${res.status}`);
      }
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e: any) {
      setError(e.message || "Error al cargar datos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Verificar si el usuario acaba de autenticarse
    const params = new URLSearchParams(window.location.search);
    const authStatus = params.get("auth");
    const authError = params.get("error");

    if (authStatus === "success") {
      setAuthMessage("✅ Cuenta de Google conectada exitosamente");
      // Limpiar URL sin recargar la página
      window.history.replaceState({}, "", window.location.pathname);
      // Esperar 1 segundo antes de cargar los datos para que se procese en el backend
      setTimeout(() => {
        fetchSummary();
      }, 1000);
    } else if (authError) {
      setError(`Error de autenticación: ${authError}`);
      window.history.replaceState({}, "", window.location.pathname);
      fetchSummary();
    } else {
      fetchSummary();
    }

    // Limpiar mensaje de éxito después de 5 segundos
    if (authStatus === "success") {
      const timer = setTimeout(() => setAuthMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleConnectGoogle = () => {
    // Redirige directamente al backend para iniciar OAuth
    window.location.href = `${API_BASE_URL}/auth/google/login`;
  };

  return (
    <main className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center p-6">
      <div className="w-full max-w-4xl space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl md:text-3xl font-bold">Cloud Aggregator 🌥️</h1>
          <button
            onClick={handleConnectGoogle}
            className="rounded-lg bg-emerald-500 hover:bg-emerald-600 transition px-4 py-2 text-sm font-semibold"
          >
            Conectar nueva cuenta de Google Drive
          </button>
        </header>

        {/* Mensaje de autenticación exitosa */}
        {authMessage && (
          <div className="bg-emerald-500/20 border border-emerald-500 rounded-lg p-4 text-emerald-100">
            {authMessage}
          </div>
        )}

        {loading && <p>Cargando resumen de almacenamiento…</p>}
        {error && (
          <p className="text-red-400">Ocurrió un error al cargar datos: {error}</p>
        )}

        {data && (
          <>
            {/* Tarjeta de resumen */}
            <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-slate-800 rounded-xl p-4 shadow">
                <h2 className="text-sm text-slate-300 uppercase tracking-wide">
                  Total espacio
                </h2>
                <p className="text-2xl font-bold">
                  {data.total_limit_gb.toFixed(2)} GB
                </p>
              </div>
              <div className="bg-slate-800 rounded-xl p-4 shadow">
                <h2 className="text-sm text-slate-300 uppercase tracking-wide">
                  Usado
                </h2>
                <p className="text-2xl font-bold">
                  {data.total_usage_gb.toFixed(2)} GB
                </p>
              </div>
              <div className="bg-slate-800 rounded-xl p-4 shadow">
                <h2 className="text-sm text-slate-300 uppercase tracking-wide">
                  Libre
                </h2>
                <p className="text-2xl font-bold">
                  {data.total_free_gb?.toFixed(2) ?? "--"} GB
                </p>
              </div>
            </section>

            {/* Tabla de cuentas */}
            <section className="bg-slate-800 rounded-xl p-4 shadow">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold">
                  Cuentas conectadas ({data.accounts.length})
                </h2>
                <button
                  onClick={fetchSummary}
                  className="text-xs border border-slate-600 rounded px-2 py-1 hover:bg-slate-700"
                >
                  Refrescar
                </button>
              </div>

              {data.accounts.length === 0 ? (
                <p className="text-sm text-slate-300">
                  Aún no hay cuentas conectadas. Haz clic en
                  &nbsp;
                  <strong>“Conectar nueva cuenta de Google Drive”</strong>.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left border-b border-slate-700">
                        <th className="py-2 pr-4">Email</th>
                        <th className="py-2 pr-4">Uso (GB)</th>
                        <th className="py-2 pr-4">Límite (GB)</th>
                        <th className="py-2 pr-4">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.accounts.map((acc) => (
                        <tr
                          key={acc.id}
                          className="border-b border-slate-800 hover:bg-slate-700/40"
                        >
                          <td className="py-2 pr-4">{acc.account_email}</td>
                          <td className="py-2 pr-4">
                            {acc.usage_gb != null ? acc.usage_gb.toFixed(2) : "—"}
                          </td>
                          <td className="py-2 pr-4">
                            {acc.limit_gb != null ? acc.limit_gb.toFixed(2) : "—"}
                          </td>
                          <td className="py-2 pr-4">
                            <a
                              href={`/drive/${acc.id}`}
                              className="text-emerald-400 hover:underline text-xs"
                            >
                              Ver archivos
                            </a>
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
    </main>
  );
}
