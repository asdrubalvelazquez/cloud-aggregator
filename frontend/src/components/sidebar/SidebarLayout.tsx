"use client";

import { useState } from "react";
import { ExplorerSidebar } from "./ExplorerSidebar";

/**
 * Main sidebar layout wrapper with desktop/mobile support
 * Includes mobile drawer for responsive navigation
 */
export function SidebarLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const buildId =
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
    process.env.NEXT_PUBLIC_COMMIT_SHA?.slice(0, 7) ||
    "dev";

  return (
    <div className="flex min-h-screen bg-slate-900">
      {/* Desktop Sidebar - Fixed */}
      <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 md:z-30">
        <div className="flex-1 flex flex-col">
          <ExplorerSidebar />
        </div>
        <div className="mt-4 px-4 py-2 text-[10px] text-slate-500 select-none">
          build: {buildId}
        </div>
      </aside>

      {/* Mobile Drawer Backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile Drawer */}
      {mobileOpen && (
        <aside className="fixed inset-y-0 left-0 w-64 z-50 md:hidden">
          <ExplorerSidebar onNavigate={() => setMobileOpen(false)} />
        </aside>
      )}

      {/* Main Content Area */}
      <div className="flex-1 md:pl-64 flex flex-col">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center justify-between p-4 bg-slate-800 border-b border-slate-700 sticky top-0 z-20">
          <h1 className="text-lg font-bold text-white">Cloud Aggregator</h1>
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 rounded hover:bg-slate-700 text-white"
            aria-label="Open menu"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </header>

        {/* Page Content - Scrollable */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
