"use client";

import { useCallback, useEffect, useState, Suspense } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CLOUD_STATUS_KEY, useCloudStatusQuery } from "@/queries/useCloudStatusQuery";
import { DashboardLoadingState } from "@/components/LoadingState";
import { supabase } from "@/lib/supabaseClient";
import { authenticatedFetch, fetchCloudStatus } from "@/lib/api";
import type { CloudStatusResponse } from "@/lib/api";
import { useRouter, useSearchParams } from "next/navigation";
import Toast from "@/components/Toast";
import ProgressBar from "@/components/ProgressBar";
import AccountStatusBadge from "@/components/AccountStatusBadge";
import { formatStorage, formatStorageFromGB } from "@/lib/formatStorage";
import ReconnectSlotsModal from "@/components/ReconnectSlotsModal";
import OwnershipTransferModal from "@/components/OwnershipTransferModal";
import AddCloudModal from "@/components/AddCloudModal";

type Account = {
  id: number;
  email: string;
  limit: number;
  usage: number;
  usage_percent: number;
  error?: string;
};

type CloudStorageAccount = {
  provider: string;
  email: string;
  total_bytes: number | null;
  used_bytes: number | null;
  free_bytes: number | null;
  percent_used: number | null;
  status: "ok" | "unavailable" | "error";
};

type CloudStorageSummary = {
  totals: {
    total_bytes: number;
    used_bytes: number;
    free_bytes: number;
    percent_used: number;
  };
  accounts: CloudStorageAccount[];
};

