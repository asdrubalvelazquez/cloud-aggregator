"use client";

import { useEffect, useRef } from "react";

/**
 * Global context menu blocker for dashboard routes.
 * 
 * CRITICAL:
 * - Uses capture phase (before bubbling) to intercept ALL contextmenu events
 * - Only calls preventDefault() to block native menu (no stopPropagation)
 * - Allows app's custom context menus to work normally via bubbling phase
 * - Tracks events via window.__ctxHits for production debugging
 */
export default function DashboardContextMenuBlocker({
  children,
}: {
  children: React.ReactNode;
}) {
  const dashboardRootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      // Only block if click is inside dashboard root
      if (dashboardRootRef.current?.contains(e.target as Node)) {
        e.preventDefault(); // Block native menu
        // NO stopPropagation() - allow app menus to work via bubbling
      }
    };

    // Register in capture phase (before bubbling) for maximum coverage
    document.addEventListener('contextmenu', handleContextMenu, true);

    // Debugging: Track context menu events (visible in production console)
    if (typeof window !== "undefined") {
      (window as any).__ctxHits = 0;
      (window as any).__appCtxOpens = 0; // Track app context menu opens
      const debugHandler = () => {
        (window as any).__ctxHits++;
      };
      document.addEventListener('contextmenu', debugHandler, true);
      
      return () => {
        document.removeEventListener('contextmenu', handleContextMenu, true);
        document.removeEventListener('contextmenu', debugHandler, true);
      };
    }

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu, true);
    };
  }, []);

  return (
    <div 
      ref={dashboardRootRef} 
      data-build="CTXFIX-2026-01-07-1"
    >
      {children}
      {/* Build marker for production verification */}
      <div style={{ display: "none" }} id="build-marker">CTXFIX-2026-01-07-1</div>
    </div>
  );
}
