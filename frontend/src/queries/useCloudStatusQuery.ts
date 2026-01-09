import { useQuery } from "@tanstack/react-query";
import { fetchCloudStatus, type CloudStatusResponse } from "@/lib/api";

/**
 * Query key constant for cloud status
 * Exported to ensure consistency across refetch/invalidate operations
 */
export const CLOUD_STATUS_KEY = ["cloudStatus"] as const;

/**
 * React Query hook for cloud status
 * 
 * Single source of truth for /me/cloud-status across the entire app.
 * Replaces CloudStatusContext with React Query cache.
 * 
 * Configuration:
 * - staleTime: 120000 (2 minutes) - data is fresh for 2 minutes
 * - gcTime: 600000 (10 minutes) - cache persists for 10 minutes after last use
 * - retry: 1 (inherited from QueryProvider)
 * - refetchOnWindowFocus: false (inherited from QueryProvider)
 * 
 * Usage:
 * ```tsx
 * const { data: cloudStatus, isLoading, error, refetch } = useCloudStatusQuery();
 * 
 * // Manual refresh (bypasses cache)
 * await refetch();
 * 
 * // Force refresh from other components
 * import { useQueryClient } from "@tanstack/react-query";
 * import { CLOUD_STATUS_KEY } from "@/queries/useCloudStatusQuery";
 * const queryClient = useQueryClient();
 * await queryClient.refetchQueries({ queryKey: CLOUD_STATUS_KEY });
 * ```
 * 
 * @returns {UseQueryResult<CloudStatusResponse>}
 */
export function useCloudStatusQuery() {
  return useQuery<CloudStatusResponse>({
    queryKey: CLOUD_STATUS_KEY,
    queryFn: async () => {
      console.debug("[useCloudStatusQuery] Fetching cloud status...");
      const data = await fetchCloudStatus(false);
      console.debug(
        `[useCloudStatusQuery] Fetched successfully (${data.accounts.length} accounts)`
      );
      return data;
    },
    staleTime: 1000 * 60 * 2, // 2 minutes
    gcTime: 1000 * 60 * 10, // 10 minutes (TanStack Query v5)
  });
}
