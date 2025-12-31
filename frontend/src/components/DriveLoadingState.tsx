"use client";

function FileSkeletonRow() {
  return (
    <div className="flex items-center gap-4 p-3 bg-slate-800 rounded-lg animate-pulse">
      <div className="w-8 h-8 bg-slate-700 rounded" />
      <div className="flex-1 space-y-2">
        <div className="h-4 bg-slate-700 rounded w-3/4" />
        <div className="h-3 bg-slate-700 rounded w-1/4" />
      </div>
      <div className="w-20 h-4 bg-slate-700 rounded" />
    </div>
  );
}

export function DriveLoadingState() {
  return (
    <div className="space-y-4">
      <div className="text-center py-6">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500 mb-2" />
        <p className="text-slate-300 text-sm">Cargando archivos…</p>
      </div>
      
      <div className="space-y-2">
        <FileSkeletonRow />
        <FileSkeletonRow />
        <FileSkeletonRow />
        <FileSkeletonRow />
        <FileSkeletonRow />
        <FileSkeletonRow />
        <FileSkeletonRow />
        <FileSkeletonRow />
      </div>
    </div>
  );
}
