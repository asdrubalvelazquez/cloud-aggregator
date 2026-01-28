"use client";

import { useState } from "react";
import Link from "next/link";
import { useCloudStatusQuery } from "@/queries/useCloudStatusQuery";
import { ProviderTree } from "./ProviderTree";
import AddCloudModal from "@/components/AddCloudModal";

type Props = {
  onNavigate?: () => void;
};

/**
 * Main sidebar with Windows Explorer-style tree navigation
 * Shows: Add Cloud button + grouped cloud accounts by provider
 * 
 * REFACTORED: Now uses React Query (useCloudStatusQuery) instead of CloudStatusContext
 * - Shared cache across all components
 * - No more event bus (onCloudStatusRefresh)
 * - Manual refresh via refetch()
 */
export function ExplorerSidebar({ onNavigate }: Props) {
  // Use React Query for cloud status (replaces CloudStatusContext)
  const { data: cloudStatus, isLoading, error, refetch } = useCloudStatusQuery();
  
  // Local UI state for manual refresh spinner
  const [refreshing, setRefreshing] = useState(false);
  
  // State for Add Cloud modal
  const [showAddCloudModal, setShowAddCloudModal] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  };

  /**
   * Normalize provider name variations to consistent values
   * Backend may return: "google", "google_drive", "onedrive", "microsoft", "ms_graph", etc.
   */
  const normalizeProvider = (provider: string): "google" | "onedrive" | null => {
    const p = provider.toLowerCase().trim();
    if (p.includes("google")) return "google";
    if (p.includes("one") || p.includes("microsoft") || p.includes("ms_graph") || p.includes("office")) return "onedrive";
    return null;
  };

  // Group accounts by normalized provider (safe: cloudStatus can be undefined)
  const accounts = cloudStatus?.accounts ?? [];
  
  const googleAccounts = accounts.filter(a => normalizeProvider(a.provider) === "google");
  const onedriveAccounts = accounts.filter(a => normalizeProvider(a.provider) === "onedrive");

  return (
    <div className="flex flex-col h-full bg-slate-800 border-r border-slate-700">
      {/* Header */}
      <div className="p-4 border-b border-slate-700">
        <div className="flex items-center justify-between">
          <Link
            href="/app"
            onClick={onNavigate}
            className="text-xl font-bold text-white hover:text-emerald-400 transition"
          >
            Cloud Aggregator
          </Link>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
            title="Refresh clouds"
            aria-label="Refresh clouds"
          >
            <svg
              className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Add Cloud Button */}
      <div className="p-4 border-b border-slate-700">
        <button
          onClick={() => {
            onNavigate?.();
            setShowAddCloudModal(true);
          }}
          className="block w-full py-2.5 px-4 bg-emerald-500 hover:bg-emerald-600 text-white text-center rounded-lg font-semibold transition shadow-sm"
        >
          + Add Cloud
        </button>
      </div>

      {/* Clouds Tree */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="text-sm text-slate-400 animate-pulse">Loading clouds...</div>
        ) : error ? (
          <div className="text-sm text-red-400">⚠️ {error instanceof Error ? error.message : 'Failed to load clouds'}</div>
        ) : (
          <div className="space-y-6">
            {/* Single Section: TUS NUBES */}
            <div>
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                TUS NUBES
              </h2>

              {/* Google Drive Provider - Always visible */}
              <ProviderTree
                title="Google Drive"
                icon="📁"
                provider="google"
                accounts={googleAccounts}
                onNavigate={onNavigate}
              />

              {/* OneDrive Provider - Always visible */}
              <div className="mt-3">
                <ProviderTree
                  title="OneDrive"
                  icon="☁️"
                  provider="onedrive"
                  accounts={onedriveAccounts}
                  onNavigate={onNavigate}
                />
              </div>
            </div>

            {/* Summary Stats (optional) */}
            {cloudStatus && cloudStatus.summary.connected > 0 && (
              <div className="pt-4 border-t border-slate-700">
                <div className="text-xs text-slate-500 space-y-1">
                  <div>Nubes activas: {cloudStatus.summary.connected}</div>
                  {cloudStatus.summary.needs_reconnect > 0 && (
                    <div className="text-amber-400">
                      ⚠️ Requieren reconexión: {cloudStatus.summary.needs_reconnect}
                    </div>
                  )}
                  {cloudStatus.summary.disconnected > 0 && (
                    <div className="text-slate-600">
                      Disconnected: {cloudStatus.summary.disconnected}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer Links */}
      <div className="p-4 border-t border-slate-700 space-y-2">
        <Link
          href="/pricing"
          onClick={onNavigate}
          className="block text-sm text-slate-400 hover:text-white transition"
        >
          💳 Pricing
        </Link>
        <Link
          href="/terms"
          onClick={onNavigate}
          className="block text-sm text-slate-400 hover:text-white transition"
        >
          📜 Terms
        </Link>
        <Link
          href="/privacy"
          onClick={onNavigate}
          className="block text-sm text-slate-400 hover:text-white transition"
        >
          🔒 Privacy
        </Link>
      </div>
      
      {/* Add Cloud Modal */}
      <AddCloudModal 
        open={showAddCloudModal} 
        onClose={() => setShowAddCloudModal(false)} 
      />
    </div>
  );
}
