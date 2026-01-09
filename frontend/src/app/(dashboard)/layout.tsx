import { SidebarLayout } from "@/components/sidebar/SidebarLayout";
import DashboardContextMenuBlocker from "@/components/DashboardContextMenuBlocker";
import { ClientNavProbe } from "@/components/debug/ClientNavProbe";
import { TransferQueueProvider } from "@/context/TransferQueueContext";
import { TransferQueuePanel } from "@/components/transfer-queue/TransferQueuePanel";
import { TransferQueueButton } from "@/components/transfer-queue/TransferQueueButton";

/**
 * Layout for authenticated dashboard routes
 * Applies sidebar navigation to: /app, /drive/[id], /onedrive/[id]
 * Public routes (/, /login, /pricing, etc.) remain unchanged
 * 
 * CRITICAL: Global context menu blocker wraps content to prevent native menu
 */

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <TransferQueueProvider>
      <DashboardContextMenuBlocker>
        <ClientNavProbe />
        <SidebarLayout>{children}</SidebarLayout>
        <TransferQueuePanel />
        <TransferQueueButton />
      </DashboardContextMenuBlocker>
    </TransferQueueProvider>
  );
}
