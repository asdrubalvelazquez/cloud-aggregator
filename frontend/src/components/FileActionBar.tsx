"use client";

import { type MouseEvent, useState, useRef, useEffect } from "react";

type FileActionBarProps = {
  provider: "google_drive" | "onedrive";
  selectedCount: number;
  singleSelected?: { id: string; name: string; isFolder: boolean; webViewLink?: string } | null;
  onClearSelection: () => void;
  
  // Action callbacks
  onDownloadSelected?: () => void;
  onCopySelected?: () => void;
  onRenameSingle?: () => void;
  onDeleteSelected?: () => void;
  onPreviewSingle?: () => void;
  onShareInProvider?: () => void;
  onGetLink?: () => void;
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
  onShareInProvider,
  onGetLink,
  onNewFolder,
  onUpload,
  onRefresh,
  copyDisabled = false,
  copyDisabledReason,
}: FileActionBarProps) {
  const providerName = provider === "google_drive" ? "Google Drive" : "OneDrive";
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
        setShowMoreMenu(false);
      }
    };

    if (showMoreMenu) {
      document.addEventListener('mousedown', handleClickOutside as any);
      return () => document.removeEventListener('mousedown', handleClickOutside as any);
    }
  }, [showMoreMenu]);

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
    <div className="flex items-center gap-3">
      {/* Clear selection button */}
      <button
        type="button"
        onClick={onClearSelection}
        className="p-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg transition"
        title="Cerrar"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Selection count and name */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-slate-200">
          {selectedCount} seleccionado{selectedCount > 1 ? "s" : ""}
        </span>
        {singleSelected && (
          <span className="text-xs text-slate-400 truncate max-w-[150px]" title={singleSelected.name}>
            {singleSelected.name}
          </span>
        )}
      </div>

      {/* Action buttons with icons only (Google Drive style) */}
      <div className="flex items-center gap-1">
        {/* Share in provider */}
        {onShareInProvider && (
          <button
            type="button"
            onClick={onShareInProvider}
            className="p-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg transition"
            title="Compartir en Google Drive / OneDrive"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
          </button>
        )}

        {/* Download */}
        {onDownloadSelected && (
          <button
            type="button"
            onClick={onDownloadSelected}
            className="p-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg transition"
            title="Descargar"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </button>
        )}

        {/* Copy to another account */}
        {onCopySelected && (
          <div className="relative group">
            <button
              type="button"
              onClick={onCopySelected}
              disabled={copyDisabled}
              className="p-2 text-slate-300 hover:text-white hover:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed rounded-lg transition"
              title={copyDisabled && copyDisabledReason ? copyDisabledReason : "Copiar a otra cuenta"}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
            {copyDisabled && copyDisabledReason && (
              <div className="absolute left-0 top-full mt-2 px-3 py-2 bg-slate-900 text-slate-100 text-xs rounded-lg shadow-xl whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 border border-slate-600">
                {copyDisabledReason}
              </div>
            )}
          </div>
        )}

        {/* Delete */}
        {onDeleteSelected && (
          <button
            type="button"
            onClick={onDeleteSelected}
            disabled={true}
            className="p-2 text-slate-500 cursor-not-allowed rounded-lg transition"
            title="Mover a papelera (requiere scope adicional)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}

        {/* Get link */}
        {onGetLink && singleSelected && (
          <button
            type="button"
            onClick={onGetLink}
            className="p-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg transition"
            title="Copiar enlace"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
          </button>
        )}

        {/* More options with dropdown menu */}
        <div className="relative" ref={moreMenuRef}>
          <button
            type="button"
            onClick={() => setShowMoreMenu(!showMoreMenu)}
            className="p-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg transition"
            title="Más opciones"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
            </svg>
          </button>

          {/* Dropdown menu */}
          {showMoreMenu && (
            <div className="absolute right-0 top-full mt-1 w-64 bg-white rounded-lg shadow-xl border border-slate-200 py-2 z-50 text-slate-900">
              {/* Download */}
              {onDownloadSelected && (
                <button
                  type="button"
                  onClick={() => {
                    onDownloadSelected();
                    setShowMoreMenu(false);
                  }}
                  className="w-full px-4 py-2 text-left hover:bg-slate-100 flex items-center gap-3 text-sm"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span>Descargar</span>
                </button>
              )}

              {/* Rename (only for single file) */}
              {onRenameSingle && isSingleFile && (
                <button
                  type="button"
                  onClick={() => {
                    onRenameSingle();
                    setShowMoreMenu(false);
                  }}
                  className="w-full px-4 py-2 text-left hover:bg-slate-100 flex items-center gap-3 text-sm"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  <span>Cambiar nombre</span>
                  <span className="ml-auto text-xs text-slate-500">Ctrl+Alt+E</span>
                </button>
              )}

              {/* Share */}
              {onShareInProvider && (
                <button
                  type="button"
                  onClick={() => {
                    onShareInProvider();
                    setShowMoreMenu(false);
                  }}
                  className="w-full px-4 py-2 text-left hover:bg-slate-100 flex items-center gap-3 text-sm"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  <span>Compartir</span>
                </button>
              )}

              {/* Divider */}
              <div className="border-t border-slate-200 my-2"></div>

              {/* Get link */}
              {onGetLink && singleSelected && (
                <button
                  type="button"
                  onClick={() => {
                    onGetLink();
                    setShowMoreMenu(false);
                  }}
                  className="w-full px-4 py-2 text-left hover:bg-slate-100 flex items-center gap-3 text-sm"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                  <span>Información de la {singleSelected.isFolder ? 'carpeta' : 'archivo'}</span>
                </button>
              )}

              {/* Move to trash (disabled) */}
              <button
                type="button"
                disabled
                className="w-full px-4 py-2 text-left text-slate-400 cursor-not-allowed flex items-center gap-3 text-sm"
                title="Mover a papelera (requiere scope adicional)"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                <span>Mover a la papelera</span>
                <span className="ml-auto text-xs">Delete</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
