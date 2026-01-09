"use client";

import { TransferItem, formatFileSize } from "@/types/transfer-queue";

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
        return "⏬";
      case "queued":
        return "⏳";
      case "skipped":
        return "⏭️";
      default:
        return "◯";
    }
  };

  return (
    <div className="flex items-start gap-3 py-2 px-3 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
      <span className="text-lg flex-shrink-0 mt-0.5">{getStatusIcon(item.status)}</span>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
            {item.source_name}
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
            {formatFileSize(item.size_bytes)}
          </span>
        </div>
        
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
