"use client";

import ProgressBar from "@/components/ProgressBar";
import QuotaBadge from "@/components/QuotaBadge";
import AccountStatusBadge from "@/components/AccountStatusBadge";
import { DashboardLoadingState } from "@/components/LoadingState";
import { formatStorage } from "@/lib/formatStorage";
import type { CloudStatusResponse } from "@/lib/api";

/**
 * CloudStorageSummary types (matching dashboard current implementation)
 */
type CloudStorageAccount = {
  provider: string;
  email: string;
  total_bytes: number | null;
  used_bytes: number | null;
  free_bytes: number | null;
  percent_used: number | null;
  status: "ok" | "unavailable" | "error";
};

type CloudStorageSummary = {
  totals: {
    total_bytes: number;
    used_bytes: number;
    free_bytes: number;
    percent_used: number;
  };
  accounts: CloudStorageAccount[];
};

/**
 * Props for DashboardOverview component
 */
export type DashboardOverviewProps = {
  cloudStatus: CloudStatusResponse | null;
  cloudStorage: CloudStorageSummary | null;
  isLoading?: boolean;
  error?: string | null;
  onConnectGoogle: () => void;
  onConnectOneDrive: () => void;
  onOpenSlotsModal: () => void;
  onOpenGoogleExplorer?: () => void;
  onOpenOneDriveExplorer?: () => void;
  onOpenTransferExplorer?: () => void;
  onViewAllAccounts?: () => void;
  userEmail?: string | null;
};

/**
 * Internal component: StatsCard
 */
type StatsCardProps = {
  icon: string;
  label: string;
  value: string | number;
  children?: React.ReactNode;
  className?: string;
};

function StatsCard({ icon, label, value, children, className = "" }: StatsCardProps) {
  return (
    <div className={`bg-slate-800 rounded-lg p-6 border border-slate-700 hover:border-slate-600 transition-colors ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <span className="text-3xl">{icon}</span>
      </div>
      <div className="space-y-2">
        <p className="text-2xl font-bold text-white">{value}</p>
        <p className="text-sm text-slate-400">{label}</p>
        {children && <div className="mt-3">{children}</div>}
      </div>
    </div>
  );
}

/**
 * Internal component: QuickActionCard
 */
type QuickActionCardProps = {
  icon: string;
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
};

function QuickActionCard({ icon, title, description, onClick, disabled = false }: QuickActionCardProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        bg-slate-800 rounded-lg p-6 border border-slate-700 text-left
        transition-all duration-200
        ${disabled 
          ? 'opacity-50 cursor-not-allowed' 
          : 'hover:border-emerald-500 hover:bg-slate-700 hover:shadow-lg hover:shadow-emerald-500/10'
        }
      `}
    >
      <div className="flex items-start gap-4">
        <span className="text-3xl flex-shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-white mb-1">{title}</h3>
          <p className="text-sm text-slate-400">{description}</p>
        </div>
      </div>
    </button>
  );
}

/**
 * DashboardOverview Component
 * 
 * Visual dashboard with stats, quick actions, and accounts summary.
 * Does NOT fetch data - receives everything as props from parent.
 */
