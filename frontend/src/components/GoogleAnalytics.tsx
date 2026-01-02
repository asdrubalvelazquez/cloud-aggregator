import Script from "next/script";

/**
 * GoogleAnalytics - Server Component
 * 
 * Carga gtag.js desde CDN de Google solo si existe NEXT_PUBLIC_GA_MEASUREMENT_ID.
 * Usa strategy="afterInteractive" para no bloquear FCP.
 * 
 * Configuración inicial con send_page_view: false para permitir control manual
 * de pageviews desde PageViewTracker (evita duplicados en SSR + SPA).
 */
export default function GoogleAnalytics() {
  const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  // Fail silently si no existe la variable de entorno
  if (!measurementId) {
    return null;
  }

  return (
    <>
      {/* Carga gtag.js library desde CDN */}
      <Script
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
      />

      {/* Inicialización de gtag con send_page_view: false */}
      <Script id="google-analytics-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${measurementId}', {
            send_page_view: false
          });
        `}
      </Script>
    </>
  );
}
