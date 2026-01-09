"use client";

import { useState } from "react";
import { JobWithItems, calculateProgress, getStatusColor, getStatusDisplayText, getProviderDisplayName, formatRelativeTime, isTerminalState } from "@/types/transfer-queue";
import { TransferItemRow } from "./TransferItemRow";
import { useTransferQueue } from "@/hooks/useTransferQueue";

interface TransferJobCardProps {
  job: JobWithItems;
}

export function TransferJobCard({ job }: TransferJobCardProps) {
  const { cancelJob } = useTransferQueue();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const progress = calculateProgress(job);
  const isJobTerminal = isTerminalState(job);

  // Validate progress to prevent NaN display
  const displayProgress = Number.isFinite(progress) ? progress : 0;

  const handleCancel = async () => {
    if (isCancelling || isJobTerminal) return;
    setIsCancelling(true);
    try {
      await cancelJob(job.id);
    } finally {
      setIsCancelling(false);
    }
  };

  const getProviderIcon = (provider?: string) => {
    if (!provider) return "📁";
    switch (provider.toLowerCase()) {
      case "google_drive":
        return "🔵";
      case "onedrive":
        return "☁️";
      case "dropbox":
        return "📦";
      default:
        return "📁";
    }
  };

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden shadow-sm">
      {/* Header - Clickable to expand/collapse */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {/* Provider icons */}
          <div className="flex items-center gap-1 text-lg flex-shrink-0">
            <span>{getProviderIcon(job.source_provider)}</span>
            <span className="text-gray-400">→</span>
            <span>{getProviderIcon(job.target_provider)}</span>
          </div>

          {/* Job info */}
          <div className="flex-1 min-w-0 text-left">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {getProviderDisplayName(job.source_provider)} → {getProviderDisplayName(job.target_provider)}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getStatusColor(job.status)}`}>
                {getStatusDisplayText(job.status)}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mt-1">
              <span>{job.completed_items}/{job.total_items} files</span>
              <span>•</span>
              <span>{formatRelativeTime(job.created_at)}</span>
            </div>
          </div>

          {/* Cancel button (only show for non-terminal jobs) */}
          {!isJobTerminal && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleCancel();
              }}
              disabled={isCancelling}
              className="px-3 py-1 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
              title="Cancel transfer"
            >
              {isCancelling ? "Cancelling..." : "Cancel"}
            </button>
          )}

          {/* Expand indicator */}
          <svg
            className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Progress bar */}
      <div className="px-4 pb-3">
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              job.status === "failed"
                ? "bg-red-500"
                : job.status === "partial"
                ? "bg-yellow-500"
                : job.status === "done"
                ? "bg-green-500"
                : job.status === "cancelled"
                ? "bg-gray-400"
                : "bg-blue-500"
            }`}
            style={{ width: `${displayProgress}%` }}
          />
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-right">
          {Number.isFinite(displayProgress) ? `${displayProgress}%` : "Calculating..."}
        </p>
      </div>

      {/* Expanded items list */}
      {isExpanded && job.items && job.items.length > 0 && (
        <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/30">
          <div className="max-h-64 overflow-y-auto p-2">
            {job.items.map((item) => (
              <TransferItemRow key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
