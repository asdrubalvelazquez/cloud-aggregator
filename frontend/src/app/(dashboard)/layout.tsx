import { SidebarLayout } from "@/components/sidebar/SidebarLayout";
import DashboardContextMenuBlocker from "@/components/DashboardContextMenuBlocker";
import { ClientNavProbe } from "@/components/debug/ClientNavProbe";
import { TransferQueuePanel } from "@/components/transfer-queue/TransferQueuePanel";
import { TransferQueueButton } from "@/components/transfer-queue/TransferQueueButton";
import { DashboardTopBar } from "@/components/DashboardTopBar";
import { Providers } from "./providers";

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
        <ClientNavProbe />
        <DashboardTopBar />
        <div className="pt-[56px]">
          <SidebarLayout>{children}</SidebarLayout>
        </div>
        <TransferQueuePanel />
        <TransferQueueButton />
      </DashboardContextMenuBlocker>
    </Providers>
  );
}
