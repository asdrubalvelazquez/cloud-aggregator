/**
 * Shared helper for Drive row actions
 * Single source of truth for RowActionsMenu and ContextMenu
 */

export type RowAction = {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tooltip?: string;
  dividerAfter?: boolean;
};

type GetRowActionsParams = {
  fileId: string;
  fileName: string;
  mimeType: string;
  webViewLink?: string;
  isFolder: boolean;
  onOpenFolder?: (fileId: string, fileName: string) => void;
  onCopy?: (fileId: string, fileName: string) => void;
  onRename?: (fileId: string, fileName: string) => void;
  onDownload?: (fileId: string, fileName: string) => void;
  copyDisabled?: boolean;
};

export function getRowActions(params: GetRowActionsParams): RowAction[] {
  const {
    fileId,
    fileName,
    mimeType,
    webViewLink,
    isFolder,
    onOpenFolder,
    onCopy,
    onRename,
    onDownload,
    copyDisabled = false,
  } = params;

  const actions: RowAction[] = [];

  // Folder: Show "Abrir"
  if (isFolder && onOpenFolder) {
    actions.push({
      icon: "📂",
      label: "Abrir",
      onClick: () => onOpenFolder(fileId, fileName),
    });
  }

  // File: Show "Ver" if webViewLink exists
  if (!isFolder && webViewLink) {
    actions.push({
      icon: "👁️",
      label: "Ver",
      onClick: () => window.open(webViewLink, "_blank", "noopener,noreferrer"),
    });
  }

  // Copiar - Disabled for folders with tooltip
  if (isFolder) {
    actions.push({
      icon: "📋",
      label: "Copiar",
      onClick: () => {},
      disabled: true,
      tooltip: "No se pueden copiar carpetas aún",
      dividerAfter: true,
    });
  } else if (onCopy) {
    actions.push({
      icon: "📋",
      label: "Copiar",
      onClick: () => onCopy(fileId, fileName),
      disabled: copyDisabled,
      dividerAfter: true,
    });
  }

  // Renombrar (always available)
  if (onRename) {
    actions.push({
      icon: "✏️",
      label: "Renombrar",
      onClick: () => onRename(fileId, fileName),
    });
  }

  // Descargar - Only for files, not folders
  if (!isFolder && onDownload) {
    actions.push({
      icon: "⬇️",
      label: "Descargar",
      onClick: () => onDownload(fileId, fileName),
    });
  }

  return actions;
}
