import { SidebarLayout } from "@/components/sidebar/SidebarLayout";
import DashboardContextMenuBlocker from "@/components/DashboardContextMenuBlocker";
import { TransferQueuePanel } from "@/components/transfer-queue/TransferQueuePanel";
import { TransferQueueButton } from "@/components/transfer-queue/TransferQueueButton";
import { DashboardTopBar } from "@/components/DashboardTopBar";
import { Providers } from "./providers";
import { Toaster } from "react-hot-toast";

/**
 * Layout for authenticated dashboard routes
 * Applies sidebar navigation to: /app, /drive/[id], /onedrive/[id]
 * Public routes (/, /login, /pricing, etc.) remain unchanged
 * 
 * CRITICAL: 
 * - This layout is a Server Component (no "use client")
 * - <Providers> wrapper contains QueryClientProvider and other client-side providers
 * - Global context menu blocker wraps content to prevent native menu
 * - DashboardTopBar is fixed at top (requires pt-[56px] offset on main content)
 */

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Providers>
      <DashboardContextMenuBlocker>
        <DashboardTopBar />
        <div className="pt-[72px]">
          <SidebarLayout>{children}</SidebarLayout>
        </div>
        <TransferQueuePanel />
        <TransferQueueButton />
      </DashboardContextMenuBlocker>
      <Toaster
        position="bottom-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: "#1e293b",
            color: "#e2e8f0",
            border: "1px solid #334155",
          },
          success: {
            iconTheme: {
              primary: "#10b981",
              secondary: "#1e293b",
            },
          },
          error: {
            iconTheme: {
              primary: "#ef4444",
              secondary: "#1e293b",
            },
          },
        }}
      />
    </Providers>
  );
}
