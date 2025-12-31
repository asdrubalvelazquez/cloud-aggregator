"use client";

import { useEffect } from "react";

const CANONICAL_ORIGIN = "https://www.cloudaggregatorapp.com";

export function CanonicalHostGuard() {
  useEffect(() => {
    // Run only in browser
    const { hostname, pathname, search, hash } = window.location;

    const isVercelHost = hostname.endsWith(".vercel.app");
    const isNonWwwCanonical = hostname === "cloudaggregatorapp.com";
    const isCanonicalHost = hostname === "www.cloudaggregatorapp.com";

    if (isCanonicalHost) return;

    if (isVercelHost || isNonWwwCanonical) {
      const target = `${CANONICAL_ORIGIN}${pathname}${search}${hash}`;
      // replace() avoids polluting history with the non-canonical host
      window.location.replace(target);
    }
  }, []);

  return null;
}
