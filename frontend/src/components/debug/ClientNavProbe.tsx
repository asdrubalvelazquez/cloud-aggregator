"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

function getNavType(): string {
  try {
    const navEntries = performance.getEntriesByType("navigation");
    const nav = navEntries && navEntries[0] as PerformanceNavigationTiming | undefined;
    return nav?.type || "unknown";
  } catch {
    return "unknown";
  }
}

function getSessionId(): string {
  try {
    const key = "ca_session_id";
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return `no-session-${Date.now()}`;
  }
}

export function ClientNavProbe() {
  const pathname = usePathname();
  const mountedRef = useRef(false);

  useEffect(() => {
    const w = window as any;
    const sessionId = getSessionId();

    // one-time per tab load
    if (!w.__CA_PROBE_SESSION_LOGGED) {
      w.__CA_PROBE_SESSION_LOGGED = true;
    }
  }, []);

  useEffect(() => {
    const w = window as any;
    w.__CA_LAYOUT_MOUNT_COUNT = (w.__CA_LAYOUT_MOUNT_COUNT || 0) + 1;

    console.log("[LAYOUT_MOUNT]", "count=" + w.__CA_LAYOUT_MOUNT_COUNT, "path=" + pathname);

    const onPageShow = (e: PageTransitionEvent) => {
      console.log("[PAGESHOW]", "persisted=" + (e.persisted ? "true" : "false"), "path=" + pathname);
    };
    const onPageHide = (e: PageTransitionEvent) => {
      console.log("[PAGEHIDE]", "persisted=" + (e.persisted ? "true" : "false"), "path=" + pathname);
    };
    const onVisibility = () => {
      console.log("[VISIBILITY]", document.visibilityState, "path=" + pathname);
    };

    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      console.log("[LAYOUT_UNMOUNT]", "path=" + pathname);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []); // mount/unmount only

  // log route changes (client nav)
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    console.log("[ROUTE_CHANGE]", "path=" + pathname);
  }, [pathname]);

  return null;
}
