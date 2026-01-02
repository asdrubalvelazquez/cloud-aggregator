"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * PageViewTracker - Client Component
 * 
 * Trackea pageviews manualmente en cada navegación client-side.
 * Resuelve problemas comunes:
 * 
 * 1. Evita doble pageview en React Strict Mode (development)
 *    - Usa useRef para detectar primer render
 * 
 * 2. Ignora cambios solo de hash (#section)
 *    - OAuth redirects con #access_token no generan pageview
 * 
 * 3. Fail-safe si gtag no está disponible
 *    - Verifica window.gtag antes de llamar
 */
export default function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isInitialMount = useRef(true);
  const previousPathname = useRef(pathname);

  useEffect(() => {
    // Skip en primer render para evitar doble pageview en Strict Mode
    if (isInitialMount.current) {
      isInitialMount.current = false;
      // Enviar pageview inicial
      sendPageView();
      return;
    }

    // Detectar si solo cambió el hash (no trackear)
    const currentPath = pathname;
    const previousPath = previousPathname.current;

    if (currentPath !== previousPath) {
      sendPageView();
      previousPathname.current = currentPath;
    }
  }, [pathname, searchParams]);

  const sendPageView = () => {
    // Verificar que gtag existe (fail silently si no)
    if (typeof window !== "undefined" && typeof window.gtag === "function") {
      const url = pathname + (searchParams?.toString() ? `?${searchParams.toString()}` : "");
      window.gtag("event", "page_view", {
        page_path: url,
      });
    }
  };

  // Este componente no renderiza nada
  return null;
}

// Declaración de tipos para gtag global
declare global {
  interface Window {
    gtag?: (
      command: string,
      targetId: string | Date,
      config?: Record<string, unknown>
    ) => void;
    dataLayer?: unknown[];
  }
}
