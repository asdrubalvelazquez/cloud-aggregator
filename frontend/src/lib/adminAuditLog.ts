export type AdminAuditEvent = {
  adminEmail: string;
  action: string;
  targetId: string;
  timestamp: string;
};

export function logAdminAction(event: AdminAuditEvent): void {
  console.log("[ADMIN_AUDIT]", event);
}
