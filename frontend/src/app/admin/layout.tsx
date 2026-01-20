"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const navItems = [
    { label: "Overview", href: "/admin/overview" },
    { label: "Users", href: "/admin/users" },
    { label: "Clouds", href: "/admin/clouds" },
    { label: "Billing", href: "/admin/billing" },
    { label: "System", href: "/admin/system" },
  ];

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {/* Sidebar */}
      <aside
        style={{
          width: "240px",
          backgroundColor: "#1a1a2e",
          color: "#fff",
          padding: "2rem 1rem",
        }}
      >
        <h2 style={{ fontSize: "1.25rem", fontWeight: "bold", marginBottom: "2rem" }}>
          Admin Panel
        </h2>
        <nav>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <li key={item.href} style={{ marginBottom: "1rem" }}>
                  <Link
                    href={item.href}
                    style={{
                      display: "block",
                      padding: "0.5rem",
                      color: "#fff",
                      textDecoration: "none",
                      cursor: "pointer",
                    }}
                  >
                    {item.label} {isActive && "[active]"}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>

      {/* Main Content */}
      <main style={{ flex: 1, backgroundColor: "#f5f5f5", padding: "2rem" }}>
        {children}
      </main>
    </div>
  );
}
