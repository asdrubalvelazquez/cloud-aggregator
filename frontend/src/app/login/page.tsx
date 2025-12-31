"use client";

import { supabase } from "@/lib/supabaseClient";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const getOAuthRedirectOrigin = () => {
    const { hostname, origin } = window.location;
    const isVercelHost = hostname.endsWith(".vercel.app");
    const isNonWwwCanonical = hostname === "cloudaggregatorapp.com";
    if (isVercelHost || isNonWwwCanonical) return "https://www.cloudaggregatorapp.com";
    return origin;
  };

  useEffect(() => {
    let mounted = true;

    // Dar tiempo a Supabase para procesar el hash de la URL si existe
    const initAuth = async () => {
      // Si hay hash en la URL, esperar a que Supabase lo procese
      if (window.location.hash) {
        console.log('Hash detected, waiting for Supabase to process...');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Verificar si ya hay una sesión activa
      const { data: { session } } = await supabase.auth.getSession();
      if (session && mounted) {
        console.log('Session found, redirecting to /app');
        router.push("/app");
        return;
      }
    };

    initAuth();

    // Escuchar cambios en la sesión de autenticación
    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('Auth event:', event);
        if (event === "SIGNED_IN" && session && mounted) {
          console.log('Redirecting to /app');
          router.push("/app");
        }
      }
    );

    return () => {
      mounted = false;
      authListener?.subscription.unsubscribe();
    };
  }, [router]);

  const signInWithGoogle = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { 
        redirectTo: `${getOAuthRedirectOrigin()}/login`,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });
    if (error) {
      console.error(error);
      alert("Error iniciando sesión con Google");
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-950 text-white">
      <div className="w-full max-w-md rounded-xl bg-slate-900 p-8">
        <h1 className="text-2xl font-bold">Iniciar sesión</h1>
        <p className="text-slate-300 mt-2">Accede con Google para usar Cloud Aggregator.</p>

        <button
          onClick={signInWithGoogle}
          disabled={loading}
          className="mt-6 w-full rounded bg-emerald-500 px-4 py-3 font-semibold hover:bg-emerald-600 disabled:opacity-50"
        >
          {loading ? "Cargando..." : "Entrar con Google"}
        </button>
      </div>
    </main>
  );
}
