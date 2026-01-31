"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authenticatedFetch } from "@/lib/api";
import PricingPaymentStatus from "@/components/PricingPaymentStatus";

type PlanFeatures = {
  storage: string;
  price_monthly: number;
  price_yearly: number;
  features: string[];
  isPopular?: boolean;
};

const planDetails: Record<string, PlanFeatures> = {
  free: {
    storage: "5GB",
    price_monthly: 0,
    price_yearly: 0,
    features: [
      "Cuentas ilimitadas (Google Drive & OneDrive)",
      "Copias ilimitadas",
      "5 GB de transferencia (lifetime)",
      "Archivos hasta 1 GB",
      "Detección de duplicados",
    ],
  },
  standard: {
    storage: "100GB",
    price_monthly: 9.99,
    price_yearly: 59.99,
    features: [
      "Cuentas ilimitadas",
      "Copias ilimitadas",
      "100 GB de transferencia/mes",
      "1200 GB de transferencia/año",
      "Archivos hasta 10 GB",
      "Todas las funciones Free",
      "Soporte prioritario",
    ],
    isPopular: true,
  },
  premium: {
    storage: "200GB",
    price_monthly: 17.99,
    price_yearly: 99.98,
    features: [
      "Cuentas ilimitadas",
      "Copias ilimitadas",
      "200 GB de transferencia/mes",
      "2400 GB de transferencia/año",
      "Archivos hasta 50 GB",
      "Todas las funciones Standard",
      "API access (próximamente)",
      "Soporte prioritario VIP",
    ],
  },
};

