"use client";

import { type MouseEvent } from "react";

type FileActionBarProps = {
  provider: "google_drive" | "onedrive";
  selectedCount: number;
  singleSelected?: { id: string; name: string; isFolder: boolean } | null;
  onClearSelection: () => void;
  
  // Action callbacks
  onDownloadSelected?: () => void;
  onCopySelected?: () => void;
  onRenameSingle?: () => void;
  onDeleteSelected?: () => void;
  onPreviewSingle?: () => void;
  onNewFolder?: () => void;
  onUpload?: () => void;
  onRefresh?: () => void;
  
  // Disabled states
  copyDisabled?: boolean;
  copyDisabledReason?: string;
};

export default function FileActionBar({
  provider,
  selectedCount,
  singleSelected,
  onClearSelection,
  onDownloadSelected,
  onCopySelected,
  onRenameSingle,
  onDeleteSelected,
  onPreviewSingle,
  onNewFolder,
  onUpload,
  onRefresh,
  copyDisabled = false,
  copyDisabledReason,
}: FileActionBarProps) {
  const providerName = provider === "google_drive" ? "Google Drive" : "OneDrive";

  if (selectedCount === 0) {
    // Directory actions (no selection)
    return (
      <div className="bg-slate-800 rounded-xl p-4 shadow border border-slate-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-300">Acciones de directorio:</span>
          </div>
          <div className="flex items-center gap-2">
            {onUpload && (
              <button
                type="button"
                onClick={onUpload}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition flex items-center gap-1.5"
                title="Subir archivos"
              >
                <span>⬆️</span>
                <span>Subir</span>
              </button>
            )}
            {onNewFolder && (
              <button
                type="button"
                onClick={onNewFolder}
                className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 text-white rounded-lg text-sm font-semibold transition flex items-center gap-1.5"
                title="Crear nueva carpeta"
              >
                <span>📁</span>
                <span>Nueva carpeta</span>
              </button>
            )}
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 text-white rounded-lg text-sm font-semibold transition flex items-center gap-1.5"
                title="Recargar lista"
              >
                <span>🔄</span>
                <span>Recargar</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Selection actions (1 or more files selected)
  const isSingleFile = selectedCount === 1 && singleSelected && !singleSelected.isFolder;
  const isSingleFolder = selectedCount === 1 && singleSelected && singleSelected.isFolder;

  return (
    <div className="bg-gradient-to-r from-blue-600/20 to-emerald-600/20 rounded-xl p-4 shadow border-2 border-blue-500/50">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-white">
            {selectedCount} {selectedCount === 1 ? "archivo seleccionado" : "archivos seleccionados"}
          </span>
          {singleSelected && (
            <span className="text-xs text-slate-300 truncate max-w-[200px]" title={singleSelected.name}>
              {singleSelected.name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Copy to another account */}
          {onCopySelected && (
            <div className="relative group">
              <button
                type="button"
                onClick={onCopySelected}
                disabled={copyDisabled}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold transition flex items-center gap-1.5"
                title={copyDisabled && copyDisabledReason ? copyDisabledReason : "Copiar a otra cuenta"}
              >
                <span>📋</span>
                <span>Copiar a...</span>
              </button>
              {copyDisabled && copyDisabledReason && (
                <div className="absolute left-0 top-full mt-2 px-3 py-2 bg-slate-900 text-slate-100 text-xs rounded-lg shadow-xl whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 border border-slate-600">
                  {copyDisabledReason}
                </div>
              )}
            </div>
          )}

          {/* Download */}
          {onDownloadSelected && (
            <button
              type="button"
              onClick={onDownloadSelected}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition flex items-center gap-1.5"
              title="Descargar archivo(s)"
            >
              <span>⬇️</span>
              <span>Descargar</span>
            </button>
          )}

          {/* Rename (only for single file) */}
          {onRenameSingle && isSingleFile && (
            <button
              type="button"
              onClick={onRenameSingle}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-semibold transition flex items-center gap-1.5"
              title="Renombrar archivo"
            >
              <span>✏️</span>
              <span>Renombrar</span>
            </button>
          )}

          {/* Preview (only for single file) */}
          {onPreviewSingle && isSingleFile && (
            <button
              type="button"
              onClick={onPreviewSingle}
              className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-semibold transition flex items-center gap-1.5"
              title="Vista previa"
            >
              <span>👁️</span>
              <span>Vista previa</span>
            </button>
          )}

          {/* Delete (if available) */}
          {onDeleteSelected && (
            <button
              type="button"
              onClick={onDeleteSelected}
              disabled={true}
              className="px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold transition flex items-center gap-1.5"
              title="Mover a papelera (requiere scope adicional)"
            >
              <span>🗑️</span>
              <span>Eliminar</span>
            </button>
          )}

          {/* Clear selection */}
          <button
            type="button"
            onClick={onClearSelection}
            className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 text-white rounded-lg text-sm font-semibold transition flex items-center gap-1.5"
            title="Limpiar selección"
          >
            <span>✖️</span>
            <span>Limpiar</span>
          </button>
        </div>
      </div>
    </div>
  );
}
