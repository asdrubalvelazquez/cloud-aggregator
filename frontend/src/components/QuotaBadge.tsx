"use client";

import { useEffect, useState } from "react";
import { authenticatedFetch } from "@/lib/api";
import ProgressBar from "./ProgressBar";

type TransferInfo = {
  plan: string;
  used_gb: number;
  limit_gb: number | null;
  used_bytes: number;
  limit_bytes: number | null;
};

type TransferBadgeProps = {
  refreshKey?: number;
};

/**
 * TransferBadge - Displays transfer quota (MultCloud model)
 * Shows only transfer bandwidth usage (no copies, no slots)
 */
export default function TransferBadge({ refreshKey = 0 }: TransferBadgeProps) {
  const [transfer, setTransfer] = useState<TransferInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTransfer();
  }, [refreshKey]);

  const fetchTransfer = async () => {
    try {
      const res = await authenticatedFetch("/billing/quota");
      if (res.ok) {
        const data = await res.json();
        setTransfer({
          plan: data.plan,
          used_gb: data.transfer.used_gb,
          limit_gb: data.transfer.limit_gb,
          used_bytes: data.transfer.used_bytes,
          limit_bytes: data.transfer.limit_bytes,
        });
      }
    } catch (e) {
      console.error("Failed to fetch transfer:", e);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !transfer) return null;

  return (
    <div className="text-sm bg-slate-800 rounded-lg p-3 border border-slate-700">
      <div className="flex items-center justify-between mb-1">
        <span className="text-slate-400">Tráfico:</span>
        <span className="text-white font-semibold">
          {transfer.limit_gb === null 
            ? "Ilimitado ✨" 
            : `${transfer.used_gb.toFixed(2)} / ${transfer.limit_gb} GB`
          }
        </span>
      </div>
      {transfer.limit_bytes !== null && transfer.limit_bytes > 0 && (
        <ProgressBar
          current={transfer.used_bytes}
          total={transfer.limit_bytes}
          height="sm"
        />
      )}
    </div>
  );
}
