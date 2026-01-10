"use client";

import { useEffect, useState } from "react";
import { authenticatedFetch } from "@/lib/api";
import { formatStorageFromGB } from "@/lib/formatStorage";

type BillingQuota = {
  plan: string;
  plan_type: string;
  transfer: {
    used_bytes: number;
    limit_bytes: number | null;
    used_gb: number;
    limit_gb: number | null;
    is_lifetime: boolean;
  };
} | null;

const TABS = [
  { id: "cloud-to-cloud", label: "Cloud-to-cloud Transfer" },
  { id: "instagram", label: "Instagram Downloader" },
  { id: "video", label: "Video Downloader" },
  { id: "web-image", label: "Web Image Downloader" },
];

export function DashboardTopBar() {
  const [billingQuota, setBillingQuota] = useState<BillingQuota>(null);

  useEffect(() => {
    const fetchBillingQuota = async () => {
      try {
        const res = await authenticatedFetch("/billing/quota");
        if (res.ok) {
          const data = await res.json();
          setBillingQuota(data);
        }
      } catch (e) {
        console.error("Failed to fetch billing quota for top bar:", e);
      }
    };

    fetchBillingQuota();
  }, []);

  const trafficText = billingQuota?.transfer
    ? `Traffic: ${formatStorageFromGB(billingQuota.transfer.used_bytes / (1024 ** 3))} / ${
        billingQuota.transfer.limit_bytes !== null
          ? formatStorageFromGB(billingQuota.transfer.limit_bytes / (1024 ** 3))
          : "∞"
      }`
    : "Traffic: —";

  return (
    <div className="fixed top-0 left-0 right-0 z-40 backdrop-blur-md bg-slate-900/80 border-b border-slate-700/50">
      <div className="flex items-center justify-between px-6 py-3">
        {/* Tabs */}
        <div className="flex items-center gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              disabled
              className="px-4 py-1.5 text-sm text-slate-400 hover:text-slate-300 hover:bg-slate-800/50 rounded transition cursor-not-allowed"
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Traffic Pill */}
        <div className="px-3 py-1 bg-slate-800/60 border border-slate-700/50 rounded-full text-xs text-slate-300 font-medium">
          {trafficText}
        </div>
      </div>
    </div>
  );
}
