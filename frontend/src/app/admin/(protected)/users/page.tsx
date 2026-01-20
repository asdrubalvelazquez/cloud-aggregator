"use client";

import { suspendUser } from "@/lib/adminActions";
import { useState } from "react";

export default function UsersPage() {
  const [error, setError] = useState<string | null>(null);

  const mockUsers = [
    { id: 1, email: "user@test.com", plan: "Pro", status: "Active", clouds: 2 },
    { id: 2, email: "alice@example.com", plan: "Free", status: "Active", clouds: 1 },
    { id: 3, email: "bob@demo.com", plan: "Pro", status: "Suspended", clouds: 3 },
    { id: 4, email: "charlie@site.com", plan: "Free", status: "Active", clouds: 0 },
  ];

  const handleSuspendUser = async (userId: number) => {
    try {
      await suspendUser(String(userId));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Action failed";
      setError(message);
      console.error("Suspend user error:", message);
    }
  };

  return (
    <div>
      <h1 style={{ fontSize: "1.875rem", fontWeight: "bold", marginBottom: "2rem" }}>
        Users
      </h1>

      {error && (
        <div style={{ padding: "1rem", marginBottom: "1rem", backgroundColor: "#fee2e2", color: "#991b1b", borderRadius: "4px" }}>
          {error}
        </div>
      )}

      <div
        style={{
          backgroundColor: "#fff",
          borderRadius: "8px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          overflow: "hidden",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ backgroundColor: "#f9fafb" }}>
              <th
                style={{
                  padding: "0.75rem 1rem",
                  textAlign: "left",
                  fontSize: "0.75rem",
                  fontWeight: "600",
                  color: "#6b7280",
                  textTransform: "uppercase",
                }}
              >
                Email
              </th>
              <th
                style={{
                  padding: "0.75rem 1rem",
                  textAlign: "left",
                  fontSize: "0.75rem",
                  fontWeight: "600",
                  color: "#6b7280",
                  textTransform: "uppercase",
                }}
              >
                Plan
              </th>
              <th
                style={{
                  padding: "0.75rem 1rem",
                  textAlign: "left",
                  fontSize: "0.75rem",
                  fontWeight: "600",
                  color: "#6b7280",
                  textTransform: "uppercase",
                }}
              >
                Status
              </th>
              <th
                style={{
                  padding: "0.75rem 1rem",
                  textAlign: "left",
                  fontSize: "0.75rem",
                  fontWeight: "600",
                  color: "#6b7280",
                  textTransform: "uppercase",
                }}
              >
                Clouds
              </th>
              <th
                style={{
                  padding: "0.75rem 1rem",
                  textAlign: "left",
                  fontSize: "0.75rem",
                  fontWeight: "600",
                  color: "#6b7280",
                  textTransform: "uppercase",
                }}
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {mockUsers.map((user) => (
              <tr
                key={user.id}
                style={{
                  borderTop: "1px solid #e5e7eb",
                }}
              >
                <td
                  style={{
                    padding: "1rem",
                    fontSize: "0.875rem",
                    color: "#374151",
                  }}
                >
                  {user.email}
                </td>
                <td
                  style={{
                    padding: "1rem",
                    fontSize: "0.875rem",
                    color: "#374151",
                  }}
                >
                  {user.plan}
                </td>
                <td
                  style={{
                    padding: "1rem",
                    fontSize: "0.875rem",
                  }}
                >
                  <span
                    style={{
                      padding: "0.25rem 0.5rem",
                      borderRadius: "4px",
                      fontSize: "0.75rem",
                      fontWeight: "500",
                      backgroundColor:
                        user.status === "Active" ? "#d1fae5" : "#fee2e2",
                      color: user.status === "Active" ? "#065f46" : "#991b1b",
                    }}
                  >
                    {user.status}
                  </span>
                </td>
                <td
                  style={{
                    padding: "1rem",
                    fontSize: "0.875rem",
                    color: "#374151",
                  }}
                >
                  {user.clouds}
                </td>
                <td
                  style={{
                    padding: "1rem",
                    fontSize: "0.875rem",
                  }}
                >
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button
                      onClick={() => handleSuspendUser(user.id)}
                      style={{
                        padding: "0.375rem 0.75rem",
                        fontSize: "0.75rem",
                        fontWeight: "500",
                        color: "#374151",
                        backgroundColor: "#f9fafb",
                        border: "1px solid #d1d5db",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                    >
                      Suspend
                    </button>
                    <button
                      onClick={() => console.log("Force refresh not implemented")}
                      style={{
                        padding: "0.375rem 0.75rem",
                        fontSize: "0.75rem",
                        fontWeight: "500",
                        color: "#374151",
                        backgroundColor: "#f9fafb",
                        border: "1px solid #d1d5db",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                    >
                      Force Refresh
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
