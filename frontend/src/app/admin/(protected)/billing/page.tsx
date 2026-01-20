"use client";

import { resyncBilling } from "@/lib/adminActions";
import { useState } from "react";

export default function BillingPage() {
  const [error, setError] = useState<string | null>(null);

  const mockSubscriptions = [
    {
      id: 1,
      userEmail: "user@test.com",
      plan: "Pro",
      stripeStatus: "Active",
      renewalDate: "2026-02-01",
    },
    {
      id: 2,
      userEmail: "alice@example.com",
      plan: "Free",
      stripeStatus: "N/A",
      renewalDate: "N/A",
    },
    {
      id: 3,
      userEmail: "bob@demo.com",
      plan: "Pro",
      stripeStatus: "Active",
      renewalDate: "2026-03-15",
    },
    {
      id: 4,
      userEmail: "charlie@site.com",
      plan: "Pro",
      stripeStatus: "Canceled",
      renewalDate: "2026-01-25",
    },
  ];

  const handleResync = async (userId: number) => {
    try {
      await resyncBilling(String(userId));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Action failed";
      setError(message);
      console.error("Resync billing error:", message);
    }
  };

  return (
    <div>
      <h1 style={{ fontSize: "1.875rem", fontWeight: "bold", marginBottom: "2rem" }}>
        Billing
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
                User Email
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
                Stripe Status
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
                Renewal Date
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
            {mockSubscriptions.map((sub) => (
              <tr
                key={sub.id}
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
                  {sub.userEmail}
                </td>
                <td
                  style={{
                    padding: "1rem",
                    fontSize: "0.875rem",
                    color: "#374151",
                    fontWeight: "500",
                  }}
                >
                  {sub.plan}
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
                        sub.stripeStatus === "Active"
                          ? "#d1fae5"
                          : sub.stripeStatus === "Canceled"
                          ? "#fee2e2"
                          : "#f3f4f6",
                      color:
                        sub.stripeStatus === "Active"
                          ? "#065f46"
                          : sub.stripeStatus === "Canceled"
                          ? "#991b1b"
                          : "#374151",
                    }}
                  >
                    {sub.stripeStatus}
                  </span>
                </td>
                <td
                  style={{
                    padding: "1rem",
                    fontSize: "0.875rem",
                    color: "#6b7280",
                  }}
                >
                  {sub.renewalDate}
                </td>
                <td
                  style={{
                    padding: "1rem",
                    fontSize: "0.875rem",
                  }}
                >
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button
                      onClick={() => handleResync(sub.id)}
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
                      Resync
                    </button>
                    <button
                      onClick={() => console.log("Cancel not implemented")}
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
                      Cancel
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