type StorageSummary = {
  accounts: Account[];
  total_limit: number;
  total_usage: number;
  total_usage_percent: number;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

type ToastMessage = {
  message: string;
  type: "success" | "error" | "warning";
} | null;

type QuotaInfo = {
  plan: string;
  used: number;
  limit: number;
  remaining: number;
  // DEPRECATED (ambiguous):
  clouds_allowed: number;
  clouds_connected: number;
  clouds_remaining: number;
  // NEW EXPLICIT FIELDS (preferred):
  historical_slots_used: number;      // Lifetime slots consumed
  historical_slots_total: number;     // Slots allowed by plan
  active_clouds_connected: number;    // Currently active accounts
} | null;

type BillingQuota = {
  plan: string;
  plan_type: string;
  copies: {
    used: number;
    limit: number | null;
    is_lifetime: boolean;
  };
  transfer: {
    used_bytes: number;
    limit_bytes: number | null;
    used_gb: number;
    limit_gb: number | null;
    is_lifetime: boolean;
  };
  max_file_bytes: number;
  max_file_gb: number;
} | null;

type DashboardRouteParams = {
  authStatus: string | null;
  authError: string | null;
  reconnectStatus: string | null;
  connectionStatus: string | null;  // OneDrive connection success
  allowedParam: string | null;
  slotId: string | null;
  provider?: string | null;  // Provider type for ownership guard errors
  masked_email?: string | null;  // Masked email for ownership guard errors
};

function SearchParamsBridge({
  onChange,
}: {
  onChange: (key: string, params: DashboardRouteParams) => void;
}) {
  const searchParams = useSearchParams();
  const key = searchParams.toString();

  useEffect(() => {
    onChange(key, {
      authStatus: searchParams.get("auth"),
      authError: searchParams.get("error"),
      reconnectStatus: searchParams.get("reconnect"),
      connectionStatus: searchParams.get("connection"),
      allowedParam: searchParams.get("allowed"),
      slotId: searchParams.get("slot_id"),
    });
  }, [key, searchParams, onChange]);

  return null;
}

function DashboardContent({
  routeParams,
  routeParamsKey,
}: {
  routeParams: DashboardRouteParams;
  routeParamsKey: string | null;
}) {
  const queryClient = useQueryClient();
  const [data, setData] = useState<StorageSummary | null>(null);
  const [cloudStorage, setCloudStorage] = useState<CloudStorageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState<{
    storage: boolean;
    quota: boolean;
    billing: boolean;
    cloudStatus: boolean;
  }>({
    storage: true,
    quota: true,
    billing: true,
    cloudStatus: true,
  });
  const [softTimeout, setSoftTimeout] = useState(false);
  const [hardError, setHardError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [quota, setQuota] = useState<QuotaInfo>(null);
  const [billingQuota, setBillingQuota] = useState<BillingQuota>(null);
  const [showReconnectModal, setShowReconnectModal] = useState(false);
  const [loadingTimeout, setLoadingTimeout] = useState(false);
  const [showOwnershipTransferModal, setShowOwnershipTransferModal] = useState(false);
  const [ownershipTransferToken, setOwnershipTransferToken] = useState<string | null>(null);
  const [transferEvents, setTransferEvents] = useState<any[]>([]);
  const [showTransferNotification, setShowTransferNotification] = useState(false);
  const [showAddCloudModal, setShowAddCloudModal] = useState(false);
  const router = useRouter();
  
  // Use React Query for cloudStatus (single source of truth)
  const { data: cloudStatus, isLoading: isCloudStatusLoading, refetch: refetchCloudStatus } = useCloudStatusQuery();

  // Helper: Clean ownership_conflict URL params and hash
  function cleanupOwnershipUrl({ removeError = true }) {
    if (typeof window === "undefined") return;
    
    const url = new URL(window.location.href);
    if (removeError) {
      url.searchParams.delete("error");
    }
    const cleanUrl = url.pathname + (url.searchParams.toString() ? `?${url.searchParams.toString()}` : "");
    window.history.replaceState({}, "", cleanUrl); // hash automatically removed
  }

  const withTimeout = async <T,>(promise: Promise<T>, ms: number): Promise<T> => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("timeout")), ms);
        }),
      ]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  };

  const fetchSummary = async (signal?: AbortSignal) => {
    let didSoftTimeout = false;
    try {
      setLoading(true);
      
      // Fetch all data in parallel instead of sequentially for better performance
      const [cloudRes, legacyRes] = await Promise.allSettled([
        // New unified endpoint (primary)
        authenticatedFetch("/cloud/storage-summary", { signal }),
        // Legacy endpoint for backwards compatibility (fallback)
        authenticatedFetch("/storage/summary", { signal })
      ]);
      
      // Process cloud storage summary (primary)
      if (cloudRes.status === 'fulfilled' && cloudRes.value.ok) {
        const cloudJson = await cloudRes.value.json();
        setCloudStorage(cloudJson);
      } else {
        console.warn("Failed to fetch cloud storage summary:", 
                    cloudRes.status === 'fulfilled' ? cloudRes.value.status : cloudRes.reason);
      }
      
      // Process legacy storage data (fallback)
      if (legacyRes.status === 'fulfilled' && legacyRes.value.ok) {
        const json = await legacyRes.value.json();
        setData(json);
      } else if (cloudRes.status === 'rejected') {
        // Only throw if both endpoints failed
        throw new Error(`Storage API failed: ${legacyRes.status === 'fulfilled' ? legacyRes.value.status : 'Network error'}`);
      }
      
      setHardError(null);
      setSoftTimeout(false);
      setLastUpdated(Date.now());
    } catch (e: any) {
      if (e.name === "AbortError") {
        setSoftTimeout(true);
        didSoftTimeout = true;
      } else {
        setHardError(e.message || "Error al cargar datos");
      }
    } finally {
      if (!didSoftTimeout) {
        setLoading(false);
      }
    }
  };

  const fetchQuota = async (signal?: AbortSignal) => {
    try {
      const res = await authenticatedFetch("/me/plan", { signal });
      if (res.ok) {
        const quotaData = await res.json();
        setQuota(quotaData);
      }
    } catch (e: any) {
      // Silently fail - quota display is optional
      if (e.name !== "AbortError") {
        console.error("Failed to fetch quota:", e);
      }
    }
  };

  const fetchBillingQuota = async (signal?: AbortSignal) => {
    try {
      const res = await authenticatedFetch("/billing/quota", { signal });
      if (res.ok) {
        const billingData = await res.json();
        setBillingQuota(billingData);
      }
    } catch (e: any) {
      if (e.name !== "AbortError") {
        console.error("Failed to fetch billing quota:", e);
      }
    }
  };

  const fetchCloudStatusData = async (forceRefresh = false) => {
    try {
      const data = await fetchCloudStatus(forceRefresh);
      // Note: cloudStatus now comes from React Query (useCloudStatusQuery)
      // No need to setCloudStatus here - refetchQueries handles it
    } catch (e) {
      console.error("Failed to fetch cloud status:", e);
    }
  };

  // NEW: Optimized parallel data loading with progress tracking and better error handling
  const loadAllDashboardData = async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      // Only clear hardError if it's not initial load (prevent flashing errors)
      if (!isInitialLoad) {
        setHardError(null);
      }
      
      // Reset progress tracking
      setLoadingProgress({
        storage: true,
        quota: true,
        billing: true,
        cloudStatus: true,
      });
      
      console.log("[DASHBOARD] Loading all data in parallel...");
      
      // Execute all API calls in parallel for maximum speed
      const [summaryResult, quotaResult, billingResult] = await Promise.allSettled([
        fetchSummaryParallel(signal).then((result) => {
          setLoadingProgress(prev => ({ ...prev, storage: false }));
          return result;
        }).catch((error) => {
          setLoadingProgress(prev => ({ ...prev, storage: false }));
          // During initial load, don't treat storage errors as fatal
          if (isInitialLoad) {
            console.warn("[DASHBOARD] Storage fetch failed during initial load (non-fatal):", error);
            return null;
          }
          throw error;
        }),
        fetchQuota(signal).then((result) => {
          setLoadingProgress(prev => ({ ...prev, quota: false }));
          return result;
        }).catch((error) => {
          setLoadingProgress(prev => ({ ...prev, quota: false }));
          console.warn("[DASHBOARD] Quota fetch failed (non-fatal):", error);
          return null;
        }),
        fetchBillingQuota(signal).then((result) => {
          setLoadingProgress(prev => ({ ...prev, billing: false }));
          return result;
        }).catch((error) => {
          setLoadingProgress(prev => ({ ...prev, billing: false }));
          console.warn("[DASHBOARD] Billing fetch failed (non-fatal):", error);
          return null;
        })
      ]);
      
      // Handle results - be more tolerant during initial load
      let hasAnySuccess = false;
      
      if (summaryResult.status === 'fulfilled') {
        hasAnySuccess = true;
      } else if (summaryResult.status === 'rejected' && !isInitialLoad) {
        console.error("Summary fetch failed:", summaryResult.reason);
      }
      
      if (quotaResult.status === 'fulfilled') {
        hasAnySuccess = true;
      } else {
        console.error("Quota fetch failed:", quotaResult.reason);
      }
      
      if (billingResult.status === 'fulfilled') {
        hasAnySuccess = true;
      } else {
        console.error("Billing fetch failed:", billingResult.reason);
      }
      
      // Only show error if ALL critical operations failed AND it's not initial load
      if (!hasAnySuccess && !isInitialLoad) {
        setHardError("Error de conexión. Algunos datos no pudieron cargarse.");
      } else {
        // Clear any previous errors if we have some success
        setHardError(null);
      }
      
      // Refetch cloud status (separate from main loading to avoid blocking)
      fetchCloudStatusData(false).finally(() => {
        setLoadingProgress(prev => ({ ...prev, cloudStatus: false }));
      });
      
      setLastUpdated(Date.now());
      console.log("[DASHBOARD] Parallel loading completed");
      
      // Mark initial load as complete
      setIsInitialLoad(false);
      
    } catch (e: any) {
      if (e.name !== "AbortError") {
        console.error("Dashboard loading error:", e);
        // Only show hard error if it's not initial load
        if (!isInitialLoad) {
          setHardError(e.message || "Error al cargar dashboard");
        }
      }
    } finally {
      setLoading(false);
      setIsInitialLoad(false);
    }
  };

  // Optimized summary fetch with better error handling
  const fetchSummaryParallel = async (signal?: AbortSignal) => {
    try {
      // Fetch all data in parallel instead of sequentially for better performance
      const [cloudRes, legacyRes] = await Promise.allSettled([
        // New unified endpoint (primary)
        authenticatedFetch("/cloud/storage-summary", { signal }),
        // Legacy endpoint for backwards compatibility (fallback)
        authenticatedFetch("/storage/summary", { signal })
      ]);
      
      // Process cloud storage summary (primary)
      if (cloudRes.status === 'fulfilled' && cloudRes.value.ok) {
        const cloudJson = await cloudRes.value.json();
        setCloudStorage(cloudJson);
        console.log("[DASHBOARD] Cloud storage summary loaded successfully");
      } else {
        console.warn("Failed to fetch cloud storage summary:", 
                    cloudRes.status === 'fulfilled' ? cloudRes.value.status : cloudRes.reason);
      }
      
      // Process legacy storage data (fallback)
      if (legacyRes.status === 'fulfilled' && legacyRes.value.ok) {
        const json = await legacyRes.value.json();
        setData(json);
        console.log("[DASHBOARD] Legacy storage data loaded successfully");
      } else if (cloudRes.status === 'rejected' || (cloudRes.status === 'fulfilled' && !cloudRes.value.ok)) {
        // Only throw if both endpoints failed
        const error = new Error(`Storage endpoints unavailable`);
        console.warn("[DASHBOARD] Both storage endpoints failed, but continuing...");
        // Don't throw during initial load - just log the warning
        if (!isInitialLoad) {
          throw error;
        }
      }
      
    } catch (e: any) {
      console.error("Storage summary fetch error:", e);
      throw e; // Re-throw to be handled by caller
    }
  };

  // Effect: Timeout de 8s para cloudStatus loading
  useEffect(() => {
    if (isCloudStatusLoading) {
      setLoadingTimeout(false);
      const timeoutId = setTimeout(() => {
        setLoadingTimeout(true);
      }, 8000);
      return () => clearTimeout(timeoutId);
    } else {
      setLoadingTimeout(false);
    }
  }, [isCloudStatusLoading]);

  useEffect(() => {
    // AbortController con timeout de 10s para evitar fetch colgados
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, 10000);

    // Verificar sesión de usuario
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.email) {
          setUserEmail(session.user.email);
          setUserId(session.user.id);
        }
      } catch (error) {
        console.error("Error checking session:", error);
      }
    };
    checkSession();

    // Verificar si el usuario acaba de autenticarse (usando search params)
    const { authStatus, authError, reconnectStatus, connectionStatus } = routeParams;
      
    if (authStatus === "success") {
      // CRITICAL: Refresh Supabase session after OAuth redirect
      // Ensures auth token is fresh before calling /me/* endpoints
      const refreshAndLoad = async () => {
        try {
          const { data, error } = await withTimeout(supabase.auth.refreshSession(), 10000);
          if (error) {
            console.error("[OAUTH] Failed to refresh session:", error);
            
            // FIX 3: Fallback seguro - signOut y redirect a login
            await supabase.auth.signOut();
            window.location.href = "/login?reason=session_expired&next=/app";
            return;
          }
          
          console.log("[OAUTH] Session refreshed successfully:", {
            user: data.session?.user?.email,
            expires_at: data.session?.expires_at,
          });
          
          setToast({
            message: "Cuenta de Google conectada exitosamente",
            type: "success",
          });
          
          // Clean URL after successful refresh
          window.history.replaceState({}, "", window.location.pathname);
          
          // Load dashboard data with fresh session using optimized parallel loading
          loadAllDashboardData(abortController.signal);
          
          // Refetch React Query cache to refresh sidebar (awaits completion)
          await queryClient.refetchQueries({ queryKey: CLOUD_STATUS_KEY });
        } catch (err) {
          console.error("[OAUTH] Exception refreshing session:", err);
          setToast({
            message: "Error inesperado. Recarga la página.",
            type: "error",
          });
        }
      };
      
      // Execute refresh after 500ms delay (allow cookies to settle)
      setTimeout(refreshAndLoad, 500);
    } else if (connectionStatus === "success") {
      // ONEDRIVE: Handle connection=success (from OneDrive OAuth callback)
      const handleOneDriveConnection = async () => {
        try {
          // Refresh Supabase session
          const { data, error } = await withTimeout(supabase.auth.refreshSession(), 10000);
          if (error) {
            console.error("[ONEDRIVE_CONNECTION] Failed to refresh session:", error);
            await supabase.auth.signOut();
            window.location.href = "/login?reason=session_expired&next=/app";
            return;
          }
          
          console.log("[ONEDRIVE_CONNECTION] Session refreshed successfully");
          
          // Clear backend cache to ensure fresh data
          try {
            await authenticatedFetch("/me/clear-cache", { method: "POST" });
            console.log("[ONEDRIVE_CONNECTION] Backend cache cleared successfully");
          } catch (cacheError) {
            console.warn("[ONEDRIVE_CONNECTION] Failed to clear backend cache (non-fatal):", cacheError);
          }
          
          setToast({
            message: "OneDrive conectado exitosamente",
            type: "success",
          });
          
          // Refetch cloudStatus FIRST (before URL change for reliability)
          await refetchCloudStatus();
          
          // Clean URL after successful refetch to avoid refresh loops
          router.replace("/app");
          
          // Refresh dashboard data with optimized parallel loading
          loadAllDashboardData(abortController.signal);
        } catch (err) {
          console.error("[ONEDRIVE_CONNECTION] Exception:", err);
          setToast({
            message: "Error inesperado. Recarga la página.",
            type: "error",
          });
        }
      };
      
      setTimeout(handleOneDriveConnection, 500);
    } else if (reconnectStatus === "success") {
      const slotId = routeParams.slotId;
      
      // Clear sessionStorage flag (set before OAuth redirect)
      const wasReconnecting = sessionStorage.getItem('isReconnecting') === 'true';
      sessionStorage.removeItem('isReconnecting');
      
      // Clear URL immediately
      window.history.replaceState({}, "", window.location.pathname);
      
      // CRITICAL: Refresh session before validating reconnection
      const validateReconnect = async () => {
        try {
          // Refresh Supabase session first (OAuth redirect may have stale token)
          const { data: sessionData, error: sessionError } = await withTimeout(
            supabase.auth.refreshSession(),
            10000
          );
          if (sessionError) {
            console.error("[RECONNECT] Failed to refresh session:", sessionError);
            
            // FIX 3: Fallback seguro - signOut y redirect a login
            await supabase.auth.signOut();
            window.location.href = "/login?reason=session_expired&next=/app";
            return;
          }
          
          console.log("[RECONNECT] Session refreshed successfully");
          
          // Clear backend cache to ensure fresh data
          try {
            await authenticatedFetch("/me/clear-cache", { method: "POST" });
            console.log("[RECONNECT] Backend cache cleared successfully");
          } catch (cacheError) {
            console.warn("[RECONNECT] Failed to clear backend cache (non-fatal):", cacheError);
          }
          
          // Fetch fresh cloud status to verify actual connection state
          const data = await fetchCloudStatus(true);  // forceRefresh = true
          
          // If slot_id provided, validate that specific slot is now connected
          if (slotId) {
            // Normalize both IDs to string for comparison (slot_log_id could be number or string)
            const normalizedSlotId = String(slotId);
            const reconnectedSlot = data.accounts.find(
              (acc: any) => String(acc.slot_log_id) === normalizedSlotId && acc.connection_status === "connected"
            );
            
            if (reconnectedSlot) {
              // Only show success toast if not suppressed by reconnection flow
              if (!wasReconnecting) {
                setToast({
                  message: `✅ Cuenta ${reconnectedSlot.provider_email} reconectada exitosamente`,
                  type: "success",
                });
              }
            } else {
              // Slot not found or not connected - show warning (always show warnings)
              setToast({
                message: "⚠️ La reconexión no se completó correctamente. Intenta nuevamente.",
                type: "warning",
              });
            }
          } else {
            // No slot_id provided, use generic success message
            if (!wasReconnecting) {
              setToast({
                message: "✅ Cuenta reconectada exitosamente",
                type: "success",
              });
            }
          }
          
          // Update all data with optimized parallel loading
          loadAllDashboardData(abortController.signal);
          
          // Refetch React Query cache to refresh sidebar AND local cloudStatus (awaits completion)
          await queryClient.refetchQueries({ queryKey: CLOUD_STATUS_KEY });
        } catch (error) {
          console.error("Failed to validate reconnect:", error);
          const message =
            (error as any)?.message === "timeout"
              ? "⚠️ La validación tardó demasiado. Recarga la página."
              : "⚠️ Error al validar reconexión. Actualiza la página.";
          setToast({
            message,
            type: "warning",
          });
        }
      };
      
      // Execute validation after 500ms delay (allow cookies to settle)
      setTimeout(validateReconnect, 500);
    } else if (authError === "ownership_conflict") {
      // OWNERSHIP TRANSFER FLOW: Check for transfer_token in hash
      if (typeof window !== "undefined") {
        try {
          const hashParams = new URLSearchParams(window.location.hash.slice(1));
          const transferToken = hashParams.get("transfer_token");
          
          if (transferToken) {
            // Show ownership transfer modal
            setOwnershipTransferToken(transferToken);
            setShowOwnershipTransferModal(true);
          } else {
            // No token found, show generic error toast
            setToast({
              message: "❌ Conflicto de propiedad: cuenta ya conectada a otro usuario",
              type: "error",
            });
            cleanupOwnershipUrl({ removeError: true });
          }
        } catch (err) {
          setToast({
            message: "❌ Error al procesar transferencia de cuenta",
            type: "error",
          });
          cleanupOwnershipUrl({ removeError: true });
        }
      }
      
      // Load data regardless with optimized parallel loading
      loadAllDashboardData(abortController.signal);
    } else if (authError === "account_already_linked") {
      // OWNERSHIP BLOCKED: OneDrive account already linked to another Cloud Aggregator user
      const maskedEmail = routeParams.masked_email || "desconocida";
      
      setToast({
        message: `❌ Esta cuenta de OneDrive (${maskedEmail}) ya está vinculada a otro usuario de Cloud Aggregator. Si necesitas recuperarla, contacta soporte.`,
        type: "error",
      });
      
      // Clean URL and load dashboard data with optimized parallel loading
      window.history.replaceState({}, "", window.location.pathname);
      loadAllDashboardData(abortController.signal);
    } else if (authError) {
      // Handle errors (both Google and OneDrive)
      let errorMessage = `Error de autenticación: ${authError}`;
      
      // Dropbox-specific error messages
      if (authError === "dropbox_already_connected") {
        errorMessage = "⚠️ Esta cuenta de Dropbox ya está conectada. Ve a 'Clouds' para administrarla.";
      } else if (authError === "dropbox_connect_failed") {
        errorMessage = "❌ Error al conectar Dropbox. Por favor, intenta nuevamente.";
      } else if (authError === "dropbox_token_exchange_failed") {
        errorMessage = "❌ Error al obtener tokens de Dropbox. Intenta más tarde.";
      } else if (authError === "dropbox_account_owned_by_other") {
        errorMessage = "❌ Esta cuenta de Dropbox ya está vinculada a otro usuario de Cloud Aggregator.";
      } else if (authError.startsWith("dropbox")) {
        errorMessage = `❌ Error de Dropbox: ${authError.replace("dropbox_", "")}`;
      }
      // OneDrive-specific error messages
      else if (authError === "onedrive_invalid_grant") {
        errorMessage = "⚠️ Código de OneDrive expirado. Por favor, intenta conectar nuevamente.";
      } else if (authError === "onedrive_token_exchange_failed") {
        errorMessage = "❌ Error al conectar OneDrive. Intenta más tarde.";
      } else if (authError.startsWith("onedrive")) {
        errorMessage = `❌ Error de OneDrive: ${authError.replace("onedrive_", "")}`;
      }
      
      setToast({
        message: errorMessage,
        type: "error",
      });
      window.history.replaceState({}, "", window.location.pathname);
      loadAllDashboardData(abortController.signal);
      fetchBillingQuota(abortController.signal);
      fetchCloudStatusData();
    } else {
      fetchSummary(abortController.signal);
      fetchQuota(abortController.signal);
      fetchBillingQuota(abortController.signal);
      fetchCloudStatusData();
    }

    // Cleanup: clear timeout and abort requests on unmount
    return () => {
      clearTimeout(timeoutId);
      abortController.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeParamsKey]);

  // OWNERSHIP TRANSFER NOTIFICATIONS: Check for unacknowledged transfer events
  useEffect(() => {
    const fetchTransferEvents = async () => {
      try {
        const res = await authenticatedFetch("/me/transfer-events?unacknowledged_only=true");
        if (res.ok) {
          const data = await res.json();
          const events = data.events || [];
          
          if (events.length > 0) {
            setTransferEvents(events);
            setShowTransferNotification(true);
          }
        }
      } catch (err) {
        console.error("Failed to fetch transfer events:", err);
        // Silent fail - notification is optional
      }
    };
    
    // Only fetch if user is authenticated (userId is set)
    if (userId) {
      fetchTransferEvents();
    }
  }, [userId]);

  const handleAcknowledgeTransferEvents = async () => {
    try {
      // Acknowledge all events in batch
      const promises = transferEvents.map(event =>
        authenticatedFetch(`/me/transfer-events/${event.id}/acknowledge`, {
          method: "PATCH"
        })
      );
      
      await Promise.all(promises);
      
      // Hide notification
      setShowTransferNotification(false);
      setTransferEvents([]);
    } catch (err) {
      console.error("Failed to acknowledge transfer events:", err);
      // Still hide notification on error (best effort)
      setShowTransferNotification(false);
    }
  };

  const handleConnectGoogle = async () => {
    if (!userId) {
      setHardError("No hay sesión de usuario activa. Recarga la página.");
      return;
    }
    
    try {
      // CRITICAL FIX: window.location.href NO envía Authorization headers → 401
      // SOLUCIÓN: Fetch autenticado a /auth/google/login-url → recibe URL → redirect manual
      // SEGURIDAD: user_id derivado de JWT en backend, NO en querystring
      const { fetchGoogleLoginUrl } = await import("@/lib/api");
      const { url } = await fetchGoogleLoginUrl({ mode: "connect" });
      window.location.href = url;
    } catch (err) {
      setHardError(`Error al obtener URL de Google: ${err}`);
      console.error("handleConnectGoogle error:", err);
    }
  };

  const handleConnectOneDrive = async () => {
    if (!userId) {
      setHardError("No hay sesión de usuario activa. Recarga la página.");
      return;
    }
    
    try {
      // CRITICAL FIX: window.location.href NO envía Authorization headers → 401
      // SOLUCIÓN: Fetch autenticado a /auth/onedrive/login-url → recibe URL → redirect manual
      // SEGURIDAD: user_id derivado de JWT en backend, NO en querystring
      const { fetchOneDriveLoginUrl } = await import("@/lib/api");
      const { url } = await fetchOneDriveLoginUrl({ mode: "connect" });
      window.location.href = url;
    } catch (err: unknown) {
      const e = err as any;
      const msg =
        e?.body?.detail ||
        e?.body?.error ||
        e?.message ||
        "Error desconocido";
      setHardError(`Error al conectar OneDrive: ${msg}`);
      console.error("handleConnectOneDrive error:", err);
    }
  };

  const handleDisconnectAccount = async (accountId: number, accountEmail: string) => {
    if (!confirm(`¿Desconectar la cuenta ${accountEmail}? Esta acción no se puede deshacer.`)) {
      return;
    }

    setLoading(true);
    try {
      const res = await authenticatedFetch("/auth/revoke-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: accountId }),
      });

      if (res.ok) {
        setToast({
          message: `Cuenta ${accountEmail} desconectada exitosamente`,
          type: "success",
        });
        // Recargar datos
        fetchSummary();
        fetchQuota();
        fetchBillingQuota();
      } else {
        const errorData = await res.json();
        throw new Error(errorData.detail || "Error al desconectar cuenta");
      }
    } catch (err: any) {
      setToast({
        message: err.message || "Error al desconectar cuenta",
        type: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleOwnershipTransferSuccess = async () => {
    // Close modal
    setShowOwnershipTransferModal(false);
    setOwnershipTransferToken(null);
    
    // Clean URL (remove error param and hash)
    cleanupOwnershipUrl({ removeError: true });
    
    // Show success toast
    setToast({
      message: "✅ Cuenta transferida exitosamente",
      type: "success",
    });
    
    // Refresh all data (without signal - not part of initial load)
    fetchSummary();
    fetchQuota();
    fetchBillingQuota();
    await refetchCloudStatus();
  };

  const handleOwnershipTransferClose = () => {
    setShowOwnershipTransferModal(false);
    setOwnershipTransferToken(null);
    
    // Clean URL when user cancels
    cleanupOwnershipUrl({ removeError: true });
  };

  const handleLogout = async () => {
    // CRITICAL: Clear UI state BEFORE sign-out to prevent visual glitches
    setLoading(false);
    setHardError(null);
    setSoftTimeout(false);
    setToast(null);

    try {
      // Sign out with timeout to prevent hanging
      const signOutPromise = supabase.auth.signOut();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("SignOut timeout")), 3000)
      );
      
      await Promise.race([signOutPromise, timeoutPromise]);
    } catch (error) {
      // Even if signOut fails, force navigation (handles network errors)
      console.error("[LOGOUT] SignOut error (forcing navigation):", error);
    }
    
    // ALWAYS navigate, regardless of signOut success
    // Use replace() to prevent back button returning to authenticated view
    router.replace("/");
    
    // Force refresh to clear any cached authenticated state
    router.refresh();
    
    // FALLBACK: If still on /app after 500ms, force navigation with window.location
    // This handles edge cases where Next.js router fails (hydration issues, etc.)
    setTimeout(() => {
      if (window.location.pathname.startsWith("/app") || 
          window.location.pathname.startsWith("/drive") ||
          window.location.pathname.startsWith("/onedrive")) {
        console.warn("[LOGOUT] Router failed, using window.location fallback");
        window.location.assign("/");
      }
    }, 500);
  };

  const getRelativeTime = (timestamp: number): string => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return "hace un momento";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `hace ${minutes} min`;
    const hours = Math.floor(minutes / 66);
    if (hours < 24) return `hace ${hours}h`;
    return `hace ${Math.floor(hours / 24)}d`;
  };

  // Filtrar y ordenar cuentas
  const filteredAndSortedAccounts = data?.accounts
    .filter((acc) => acc.email.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      const diff = a.usage_percent - b.usage_percent;
      return sortOrder === "desc" ? -diff : diff;
    }) || [];

  // Cuentas conectadas (multi-provider)
  const connectedAccounts = (cloudStatus?.accounts ?? []).filter(a => a.connection_status === "connected");

  return (
    <main className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center p-6">
      {/* Toast Notifications */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {/* Transfer Events Notification */}
      {showTransferNotification && transferEvents.length > 0 && (
        <div className="fixed top-6 right-6 z-50 bg-gradient-to-br from-amber-500 to-orange-600 text-white p-4 rounded-lg shadow-2xl max-w-md border border-amber-400/50 animate-slide-in-right">
          <div className="flex items-start gap-3">
            <div className="text-2xl">⚠️</div>
            <div className="flex-1">
              <h3 className="font-bold text-lg mb-1">Cuenta Transferida</h3>
              {transferEvents.length === 1 ? (
                <p className="text-sm leading-relaxed">
                  Tu cuenta <strong>{transferEvents[0].account_email}</strong> de {transferEvents[0].provider === 'onedrive' ? 'OneDrive' : 'Google Drive'} fue transferida a otro usuario de Cloud Aggregator. 
                  Ya no tenés acceso a esta cuenta en tu panel.
                </p>
              ) : (
                <div className="text-sm leading-relaxed">
                  <p className="mb-2">Las siguientes cuentas fueron transferidas a otros usuarios:</p>
                  <ul className="list-disc list-inside space-y-1 text-xs">
                    {transferEvents.map((event, idx) => (
                      <li key={idx}>
                        {event.account_email} ({event.provider === 'onedrive' ? 'OneDrive' : 'Google Drive'})
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <button
                onClick={handleAcknowledgeTransferEvents}
                className="mt-3 w-full bg-white text-amber-700 font-semibold py-2 rounded-md hover:bg-amber-50 transition text-sm"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="w-full max-w-6xl space-y-6">
        {/* Loading state mejorado con animación atractiva y sin errores prematuros */}
        {(loading || softTimeout) && !cloudStatus && (
          <div className="min-h-screen flex items-center justify-center">
            <div className="max-w-md w-full mx-auto">
              {/* Animación principal del logo */}
              <div className="flex justify-center mb-8">
                <div className="relative">
                  <div className="w-16 h-16 border-4 border-blue-200 rounded-full animate-pulse"></div>
                  <div className="absolute inset-0 w-16 h-16 border-4 border-transparent border-t-blue-500 rounded-full animate-spin"></div>
                  <div className="absolute inset-2 w-12 h-12 border-4 border-transparent border-t-emerald-500 rounded-full animate-spin animation-delay-150"></div>
                  <div className="absolute inset-4 w-8 h-8 border-4 border-transparent border-t-purple-500 rounded-full animate-spin animation-delay-300"></div>
                </div>
              </div>
              
              {/* Título con animación */}
              <div className="text-center mb-8">
                <h2 className="text-2xl font-bold text-white mb-2 animate-fade-in">Cargando Dashboard</h2>
                <p className="text-slate-400 animate-fade-in animation-delay-200">Conectando con tus nubes...</p>
              </div>
              
              {/* Progress indicators mejorados */}
              <div className="bg-slate-800/50 rounded-lg p-6 border border-slate-700/50 backdrop-blur-sm">
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      {loadingProgress.storage ? (
                        <div className="w-5 h-5 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin"></div>
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-gradient-to-r from-green-400 to-emerald-500 flex items-center justify-center animate-scale-in">
                          <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        </div>
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-sm font-medium ${
                          loadingProgress.storage ? 'text-blue-400' : 'text-green-400'
                        }`}>
                          {loadingProgress.storage ? 'Cargando almacenamiento...' : 'Almacenamiento cargado'}
                        </span>
                      </div>
                      <div className="w-full bg-slate-700 rounded-full h-1.5">
                        <div className={`h-1.5 rounded-full transition-all duration-500 ${
                          loadingProgress.storage ? 'bg-blue-500 w-2/3 animate-pulse' : 'bg-green-500 w-full'
                        }`}></div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      {loadingProgress.quota ? (
                        <div className="w-5 h-5 border-2 border-purple-300 border-t-purple-600 rounded-full animate-spin animation-delay-150"></div>
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-gradient-to-r from-green-400 to-emerald-500 flex items-center justify-center animate-scale-in">
                          <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        </div>
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-sm font-medium ${
                          loadingProgress.quota ? 'text-purple-400' : 'text-green-400'
                        }`}>
                          {loadingProgress.quota ? 'Cargando plan...' : 'Plan cargado'}
                        </span>
                      </div>
                      <div className="w-full bg-slate-700 rounded-full h-1.5">
                        <div className={`h-1.5 rounded-full transition-all duration-500 ${
                          loadingProgress.quota ? 'bg-purple-500 w-1/2 animate-pulse' : 'bg-green-500 w-full'
                        }`}></div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      {loadingProgress.cloudStatus ? (
                        <div className="w-5 h-5 border-2 border-emerald-300 border-t-emerald-600 rounded-full animate-spin animation-delay-300"></div>
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-gradient-to-r from-green-400 to-emerald-500 flex items-center justify-center animate-scale-in">
                          <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        </div>
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-sm font-medium ${
                          loadingProgress.cloudStatus ? 'text-emerald-400' : 'text-green-400'
                        }`}>
                          {loadingProgress.cloudStatus ? 'Verificando conexiones...' : 'Conexiones verificadas'}
                        </span>
                      </div>
                      <div className="w-full bg-slate-700 rounded-full h-1.5">
                        <div className={`h-1.5 rounded-full transition-all duration-500 ${
                          loadingProgress.cloudStatus ? 'bg-emerald-500 w-3/4 animate-pulse' : 'bg-green-500 w-full'
                        }`}></div>
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Mensaje motivacional */}
                <div className="mt-6 text-center">
                  <p className="text-xs text-slate-500 animate-fade-in animation-delay-500">
                    💡 Tip: Usa el buscador para encontrar archivos rápidamente
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Fallback UX: Si cloudStatus tarda > 8s, mostrar botón reintentar */}
        {isCloudStatusLoading && loadingTimeout && (
          <div className="bg-amber-500/20 border border-amber-500 rounded-lg p-4 text-center">
            <p className="text-amber-200 text-sm mb-3">
              ⏳ Cargando tus nubes está tardando más de lo normal...
            </p>
            <button
              onClick={() => {
                console.log("[REINTENTAR] Manual refetch of cloudStatus");
                refetchCloudStatus();
              }}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-semibold transition"
            >
              🔄 Reintentar
            </button>
          </div>
        )}

        {/* Solo mostrar errores después de la carga inicial */}
        {hardError && !loading && !isInitialLoad && (
          <div className="bg-red-500/20 border border-red-500 rounded-lg p-4 text-red-100">
            <p className="font-semibold">Error al cargar datos</p>
            <p className="text-sm mt-1">{hardError}</p>
            <button
              onClick={() => {
                setHardError(null);
                setSoftTimeout(false);
                loadAllDashboardData();
              }}
              className="mt-3 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold transition"
            >
              Reintentar
            </button>
          </div>
        )}

        {!loading && !hardError && data && (
          <>
            {/* Your Connected Clouds Cards - Grouped by Provider */}
            {cloudStatus && cloudStatus.accounts && cloudStatus.accounts.length > 0 && (() => {
              // Group accounts by provider
              const groupedByProvider = cloudStatus.accounts.reduce((acc: any, account: any) => {
                if (!acc[account.provider]) {
                  acc[account.provider] = [];
                }
                acc[account.provider].push(account);
                return acc;
              }, {});

              return (
                <section className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-bold text-white">Your Connected Clouds</h2>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setShowAddCloudModal(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Connect New Cloud
                      </button>
                      <button className="p-2 hover:bg-slate-800 rounded-lg transition-colors">
                        <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {Object.entries(groupedByProvider).map(([provider, accounts]: [string, any]) => {
                      // Aggregate data for this provider
                      const connectedAccounts = accounts.filter((a: any) => a.connection_status === "connected");
                      const needsReconnectAccounts = accounts.filter((a: any) => a.can_reconnect);
                      const hasAnyConnected = connectedAccounts.length > 0;
                      const allNeedReconnect = accounts.length === needsReconnectAccounts.length;
                      
                      // Sum storage across all accounts of this provider
                      const providerStorageAccounts = cloudStorage?.accounts.filter((s: any) => 
                        accounts.some((a: any) => a.provider_email === s.email)
                      ) || [];
                      
                      const totalStorage = providerStorageAccounts.reduce((sum, s) => sum + (s.total_bytes || 0), 0);
                      const usedStorage = providerStorageAccounts.reduce((sum, s) => sum + (s.used_bytes || 0), 0);
                      const percentUsed = totalStorage > 0 ? (usedStorage / totalStorage) * 100 : 0;
                      
                      const getProviderIcon = (provider: string) => {
                        switch (provider) {
                          case "google_drive":
                            return (
                              <svg className="w-10 h-10" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
                                <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
                                <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/>
                                <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/>
                                <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
                                <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
                                <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
                              </svg>
                            );
                          case "onedrive":
                            return (
                              <svg className="w-10 h-10" viewBox="35.98 139.2 648.03 430.85" xmlns="http://www.w3.org/2000/svg">
                                <defs>
                                  <radialGradient id="r0-dashboard" cx="0" cy="0" r="1" gradientTransform="matrix(130.865 156.805 -260.09 217.064 48.67 228.766)">
                                    <stop offset="0" stopColor="#4895ff"/>
                                    <stop offset="0.695" stopColor="#0934b3"/>
                                  </radialGradient>
                                  <radialGradient id="r1-dashboard" cx="0" cy="0" r="1" gradientTransform="matrix(-575.29 663.594 -491.728 -426.294 596.957 -6.38)">
                                    <stop offset="0.165" stopColor="#23c0ff"/>
                                    <stop offset="0.534" stopColor="#1c91ff"/>
                                  </radialGradient>
                                  <linearGradient id="l0-dashboard" x1="29.9997" y1="37.9823" x2="29.9997" y2="18.3982" gradientTransform="scale(15)">
                                    <stop offset="0" stopColor="#0086ff"/>
                                    <stop offset="0.49" stopColor="#00bbff"/>
                                  </linearGradient>
                                </defs>
                                <path fill="url(#r0-dashboard)" d="M215.078 205.09c-99.066 0-173.12 81.094-178.695 171.437 3.453 19.465 14.793 57.902 32.559 55.93 22.203-2.47 78.125 0 125.824-86.352 34.844-63.078 106.52-141.02 20.312-141.015Z"/>
                                <path fill="url(#r1-dashboard)" d="M192.172 238.813c-33.3 52.722-78.13 128.272-93.258 152.046-17.985 28.262-65.61 16.254-61.664-24.25-.387 3.285-.688 6.601-.895 9.937-6.511 105.387 77.044 192.907 181.021 192.907 114.594 0 387.895-142.782 360.235-285.844-29.152-84.09-111.086-144.406-203.945-144.406-92.856 0-152.368 53.496-181.493 99.61Z"/>
                                <path fill="url(#l0-dashboard)" d="M215.7 569.496s273.62.539 320.034.539c84.226 0 148.266-68.762 148.266-148.004 0-80.242-65.329-148.586-148.266-148.586-82.942 0-130.707 62.047-166.582 129.781-42.035 79.367-95.664 166.32-153.453 167.27Z"/>
                              </svg>
                            );
                          case "dropbox":
                            return (
                              <svg className="w-10 h-10" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                                <path fill="#0061ff" d="M8 3L0 8.5l8 5.5 8-5.5L8 3zm16 0l-8 5.5 8 5.5 8-5.5L24 3zM0 19.5l8 5.5 8-5.5-8-5.5-8 5.5zm24 0l-8 5.5 8 5.5 8-5.5-8-5.5z"/>
                                <path fill="#0061ff" d="M8 27l8-5.5L24 27l-8 5z"/>
                              </svg>
                            );
                          default:
                            return <div className="w-10 h-10 bg-slate-600 rounded-full" />;
                        }
                      };

                      const getProviderName = (provider: string) => {
                        switch (provider) {
                          case "google_drive": return "Google Drive";
                          case "onedrive": return "OneDrive";
                          case "dropbox": return "Dropbox";
                          default: return provider;
                        }
                      };

                      const formatBytes = (bytes: number | null) => {
                        if (bytes === null || bytes === 0) return "0 GB";
                        const tb = bytes / (1024 ** 4);
                        const gb = bytes / (1024 ** 3);
                        
                        if (tb >= 1) {
                          return `${tb.toFixed(2)} TB`;
                        } else if (gb >= 1) {
                          return `${gb.toFixed(2)} TB`;
                        } else {
                          return `${(bytes / (1024 ** 2)).toFixed(0)} MB`;
                        }
                      };

                      return (
                        <div
                          key={provider}
                          className="bg-slate-800 rounded-xl p-6 border border-slate-700 hover:border-slate-600 transition-colors"
                        >
                          <div className="flex items-center gap-3 mb-4">
                            {getProviderIcon(provider)}
                            <div>
                              <h3 className="text-lg font-semibold">{getProviderName(provider)}</h3>
                            </div>
                          </div>

                          <div className="mb-3">
                            {allNeedReconnect ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-yellow-900/30 text-yellow-400 text-xs rounded-full border border-yellow-500/30">
                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                                Needs reconnect
                              </span>
                            ) : hasAnyConnected ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-900/30 text-emerald-400 text-xs rounded-full border border-emerald-500/30">
                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                </svg>
                                Connected
                              </span>
                            ) : null}
                          </div>

                          {totalStorage > 0 ? (
                            <div className="space-y-3">
                              <div className="flex items-baseline justify-between">
                                <span className="text-xs text-slate-400">Total Storage:</span>
                                <span className="text-lg font-semibold">{formatBytes(totalStorage)}</span>
                              </div>
                              <div className="flex items-baseline justify-between mb-2">
                                <span className="text-xs text-slate-400">
                                  {formatBytes(usedStorage)} used ({percentUsed.toFixed(1)}%)
                                </span>
                              </div>
                              <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-500"
                                  style={{ width: `${Math.min(percentUsed, 100)}%` }}
                                />
                              </div>
                            </div>
                          ) : (
                            <div className="text-xs text-slate-500 italic">Storage unavailable</div>
                          )}

                          <div className="mt-4">
                            {allNeedReconnect ? (
                              <button
                                onClick={() => setShowReconnectModal(true)}
                                className="w-full px-3 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg text-sm font-medium transition-colors"
                              >
                                Reconnect
                              </button>
                            ) : (
                              <button
                                onClick={() => {
                                  router.push(`/clouds/${provider}`);
                                }}
                                className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
                              >
                                Manage
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })()}
          </>
        )}
      </div>

      {/* Modal de slots históricos */}
      <ReconnectSlotsModal
        isOpen={showReconnectModal}
        onClose={() => setShowReconnectModal(false)}
      />

      {/* Modal de agregar nube */}
      <AddCloudModal
        open={showAddCloudModal}
        onClose={() => setShowAddCloudModal(false)}
      />

      {/* Modal de transferencia de propiedad */}
      {ownershipTransferToken && (
        <OwnershipTransferModal
          isOpen={showOwnershipTransferModal}
          transferToken={ownershipTransferToken}
          onClose={handleOwnershipTransferClose}
          onSuccess={handleOwnershipTransferSuccess}
        />
      )}
    </main>
  );
}

export default function AppDashboard() {
  const [routeParamsKey, setRouteParamsKey] = useState<string | null>("init");
  const [routeParams, setRouteParams] = useState<DashboardRouteParams>({
    authStatus: null,
    authError: null,
    reconnectStatus: null,
    connectionStatus: null,
    allowedParam: null,
    slotId: null,
  });

  const handleParamsChange = useCallback(
    (key: string, params: DashboardRouteParams) => {
      setRouteParamsKey(key);
      setRouteParams(params);
    },
    []
  );

  return (
    <>
      <Suspense
        fallback={
          <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-500" />
        }
      >
        <SearchParamsBridge onChange={handleParamsChange} />
      </Suspense>
      <DashboardContent routeParams={routeParams} routeParamsKey={routeParamsKey} />
    </>
  );
}
