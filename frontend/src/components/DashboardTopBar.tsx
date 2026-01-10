"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
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
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsDropdownOpen(false);
      }
    };

    if (isDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isDropdownOpen]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

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
        {/* LEFT: Brand + Email + Traffic */}
        <div className="flex flex-col leading-tight min-w-[280px]">
          <Link href="/app" className="flex items-center gap-3 hover:opacity-80 transition">
            <img
              src="/732fa691-7a06-42d0-acf2-4b6e300e8953.png"
              alt="Cloud Aggregator"
              className="w-10 h-10 rounded-md object-contain"
            />
            <span className="text-[16px] font-semibold text-white">Cloud Aggregator</span>
          </Link>

          <div className="relative ml-[52px]" ref={dropdownRef}>
            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="flex flex-col leading-tight hover:bg-slate-800/50 px-2 py-1 rounded transition"
            >
              {userEmail ? (
                <div className="text-[12.5px] text-slate-400">{userEmail}</div>
              ) : (
                <div className="text-[12.5px] text-slate-500"> </div>
              )}
            </button>
            <div className="text-[11px] text-slate-500 px-2">{trafficText}</div>

            {/* Dropdown Menu */}
            {isDropdownOpen && (
              <div className="absolute top-full mt-2 left-0 w-48 bg-slate-800 border border-slate-700 rounded-lg shadow-xl py-1 z-50">
                <button className="w-full text-left px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 transition">
                  Settings
                </button>
                <button className="w-full text-left px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 transition">
                  Language
                </button>
                <button className="w-full text-left px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 transition">
                  Help
                </button>
                <div className="border-t border-slate-700 my-1" />
                <button
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-slate-700 transition"
                >
                  Logout
                </button>
              </div>
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

        {/* RIGHT: Spacer for balance */}
        <div className="min-w-[220px]" />
      </div>
    </div>
  );
}
