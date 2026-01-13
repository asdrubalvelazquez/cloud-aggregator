"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { authenticatedFetch } from "@/lib/api";
import { formatStorageFromGB } from "@/lib/formatStorage";
import { supabase } from "@/lib/supabaseClient";
import type { User } from "@supabase/supabase-js";

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
  const [user, setUser] = useState<User | null>(null);
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

    const fetchUser = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        setUser(user);
      } catch (e) {
        console.error("Failed to fetch user:", e);
      }
    };

    fetchBillingQuota();
    fetchUser();
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
    ? `${formatStorageFromGB(billingQuota.transfer.used_bytes / (1024 ** 3))} / ${
        billingQuota.transfer.limit_bytes !== null
          ? formatStorageFromGB(billingQuota.transfer.limit_bytes / (1024 ** 3))
          : "∞"
      }`
    : "—";

  // Extract avatar from user metadata (Google OAuth provides picture/avatar_url)
  const avatarUrl = user?.user_metadata?.avatar_url || user?.user_metadata?.picture || user?.user_metadata?.photo || null;
  const userInitial = user?.email?.[0]?.toUpperCase() || "?";

  return (
    <div className="fixed top-0 left-0 right-0 z-40 bg-slate-900/80 backdrop-blur-md border-b border-slate-700/50">
      <div className="h-[72px] px-5 flex items-center justify-between gap-6">
        {/* LEFT: Brand (Logo + App Name) */}
        <Link href="/app" className="flex items-center gap-3 hover:opacity-80 transition">
          <img
            src="/732fa691-7a06-42d0-acf2-4b6e300e8953.png"
            alt="Cloud Aggregator"
            className="w-12 h-12 object-contain"
          />
          <div className="text-[20px] font-semibold text-white leading-none">Cloud Aggregator</div>
        </Link>

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

        {/* RIGHT: Avatar + Traffic */}
        <div className="flex items-center gap-3 min-w-[140px] justify-end" ref={dropdownRef}>
          <button
            onClick={() => setIsDropdownOpen((v) => !v)}
            className="relative group flex flex-col items-center gap-1"
            title={user?.email || "User"}
          >
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt="User avatar"
                className="w-10 h-10 rounded-full border-2 border-slate-700 group-hover:border-slate-500 transition object-cover"
              />
            ) : (
              <div className="w-10 h-10 rounded-full border-2 border-slate-700 group-hover:border-slate-500 transition bg-slate-800 flex items-center justify-center text-slate-300 font-semibold">
                {userInitial}
              </div>
            )}
            <div className="text-[11px] text-slate-400 leading-none">
              Traffic: {trafficText}
            </div>
          </button>

          {/* Dropdown Menu */}
          {isDropdownOpen && (
            <div className="absolute top-full right-0 mt-2 w-60 bg-slate-800 border border-slate-700 rounded-lg shadow-xl py-1 z-50">
              {user?.email && (
                <div className="px-4 py-2 text-xs text-slate-400 border-b border-slate-700">
                  {user.email}
                </div>
              )}
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
    </div>
  );
}
