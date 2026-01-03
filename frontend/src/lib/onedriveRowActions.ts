/**
 * OneDrive row actions helper (kebab menu)
 * Similar structure to driveRowActions.ts
 */

type OnedriveRowAction = {
  label: string;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
  tooltip?: string;
  dividerAfter?: boolean;
};

type GetOnedriveRowActionsParams = {
  fileId: string;
  fileName: string;
  webViewLink?: string;
  isFolder: boolean;
  onOpenFolder?: (fileId: string, fileName: string) => void;
  onRename?: (fileId: string, fileName: string) => void;
  onDownload?: (fileId: string, fileName: string) => void;
};

export function getOnedriveRowActions(params: GetOnedriveRowActionsParams): OnedriveRowAction[] {
  const {
    fileId,
    fileName,
    webViewLink,
    isFolder,
    onOpenFolder,
    onRename,
    onDownload,
  } = params;

  const actions: OnedriveRowAction[] = [];

  // 1. Abrir (solo folders)
  if (isFolder && onOpenFolder) {
    actions.push({
      label: "Abrir",
      icon: "📂",
      onClick: () => onOpenFolder(fileId, fileName),
    });
  }

  // 2. Descargar (solo files)
  if (!isFolder && onDownload) {
    actions.push({
      label: "Descargar",
      icon: "⬇️",
      onClick: () => onDownload(fileId, fileName),
    });
  }

  // 3. Renombrar
  if (onRename) {
    actions.push({
      label: "Renombrar",
      icon: "✏️",
      onClick: () => onRename(fileId, fileName),
      dividerAfter: true,
    });
  }

  // 4. Ver en OneDrive (siempre, si hay webViewLink)
  if (webViewLink) {
    actions.push({
      label: "Ver en OneDrive",
      icon: "🔗",
      onClick: () => window.open(webViewLink, "_blank"),
    });
  }

  return actions;
}
