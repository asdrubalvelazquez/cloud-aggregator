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
  onOpenInProvider?: (fileId: string, fileName: string) => void;
  onShareInProvider?: (fileId: string, fileName: string) => void;
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
    onOpenInProvider,
    onShareInProvider,
    copyDisabled = false,
  } = params;

  const actions: RowAction[] = [];

  // === SECCIÓN 1: NAVEGACIÓN Y VISTA ===
  
  // Folder: Show "Abrir" (navigate into folder)
  if (isFolder && onOpenFolder) {
    actions.push({
      icon: "📂",
      label: "Abrir carpeta",
      onClick: () => onOpenFolder(fileId, fileName),
    });
  }

  // File: Show "Ver en Drive" (open in provider UI)
  if (!isFolder && onOpenInProvider) {
    actions.push({
      icon: "🔗",
      label: "Abrir en Google Drive",
      onClick: () => onOpenInProvider(fileId, fileName),
      disabled: !webViewLink,
      tooltip: !webViewLink ? "No disponible para este archivo" : undefined,
    });
  }

  // File: Show "Preview" fallback if no handler (inline view)
  if (!isFolder && webViewLink && !onOpenInProvider) {
    actions.push({
      icon: "👁️",
      label: "Vista previa",
      onClick: () => window.open(webViewLink, "_blank", "noopener,noreferrer"),
    });
  }

  // Divider after navigation
  if (actions.length > 0) {
    actions[actions.length - 1].dividerAfter = true;
  }

  // === SECCIÓN 2: ACCIONES DE ARCHIVO ===

  // Descargar - Only for files, not folders
  if (!isFolder && onDownload) {
    actions.push({
      icon: "⬇️",
      label: "Descargar",
      onClick: () => onDownload(fileId, fileName),
    });
  }

  // Copiar a otra cuenta - Disabled for folders
  if (isFolder) {
    actions.push({
      icon: "📋",
      label: "Copiar a otra cuenta...",
      onClick: () => {},
      disabled: true,
      tooltip: "No se pueden copiar carpetas entre cuentas",
    });
  } else if (onCopy) {
    actions.push({
      icon: "📋",
      label: "Copiar a otra cuenta...",
      onClick: () => onCopy(fileId, fileName),
      disabled: copyDisabled,
      tooltip: copyDisabled ? "Conecta más cuentas para copiar" : undefined,
    });
  }

  // Duplicar en mismo Drive (DESHABILITADO - requiere scope drive.file)
  actions.push({
    icon: "🔄",
    label: "Duplicar en este Drive",
    onClick: () => {},
    disabled: true,
    tooltip: "Requiere permisos adicionales (scope drive.file). Próximamente.",
  });

  // Divider after file operations
  actions[actions.length - 1].dividerAfter = true;

  // === SECCIÓN 3: ORGANIZACIÓN ===

  // Renombrar (always available)
  if (onRename) {
    actions.push({
      icon: "✏️",
      label: "Renombrar",
      onClick: () => onRename(fileId, fileName),
    });
  }

  // Mover a carpeta (DESHABILITADO - Fase 2)
  actions.push({
    icon: "📁",
    label: "Mover a...",
    onClick: () => {},
    disabled: true,
    tooltip: "Próximamente: Mover archivos entre carpetas",
  });

  // Divider before share/delete
  actions[actions.length - 1].dividerAfter = true;

  // === SECCIÓN 4: COMPARTIR Y ELIMINAR ===

  // Compartir (abre UI oficial del proveedor)
  if (onShareInProvider) {
    actions.push({
      icon: "👥",
      label: "Compartir...",
      onClick: () => onShareInProvider(fileId, fileName),
      disabled: !webViewLink,
      tooltip: !webViewLink 
        ? "No disponible para este archivo" 
        : "Abre interfaz de compartir de Google Drive",
    });
  }

  // Eliminar/Mover a papelera (DESHABILITADO - requiere scope drive.file)
  actions.push({
    icon: "🗑️",
    label: "Mover a papelera",
    onClick: () => {},
    disabled: true,
    tooltip: "Requiere permisos adicionales (scope drive.file). Por ahora, elimina desde Google Drive.",
  });

  return actions;
}