export default function DashboardOverview({
  cloudStatus,
  cloudStorage,
  isLoading = false,
  error = null,
  onConnectGoogle,
  onConnectOneDrive,
  onOpenSlotsModal,
  onOpenGoogleExplorer,
  onOpenOneDriveExplorer,
  onOpenTransferExplorer,
  onViewAllAccounts,
  userEmail,
}: DashboardOverviewProps) {

  // Loading state
  if (isLoading) {
    return <DashboardLoadingState />;
  }

  // Error state
  if (error) {
    return (
      <div className="w-full max-w-6xl">
        <div className="bg-red-500/20 border border-red-500 rounded-lg p-6 text-center">
          <p className="text-red-100 font-semibold mb-2">Error al cargar el dashboard</p>
          <p className="text-red-200 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  // Extract data
  const totals = cloudStorage?.totals;
  const summary = cloudStatus?.summary;
  const connectedAccounts = cloudStatus?.accounts.filter(
    (acc) => acc.connection_status === "connected"
  ) || [];
  
  // Get storage accounts (max 5 for preview)
  const storageAccounts = cloudStorage?.accounts.slice(0, 5) || [];
  const hasMoreAccounts = (cloudStorage?.accounts.length || 0) > 5;

  // Get first Google Drive and OneDrive accounts for quick actions
  const firstGoogleAccount = connectedAccounts.find(acc => acc.provider === "google_drive");
  const firstOneDriveAccount = connectedAccounts.find(acc => acc.provider === "onedrive");

  return (
    <div className="w-full max-w-6xl space-y-8">
      {/* Hero Section */}
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold text-white">
          Tu Almacenamiento en la Nube
        </h1>
        <p className="text-lg text-slate-400">
          {userEmail ? `Bienvenido, ${userEmail}` : 'Gestiona todas tus cuentas en un solo lugar'}
        </p>
        <div className="flex items-center justify-center gap-4 pt-2">
          <button
            onClick={onConnectGoogle}
            className="px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold rounded-lg transition-colors"
          >
            Conectar Google Drive
          </button>
          <button
            onClick={onConnectOneDrive}
            className="px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg transition-colors"
          >
            Conectar OneDrive
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Card 1: Total Storage */}
        <StatsCard
          icon="☁️"
          label="Almacenamiento Total"
          value={totals ? formatStorage(totals.total_bytes) : "—"}
        >
          {totals && totals.total_bytes > 0 && (
            <ProgressBar
              current={totals.used_bytes}
              total={totals.total_bytes}
              height="sm"
              showPercentage={false}
            />
          )}
          {totals && (
            <div className="flex items-center justify-between text-xs text-slate-400 mt-2">
              <span>Usado: {formatStorage(totals.used_bytes)}</span>
              <span>Libre: {formatStorage(totals.free_bytes)}</span>
            </div>
          )}
        </StatsCard>

        {/* Card 2: Connected Accounts */}
        <StatsCard
          icon="🔗"
          label="Cuentas Conectadas"
          value={summary?.connected ?? 0}
        >
          {summary && summary.needs_reconnect > 0 && (
            <div className="bg-amber-500/20 border border-amber-500/50 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-amber-400 text-sm">⚠️</span>
                <span className="text-amber-200 text-xs font-medium">
                  {summary.needs_reconnect} {summary.needs_reconnect === 1 ? 'cuenta requiere' : 'cuentas requieren'} reconexión
                </span>
              </div>
            </div>
          )}
          {summary && summary.needs_reconnect === 0 && summary.connected > 0 && (
            <div className="text-emerald-400 text-sm flex items-center gap-2">
              <span>✓</span>
              <span>Todas las cuentas activas</span>
            </div>
          )}
        </StatsCard>

        {/* Card 3: Transfer Quota */}
        <StatsCard
          icon="🚀"
          label="Tráfico Disponible"
          value=""
          className="flex flex-col"
        >
          <QuotaBadge />
        </StatsCard>
      </div>

      {/* Quick Actions Panel */}
      <div>
        <h2 className="text-2xl font-bold text-white mb-4">Acceso Rápido</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <QuickActionCard
            icon="📁"
            title="Explorar Google Drive"
            description="Navega y gestiona tus archivos de Google Drive"
            onClick={onOpenGoogleExplorer || (() => {})}
            disabled={!firstGoogleAccount}
          />
          
          <QuickActionCard
            icon="📂"
            title="Explorar OneDrive"
            description="Navega y gestiona tus archivos de OneDrive"
            onClick={onOpenOneDriveExplorer || (() => {})}
            disabled={!firstOneDriveAccount}
          />
          
          <QuickActionCard
            icon="🔄"
            title="Transferir Archivos"
            description="Copia archivos entre tus cuentas de nube"
            onClick={onOpenTransferExplorer || (() => {})}
            disabled={connectedAccounts.length === 0}
          />
          
          <QuickActionCard
            icon="📊"
            title="Ver Mis Cuentas"
            description="Gestiona tus conexiones y reconecta cuentas"
            onClick={onOpenSlotsModal}
          />
        </div>
      </div>

      {/* Accounts Summary */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-white">Tus Nubes</h2>
          {hasMoreAccounts && (
            <button
              onClick={onViewAllAccounts || (() => {})}
              className="text-emerald-400 hover:text-emerald-300 text-sm font-medium transition-colors"
            >
              Ver todas →
            </button>
          )}
        </div>

        {storageAccounts.length === 0 ? (
          <div className="bg-slate-800 rounded-lg border-2 border-dashed border-slate-700 p-12 text-center">
            <div className="text-5xl mb-4">☁️</div>
            <p className="text-slate-300 text-lg mb-2">Aún no hay cuentas conectadas</p>
            <p className="text-slate-400 text-sm">
              Haz clic en los botones de arriba para conectar tu primera cuenta
            </p>
          </div>
        ) : (
          <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-900/50 border-b border-slate-700">
                    <th className="text-left py-3 px-4 text-slate-300 font-semibold text-sm">Cuenta</th>
                    <th className="text-left py-3 px-4 text-slate-300 font-semibold text-sm">Provider</th>
                    <th className="text-left py-3 px-4 text-slate-300 font-semibold text-sm">Estado</th>
                    <th className="text-left py-3 px-4 text-slate-300 font-semibold text-sm">Almacenamiento</th>
                  </tr>
                </thead>
                <tbody>
                  {storageAccounts.map((account, idx) => {
                    // Find corresponding cloudStatus account
                    const statusAccount = connectedAccounts.find(
                      (acc) => acc.provider_email === account.email
                    );
                    
                    const providerIcon = account.provider === "google_drive" ? "📁" : "📂";
                    const providerLabel = account.provider === "google_drive" ? "Google Drive" : "OneDrive";
                    
                    return (
                      <tr 
                        key={`${account.provider}-${account.email}-${idx}`}
                        className="border-b border-slate-700 hover:bg-slate-700/40 transition-colors"
                      >
                        <td className="py-4 px-4">
                          <div className="flex items-center gap-2">
                            <span className="text-2xl">{providerIcon}</span>
                            <span className="text-white font-medium truncate max-w-[200px]">
                              {account.email}
                            </span>
                          </div>
                        </td>
                        <td className="py-4 px-4">
                          <span className="text-slate-300 text-sm">{providerLabel}</span>
                        </td>
                        <td className="py-4 px-4">
                          {account.total_bytes !== null && account.used_bytes !== null ? (
                            <AccountStatusBadge
                              limit={account.total_bytes}
                              usage={account.used_bytes}
                              error={account.status === "error" ? "Error" : undefined}
                            />
                          ) : (
                            <span className="text-slate-400 text-sm">—</span>
                          )}
                        </td>
                        <td className="py-4 px-4">
                          {account.total_bytes !== null && account.used_bytes !== null ? (
                            <div className="space-y-2 min-w-[200px]">
                              <div className="flex items-center justify-between text-sm">
                                <span className="text-slate-400">
                                  {formatStorage(account.used_bytes)}
                                </span>
                                <span className="text-slate-400">
                                  {formatStorage(account.total_bytes)}
                                </span>
                              </div>
                              <ProgressBar
                                current={account.used_bytes}
                                total={account.total_bytes}
                                height="sm"
                                showPercentage={false}
                              />
                            </div>
                          ) : (
                            <span className="text-slate-400 text-sm">No disponible</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            
            {hasMoreAccounts && (
              <div className="bg-slate-900/50 border-t border-slate-700 p-4 text-center">
                <button
                  onClick={onViewAllAccounts || (() => {})}
                  className="text-emerald-400 hover:text-emerald-300 font-medium text-sm transition-colors"
                >
                  Ver todas las cuentas ({cloudStorage?.accounts.length}) →
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer / Help Section */}
      <div className="bg-slate-800/50 rounded-lg border border-slate-700 p-6">
        <div className="flex items-start gap-4">
          <span className="text-3xl">💡</span>
          <div className="flex-1">
            <h3 className="text-white font-semibold mb-2">Tip: Conecta múltiples cuentas</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              Puedes conectar varias cuentas de Google Drive y OneDrive para gestionar todo tu almacenamiento 
              en un solo lugar. Transfiere archivos entre cuentas con un solo clic.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
