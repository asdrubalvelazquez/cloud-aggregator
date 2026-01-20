import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import type { User } from "@supabase/supabase-js";

export async function adminGuard(): Promise<User> {
  const cookieStore = await cookies();
  
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
      },
    }
  );

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session || !session.user?.email) {
    redirect("/");
  }

  const adminEmails = process.env.ADMIN_EMAILS || "";
  const adminList = adminEmails
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);

  if (!adminList.includes(session.user.email.toLowerCase())) {
    redirect("/app");
  }

  return session.user;
}
