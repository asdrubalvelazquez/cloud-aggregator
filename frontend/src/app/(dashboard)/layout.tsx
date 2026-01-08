import { SidebarLayout } from "@/components/sidebar/SidebarLayout";
import DashboardContextMenuBlocker from "@/components/DashboardContextMenuBlocker";
import { ClientNavProbe } from "@/components/debug/ClientNavProbe";

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
    <DashboardContextMenuBlocker>
      <ClientNavProbe />
      <SidebarLayout>{children}</SidebarLayout>
    </DashboardContextMenuBlocker>
  );
}
