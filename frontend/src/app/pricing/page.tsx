"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

type Plan = {
  name: string;
  price: string;
  clouds: number;
  copies: number;
  features: string[];
};

const plans: Plan[] = [
  {
    name: "Free",
    price: "$0",
    clouds: 2,
    copies: 20,
    features: [
      "2 cuentas de Google Drive",
      "20 copias por mes",
      "Detección de duplicados",
      "Renombrar archivos",
    ],
  },
  {
    name: "Plus",
    price: "$9",
    clouds: 3,
    copies: 500,
    features: [
      "3 cuentas de Google Drive",
      "500 copias por mes",
      "Todas las funciones Free",
      "Soporte prioritario",
    ],
  },
  {
    name: "Pro",
    price: "$19",
    clouds: 7,
    copies: 2500,
    features: [
      "7 cuentas de Google Drive",
      "2,500 copias por mes",
      "Todas las funciones Plus",
      "API access (próximamente)",
    ],
  },
];

export default function PricingPage() {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [currentPlan, setCurrentPlan] = useState<string>("free");

  useEffect(() => {
    const fetchCurrentPlan = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!session?.access_token) {
          setCurrentPlan("free");
          return;
        }

        const headers = new Headers();
        headers.set("Authorization", `Bearer ${session.access_token}`);

        const res = await fetch(`${API_BASE_URL}/me/plan`, { headers });
        if (res.ok) {
          const data = await res.json();
          setCurrentPlan(data.plan?.toLowerCase() || "free");
        } else {
          setCurrentPlan("free");
        }
      } catch (e) {
        // Default to free on error
        setCurrentPlan("free");
      }
    };
    fetchCurrentPlan();
  }, []);

  const handleUpgrade = () => {
    setShowModal(true);
  };

  return (
    <main className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center p-6">
      <div className="w-full max-w-6xl space-y-8">
        {/* Header */}
        <header className="text-center space-y-4">
          <button
            onClick={() => router.push("/app")}
            className="text-sm text-slate-400 hover:text-slate-200 transition"
          >
            ← Volver al Dashboard
          </button>
          <h1 className="text-4xl font-bold">Planes y Precios</h1>
          <p className="text-slate-400">
            Elige el plan que mejor se adapte a tus necesidades
          </p>
        </header>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((plan) => {
            const isCurrent = plan.name.toLowerCase() === currentPlan;
            return (
              <div
                key={plan.name}
                className={`bg-slate-800 rounded-xl p-6 border ${
                  isCurrent
                    ? "border-emerald-500 shadow-lg shadow-emerald-500/20"
                    : "border-slate-700"
                } flex flex-col`}
              >
              {/* Plan Header */}
              <div className="text-center mb-6">
                <h2 className="text-2xl font-bold mb-2">{plan.name}</h2>
                <div className="flex items-baseline justify-center gap-1">
                  <span className="text-4xl font-bold">{plan.price}</span>
                  {plan.price !== "$0" && (
                    <span className="text-slate-400">/mes</span>
                  )}
                </div>
              </div>

              {/* Limits */}
              <div className="space-y-3 mb-6">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">Nubes:</span>
                  <span className="font-semibold">{plan.clouds}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">Copias/mes:</span>
                  <span className="font-semibold">
                    {plan.copies.toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Features */}
              <ul className="space-y-2 mb-6 flex-grow">
                {plan.features.map((feature, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm">
                    <span className="text-emerald-400 mt-0.5">✓</span>
                    <span className="text-slate-300">{feature}</span>
                  </li>
                ))}
              </ul>

              {/* CTA Button */}
              {isCurrent ? (
                <button
                  disabled
                  className="w-full rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold cursor-not-allowed opacity-50"
                >
                  Plan actual
                </button>
              ) : (
                <button
                  onClick={handleUpgrade}
                  className="w-full rounded-lg bg-emerald-500 hover:bg-emerald-600 transition px-4 py-2 text-sm font-semibold"
                >
                  Actualizar
                </button>
              )}
            </div>
          );
          })}
        </div>

        {/* Footer Note */}
        <p className="text-center text-sm text-slate-500">
          * Los precios son estimados. Sistema de pagos próximamente.
        </p>
      </div>

      {/* Upgrade Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 rounded-xl p-6 max-w-md w-full border border-slate-700">
            <h3 className="text-xl font-bold mb-4">Próximamente</h3>
            <p className="text-slate-300 mb-6">
              Los pagos con tarjeta estarán disponibles muy pronto.
              <br />
              <br />
              Por ahora, contáctanos para acceso beta a planes premium.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 rounded-lg bg-slate-700 hover:bg-slate-600 transition px-4 py-2 text-sm font-semibold"
              >
                Cerrar
              </button>
              <a
                href="mailto:support@cloudaggregator.com?subject=Acceso Beta Premium"
                className="flex-1 rounded-lg bg-emerald-500 hover:bg-emerald-600 transition px-4 py-2 text-sm font-semibold text-center"
              >
                Contactar
              </a>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
