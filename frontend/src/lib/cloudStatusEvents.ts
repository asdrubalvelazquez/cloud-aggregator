/**
 * Simple event emitter for cloud status changes
 * Used to refresh sidebar when clouds are connected/reconnected/disconnected
 * No dependencies - just a pub/sub pattern
 */

type CloudStatusCallback = () => void;

const listeners = new Set<CloudStatusCallback>();

/**
 * Emit event to refresh cloud status in all subscribed components
 * Call this after successful connect/reconnect/disconnect operations
 */
export function emitCloudStatusRefresh(): void {
  listeners.forEach(callback => {
    try {
      callback();
    } catch (err) {
      console.error('Error in cloud status refresh callback:', err);
    }
  });
}

/**
 * Subscribe to cloud status refresh events
 * Returns unsubscribe function for cleanup
 * 
 * @example
 * useEffect(() => {
 *   const unsubscribe = onCloudStatusRefresh(() => {
 *     loadClouds(true);
 *   });
 *   return unsubscribe;
 * }, []);
 */
export function onCloudStatusRefresh(callback: CloudStatusCallback): () => void {
  listeners.add(callback);
  
  // Return unsubscribe function
  return () => {
    listeners.delete(callback);
  };
}
