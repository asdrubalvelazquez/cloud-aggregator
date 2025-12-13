"use client";

import { supabase } from "@/lib/supabaseClient";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    // Verificar si ya hay una sesión activa al cargar
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        router.push("/app");
      }
    };
    
    checkSession();

    // Escuchar cambios en la sesión de autenticación
    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('Auth event:', event);
        if (event === "SIGNED_IN" && session) {
          console.log('Redirecting to /app');
          router.push("/app");
        }
      }
    );

    return () => {
      authListener?.subscription.unsubscribe();
    };
  }, [router]);

  const signInWithGoogle = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { 
        redirectTo: "https://cloud-aggregator-iota.vercel.app/login",
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
