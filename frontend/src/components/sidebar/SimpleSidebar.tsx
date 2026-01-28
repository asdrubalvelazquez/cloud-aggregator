"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCloudStatusQuery } from "@/queries/useCloudStatusQuery";
import AddCloudModal from "@/components/AddCloudModal";

type Props = {
  onNavigate?: () => void;
};

/**
 * Simplified sidebar inspired by Google Drive
 * - No complex trees or expansions
 * - Direct list of accounts
 * - Fast, instant navigation
 * - Clean visual design
 */
export function SimpleSidebar({ onNavigate }: Props) {
  const pathname = usePathname();
  const { data: cloudStatus, isLoading } = useCloudStatusQuery();
  const [showAddCloudModal, setShowAddCloudModal] = useState(false);

  // Group accounts by provider for organized display
  const accounts = cloudStatus?.accounts ?? [];
  const googleAccounts = accounts.filter(a => a.provider.toLowerCase().includes("google"));
  const onedriveAccounts = accounts.filter(a => 
    a.provider.toLowerCase().includes("one") || 
    a.provider.toLowerCase().includes("microsoft")
  );

  return (
    <div className="flex flex-col h-full bg-slate-900 border-r border-slate-700">
      {/* Header */}
      <div className="p-4 border-b border-slate-700">
        <Link
          href="/app"
          onClick={onNavigate}
          className="text-xl font-bold text-white hover:text-emerald-400 transition-colors"
        >
          Cloud Aggregator
        </Link>
      </div>

      {/* Add Cloud Button */}
      <div className="p-4">
        <button
          onClick={() => setShowAddCloudModal(true)}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg font-semibold transition-colors shadow-sm"
        >
          <span className="text-lg">+</span>
          <span>Add Cloud</span>
        </button>
      </div>

      {/* Accounts List */}
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {isLoading ? (
          <div className="text-sm text-slate-400 p-4 animate-pulse">
            Loading clouds...
          </div>
        ) : (
          <div className="space-y-1">
            {/* Dashboard Home */}
            <Link
              href="/app"
              onClick={onNavigate}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors
                ${pathname === "/app" 
                  ? "bg-blue-600 text-white font-medium" 
                  : "text-slate-300 hover:bg-slate-800"
                }
              `}
            >
              <span className="text-xl">🏠</span>
              <span>Dashboard</span>
            </Link>

            {/* Google Drive Accounts */}
            {googleAccounts.length > 0 && (
              <>
                <div className="mt-6 mb-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Google Drive
                </div>
                {googleAccounts.map((account) => {
                  const href = `/drive/${account.cloud_account_id}`;
                  const isActive = pathname === href;
                  const isConnected = account.connection_status === "connected";

                  return (
                    <Link
                      key={account.slot_log_id}
                      href={href}
                      onClick={onNavigate}
                      className={`
                        w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors
                        ${isActive 
                          ? "bg-blue-600 text-white font-medium" 
                          : isConnected
                            ? "text-slate-300 hover:bg-slate-800"
                            : "text-slate-500 hover:bg-slate-800"
                        }
                      `}
                    >
                      <span className="text-xl">📁</span>
                      <div className="flex-1 min-w-0">
                        <div className="truncate">
                          {account.provider_email}
                        </div>
                        {!isConnected && (
                          <div className="text-xs text-amber-400 mt-0.5">
                            ⚠️ Needs reconnect
                          </div>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </>
            )}

            {/* OneDrive Accounts */}
            {onedriveAccounts.length > 0 && (
              <>
                <div className="mt-6 mb-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  OneDrive
                </div>
                {onedriveAccounts.map((account) => {
                  const href = `/onedrive/${account.provider_account_uuid}`;
                  const isActive = pathname === href;
                  const isConnected = account.connection_status === "connected";

                  return (
                    <Link
                      key={account.slot_log_id}
                      href={href}
                      onClick={onNavigate}
                      className={`
                        w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors
                        ${isActive 
                          ? "bg-blue-600 text-white font-medium" 
                          : isConnected
                            ? "text-slate-300 hover:bg-slate-800"
                            : "text-slate-500 hover:bg-slate-800"
                        }
                      `}
                    >
                      <span className="text-xl">☁️</span>
                      <div className="flex-1 min-w-0">
                        <div className="truncate">
                          {account.provider_email}
                        </div>
                        {!isConnected && (
                          <div className="text-xs text-amber-400 mt-0.5">
                            ⚠️ Needs reconnect
                          </div>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </>
            )}

            {/* Empty state */}
            {accounts.length === 0 && !isLoading && (
              <div className="text-sm text-slate-500 p-4 text-center">
                No cloud accounts yet.
                <br />
                Click "+ Add Cloud" to get started.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer Stats */}
      {cloudStatus && cloudStatus.summary.connected > 0 && (
        <div className="px-4 py-3 border-t border-slate-700 text-xs text-slate-500">
          <div className="font-medium text-slate-400 mb-1">Status</div>
          <div className="space-y-0.5">
            <div>✅ Connected: {cloudStatus.summary.connected}</div>
            {cloudStatus.summary.needs_reconnect > 0 && (
              <div className="text-amber-400">
                ⚠️ Need reconnect: {cloudStatus.summary.needs_reconnect}
              </div>
            )}
          </div>
        </div>
      )}

      <AddCloudModal 
        open={showAddCloudModal} 
        onClose={() => setShowAddCloudModal(false)} 
      />
    </div>
  );
}
