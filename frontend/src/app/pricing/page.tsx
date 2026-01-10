"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authenticatedFetch } from "@/lib/api";
import PricingPaymentStatus from "@/components/PricingPaymentStatus";

type Plan = {
  name: string;
  price: string;
  transfer_gb: number | null; // null = ilimitado
  max_file_gb: number;
  features: string[];
};

const plans: Plan[] = [
  {
    name: "Free",
    price: "$0",
    transfer_gb: 5,
    max_file_gb: 1,
    features: [
      "Cuentas ilimitadas (Google Drive & OneDrive)",
      "Copias ilimitadas",
      "5 GB de transferencia (lifetime)",
      "Archivos hasta 1 GB",
      "Detección de duplicados",
    ],
  },
  {
    name: "Plus",
    price: "$9",
    transfer_gb: 100,
    max_file_gb: 10,
    features: [
      "Cuentas ilimitadas",
      "Copias ilimitadas",
      "100 GB de transferencia/mes",
      "Archivos hasta 10 GB",
      "Todas las funciones Free",
      "Soporte prioritario",
    ],
  },
  {
    name: "Pro",
    price: "$19",
    transfer_gb: null, // ilimitado
    max_file_gb: 50,
    features: [
      "Cuentas ilimitadas",
      "Copias ilimitadas",
      "Transferencia ilimitada 🚀",
      "Archivos hasta 50 GB",
      "Todas las funciones Plus",
      "API access (próximamente)",
    ],
  },
];

export default function PricingPage() {
  const router = useRouter();
  const [currentPlan, setCurrentPlan] = useState<string>("free");
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");

  // Callback para actualizar plan desde componente de payment status
  const handlePlanRefresh = (newPlan: string) => {
    setCurrentPlan(newPlan);
  };

  useEffect(() => {
    const fetchCurrentPlan = async () => {
      try {
        const res = await authenticatedFetch("/me/plan");
        if (res.ok) {
          const data = await res.json();
          setCurrentPlan(data.plan?.toLowerCase() || "free");
        } else {
          setCurrentPlan("free");
        }
      } catch (e) {
        // Default to free on error (no auth or network error)
        setCurrentPlan("free");
      }
    };
    fetchCurrentPlan();
  }, []);

  const handleUpgrade = async (planCode: string) => {
    setErrorMessage("");
    setLoadingPlan(planCode);

    try {
      const res = await authenticatedFetch("/stripe/create-checkout-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ plan_code: planCode }),
      });

      if (res.ok) {
        const data = await res.json();
        // Redirigir a Stripe Checkout
        window.location.href = data.url;
      } else {
        const errorData = await res.json().catch(() => ({}));
        
        // Manejar errores estructurados del backend
        let message = "Error al procesar el pago";
        
        if (typeof errorData.detail === 'object' && errorData.detail.message) {
          // Error estructurado con JSON
          message = errorData.detail.message;
          
          // Agregar detalles técnicos si están disponibles (para debugging)
          if (errorData.detail.error === 'stripe_not_configured' && errorData.detail.missing) {
            console.error('[PRICING] Missing Stripe env vars:', errorData.detail.missing);
            message += ' (Sistema de pagos no configurado)';
          } else if (errorData.detail.code) {
            console.error('[PRICING] Stripe error code:', errorData.detail.code);
          }
        } else if (typeof errorData.detail === 'string') {
          // Error simple con string
          message = errorData.detail;
        } else {
          // Fallback genérico
          message = `Error al procesar el pago (${res.status})`;
        }
        
        setErrorMessage(message);
        setLoadingPlan(null);
      }
    } catch (error) {
      console.error('[PRICING] Network error:', error);
      setErrorMessage("Error de conexión. Intenta nuevamente.");
      setLoadingPlan(null);
    }
  };

  return (
    <main className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center p-6">
      <div className="w-full max-w-6xl space-y-8">
        {/* Header */}
        <header className="text-center space-y-4">
          <Link
            href="/app"
            className="inline-block text-sm text-emerald-400 hover:text-emerald-300 transition font-medium"
          >
            Dashboard
          </Link>
          <h1 className="text-4xl font-bold">Planes y Precios</h1>
          <p className="text-slate-400">
            Elige el plan que mejor se adapte a tus necesidades
          </p>
        </header>

        {/* Payment Status Banner */}
        <Suspense fallback={null}>
          <PricingPaymentStatus onPlanRefresh={handlePlanRefresh} />
        </Suspense>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((plan) => {
            const isCurrent = plan.name.toLowerCase() === currentPlan;
            const planCode = plan.name.toUpperCase();
            const isLoading = loadingPlan === planCode;
            
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
                  <span className="text-slate-400">Transferencia:</span>
                  <span className="font-semibold">
                    {plan.transfer_gb === null ? "Ilimitada ✨" : `${plan.transfer_gb} GB`}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">Max archivo:</span>
                  <span className="font-semibold">{plan.max_file_gb} GB</span>
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
              ) : plan.name === "Free" ? (
                <button
                  disabled
                  className="w-full rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold cursor-not-allowed opacity-50"
                >
                  Plan básico
                </button>
              ) : (
                <button
                  onClick={() => handleUpgrade(planCode)}
                  disabled={isLoading}
                  className="w-full rounded-lg bg-emerald-500 hover:bg-emerald-600 transition px-4 py-2 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoading ? "Procesando..." : "Actualizar"}
                </button>
              )}
            </div>
          );
          })}
        </div>

        {/* Error Message */}
        {errorMessage && (
          <div className="bg-red-900/20 border border-red-500 rounded-lg p-4 text-center">
            <p className="text-red-400 text-sm">{errorMessage}</p>
          </div>
        )}

        {/* Footer Note */}
        <p className="text-center text-sm text-slate-500">
          * Pagos seguros procesados por Stripe. Cancela cuando quieras.
        </p>
      </div>
    </main>
  );
}
