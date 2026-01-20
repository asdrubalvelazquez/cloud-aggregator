import { logAdminAction } from "./adminAuditLog";

export async function suspendUser(userId: string): Promise<void> {
  logAdminAction({
    adminEmail: "admin@local",
    action: "suspendUser",
    targetId: userId,
    timestamp: new Date().toISOString(),
  });
  throw new Error("NOT_IMPLEMENTED");
}

export async function forceRefreshCloud(cloudId: string): Promise<void> {
  logAdminAction({
    adminEmail: "admin@local",
    action: "forceRefreshCloud",
    targetId: cloudId,
    timestamp: new Date().toISOString(),
  });
  throw new Error("NOT_IMPLEMENTED");
}

export async function disconnectCloud(cloudId: string): Promise<void> {
  logAdminAction({
    adminEmail: "admin@local",
    action: "disconnectCloud",
    targetId: cloudId,
    timestamp: new Date().toISOString(),
  });
  throw new Error("NOT_IMPLEMENTED");
}

export async function resyncBilling(userId: string): Promise<void> {
  logAdminAction({
    adminEmail: "admin@local",
    action: "resyncBilling",
    targetId: userId,
    timestamp: new Date().toISOString(),
  });
  throw new Error("NOT_IMPLEMENTED");
}
