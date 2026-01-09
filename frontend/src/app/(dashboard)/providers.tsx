"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode, useState } from "react";
import { TransferQueueProvider } from "@/context/TransferQueueContext";

/**
 * Client-side providers wrapper for dashboard routes
 * 
 * CRITICAL: This component is "use client" while layout.tsx remains a Server Component.
 * 
 * React Query configuration:
 * - retry: 1 (avoid excessive retries for auth failures)
 * - refetchOnWindowFocus: false (prevent unnecessary re-fetches)
 * - refetchOnReconnect: true (refresh on network recovery)
 * - staleTime: 0 (queries are immediately stale by default, unless overridden)
 * - gcTime: 5 minutes (cache data for 5 minutes after last use) - TanStack Query v5
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
            staleTime: 0,
            gcTime: 1000 * 60 * 5, // 5 minutes (TanStack Query v5)
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TransferQueueProvider>
        {children}
      </TransferQueueProvider>
    </QueryClientProvider>
  );
}
