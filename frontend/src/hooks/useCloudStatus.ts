/**
 * Re-export of useCloudStatus from CloudStatusContext
 * 
 * CRITICAL: This file exists only for backward compatibility.
 * It re-exports the hook from @/context/CloudStatusContext to ensure
 * a single context instance across the entire bundle.
 * 
 * PREFERRED: Import directly from @/context/CloudStatusContext
 * AVOID: Creating wrapper hooks that import from different paths
 */
export { useCloudStatus } from "@/context/CloudStatusContext";
