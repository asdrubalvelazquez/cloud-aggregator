import { useCloudStatusContext } from "@/context/CloudStatusContext";

/**
 * useCloudStatus
 * 
 * Convenient hook to access global cloud status cache.
 * 
 * Features:
 * - Shares cache across all consumers (120s TTL by default)
 * - Deduplicates concurrent requests automatically
 * - refreshAccounts(force=false): respects cache TTL
 * - refreshAccounts(force=true): bypasses cache (cache:'no-store')
 * - invalidateCache(): resets lastFetch to force next fetch
 * 
 * Example usage:
 * 
 * ```tsx
 * const { cloudStatus, loading, error, refreshAccounts } = useCloudStatus();
 * 
 * useEffect(() => {
 *   // Initial load (respects cache)
 *   refreshAccounts();
 * }, []);
 * 
 * const handleReconnect = async () => {
 *   // Force refresh after state change
 *   await reconnectAccount();
 *   await refreshAccounts(true);
 * };
 * ```
 */
export function useCloudStatus() {
  return useCloudStatusContext();
}
