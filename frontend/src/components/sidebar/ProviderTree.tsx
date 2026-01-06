"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import type { CloudAccountStatus } from "@/lib/api";

type Props = {
  title: string;
  icon: string;
  provider: "google" | "onedrive";
  accounts: CloudAccountStatus[];
  onNavigate?: () => void;
};

/**
 * Expandable tree node for a cloud provider
 * Shows accounts grouped under the provider with status badges
 * Persists expand/collapse state in localStorage
 */
export function ProviderTree({ title, icon, provider, accounts, onNavigate }: Props) {
  const pathname = usePathname();
  
  // Initialize from localStorage with default true
  const [expanded, setExpanded] = useState(() => {
    if (typeof window === 'undefined') return true;
    try {
      const stored = localStorage.getItem(`sidebar_expand_${provider}`);
      return stored === null ? true : stored === 'true';
    } catch {
      return true;
    }
  });

  // Persist to localStorage when expanded changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(`sidebar_expand_${provider}`, String(expanded));
    } catch (err) {
      console.error('Failed to save expand state:', err);
    }
  }, [expanded, provider]);

  return (
    <div className="space-y-1">
      {/* Provider Header - Expandable */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-slate-700/50 transition group"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-300 group-hover:text-white">
          <span className="text-base">{icon}</span>
          <span>{title}</span>
          <span className="text-xs text-slate-500">({accounts.length})</span>
        </div>
        <span className="text-slate-500 text-xs">
          {expanded ? "▼" : "▶"}
        </span>
      </button>

      {/* Accounts List - Windows Explorer tree style */}
      {expanded && accounts.length > 0 && (
        <ul className="ml-3 pl-3 border-l-2 border-slate-700 space-y-0.5">
          {accounts.map((account, index) => {
            // Build href with null safety
            let href = "/app"; // Default fallback
            if (provider === "google" && account.cloud_account_id) {
              href = `/drive/${account.cloud_account_id}`;
            } else if (provider === "onedrive" && account.provider_account_uuid) {
              href = `/onedrive/${account.provider_account_uuid}`;
            }

            const isActive = pathname === href;
            const isConnected = account.connection_status === "connected";
            const needsReconnect = account.connection_status === "needs_reconnect";
            const isDisconnected = account.connection_status === "disconnected";
            const isLast = index === accounts.length - 1;

            return (
              <li key={account.slot_log_id} className="relative">
                {/* Tree branch horizontal line */}
                <span 
                  className="absolute left-0 top-[14px] w-3 h-px bg-slate-700"
                  aria-hidden="true"
                />
                
                <Link
                  href={href}
                  onClick={onNavigate}
                  className={`
                    relative block pl-4 pr-3 py-2 rounded-md text-sm transition
                    ${
                      isActive
                        ? "bg-emerald-500 text-white font-semibold shadow-sm"
                        : isConnected
                          ? "text-slate-300 hover:bg-slate-700"
                          : "text-slate-500 hover:bg-slate-700/50"
                    }
                  `}
                  title={account.reason || account.provider_email}
                >
                  <div className="flex items-start gap-2">
                    {/* Account Email */}
                    <div className="flex-1 min-w-0">
                      <div className={`truncate ${!isConnected && !isActive ? 'text-slate-400' : ''}`}>
                        {account.provider_email}
                      </div>

                      {/* Status Badges */}
                      {needsReconnect && (
                        <div className="flex items-center gap-1 mt-1 text-xs text-amber-400 font-medium">
                          <span>⚠️</span>
                          <span>Needs reconnect</span>
                        </div>
                      )}
                      {isDisconnected && (
                        <div className="flex items-center gap-1 mt-1 text-xs text-red-400/80 font-medium">
                          <span>❌</span>
                          <span>Disconnected</span>
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {/* No accounts message for this provider */}
      {expanded && accounts.length === 0 && (
        <div className="ml-3 pl-3 border-l-2 border-slate-700">
          <div className="pl-4 py-2 text-xs text-slate-500 italic">
            No accounts yet
          </div>
        </div>
      )}
    </div>
  );
}
