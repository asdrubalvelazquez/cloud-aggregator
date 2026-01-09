"use client";

import React, { createContext, useContext, useState, useCallback, useRef } from "react";
import { fetchCloudStatus, CloudStatusResponse } from "@/lib/api";

/**
 * CloudStatusContext
 * 
 * Global cache for /me/cloud-status with TTL-based invalidation.
 * 
 * Features:
 * - 120s TTL cache (configurable)
 * - Deduplicates concurrent requests
 * - force=true bypasses cache (uses cache:'no-store')
 * - force=false respects TTL
 * - Manual invalidation via invalidateCache()
 * 
 * Usage:
 * - Wrap app with <CloudStatusProvider>
 * - Consume via useCloudStatus() hook
 */

interface CloudStatusContextValue {
  cloudStatus: CloudStatusResponse | null;
  loading: boolean;
  error: string | null;
  lastFetch: number | null;
  refreshAccounts: (force?: boolean) => Promise<void>;
  invalidateCache: () => void;
}

export const CloudStatusContext = createContext<CloudStatusContextValue | undefined>(undefined);

interface CloudStatusProviderProps {
  children: React.ReactNode;
  cacheTTL?: number; // milliseconds, default 120000 (120s)
}

export function CloudStatusProvider({ 
  children, 
  cacheTTL = 120000 
}: CloudStatusProviderProps) {
  const [cloudStatus, setCloudStatus] = useState<CloudStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<number | null>(null);

  // Deduplication: prevent multiple simultaneous requests
  const inFlightRequestRef = useRef<Promise<void> | null>(null);

  const refreshAccounts = useCallback(
    async (force = false) => {
      // If there's already a request in flight, wait for it instead of creating a new one
      if (inFlightRequestRef.current) {
        console.debug("[CloudStatus] Request already in flight, waiting...");
        await inFlightRequestRef.current;
        return;
      }

      // Check cache TTL (only if force=false)
      if (!force && lastFetch !== null) {
        const age = Date.now() - lastFetch;
        if (age < cacheTTL) {
          console.debug(
            `[CloudStatus] Using cached data (age: ${age}ms, TTL: ${cacheTTL}ms)`
          );
          return;
        }
        console.debug(
          `[CloudStatus] Cache expired (age: ${age}ms, TTL: ${cacheTTL}ms), fetching...`
        );
      }

      // Create promise and store in ref for deduplication
      const requestPromise = (async () => {
        try {
          setLoading(true);
          setError(null);

          console.debug(
            `[CloudStatus] Fetching cloud status (force: ${force})`
          );

          const data = await fetchCloudStatus(force);
          
          setCloudStatus(data);
          setLastFetch(Date.now());
          
          console.debug(
            `[CloudStatus] Fetched successfully (${data.accounts.length} accounts)`
          );
        } catch (err) {
          const errorMessage =
            err instanceof Error ? err.message : "Failed to fetch cloud status";
          
          console.error("[CloudStatus] Fetch error:", errorMessage);
          setError(errorMessage);
          
          // Don't throw - keep tree alive
        } finally {
          setLoading(false);
          inFlightRequestRef.current = null;
        }
      })();

      inFlightRequestRef.current = requestPromise;
      await requestPromise;
    },
    [lastFetch, cacheTTL]
  );

  const invalidateCache = useCallback(() => {
    console.debug("[CloudStatus] Cache invalidated manually");
    setLastFetch(null);
  }, []);

  const value: CloudStatusContextValue = {
    cloudStatus,
    loading,
    error,
    lastFetch,
    refreshAccounts,
    invalidateCache,
  };

  return (
    <CloudStatusContext.Provider value={value}>
      {children}
    </CloudStatusContext.Provider>
  );
}

/**
 * useCloudStatus
 * 
 * Hook to access global cloud status cache.
 * 
 * CRITICAL: Import ONLY from this file to ensure single context instance.
 * Do NOT import from @/hooks/useCloudStatus to avoid module duplication.
 * 
 * Production Safety: Returns safe fallback if provider missing (prevents crash).
 * Development: Throws error to catch missing provider early.
 */
export function useCloudStatus(): CloudStatusContextValue {
  const context = useContext(CloudStatusContext);
  
  if (!context) {
    // In development: throw to catch bugs early
    if (process.env.NODE_ENV !== "production") {
      throw new Error(
        "useCloudStatus must be used within CloudStatusProvider. " +
        "Wrap your component tree with <CloudStatusProvider>."
      );
    }
    
    // In production: safe fallback to prevent crash
    console.error(
      "[CloudStatus] CRITICAL: useCloudStatus called outside CloudStatusProvider. " +
      "Returning safe fallback. Check your component tree."
    );
    
    return {
      cloudStatus: null,
      loading: false,
      error: "Cloud status provider missing",
      lastFetch: null,
      refreshAccounts: async () => {
        console.warn("[CloudStatus] refreshAccounts called without provider");
      },
      invalidateCache: () => {
        console.warn("[CloudStatus] invalidateCache called without provider");
      },
    };
  }
  
  return context;
}
