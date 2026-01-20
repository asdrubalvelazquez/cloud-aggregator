import { redirect } from "next/navigation";
import { adminGuard } from "@/lib/adminGuard";

export default async function AdminPage() {
  await adminGuard();
  redirect("/admin/overview");
}
