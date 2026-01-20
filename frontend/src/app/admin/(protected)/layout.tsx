import { adminGuard } from "@/lib/adminGuard";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await adminGuard();
  return <>{children}</>;
}
