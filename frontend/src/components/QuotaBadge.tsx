"use client";

import { useEffect, useState } from "react";
import { authenticatedFetch } from "@/lib/api";

type QuotaInfo = {
  plan: string;
  used: number;
  limit: number;
  remaining: number;
};

type QuotaBadgeProps = {
  refreshKey?: number;
};

export default function QuotaBadge({ refreshKey = 0 }: QuotaBadgeProps) {
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchQuota();
  }, [refreshKey]); // Re-fetch when refreshKey changes

  const fetchQuota = async () => {
    try {
      const res = await authenticatedFetch("/me/plan");
      if (res.ok) {
        const quotaData = await res.json();
        setQuota(quotaData);
      }
    } catch (e) {
      // Gracefully fail - quota display is optional
      console.error("Failed to fetch quota:", e);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !quota) return null;

  return (
    <div className="text-sm text-gray-400">
      Copias este mes:{" "}
      <span className={quota.used >= quota.limit ? "text-red-400" : "text-white"}>
        {quota.used} / {quota.limit}
      </span>
    </div>
  );
}
