"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchCloudStatus, type CloudStatusResponse } from "@/lib/api";
import { onCloudStatusRefresh } from "@/lib/cloudStatusEvents";
import { ProviderTree } from "./ProviderTree";

type Props = {
  onNavigate?: () => void;
};

/**
 * Main sidebar with Windows Explorer-style tree navigation
 * Shows: Add Cloud button + grouped cloud accounts by provider
 */
export function ExplorerSidebar({ onNavigate }: Props) {
  const [cloudStatus, setCloudStatus] = useState<CloudStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadClouds = async (forceRefresh = false) => {
    try {
      if (forceRefresh) {
        setRefreshing(true);
        setLoading(false);  // Clear loading state on manual refresh
      } else {
        setLoading(true);
        setRefreshing(false);  // Clear refreshing state on initial load
      }
      const data = await fetchCloudStatus(forceRefresh);
      setCloudStatus(data);
      setError(null);
    } catch (err: any) {
      console.error("Failed to load cloud status:", err);
      setError(err.message || "Failed to load clouds");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadClouds();
    
    // Subscribe to cloud status refresh events
    const unsubscribe = onCloudStatusRefresh(() => {
      console.log("[ExplorerSidebar] Cloud status refresh event received");
      loadClouds();  // Use cache - page already fetched fresh data
    });
    
    // Cleanup subscription on unmount
    return unsubscribe;
  }, []);

  const handleRefresh = () => {
    loadClouds(true);
  };

  // Group accounts by provider
  const googleAccounts = (cloudStatus?.accounts ?? []).filter(a => a.provider === "google");
  const onedriveAccounts = (cloudStatus?.accounts ?? []).filter(a => a.provider === "onedrive");

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
        <Link
          href="/app"
          onClick={onNavigate}
          className="block w-full py-2.5 px-4 bg-emerald-500 hover:bg-emerald-600 text-white text-center rounded-lg font-semibold transition shadow-sm"
        >
          + Add Cloud
        </Link>
      </div>

      {/* Clouds Tree */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="text-sm text-slate-400 animate-pulse">Loading clouds...</div>
        ) : error ? (
          <div className="text-sm text-red-400">⚠️ {error}</div>
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
            {cloudStatus && cloudStatus.summary.total_slots > 0 && (
              <div className="pt-4 border-t border-slate-700">
                <div className="text-xs text-slate-500 space-y-1">
                  <div>Connected: {cloudStatus.summary.connected}</div>
                  {cloudStatus.summary.needs_reconnect > 0 && (
                    <div className="text-amber-400">
                      ⚠️ Needs reconnect: {cloudStatus.summary.needs_reconnect}
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
    </div>
  );
}
