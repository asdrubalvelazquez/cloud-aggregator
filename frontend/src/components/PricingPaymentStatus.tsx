"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { authenticatedFetch } from "@/lib/api";

interface PricingPaymentStatusProps {
  onPlanRefresh?: (plan: string) => void;
}

export default function PricingPaymentStatus({ onPlanRefresh }: PricingPaymentStatusProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [successMessage, setSuccessMessage] = useState<string>("");
  const [cancelMessage, setCancelMessage] = useState<string>("");

  useEffect(() => {
    const paymentStatus = searchParams?.get("payment");
    const sessionId = searchParams?.get("session_id");

    if (paymentStatus === "success") {
      setSuccessMessage("¡Pago exitoso! Tu plan ha sido actualizado.");

      // Refrescar plan actual desde backend
      const refreshPlan = async () => {
        try {
          const res = await authenticatedFetch("/me/plan");
          if (res.ok) {
            const data = await res.json();
            const newPlan = data.plan?.toLowerCase() || "free";
            
            // Notificar al componente padre para actualizar UI
            if (onPlanRefresh) {
              onPlanRefresh(newPlan);
            }
          }
        } catch (e) {
          console.error("Error refreshing plan:", e);
        }
      };
      refreshPlan();

      // Limpiar URL después de 3 segundos
      setTimeout(() => {
        setSuccessMessage("");
        router.replace("/pricing", { scroll: false });
      }, 3000);

    } else if (paymentStatus === "cancel") {
      setCancelMessage("Pago cancelado. Puedes intentarlo nuevamente cuando desees.");

      // Limpiar URL después de 3 segundos
      setTimeout(() => {
        setCancelMessage("");
        router.replace("/pricing", { scroll: false });
      }, 3000);
    }
  }, [searchParams, router, onPlanRefresh]);

  // No renderizar nada si no hay mensajes
  if (!successMessage && !cancelMessage) {
    return null;
  }

  return (
    <>
      {/* Success Message */}
      {successMessage && (
        <div className="bg-emerald-900/20 border border-emerald-500 rounded-lg p-4 text-center mb-6 animate-fade-in">
          <p className="text-emerald-400 text-sm font-medium">{successMessage}</p>
        </div>
      )}

      {/* Cancel Message */}
      {cancelMessage && (
        <div className="bg-amber-900/20 border border-amber-500 rounded-lg p-4 text-center mb-6 animate-fade-in">
          <p className="text-amber-400 text-sm font-medium">{cancelMessage}</p>
        </div>
      )}
    </>
  );
}
