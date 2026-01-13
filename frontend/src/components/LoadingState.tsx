"use client";

import { CloudLoadingIndicator } from "./CloudLoadingIndicator";

export function TopProgressBar() {
  return (
    <div className="fixed top-0 left-0 right-0 h-1 bg-slate-800 z-50 overflow-hidden">
      <div className="h-full w-[70%] bg-gradient-to-r from-emerald-500 via-emerald-400 to-emerald-500 animate-pulse" />
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="bg-slate-800 rounded-lg p-6 animate-pulse">
      <div className="flex items-center justify-between mb-4">
        <div className="h-4 bg-slate-700 rounded w-32" />
        <div className="h-8 w-8 bg-slate-700 rounded-full" />
      </div>
      <div className="space-y-3">
        <div className="h-6 bg-slate-700 rounded w-24" />
        <div className="h-4 bg-slate-700 rounded w-full" />
        <div className="h-2 bg-slate-700 rounded-full w-full" />
      </div>
    </div>
  );
}

export function DashboardLoadingState() {
  return (
    <>
      <CloudLoadingIndicator />
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </>
  );
}

export function SlowLoadingNotice({ onReload }: { onReload: () => void }) {
  return (
    <div className="mt-6 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 text-center">
      <p className="text-yellow-200 text-sm mb-3">
        ⏳ Está tardando más de lo normal. Tu conexión podría estar lenta.
      </p>
      <button
        onClick={onReload}
        className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg text-sm font-semibold transition"
      >
        Recargar ahora
      </button>
    </div>
  );
}
