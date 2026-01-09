/**
 * Transfer Queue Types
 * Shared types for persistent transfer queue with live progress
 */

export type TransferItemStatus = "queued" | "running" | "done" | "failed" | "skipped";
export type TransferJobStatus = "pending" | "preparing" | "queued" | "running" | "done" | "failed" | "partial" | "blocked_quota" | "cancelled";

export interface TransferItem {
  id: string;
  source_item_id: string;
  source_name: string;
  size_bytes: number;
  status: TransferItemStatus;
  error_message?: string;
  target_item_id?: string;
  target_web_url?: string;
}

export interface JobWithItems {
  id: string;
  status: TransferJobStatus;
  total_items: number;
  completed_items: number;
  failed_items: number;
  skipped_items?: number;
  total_bytes: number;
  transferred_bytes: number;
  progress?: number | null;  // Backend-calculated progress (0-100 or null)
  created_at: string;
  started_at?: string;
  completed_at?: string;
  items: TransferItem[];
  source_provider?: string;
  target_provider?: string;
  source_account_id?: string;
  target_account_id?: string;
}

export interface PersistedQueue {
  version: number;
  jobs: Map<string, JobWithItems>;
  lastUpdated: string;
}

/**
 * Helper: Check if job is in terminal state (done, failed, partial, cancelled)
 */
export function isTerminalState(job: JobWithItems): boolean {
  const terminalStatuses: TransferJobStatus[] = ["done", "failed", "partial", "cancelled"];
  if (terminalStatuses.includes(job.status)) return true;

  // Check if all items are processed
  const total = job.total_items || 0;
  const processed = (job.completed_items || 0) + (job.failed_items || 0) + (job.skipped_items || 0);
  return total > 0 && processed >= total;
}

/**
 * Helper: Calculate overall progress percentage (with NaN prevention)
 */
export function calculateProgress(job: JobWithItems): number {
  // Prefer backend-calculated progress if available
  if (job.progress !== undefined && job.progress !== null && Number.isFinite(job.progress)) {
    return Math.max(0, Math.min(100, job.progress));
  }
  
  // Fallback: Calculate from bytes if available
  const totalBytes = job.total_bytes || 0;
  const transferredBytes = job.transferred_bytes || 0;
  
  if (totalBytes > 0 && Number.isFinite(totalBytes) && Number.isFinite(transferredBytes)) {
    const progress = (transferredBytes / totalBytes) * 100;
    return Math.max(0, Math.min(100, Math.round(progress)));
  }
  
  // Fallback: Calculate from item count
  const total = job.total_items || 0;
  if (total === 0) return 0;

  const completed = job.completed_items || 0;
  const failed = job.failed_items || 0;
  const skipped = job.skipped_items || 0;
  const processed = completed + failed + skipped;

  return Math.min(100, Math.round((processed / total) * 100));
}

/**
 * Helper: Serialize Map to array for localStorage
 */
export function serializeJobsMap(jobs: Map<string, JobWithItems>): Array<[string, JobWithItems]> {
  return Array.from(jobs.entries());
}

/**
 * Helper: Deserialize array from localStorage to Map
 */
export function deserializeJobsMap(entries: Array<[string, JobWithItems]>): Map<string, JobWithItems> {
  return new Map(entries);
}

/**
 * Helper: Format file size in human-readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Helper: Format timestamp to relative time
 */
export function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

/**
 * Helper: Get provider display name
 */
export function getProviderDisplayName(provider?: string): string {
  if (!provider) return "Unknown";
  const map: Record<string, string> = {
    google_drive: "Google Drive",
    onedrive: "OneDrive",
    dropbox: "Dropbox",
  };
  return map[provider.toLowerCase()] || provider;
}

/**
 * Helper: Get status badge color
 */
export function getStatusColor(status: TransferJobStatus): string {
  switch (status) {
    case "done":
      return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
    case "failed":
      return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
    case "partial":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
    case "cancelled":
      return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300";
    case "running":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
    case "preparing":
    case "queued":
      return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300";
    case "blocked_quota":
      return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300";
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300";
  }
}

/**
 * Helper: Get status display text
 */
export function getStatusDisplayText(status: TransferJobStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "preparing":
      return "Preparing";
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "done":
      return "Completed";
    case "failed":
      return "Failed";
    case "partial":
      return "Partial";
    case "blocked_quota":
      return "Quota Exceeded";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}
