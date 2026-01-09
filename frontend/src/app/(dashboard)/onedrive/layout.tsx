"use client";

/**
 * OneDrive Layout (Passthrough)
 * 
 * HOTFIX: Originally had nested CloudStatusProvider which caused provider split.
 * Now just a passthrough to ensure parent (dashboard)/layout.tsx provider is used.
 * This prevents isolated state and infinite loading issues.
 */
export default function OneDriveLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
