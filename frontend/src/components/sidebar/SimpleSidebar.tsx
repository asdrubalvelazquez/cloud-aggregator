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

      {/* Navigation Menu */}
      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        <div className="space-y-1">
          {/* Dashboard */}
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
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            <span>Dashboard</span>
          </Link>

          {/* Clouds */}
          <Link
            href="/clouds"
            onClick={onNavigate}
            className={`
              flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors
              ${pathname === "/clouds" || pathname?.startsWith("/clouds/")
                ? "bg-blue-600 text-white font-medium" 
                : "text-slate-300 hover:bg-slate-800"
              }
            `}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
            </svg>
            <span>Clouds</span>
          </Link>

          {/* Transfers */}
          <Link
            href="/app/transfer"
            onClick={onNavigate}
            className={`
              flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors
              ${pathname === "/app/transfer" 
                ? "bg-blue-600 text-white font-medium" 
                : "text-slate-300 hover:bg-slate-800"
              }
            `}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            <span>Transfers</span>
          </Link>

          {/* Analytics - Disabled */}
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-500 cursor-not-allowed opacity-50">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <span>Analytics</span>
          </div>

          {/* Settings - Disabled */}
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-500 cursor-not-allowed opacity-50">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span>Settings</span>
          </div>
        </div>
      </nav>



      {/* Footer Status */}
      {cloudStatus && (
        <div className="px-4 py-3 border-t border-slate-700">
          <div className="text-xs text-slate-500 mb-1">Status</div>
          <div className="text-xs text-slate-400">Plan: PRO</div>
          <div className="text-xs text-slate-500 mt-1">Usage: 16%</div>
        </div>
      )}

      <AddCloudModal 
        open={showAddCloudModal} 
        onClose={() => setShowAddCloudModal(false)} 
      />
    </div>
  );
}
