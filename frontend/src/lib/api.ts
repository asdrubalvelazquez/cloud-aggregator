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
