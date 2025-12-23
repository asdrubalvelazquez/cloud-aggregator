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

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  return response;
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
 * @param mode - "reauth" for reconnecting slots, "consent" for forced consent, undefined for new
 * @returns OAuth URL to redirect user to Google
 */
export async function fetchGoogleLoginUrl(params?: {
  mode?: "reauth" | "consent" | "new";
}): Promise<GoogleLoginUrlResponse> {
  const queryParams = new URLSearchParams();
  if (params?.mode && params.mode !== "new") {
    queryParams.set("mode", params.mode);
  }
  
  const endpoint = `/auth/google/login-url${
    queryParams.toString() ? `?${queryParams.toString()}` : ""
  }`;
  
  const res = await authenticatedFetch(endpoint);
  if (!res.ok) {
    throw new Error(`Failed to get OAuth URL: ${res.status}`);
  }
  return await res.json();
}
