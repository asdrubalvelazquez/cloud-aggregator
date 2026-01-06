import { SidebarLayout } from "@/components/sidebar/SidebarLayout";

/**
 * Layout for authenticated dashboard routes
 * Applies sidebar navigation to: /app, /drive/[id], /onedrive/[id]
 * Public routes (/, /login, /pricing, etc.) remain unchanged
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SidebarLayout>{children}</SidebarLayout>;
}
