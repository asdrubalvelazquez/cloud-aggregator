"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { fetchBillingQuota, type BillingQuotaResponse } from "@/lib/api";

/**
 * React Query hook for fetching billing quota and plan information
 * 
 * Features:
 * - Automatic caching with 5-minute stale time
 * - Automatic refetching on window focus
 * - Error handling with retry logic
 * 
 * Usage:
 * ```tsx
 * const { data: billingQuota, isLoading, error } = useBillingQuotaQuery();
 * ```
 * 
 * @returns {UseQueryResult<BillingQuotaResponse>}
 */
export function useBillingQuotaQuery(): UseQueryResult<BillingQuotaResponse> {
  return useQuery<BillingQuotaResponse>({
    queryKey: ["billingQuota"],
    queryFn: fetchBillingQuota,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    retry: 2,
  });
}
