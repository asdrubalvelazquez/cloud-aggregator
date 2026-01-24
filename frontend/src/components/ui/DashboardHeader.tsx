import React, { useMemo } from "react";
import { formatStorageFromGB } from "@/lib/formatStorage";

type DashboardHeaderProps = {
  userName?: string | null;
  totalUsedBytes: number;
  totalLimitBytes: number;
  connectedAccountsCount: number;
  onAddCloud: () => void;
  onLogout: () => void;
};

export default function DashboardHeader({
  userName,
  totalUsedBytes,
  totalLimitBytes,
  connectedAccountsCount,
  onAddCloud,
  onLogout,
}: DashboardHeaderProps) {
  // Cálculos optimizados con useMemo y GB decimales (1000^3)
  const { totalUsedGB, totalLimitGB, freeSpaceGB, usagePercent } = useMemo(() => {
    const GB_DIVISOR = 1000 ** 3; // 1,000,000,000 para GB decimales
    const used = totalUsedBytes / GB_DIVISOR;
    const limit = totalLimitBytes / GB_DIVISOR;
    const free = Math.max(0, (totalLimitBytes - totalUsedBytes) / GB_DIVISOR);
    const percent = totalLimitBytes > 0 ? (totalUsedBytes / totalLimitBytes) * 100 : 0;
    return { totalUsedGB: used, totalLimitGB: limit, freeSpaceGB: free, usagePercent: percent };
  }, [totalUsedBytes, totalLimitBytes]);

  // Color semántico basado en porcentaje de uso
  const getUsageColor = () => {
    if (usagePercent >= 90) return "text-red-400";
    if (usagePercent >= 75) return "text-amber-400";
    return "text-emerald-400";
  };

  // Iniciales del usuario optimizadas con useMemo
  const userInitials = useMemo(() => {
    if (!userName?.trim()) return "U";
    const emailPart = userName.split("@")[0];
    const parts = emailPart.split(".");
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return emailPart[0]?.toUpperCase() || "U";
  }, [userName]);

  return (
    <header className="w-full max-w-7xl mb-8">
      <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 shadow-xl">
        <div className="px-6 py-4">
          {/* Mobile Layout: Grid 2x2 de métricas + botón completo */}
          <div className="flex flex-col gap-4 lg:hidden">
            {/* Logo + Avatar */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-blue-600 flex items-center justify-center">
                  <span className="text-white font-bold text-lg" aria-hidden="true">☁️</span>
                </div>
                <div>
                  <h1 className="text-xl font-bold text-white">Cloud Aggregator</h1>
                  <p className="text-xs text-slate-400">{userName || "Usuario"}</p>
                </div>
              </div>
              <button
                onClick={onLogout}
                className="w-9 h-9 rounded-full bg-slate-700 hover:bg-slate-600 active:bg-slate-500 flex items-center justify-center text-sm font-semibold text-slate-200 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-opacity-50"
                aria-label={`Cerrar sesión de ${userName || 'usuario'}`}
                role="button"
                tabIndex={0}
                title={userName || "Usuario"}
                onKeyDown={(e) => e.key === 'Enter' && onLogout()}
              >
                <span aria-hidden="true">{userInitials}</span>
              </button>
            </div>

            {/* Métricas: 4 cards en grid 2x2 */}
            <div className="grid grid-cols-2 gap-3">
              {/* Usado */}
              <div className="bg-slate-900/50 rounded-lg px-3 py-2.5 border border-slate-700/50">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg" aria-hidden="true">📊</span>
                  <span className="text-xs text-slate-400 font-medium">Usado</span>
                </div>
                <p className={`text-lg font-bold ${getUsageColor()}`}>
                  {formatStorageFromGB(totalUsedGB)}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  de {formatStorageFromGB(totalLimitGB)}
                </p>
              </div>

              {/* Cuentas */}
              <div className="bg-slate-900/50 rounded-lg px-3 py-2.5 border border-slate-700/50">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg" aria-hidden="true">☁️</span>
                  <span className="text-xs text-slate-400 font-medium">Cuentas</span>
                </div>
                <p className="text-lg font-bold text-blue-400">
                  {connectedAccountsCount}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">conectadas</p>
              </div>

              {/* Libre */}
              <div className="bg-slate-900/50 rounded-lg px-3 py-2.5 border border-slate-700/50">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg" aria-hidden="true">💾</span>
                  <span className="text-xs text-slate-400 font-medium">Libre</span>
                </div>
                <p className="text-lg font-bold text-emerald-400">
                  {formatStorageFromGB(freeSpaceGB)}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">disponible</p>
              </div>

              {/* Uso % */}
              <div className="bg-slate-900/50 rounded-lg px-3 py-2.5 border border-slate-700/50">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg" aria-hidden="true">📈</span>
                  <span className="text-xs text-slate-400 font-medium">Uso</span>
                </div>
                <p className={`text-lg font-bold ${getUsageColor()}`}>
                  {usagePercent.toFixed(1)}%
                </p>
                <p className="text-xs text-slate-500 mt-0.5">capacidad</p>
              </div>
            </div>

            {/* Botón Add Cloud */}
            <button
              onClick={onAddCloud}
              className="w-full bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-semibold py-3 rounded-lg transition-colors flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-opacity-50 disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Abrir menú para conectar nueva nube"
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onAddCloud()}
            >
              <span aria-hidden="true" className="text-xl">+</span>
              <span>Conectar Nube</span>
            </button>
          </div>

          {/* Desktop Layout: Horizontal con 3 métricas principales */}
          <div className="hidden lg:flex items-center justify-between gap-6">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-blue-600 flex items-center justify-center">
                <span className="text-white font-bold text-2xl" aria-hidden="true">☁️</span>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">Cloud Aggregator</h1>
                <p className="text-sm text-slate-400">Panel de control</p>
              </div>
            </div>

            {/* Métricas: 3 cards horizontales */}
            <div className="flex items-center gap-4">
              {/* Almacenamiento usado */}
              <div className="flex items-center gap-3 bg-slate-900/50 rounded-lg px-4 py-3">
                <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <span className="text-xl" aria-hidden="true">📊</span>
                </div>
                <div>
                  <p className={`text-lg font-bold ${getUsageColor()}`}>
                    {formatStorageFromGB(totalUsedGB)}
                  </p>
                  <p className="text-xs text-slate-400">
                    de {formatStorageFromGB(totalLimitGB)} usados
                  </p>
                </div>
              </div>

              {/* Cuentas */}
              <div className="flex items-center gap-3 bg-slate-900/50 rounded-lg px-4 py-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <span className="text-xl" aria-hidden="true">☁️</span>
                </div>
                <div>
                  <p className="text-lg font-bold text-blue-400">{connectedAccountsCount}</p>
                  <p className="text-xs text-slate-400">
                    {connectedAccountsCount === 1 ? "cuenta" : "cuentas"}
                  </p>
                </div>
              </div>

              {/* Espacio libre */}
              <div className="flex items-center gap-3 bg-slate-900/50 rounded-lg px-4 py-3">
                <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                  <span className="text-xl" aria-hidden="true">💾</span>
                </div>
                <div>
                  <p className="text-lg font-bold text-emerald-400">
                    {formatStorageFromGB(freeSpaceGB)}
                  </p>
                  <p className="text-xs text-slate-400">disponible</p>
                </div>
              </div>
            </div>

            {/* Acciones + Avatar */}
            <div className="flex items-center gap-3">
              <button
                onClick={onAddCloud}
                className="bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-semibold px-5 py-2.5 rounded-lg transition-colors flex items-center gap-2 shadow-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-opacity-50 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Abrir menú para conectar nueva nube"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && onAddCloud()}
              >
                <span aria-hidden="true" className="text-xl">+</span>
                <span>Conectar Nube</span>
              </button>
              <button
                onClick={onLogout}
                className="w-11 h-11 rounded-full bg-slate-700 hover:bg-slate-600 active:bg-slate-500 flex items-center justify-center text-sm font-semibold text-slate-200 transition-colors shadow-lg focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-opacity-50"
                aria-label={`Cerrar sesión de ${userName || 'usuario'}`}
                role="button"
                tabIndex={0}
                title={userName || "Usuario"}
                onKeyDown={(e) => e.key === 'Enter' && onLogout()}
              >
                <span aria-hidden="true">{userInitials}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
