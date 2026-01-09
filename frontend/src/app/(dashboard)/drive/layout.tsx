"use client";

import { CloudStatusProvider } from "@/context/CloudStatusContext";

/**
 * Drive Layout (Defensive Provider Wrapper)
 * 
 * HOTFIX: Ensures CloudStatusProvider wraps /drive/[id] routes.
 * This layout is a defensive measure to prevent "useCloudStatusContext 
 * must be used within CloudStatusProvider" errors in production.
 * 
 * The parent (dashboard)/layout.tsx already provides CloudStatusProvider,
 * but this ensures it's available even if there's a build/hydration issue.
 * 
 * Nested providers are safe in React - the innermost provider wins.
 */
export default function DriveLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <CloudStatusProvider>{children}</CloudStatusProvider>;
}
