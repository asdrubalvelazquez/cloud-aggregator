"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

/**
 * Client component that silently checks for authenticated session
 * and redirects to /app if user is already logged in.
 * This doesn't block page rendering - it runs after hydration.
 */
export default function SilentAuthRedirect() {
  const router = useRouter();

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          router.replace("/app");
        }
      } catch (err) {
        // Silently fail - landing page should always be accessible
        console.error("[SilentAuthRedirect] Auth check failed:", err);
      }
    };

    checkAuth();
  }, [router]);

  // This component renders nothing - it's just for the side effect
  return null;
}
