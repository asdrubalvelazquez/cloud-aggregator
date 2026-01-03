/**
 * Helper para hacer peticiones autenticadas al backend
 */
import { supabase } from "./supabaseClient";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

export async function authenticatedFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  // Obtener el token de sesión de Supabase
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error("No authenticated session");
  }

  // Agregar el token al header Authorization
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${session.access_token}`);

  // Default timeout to prevent infinite pending requests.
  // If the caller already provides a signal (with its own timeout/abort), respect it.
  const timeoutMs = 15000;
  const controller = options.signal ? null : new AbortController();
  const timeoutId: ReturnType<typeof setTimeout> | null = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  const requestInit: RequestInit = {
    ...options,
    headers,
    signal: options.signal ?? controller?.signal,
    // Permitir cache: 'no-store' para forzar refetch
    cache: options.cache || "default",
  };

  try {
    return await fetch(`${API_BASE_URL}${endpoint}`, requestInit);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Types for cloud slots
 */
export type CloudSlot = {
  id: string;
  provider: string;
  provider_email: string;
  slot_number: number;
  is_active: boolean;
  connected_at: string;
  disconnected_at: string | null;
  plan_at_connection: string;
};

export type SlotsResponse = {
  slots: CloudSlot[];
};

/**
 * Types for cloud account status (new endpoint)
 */
export type CloudAccountStatus = {
  slot_log_id: string;
  slot_number: number;
  slot_is_active: boolean;
  provider: string;
  provider_email: string;
  provider_account_id: string;
  connection_status: "connected" | "needs_reconnect" | "disconnected";
  reason: string | null;
  can_reconnect: boolean;
  cloud_account_id: number | null;
  has_refresh_token: boolean;
  account_is_active: boolean;
};

export type CloudStatusResponse = {
  accounts: CloudAccountStatus[];
  summary: {
    total_slots: number;
    active_slots: number;
    connected: number;
    needs_reconnect: number;
    disconnected: number;
  };
};

/**
 * Fetch detailed connection status for all cloud accounts
 * 
 * Returns connection status including whether accounts need reconnection,
 * helping distinguish between historical slots and actually usable accounts.
 * 
 * @param forceRefresh - If true, bypasses cache with cache: 'no-store'
 */
export async function fetchCloudStatus(forceRefresh = false): Promise<CloudStatusResponse> {
  const options: RequestInit = forceRefresh ? { cache: 'no-store' } : {};
  const res = await authenticatedFetch("/me/cloud-status", options);
  if (!res.ok) {
    throw new Error(`Failed to fetch cloud status: ${res.status}`);
  }
  return await res.json();
}

/**
 * Fetch all cloud slots (active and inactive) for the authenticated user
 * 
 * Returns historical slot data including disconnected accounts,
 * allowing users to see which accounts they can reconnect.
 */
export async function fetchUserSlots(): Promise<SlotsResponse> {
  const res = await authenticatedFetch("/me/slots");
  if (!res.ok) {
    throw new Error(`Failed to fetch slots: ${res.status}`);
  }
  return await res.json();
}

/**
 * Google OAuth Login URL Response
 */
export type GoogleLoginUrlResponse = {
  url: string;
};

/**
 * Fetch Google OAuth URL (authenticated endpoint)
 * 
 * CRITICAL: window.location.href does NOT send Authorization headers.
 * This endpoint is protected with JWT, so we fetch it first,
 * then redirect manually to the returned OAuth URL.
 * 
 * @param params - mode: "connect"|"reauth"|"reconnect", reconnect_account_id: Google account ID for reconnect
 * @returns OAuth URL to redirect user to Google
 */
export async function fetchGoogleLoginUrl(params?: {
  mode?: "connect" | "reauth" | "reconnect" | "consent";
  reconnect_account_id?: string;
}): Promise<GoogleLoginUrlResponse> {
  const queryParams = new URLSearchParams();
  if (params?.mode) {
    queryParams.set("mode", params.mode);
  }
  if (params?.reconnect_account_id) {
    queryParams.set("reconnect_account_id", params.reconnect_account_id);
  }
  
  const endpoint = `/auth/google/login-url${
    queryParams.toString() ? `?${queryParams.toString()}` : ""
  }`;
  
  const res = await authenticatedFetch(endpoint);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    const error: any = new Error(`Failed to get OAuth URL: ${res.status}`);
    error.status = res.status;
    error.body = errorData;
    throw error;
  }
  return await res.json();
}

/**
 * Fetch OneDrive OAuth URL (authenticated endpoint)
 * 
 * CRITICAL: window.location.href does NOT send Authorization headers.
 * This endpoint is protected with JWT, so we fetch it first,
 * then redirect manually to the returned OAuth URL.
 * 
 * @param params - mode: "connect"|"reauth"|"reconnect", reconnect_account_id: OneDrive account ID for reconnect
 * @returns OAuth URL to redirect user to Microsoft OneDrive
 */
export async function fetchOneDriveLoginUrl(params?: {
  mode?: "connect" | "reauth" | "reconnect" | "consent";
  reconnect_account_id?: string;
}): Promise<GoogleLoginUrlResponse> {
  const queryParams = new URLSearchParams();
  if (params?.mode) {
    queryParams.set("mode", params.mode);
  }
  if (params?.reconnect_account_id) {
    queryParams.set("reconnect_account_id", params.reconnect_account_id);
  }
  
  const endpoint = `/auth/onedrive/login-url${
    queryParams.toString() ? `?${queryParams.toString()}` : ""
  }`;
  
  const res = await authenticatedFetch(endpoint);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    const error: any = new Error(`Failed to get OAuth URL: ${res.status}`);
    error.status = res.status;
    error.body = errorData;
    throw error;
  }
  return await res.json();
}

/**
 * OneDrive file/folder item type
 */
export type OneDriveItem = {
  id: string;
  name: string;
  kind: "file" | "folder";
  size: number;
  modifiedTime: string | null;
  webViewLink?: string | null;
  parentId?: string | null;
};

/**
 * OneDrive files list response
 */
export type OneDriveListResponse = {
  provider: "onedrive";
  account_id: string;
  parent_id: string | null;
  items: OneDriveItem[];
  nextPageToken?: string | null;
};

/**
 * Fetch OneDrive files/folders for a specific account
 * 
 * Lists files and folders from the user's OneDrive account.
 * If parentId is provided, lists children of that folder.
 * Otherwise, lists root folder contents.
 * 
 * @param accountId - UUID of the OneDrive account from cloud_provider_accounts
 * @param parentId - Optional folder ID to list children from
 * @returns OneDrive files list with items array
 */
export async function fetchOneDriveFiles(
  accountId: string,
  parentId?: string
): Promise<OneDriveListResponse> {
  const params = new URLSearchParams();
  if (parentId) {
    params.set("parent_id", parentId);
  }
  
  const endpoint = `/onedrive/${accountId}/files${
    params.toString() ? `?${params.toString()}` : ""
  }`;
  
  const res = await authenticatedFetch(endpoint);
  if (!res.ok) {
    // Parse error response if available
    const errorData = await res.json().catch(() => null);
    const errorMessage = errorData?.message || errorData?.detail?.message || `Failed to fetch OneDrive files: ${res.status}`;
    throw new Error(errorMessage);
  }
  
  return await res.json();
}
