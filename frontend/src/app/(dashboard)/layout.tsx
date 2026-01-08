"use client";

import { SidebarLayout } from "@/components/sidebar/SidebarLayout";
import DashboardContextMenuBlocker from "@/components/DashboardContextMenuBlocker";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Layout for authenticated dashboard routes
 * Applies sidebar navigation to: /app, /drive/[id], /onedrive/[id]
 * Public routes (/, /login, /pricing, etc.) remain unchanged
 * 
 * CRITICAL: Global context menu blocker wraps content to prevent native menu
 */

function LayoutMountProbe() {
  const pathname = usePathname();
  
  useEffect(() => {
    const count = parseInt(sessionStorage.getItem("ca_layout_mounts") || "0") + 1;
    sessionStorage.setItem("ca_layout_mounts", count.toString());
    console.log(`[LAYOUT_MOUNT] count=${count} path=${pathname}`);
    
    return () => {
      console.log(`[LAYOUT_UNMOUNT] path=${pathname}`);
    };
  }, [pathname]);
  
  return null;
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DashboardContextMenuBlocker>
      <LayoutMountProbe />
      <SidebarLayout>{children}</SidebarLayout>
    </DashboardContextMenuBlocker>
  );
}
