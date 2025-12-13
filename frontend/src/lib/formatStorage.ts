/**
 * Formatea bytes a unidades legibles (B, KB, MB, GB, TB)
 */
export function formatStorage(bytes: number): string {
  if (bytes === 0) return "0 B";
  
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  const value = bytes / Math.pow(k, i);
  
  // Formatear con 2 decimales solo si es necesario
  const formatted = value % 1 === 0 ? value.toFixed(0) : value.toFixed(2);
  
  return `${formatted} ${sizes[i]}`;
}

/**
 * Formatea GB a unidades legibles (GB o TB)
 */
export function formatStorageFromGB(gb: number): string {
  if (gb >= 1024) {
    const tb = gb / 1024;
    return `${tb.toFixed(2)} TB`;
  }
  return `${gb.toFixed(2)} GB`;
}
