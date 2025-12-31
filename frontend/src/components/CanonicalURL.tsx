"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Dynamic Canonical URL Component
 * 
 * Injects canonical URL that preserves the current pathname.
 * This ensures SEO points to www.cloudaggregatorapp.com regardless of the domain used to access the site.
 * 
 * Supports dual-domain:
 * - https://<deployment-host>/app → canonical: https://www.cloudaggregatorapp.com/app
 * - https://www.cloudaggregatorapp.com/app → canonical: https://www.cloudaggregatorapp.com/app
 * 
 * Safe: Does NOT force redirects, only signals preferred domain to search engines.
 */
export function CanonicalURL() {
  const pathname = usePathname();

  useEffect(() => {
    // Remove existing canonical tag if present
    const existingCanonical = document.querySelector('link[rel="canonical"]');
    if (existingCanonical) {
      existingCanonical.remove();
    }

    // Create new canonical tag with current pathname
    const canonical = document.createElement("link");
    canonical.rel = "canonical";
    canonical.href = `https://www.cloudaggregatorapp.com${pathname}`;
    document.head.appendChild(canonical);

    return () => {
      // Cleanup on unmount
      const linkToRemove = document.querySelector(`link[rel="canonical"][href="https://www.cloudaggregatorapp.com${pathname}"]`);
      if (linkToRemove) {
        linkToRemove.remove();
      }
    };
  }, [pathname]);

  return null; // This component doesn't render anything
}
