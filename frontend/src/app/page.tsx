"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

export default function Home() {
  const router = useRouter();
  const [checkingSession, setCheckingSession] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const checkAuth = async () => {
      setSessionError(null);

      // Failsafe timeout (10s) so we never stick on an infinite "Cargando..."
      const timeoutMs = 10000;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error("timeout"));
        }, timeoutMs);
      });

      try {
        const result = await Promise.race([
          supabase.auth.getSession(),
          timeoutPromise,
        ]);

        // Promise.race returns the getSession result if it wins
        const {
          data: { session },
        } = result as Awaited<ReturnType<typeof supabase.auth.getSession>>;

        if (!mounted) return;

        if (session) {
          // Usuario autenticado -> redirigir a dashboard
          router.replace("/app");
          return;
        }

        // No hay sesión -> mostrar landing
        setCheckingSession(false);
      } catch (err: any) {
        if (!mounted) return;

        if (err?.message === "timeout") {
          setSessionError("La verificación de sesión tardó demasiado.");
        } else {
          setSessionError("Error verificando sesión.");
          console.error("[Home] Error checking session:", err);
        }

        setCheckingSession(false);
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    };

    checkAuth();

    return () => {
      mounted = false;
    };
  }, [router]);

  // Mientras verifica sesión, mostrar spinner
  if (checkingSession) {
    return (
      <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mb-4"></div>
          <p className="text-slate-300">Loading...</p>
        </div>
      </main>
    );
  }

  if (sessionError) {
    return (
      <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <p className="text-slate-200 font-semibold">{sessionError}</p>
          <p className="text-slate-400 text-sm mt-2">You can reload to try again.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 rounded-lg bg-emerald-600 hover:bg-emerald-700 transition px-4 py-2 text-sm font-semibold"
          >
            Reload
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white overflow-hidden">
      {/* Animated gradient background */}
      <div className="fixed inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 animate-gradient-slow" />
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-900/20 via-transparent to-transparent" />
      
      <div className="relative z-10">
        {/* Hero Section */}
        <section className="min-h-screen flex flex-col items-center justify-center px-6 py-20">
          <div className="max-w-5xl mx-auto text-center space-y-8">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 backdrop-blur-sm border border-white/10 text-sm text-slate-300">
              <span className="text-emerald-400">●</span>
              Connect multiple cloud accounts
            </div>

            {/* App Name */}
            <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">
              Cloud Aggregator
            </h1>

            {/* Main Heading */}
            <h2 className="text-5xl md:text-7xl font-extrabold tracking-tight leading-tight">
              Connect{" "}
              <span className="bg-gradient-to-r from-emerald-400 via-blue-500 to-purple-500 bg-clip-text text-transparent animate-gradient">
                multiple Google Drive
              </span>
              {" "}accounts from a single interface
            </h2>

            {/* Subheading */}
            <p className="text-xl md:text-2xl text-slate-300 max-w-3xl mx-auto leading-relaxed">
              Connect multiple Google Drive accounts (each remains separate), select files with Google Picker,
              and manually copy between accounts with explicit user confirmation.
            </p>

            {/* Disclaimer */}
            <p className="text-sm text-slate-500 max-w-2xl mx-auto border-l-2 border-slate-700 pl-4 italic">
              Each account remains separate. Use Google Picker to select specific files. All copy operations are user-initiated. Storage limits remain unchanged.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
              <Link
                href="/login"
                className="group relative inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-semibold text-lg shadow-lg shadow-emerald-500/30 transition-all duration-300 hover:scale-105 hover:shadow-2xl hover:shadow-emerald-500/40"
              >
                Get Started
                <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>
            </div>

            {/* Trust Indicators */}
            <div className="flex items-center justify-center gap-6 pt-8 text-sm text-slate-400">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                No credit card required
              </div>
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Free plan available
              </div>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className="py-20 px-6">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">
                User-controlled file operations
              </h2>
              <p className="text-slate-400 text-lg">
                Connect accounts and copy files manually
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {/* Feature 1 */}
              <div className="group relative p-8 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 hover:bg-white/10 hover:border-emerald-500/50 transition-all duration-300 hover:scale-105">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                  <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold mb-3">View connected accounts</h3>
                <p className="text-slate-400 leading-relaxed">
                  Connect multiple Google Drive accounts and view storage usage for each account separately. Each account remains independent.
                </p>
              </div>

              {/* Feature 2 */}
              <div className="group relative p-8 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 hover:bg-white/10 hover:border-blue-500/50 transition-all duration-300 hover:scale-105">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                  <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold mb-3">Manual file copy</h3>
                <p className="text-slate-400 leading-relaxed">
                  Copy files between your Google Drive accounts with manual file selection and explicit user confirmation for each operation.
                </p>
              </div>

              {/* Feature 3 */}
              <div className="group relative p-8 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 hover:bg-white/10 hover:border-purple-500/50 transition-all duration-300 hover:scale-105">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                  <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold mb-3">File selection (Google Picker)</h3>
                <p className="text-slate-400 leading-relaxed">
                  Select files with Google Picker from your connected accounts. Only user-selected files are accessible for copy operations.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Dashboard Preview Section */}
        <section className="py-20 px-6">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">
                Single interface for connected accounts
              </h2>
              <p className="text-slate-400 text-lg">
                View connected accounts and initiate copy operations
              </p>
            </div>

            {/* Dashboard Mockup */}
            <div className="relative rounded-3xl overflow-hidden bg-gradient-to-br from-slate-800/50 to-slate-900/50 backdrop-blur-sm border border-white/10 p-8 shadow-2xl">
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-transparent to-purple-500/10" />
              
              <div className="relative space-y-4">
                {/* Mock header */}
                <div className="flex items-center justify-between pb-4 border-b border-white/10">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600" />
                    <div className="space-y-1">
                      <div className="h-4 w-32 bg-white/20 rounded" />
                      <div className="h-3 w-24 bg-white/10 rounded" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <div className="h-9 w-24 bg-white/10 rounded-lg" />
                    <div className="h-9 w-9 bg-emerald-500/20 rounded-lg" />
                  </div>
                </div>

                {/* Mock stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-4">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="p-4 rounded-xl bg-white/5 border border-white/10">
                      <div className="h-3 w-20 bg-white/20 rounded mb-3" />
                      <div className="h-6 w-24 bg-gradient-to-r from-emerald-400/30 to-blue-400/30 rounded" />
                    </div>
                  ))}
                </div>

                {/* Mock table */}
                <div className="space-y-2 py-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center gap-4 p-4 rounded-xl bg-white/5 border border-white/10">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3 w-40 bg-white/20 rounded" />
                        <div className="h-2 w-32 bg-white/10 rounded" />
                      </div>
                      <div className="h-2 w-32 bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-full" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Stats Section */}
        <section className="py-20 px-6">
          <div className="max-w-6xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="text-center p-8">
                <div className="text-5xl md:text-6xl font-bold bg-gradient-to-r from-emerald-400 to-emerald-600 bg-clip-text text-transparent mb-2">
                  500+
                </div>
                <p className="text-slate-400 text-lg">Accounts connected</p>
              </div>
              <div className="text-center p-8">
                <div className="text-5xl md:text-6xl font-bold bg-gradient-to-r from-blue-400 to-blue-600 bg-clip-text text-transparent mb-2">
                  Multi
                </div>
                <p className="text-slate-400 text-lg">Multiple accounts</p>
              </div>
              <div className="text-center p-8">
                <div className="text-5xl md:text-6xl font-bold bg-gradient-to-r from-purple-400 to-purple-600 bg-clip-text text-transparent mb-2">
                  Free
                </div>
                <p className="text-slate-400 text-lg">To get started</p>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA Section */}
        <section className="py-32 px-6">
          <div className="max-w-4xl mx-auto text-center space-y-8">
            <h2 className="text-4xl md:text-5xl font-bold leading-tight">
              Ready to connect your Google Drive accounts?
            </h2>
            <p className="text-xl text-slate-300 max-w-2xl mx-auto">
              Connect accounts and work with your user-selected files from a single interface.
            </p>
            <div className="pt-4">
              <Link
                href="/login"
                className="group inline-flex items-center gap-3 px-10 py-5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-bold text-xl shadow-2xl shadow-emerald-500/40 transition-all duration-300 hover:scale-105 hover:shadow-emerald-500/50"
              >
                Get Started
                <svg className="w-6 h-6 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="py-12 px-6 border-t border-white/10">
          <div className="max-w-6xl mx-auto text-center space-y-4">
            {/* Legal Links */}
            <div className="flex items-center justify-center gap-6 text-sm">
              <Link 
                href="/privacy" 
                className="text-slate-400 hover:text-emerald-400 transition-colors duration-200"
              >
                Privacy Policy
              </Link>
              <span className="text-slate-600">•</span>
              <Link 
                href="/terms" 
                className="text-slate-400 hover:text-emerald-400 transition-colors duration-200"
              >
                Terms of Service
              </Link>
            </div>
            
            {/* Copyright */}
            <p className="text-slate-400 text-sm">
              Cloud Aggregator © 2025 - Multi-account Google Drive manager
            </p>
          </div>
        </footer>
      </div>
    </main>
  );
}
