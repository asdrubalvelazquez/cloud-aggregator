"use client";

import { useEffect, useState } from "react";
import { authenticatedFetch } from "@/lib/api";
import { formatStorageFromGB } from "@/lib/formatStorage";
import { supabase } from "@/lib/supabaseClient";

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
  const [userEmail, setUserEmail] = useState<string>("");

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

    const fetchUserEmail = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        setUserEmail(user?.email || "");
      } catch (e) {
        console.error("Failed to fetch user email:", e);
      }
    };

    fetchBillingQuota();
    fetchUserEmail();
  }, []);

  const trafficText = billingQuota?.transfer
    ? `Traffic: ${formatStorageFromGB(billingQuota.transfer.used_bytes / (1024 ** 3))} / ${
        billingQuota.transfer.limit_bytes !== null
          ? formatStorageFromGB(billingQuota.transfer.limit_bytes / (1024 ** 3))
          : "∞"
      }`
    : "Traffic: —";

  return (
    <div className="fixed top-0 left-0 right-0 z-40 bg-slate-900/80 backdrop-blur-md border-b border-slate-700/50">
      <div className="h-[52px] px-5 flex items-center justify-between gap-6">
        {/* LEFT: Brand */}
        <div className="flex items-center gap-3 min-w-[260px]">
          <img
            src="/logo.png"
            alt="Cloud Aggregator"
            className="h-7 w-7 rounded-md object-contain"
          />
          <div className="leading-tight">
            <div className="text-sm font-semibold text-white">Cloud Aggregator</div>
            {userEmail ? (
              <div className="text-xs text-slate-400">{userEmail}</div>
            ) : (
              <div className="text-xs text-slate-500"> </div>
            )}
          </div>
        </div>

        {/* CENTER: Tabs (placeholders) */}
        <nav className="hidden md:flex items-center gap-6 text-sm text-slate-400">
          {TABS.map((tab) => (
            <span
              key={tab.id}
              className="hover:text-slate-200 transition-colors cursor-default"
            >
              {tab.label}
            </span>
          ))}
        </nav>

        {/* RIGHT: Traffic pill */}
        <div className="flex items-center justify-end min-w-[220px]">
          <div className="px-3 py-1 bg-slate-800/60 border border-slate-700/50 rounded-full text-xs text-slate-200 font-medium">
            {trafficText}
          </div>
        </div>
      </div>
    </div>
  );
}