export default function PricingPage() {
  const router = useRouter();
  const [billingPeriod, setBillingPeriod] = useState<"MONTHLY" | "YEARLY">("MONTHLY");
  const [currentPlan, setCurrentPlan] = useState<string>("free");
  const [currentBillingPeriod, setCurrentBillingPeriod] = useState<string>("MONTHLY");
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
          const plan = data.plan?.toLowerCase() || "free";
          const billing = data.billing_period?.toUpperCase() || "MONTHLY";
          
          // Extract base plan name (remove _monthly or _yearly suffix)
          const basePlan = plan.replace(/_monthly|_yearly/, '');
          
          setCurrentPlan(basePlan);
          setCurrentBillingPeriod(billing);
        } else {
          setCurrentPlan("free");
          setCurrentBillingPeriod("MONTHLY");
        }
      } catch (e) {
        setCurrentPlan("free");
        setCurrentBillingPeriod("MONTHLY");
      }
    };
    fetchCurrentPlan();
  }, []);

  const handleUpgrade = async (basePlanName: string) => {
    if (basePlanName === "free") return;
    
    setErrorMessage("");
    setLoadingPlan(basePlanName);

    try {
      // Construct plan_code with billing frequency
      const billingFreq = billingPeriod === "YEARLY" ? "yearly" : "monthly";
      const plan_code = `${basePlanName}_${billingFreq}`;
      
      const res = await authenticatedFetch("/stripe/create-checkout-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ plan_code }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ detail: "Error desconocido" }));
        const errorMsg = typeof errorData.detail === "string" 
          ? errorData.detail 
          : errorData.detail?.message || "Error al crear sesión de pago";
        
        setErrorMessage(errorMsg);
        setLoadingPlan(null);
        return;
      }

      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setErrorMessage("No se recibió URL de checkout");
        setLoadingPlan(null);
      }
    } catch (error) {
      setErrorMessage("Error de red. Por favor intenta nuevamente.");
      setLoadingPlan(null);
    }
  };

  const getButtonText = (planName: string) => {
    if (planName === "free") {
      return currentPlan === "free" ? "Plan Actual" : "Downgrade no disponible";
    }
    
    if (currentPlan === planName) {
      // Same tier, check billing period
      if (currentBillingPeriod === billingPeriod) {
        return "Plan Actual";
      } else {
        return billingPeriod === "YEARLY" ? "Cambiar a Anual" : "Cambiar a Mensual";
      }
    }
    
    return "Seleccionar Plan";
  };

  const isButtonDisabled = (planName: string) => {
    if (planName === "free") return true;
    if (loadingPlan) return true;
    
    // Disable if same plan and same billing period
    if (currentPlan === planName && currentBillingPeriod === billingPeriod) {
      return true;
    }
    
    return false;
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

        {/* Billing Period Toggle */}
        <div className="flex justify-center mb-8">
          <div className="bg-slate-800 rounded-full p-1 border border-slate-700 inline-flex">
            <button
              onClick={() => setBillingPeriod("MONTHLY")}
              className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${
                billingPeriod === "MONTHLY"
                  ? "bg-emerald-500 text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Mensual
            </button>
            <button
              onClick={() => setBillingPeriod("YEARLY")}
              className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${
                billingPeriod === "YEARLY"
                  ? "bg-emerald-500 text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Anual
              <span className="ml-2 text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded">
                Ahorra 40%
              </span>
            </button>
          </div>
        </div>

        {/* Error Message */}
        {errorMessage && (
          <div className="bg-red-900/20 border border-red-500 rounded-lg p-4 text-center">
            <p className="text-red-400 text-sm">{errorMessage}</p>
          </div>
        )}

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {Object.entries(planDetails).map(([planName, plan]) => {
            const isCurrentPlan = currentPlan === planName && currentBillingPeriod === billingPeriod;
            const price = billingPeriod === "MONTHLY" ? plan.price_monthly : plan.price_yearly;
            const priceLabel = billingPeriod === "MONTHLY" ? "/mes" : "/año";
            
            return (
              <div
                key={planName}
                className={`bg-slate-800 rounded-xl p-6 border ${
                  plan.isPopular
                    ? "border-emerald-500 shadow-lg shadow-emerald-500/20 relative"
                    : isCurrentPlan
                    ? "border-blue-500 shadow-lg shadow-blue-500/20"
                    : "border-slate-700"
                } flex flex-col`}
              >
                {/* Popular Badge */}
                {plan.isPopular && (
                  <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                    <span className="bg-emerald-500 text-white text-xs font-bold px-3 py-1 rounded-full">
                      MÁS POPULAR
                    </span>
                  </div>
                )}

                {/* Current Plan Badge */}
                {isCurrentPlan && (
                  <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                    <span className="bg-blue-500 text-white text-xs font-bold px-3 py-1 rounded-full">
                      PLAN ACTUAL
                    </span>
                  </div>
                )}

                {/* Plan Header */}
                <div className="text-center mb-6 mt-2">
                  <h2 className="text-2xl font-bold mb-2 capitalize">{planName}</h2>
                  <p className="text-slate-400 text-sm mb-4">{plan.storage}/mes</p>
                  
                  <div className="flex items-baseline justify-center gap-1">
                    <span className="text-4xl font-bold">${price.toFixed(2)}</span>
                    <span className="text-slate-400 text-sm">{priceLabel}</span>
                  </div>
                  
                  {/* Yearly savings indicator */}
                  {billingPeriod === "YEARLY" && planName !== "free" && (
                    <p className="mt-2 text-xs text-emerald-400">
                      Ahorra ${(plan.price_monthly * 12 - plan.price_yearly).toFixed(2)} al año
                    </p>
                  )}
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
                <button
                  onClick={() => handleUpgrade(planName)}
                  disabled={isButtonDisabled(planName)}
                  className={`w-full rounded-lg px-4 py-3 text-sm font-semibold transition-all ${
                    isButtonDisabled(planName)
                      ? "bg-slate-700 cursor-not-allowed opacity-50"
                      : plan.isPopular
                      ? "bg-emerald-500 hover:bg-emerald-600"
                      : "bg-slate-700 hover:bg-slate-600"
                  }`}
                >
                  {loadingPlan === planName ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
                      Procesando...
                    </span>
                  ) : (
                    getButtonText(planName)
                  )}
                </button>
              </div>
            );
          })}
        </div>

        {/* Footer Note */}
        <p className="text-center text-sm text-slate-500">
          ✓ Todos los planes incluyen copias ilimitadas y detección de duplicados<br/>
          ¿Necesitas un plan personalizado? <a href="mailto:support@cloudaggregatorapp.com" className="text-emerald-400 hover:underline">Contáctanos</a>
        </p>
      </div>
    </main>
  );
}
