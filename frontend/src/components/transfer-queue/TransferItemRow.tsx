"use client";

import { TransferItem, formatFileSize, toSafeName } from "@/types/transfer-queue";

interface TransferItemRowProps {
  item: TransferItem;
}

export function TransferItemRow({ item }: TransferItemRowProps) {
  const getStatusIcon = (status: string) => {
    switch (status) {
      case "done":
        return "✅";
      case "failed":
        return "❌";
      case "running":
      case "in_progress":
        return "⏬";
      case "queued":
      case "pending":
        return "⏳";
      case "skipped":
      case "already_exists":
        return "⏭️";
      default:
        return "◯";
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "done":
      case "completed":
      case "success":
        return "Listo";
      case "failed":
      case "error":
        return "Error";
      case "running":
      case "in_progress":
        return "Copiando…";
      case "queued":
      case "pending":
        return "En cola";
      case "skipped":
        return "Omitido";
      case "already_exists":
        return "Omitido (ya existe en destino)";
      case "cancelled":
        return "Cancelado";
      default:
        return `Estado: ${status}`;
    }
  };

  // Calculate status display logic
  const status = (item.status || "").toLowerCase();
  const isDone = ["done", "completed", "success"].includes(status);
  const showStatusText = !isDone || ["skipped", "already_exists"].includes(status);

  return (
    <div className="flex items-start gap-3 py-2 px-3 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
      <span className="text-lg flex-shrink-0 mt-0.5">{getStatusIcon(item.status)}</span>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
            {toSafeName(item.source_name)}
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
            {formatFileSize(item.size_bytes)}
          </span>
        </div>
        
        {/* Status text - shown for non-done items or items with specific statuses */}
        {showStatusText && (
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
            {getStatusText(item.status)}
          </p>
        )}
        
        {item.error_message && (
          <p className="text-xs text-red-600 dark:text-red-400 mt-1 line-clamp-2">
            {item.error_message}
          </p>
        )}
        
        {item.target_web_url && item.status === "done" && (
          <a
            href={item.target_web_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-1 inline-block"
          >
            View in destination →
          </a>
        )}
      </div>
    </div>
  );
}
