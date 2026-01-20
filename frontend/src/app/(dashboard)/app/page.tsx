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
import DashboardOverview from "@/components/dashboard/DashboardOverview";

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

// Feature flag: cambiar a true para habilitar DashboardOverview
const ENABLE_OVERVIEW = false;

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
      
      // Fetch cloud storage summary (new unified endpoint)
      const cloudRes = await authenticatedFetch("/cloud/storage-summary", { signal });
      if (cloudRes.ok) {
        const cloudJson = await cloudRes.json();
        setCloudStorage(cloudJson);
      } else {
        console.warn("Failed to fetch cloud storage summary:", cloudRes.status);
      }
      
      // Keep legacy endpoint for backwards compatibility (if needed)
      const res = await authenticatedFetch("/storage/summary", { signal });
      if (!res.ok) {
        throw new Error(`Error API: ${res.status}`);
      }
      const json = await res.json();
      setData(json);
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
      // TEMPORAL DEBUG: Verificar que needs_reconnect baja después de reconectar
      console.log("[DEBUG - fetchCloudStatus]", {
        connected: data.summary.connected,
        needs_reconnect: data.summary.needs_reconnect,
        disconnected: data.summary.disconnected,
        forceRefresh,
        accounts: data.accounts.map(a => ({
          email: a.provider_email,
          status: a.connection_status,
          reason: a.reason,
        }))
      });
      // Note: cloudStatus now comes from React Query (useCloudStatusQuery)
      // No need to setCloudStatus here - refetchQueries handles it
    } catch (e) {
      console.error("Failed to fetch cloud status:", e);
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
          
          // Load dashboard data with fresh session
          fetchSummary(abortController.signal);
          fetchQuota(abortController.signal);
          fetchBillingQuota(abortController.signal);
          fetchCloudStatusData();
          
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
          
          setToast({
            message: "OneDrive conectado exitosamente",
            type: "success",
          });
          
          // Refetch cloudStatus FIRST (before URL change for reliability)
          await refetchCloudStatus();
          
          // Clean URL after successful refetch to avoid refresh loops
          router.replace("/app");
          
          // Refresh dashboard data
          fetchSummary(abortController.signal);
          fetchQuota(abortController.signal);
          fetchBillingQuota(abortController.signal);
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
          
          // Update all data
          fetchSummary(abortController.signal);
          fetchQuota(abortController.signal);
          fetchBillingQuota(abortController.signal);
          
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
      
      // Load data regardless
      fetchSummary(abortController.signal);
      fetchQuota(abortController.signal);
      fetchBillingQuota(abortController.signal);
      fetchCloudStatusData();
    } else if (authError === "account_already_linked") {
      // OWNERSHIP BLOCKED: OneDrive account already linked to another Cloud Aggregator user
      const maskedEmail = routeParams.masked_email || "desconocida";
      
      setToast({
        message: `❌ Esta cuenta de OneDrive (${maskedEmail}) ya está vinculada a otro usuario de Cloud Aggregator. Si necesitas recuperarla, contacta soporte.`,
        type: "error",
      });
      
      // Clean URL and load dashboard data
      window.history.replaceState({}, "", window.location.pathname);
      fetchSummary(abortController.signal);
      fetchQuota(abortController.signal);
      fetchBillingQuota(abortController.signal);
      fetchCloudStatusData();
    } else if (authError) {
      // Handle errors (both Google and OneDrive)
      let errorMessage = `Error de autenticación: ${authError}`;
      
      // OneDrive-specific error messages
      if (authError === "onedrive_invalid_grant") {
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
      fetchSummary(abortController.signal);
      fetchQuota(abortController.signal);
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
    const hours = Math.floor(minutes / 60);
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

  // ========== ROUTING HANDLERS FOR OVERVIEW ==========
  // Resolver IDs de cuentas para navegación
  const firstGoogleAccount = connectedAccounts.find(acc => acc.provider === "google_drive");
  const firstOneDriveAccount = connectedAccounts.find(acc => acc.provider === "onedrive");

  const handleOpenGoogleExplorer = () => {
    if (firstGoogleAccount?.provider_account_uuid) {
      router.push(`/drive/${firstGoogleAccount.provider_account_uuid}`);
    }
  };

  const handleOpenOneDriveExplorer = () => {
    if (firstOneDriveAccount?.provider_account_uuid) {
      router.push(`/onedrive/${firstOneDriveAccount.provider_account_uuid}`);
    }
  };

  const handleOpenTransferExplorer = () => {
    // Priorizar Google Drive si existe, sino OneDrive
    if (firstGoogleAccount?.provider_account_uuid) {
      router.push(`/drive/${firstGoogleAccount.provider_account_uuid}`);
    } else if (firstOneDriveAccount?.provider_account_uuid) {
      router.push(`/onedrive/${firstOneDriveAccount.provider_account_uuid}`);
    }
  };

  const handleViewAllAccounts = () => {
    router.push("/app");
  };

  // ========== VISTAS: OVERVIEW vs LEGACY ==========
  // Vista nueva: DashboardOverview
  const overviewView = (
    <DashboardOverview
      cloudStatus={cloudStatus}
      cloudStorage={cloudStorage}
      isLoading={loading || isCloudStatusLoading}
      error={hardError}
      onConnectGoogle={handleConnectGoogle}
      onConnectOneDrive={handleConnectOneDrive}
      onOpenSlotsModal={() => setShowReconnectModal(true)}
      onOpenGoogleExplorer={handleOpenGoogleExplorer}
      onOpenOneDriveExplorer={handleOpenOneDriveExplorer}
      onOpenTransferExplorer={handleOpenTransferExplorer}
      onViewAllAccounts={handleViewAllAccounts}
      userEmail={userEmail}
    />
  );

  // Vista existente: tabla de cuentas (legacy) - definida inline en JSX
  
  // Selección de vista según feature flag
  const mainView = ENABLE_OVERVIEW ? overviewView : null;

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
        {ENABLE_OVERVIEW ? (
          mainView
        ) : (
          // Vista existente: tabla de cuentas
          <>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowReconnectModal(true)}
                className="rounded-lg transition px-4 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700"
              >
                📊 Tus Nubes
              </button>
              
              <button
                onClick={handleConnectGoogle}
                className="rounded-lg transition px-4 py-2 text-sm font-semibold bg-emerald-500 hover:bg-emerald-600"
                title="Conectar una nueva cuenta de Google Drive"
              >
                Conectar Google Drive
              </button>
              
              <button
                onClick={handleConnectOneDrive}
                className="rounded-lg transition px-4 py-2 text-sm font-semibold bg-blue-500 hover:bg-blue-600"
                title="Conectar una nueva cuenta de OneDrive"
              >
                Conectar OneDrive
              </button>
              
              <button
                onClick={handleLogout}
                className="rounded-lg bg-slate-700 hover:bg-slate-600 transition px-4 py-2 text-sm font-semibold"
              >
                Salir
              </button>
            </div>

            {/* Loading state: solo bloquear UI si cloudStatus no existe o si loading summary sin data */}
            {(loading || softTimeout) && !cloudStatus && (
              <DashboardLoadingState />
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

        {hardError && !loading && (
          <div className="bg-red-500/20 border border-red-500 rounded-lg p-4 text-red-100">
            <p className="font-semibold">Error al cargar datos</p>
            <p className="text-sm mt-1">{hardError}</p>
            <button
              onClick={() => {
                setHardError(null);
                setSoftTimeout(false);
                setLoading(true);
                fetchSummary();
                fetchQuota();
                fetchBillingQuota();
                fetchCloudStatusData();
              }}
              className="mt-3 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold transition"
            >
              Reintentar
            </button>
          </div>
        )}

        {!loading && !hardError && data && (
          <>
            {/* Plan & Límites de Billing */}
            {billingQuota && (
              <section className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-6 shadow-lg border border-slate-700">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <h2 className="text-xl font-bold text-white">Plan & Límites</h2>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${
                        billingQuota.plan === "free"
                          ? "bg-slate-600 text-slate-200"
                          : billingQuota.plan === "plus"
                          ? "bg-blue-600 text-white"
                          : "bg-purple-600 text-white"
                      }`}
                    >
                      {billingQuota.plan}
                    </span>
                  </div>
                  {(billingQuota.plan === "free" || billingQuota.plan === "plus") && (
                    <a
                      href="/pricing"
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold transition"
                    >
                      {billingQuota.plan === "free" ? "⬆️ Actualizar plan" : "🚀 Actualizar a PRO"}
                    </a>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Transferencia */}
                  <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-semibold text-slate-300">
                        📡 Transferencia {billingQuota.transfer.is_lifetime ? "(Lifetime)" : "(Mes)"}
                      </h3>
                      {billingQuota.transfer.limit_gb !== null && (
                        <span className="text-xs text-slate-400">
                          {billingQuota.transfer.used_gb.toFixed(2)} / {billingQuota.transfer.limit_gb} GB
                        </span>
                      )}
                    </div>
                    {billingQuota.transfer.limit_bytes !== null && billingQuota.transfer.limit_bytes > 0 ? (
                      <>
                        <ProgressBar
                          current={billingQuota.transfer.used_bytes}
                          total={billingQuota.transfer.limit_bytes}
                          height="sm"
                        />
                        <p className="text-xs text-slate-400 mt-2">
                          {Math.max(0, 
                            (billingQuota.transfer.limit_bytes - billingQuota.transfer.used_bytes) /
                            (1024 ** 3)
                          ).toFixed(2)}{" "}
                          GB restantes
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-emerald-400 font-semibold">Ilimitada ✨</p>
                    )}
                  </div>

                  {/* Máximo por archivo */}
                  <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
                    <h3 className="text-sm font-semibold text-slate-300 mb-2">📄 Máx por archivo</h3>
                    <p className="text-2xl font-bold text-white">
                      {billingQuota.max_file_gb.toFixed(1)} GB
                    </p>
                    {billingQuota.plan !== "pro" ? (
                      <a
                        href="/pricing"
                        className="text-xs text-blue-400 hover:text-blue-300 mt-2 inline-block underline cursor-pointer transition"
                      >
                        {billingQuota.plan === "free" && "Actualiza a PLUS para 10 GB →"}
                        {billingQuota.plan === "plus" && "Actualiza a PRO para 50 GB →"}
                      </a>
                    ) : (
                      <p className="text-xs text-slate-400 mt-2">Límite máximo 🎉</p>
                    )}
                  </div>
                </div>
              </section>
            )}

            {/* Tarjetas de resumen con barra de progreso global */}
            <section className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-slate-800 rounded-xl p-5 shadow-lg border border-slate-700">
                  <h2 className="text-xs text-slate-400 uppercase tracking-wide font-semibold mb-1">
                    Total Espacio
                  </h2>
                  <p className="text-3xl font-bold text-white">
                    {cloudStorage
                      ? formatStorageFromGB(cloudStorage.totals.total_bytes / (1024 ** 3))
                      : formatStorageFromGB(data.total_limit / (1024 ** 3))
                    }
                  </p>
                </div>
                <div className="bg-slate-800 rounded-xl p-5 shadow-lg border border-slate-700">
                  <h2 className="text-xs text-slate-400 uppercase tracking-wide font-semibold mb-1">
                    Espacio Usado
                  </h2>
                  <p className="text-3xl font-bold text-white">
                    {cloudStorage
                      ? formatStorageFromGB(cloudStorage.totals.used_bytes / (1024 ** 3))
                      : formatStorageFromGB(data.total_usage / (1024 ** 3))
                    }
                  </p>
                </div>
                <div className="bg-slate-800 rounded-xl p-5 shadow-lg border border-slate-700">
                  <h2 className="text-xs text-slate-400 uppercase tracking-wide font-semibold mb-1">
                    Espacio Libre
                  </h2>
                  <p className="text-3xl font-bold text-white">
                    {cloudStorage
                      ? formatStorageFromGB(cloudStorage.totals.free_bytes / (1024 ** 3))
                      : formatStorageFromGB((data.total_limit - data.total_usage) / (1024 ** 3))
                    }
                  </p>
                </div>
                <div className="bg-slate-800 rounded-xl p-5 shadow-lg border border-slate-700">
                  <h2 className="text-xs text-slate-400 uppercase tracking-wide font-semibold mb-1">
                    % Utilizado
                  </h2>
                  <p className="text-3xl font-bold text-white">
                    {cloudStorage
                      ? cloudStorage.totals.percent_used.toFixed(1)
                      : data.total_usage_percent.toFixed(1)
                    }%
                  </p>
                </div>
              </div>

              {/* Barra de progreso global */}
              <div className="bg-slate-800 rounded-xl p-5 shadow-lg border border-slate-700">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-slate-300">Storage Overview</h3>
                  {lastUpdated && (
                    <span className="text-xs text-slate-500">
                      Última actualización: {getRelativeTime(lastUpdated)}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mb-1">
                  <span className="text-slate-500">Separate accounts. Consolidated view for management.</span>
                </p>
                <p className="text-xs text-slate-500 mb-1 italic">
                  Storage limits are enforced by cloud providers. Transfers only occur when you confirm an action.
                </p>
                <p className="text-xs text-slate-400 mb-3">
                  {cloudStorage
                    ? `${formatStorageFromGB(cloudStorage.totals.used_bytes / (1024 ** 3))} usados de ${formatStorageFromGB(cloudStorage.totals.total_bytes / (1024 ** 3))} (${formatStorageFromGB(cloudStorage.totals.free_bytes / (1024 ** 3))} libre)`
                    : `${formatStorageFromGB(data.total_usage / (1024 ** 3))} usados de ${formatStorageFromGB(data.total_limit / (1024 ** 3))} (${formatStorageFromGB((data.total_limit - data.total_usage) / (1024 ** 3))} libre)`
                  }
                </p>
                <ProgressBar
                  current={cloudStorage ? cloudStorage.totals.used_bytes : data.total_usage}
                  total={cloudStorage ? cloudStorage.totals.total_bytes : data.total_limit}
                  height="lg"
                />
              </div>
            </section>

            {/* Tabla de cuentas mejorada */}
            <section className="bg-slate-800 rounded-xl p-6 shadow-lg border border-slate-700">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-white">
                  Cuentas conectadas ({connectedAccounts.length})
                </h2>
                <button
                  onClick={() => {
                    fetchSummary();
                    fetchCloudStatusData();
                  }}
                  className="text-sm border border-slate-600 rounded-lg px-3 py-1.5 hover:bg-slate-700 transition font-medium"
                >
                  🔄 Refrescar
                </button>
              </div>

              {/* Alert para cuentas que necesitan reconexión */}
              {cloudStatus && cloudStatus.summary.needs_reconnect > 0 && (
                <div className="bg-amber-500/20 border border-amber-500 rounded-lg p-3 text-sm mb-4">
                  <div className="flex items-start gap-2">
                    <span className="text-amber-400 text-lg">⚠️</span>
                    <div className="flex-1">
                      <p className="text-amber-200 font-semibold">
                        {cloudStatus.summary.needs_reconnect} cuenta(s) necesitan reconexión
                      </p>
                      <p className="text-amber-300 text-xs mt-1">
                        Estas cuentas requieren reautorización. Haz clic en "Ver mis cuentas" para reconectarlas.
                      </p>
                    </div>
                    <button
                      onClick={() => setShowReconnectModal(true)}
                      className="px-3 py-1 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded transition"
                    >
                      Ver detalles
                    </button>
                  </div>
                </div>
              )}

              {/* Búsqueda y Sorting */}
              <div className="flex gap-3 mb-4">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    placeholder="Buscar por email..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full px-4 py-2 pl-10 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
                  />
                  <svg className="w-5 h-5 text-slate-400 absolute left-3 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <button
                  onClick={() => setSortOrder(sortOrder === "desc" ? "asc" : "desc")}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg hover:bg-slate-600 transition font-medium text-sm"
                >
                  % Usado
                  <svg className={`w-4 h-4 transition-transform ${sortOrder === "asc" ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>

              {connectedAccounts.length === 0 ? (
                <div className="text-center py-12 bg-slate-900/50 rounded-lg border-2 border-dashed border-slate-700">
                  <div className="text-5xl mb-4">☁️</div>
                  <p className="text-slate-300 mb-2">
                    Aún no hay cuentas conectadas
                  </p>
                  <p className="text-sm text-slate-400">
                    Haz clic en <strong>"Conectar Google Drive"</strong> o <strong>"Conectar OneDrive"</strong> para empezar
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left border-b border-slate-700">
                        <th className="py-3 px-4 text-slate-300 font-semibold">Cuenta</th>
                        <th className="py-3 px-4 text-slate-300 font-semibold">Provider</th>
                        <th className="py-3 px-4 text-slate-300 font-semibold">Estado</th>
                        <th className="py-3 px-4 text-slate-300 font-semibold">Uso</th>
                        <th className="py-3 px-4 text-slate-300 font-semibold">Límite</th>
                        <th className="py-3 px-4 text-slate-300 font-semibold">Progreso</th>
                        <th className="py-3 px-4 text-slate-300 font-semibold text-center">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {connectedAccounts.map((acc) => {
                        // Buscar data de storage: Google en data.accounts o unified en cloudStorage.accounts
                        let storageData = undefined;
                        
                        if (cloudStorage) {
                          // Usar nuevo endpoint unificado
                          storageData = cloudStorage.accounts.find(
                            a => a.email === acc.provider_email && 
                                 ((a.provider === "google_drive" && acc.provider === "google_drive") ||
                                  (a.provider === "onedrive" && acc.provider === "onedrive"))
                          );
                        } else if (acc.provider === "google_drive" && data?.accounts) {
                          // Fallback a endpoint legacy (solo Google)
                          const legacyData = data.accounts.find(a => a.email === acc.provider_email);
                          if (legacyData) {
                            storageData = {
                              provider: "google_drive",
                              email: legacyData.email,
                              total_bytes: legacyData.limit,
                              used_bytes: legacyData.usage,
                              free_bytes: legacyData.limit - legacyData.usage,
                              percent_used: legacyData.usage_percent,
                              status: legacyData.error ? "error" : "ok"
                            };
                          }
                        }
                        
                        return (
                            <tr
                              key={`${acc.provider}:${acc.slot_log_id}`}
                              className="border-b border-slate-800 hover:bg-slate-700/40 transition"
                            >
                              <td className="py-4 px-4">
                                <div className="flex items-center gap-2">
                                  <span className="text-2xl">📧</span>
                                  <div className="flex flex-col">
                                    <span className="font-medium text-white">{acc.provider_email}</span>
                                    {storageData && storageData.used_bytes !== null && storageData.total_bytes !== null ? (
                                      <span className="text-xs text-slate-400 mt-0.5">
                                        Traffic: {formatStorageFromGB(storageData.used_bytes / (1024 ** 3))} / {formatStorageFromGB(storageData.total_bytes / (1024 ** 3))} • {storageData.percent_used?.toFixed(1)}%
                                      </span>
                                    ) : (
                                      <span className="text-xs text-slate-500 mt-0.5">Traffic: —</span>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="py-4 px-4">
                                <div className="flex items-center gap-2">
                                  <span className="text-lg">
                                    {acc.provider === "google_drive" ? "🔵" : acc.provider === "onedrive" ? "🟦" : acc.provider === "dropbox" ? "🟪" : "☁️"}
                                  </span>
                                  <span className="px-2 py-0.5 bg-slate-700 text-slate-300 text-xs font-medium rounded">
                                    {acc.provider === "google_drive" ? "Google Drive" : acc.provider === "onedrive" ? "OneDrive" : acc.provider === "dropbox" ? "Dropbox" : acc.provider}
                                  </span>
                                </div>
                              </td>
                              <td className="py-4 px-4">
                                {storageData && storageData.status === "ok" ? (
                                  <AccountStatusBadge
                                    limit={storageData.total_bytes || 0}
                                    usage={storageData.used_bytes || 0}
                                    error={undefined}
                                  />
                                ) : storageData && storageData.status === "unavailable" ? (
                                  <span className="px-2 py-1 bg-amber-500/20 text-amber-300 text-xs font-medium rounded">
                                    No disponible
                                  </span>
                                ) : (
                                  <span className="px-2 py-1 bg-blue-500/20 text-blue-300 text-xs font-medium rounded">
                                    Conectado
                                  </span>
                                )}
                              </td>
                              <td className="py-4 px-4 text-slate-300">
                                {storageData && storageData.used_bytes !== null
                                  ? formatStorageFromGB(storageData.used_bytes / (1024 ** 3))
                                  : "N/A"}
                              </td>
                              <td className="py-4 px-4 text-slate-300">
                                {storageData && storageData.total_bytes !== null
                                  ? formatStorageFromGB(storageData.total_bytes / (1024 ** 3))
                                  : "N/A"}
                              </td>
                              <td className="py-4 px-4">
                                {storageData && storageData.used_bytes !== null && storageData.total_bytes !== null ? (
                                  <div className="w-full">
                                    <div className="flex items-center justify-between mb-1">
                                      <span className="text-xs text-slate-400">
                                        {storageData.percent_used?.toFixed(1)}%
                                      </span>
                                    </div>
                                    <ProgressBar
                                      current={storageData.used_bytes}
                                      total={storageData.total_bytes}
                                      height="sm"
                                    />
                                  </div>
                                ) : (
                                  <span className="text-xs text-slate-500">N/A</span>
                                )}
                              </td>
                              <td className="py-4 px-4 text-center">
                                <div className="flex items-center justify-center gap-2">
                                  {acc.provider === "google_drive" && acc.cloud_account_id && (
                                    <a
                                      href={`/drive/${acc.cloud_account_id}`}
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition"
                                    >
                                      📁 Ver archivos
                                    </a>
                                  )}
                                  {acc.provider === "onedrive" && (
                                    <>
                                      {acc.provider_account_uuid ? (
                                        <a
                                          href={`/onedrive/${acc.provider_account_uuid}`}
                                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition"
                                        >
                                          📁 Ver archivos
                                        </a>
                                      ) : (
                                        <span className="text-xs text-red-400 italic">Error: ID no disponible</span>
                                      )}
                                    </>
                                  )}
                                  {acc.provider !== "google_drive" && acc.provider !== "onedrive" && (
                                    <span className="text-xs text-slate-500 italic">Próximamente</span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {/* Modal de slots históricos */}
      <ReconnectSlotsModal
        isOpen={showReconnectModal}
        onClose={() => setShowReconnectModal(false)}
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
