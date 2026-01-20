"use client";

import { disconnectCloud, forceRefreshCloud } from "@/lib/adminActions";
import { useState } from "react";

export default function CloudsPage() {
  const [error, setError] = useState<string | null>(null);

  const mockClouds = [
    {
      id: 1,
      provider: "Google Drive",
      accountEmail: "user@test.com",
      ownerUser: "user@test.com",
      status: "Connected",
      lastSync: "5 min ago",
    },
    {
      id: 2,
      provider: "OneDrive",
      accountEmail: "alice@example.com",
      ownerUser: "alice@example.com",
      status: "Connected",
      lastSync: "10 min ago",
    },
    {
      id: 3,
      provider: "Google Drive",
      accountEmail: "bob@demo.com",
      ownerUser: "bob@demo.com",
      status: "Error",
      lastSync: "2 hours ago",
    },
    {
      id: 4,
      provider: "OneDrive",
      accountEmail: "charlie@site.com",
      ownerUser: "charlie@site.com",
      status: "Connected",
      lastSync: "1 min ago",
    },
  ];

  const handleDisconnect = async (cloudId: number) => {
    try {
      await disconnectCloud(String(cloudId));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Action failed";
      setError(message);
      console.error("Disconnect cloud error:", message);
    }
  };

  const handleForceReauth = async (cloudId: number) => {
    try {
      await forceRefreshCloud(String(cloudId));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Action failed";
      setError(message);
      console.error("Force reauth error:", message);
    }
  };

  return (
    <div>
      <h1 style={{ fontSize: "1.875rem", fontWeight: "bold", marginBottom: "2rem" }}>
        Clouds
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
                Provider
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
                Account Email
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
                Owner User
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
                Last Sync
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
            {mockClouds.map((cloud) => (
              <tr
                key={cloud.id}
                style={{
                  borderTop: "1px solid #e5e7eb",
                }}
              >
                <td
                  style={{
                    padding: "1rem",
                    fontSize: "0.875rem",
                    color: "#374151",
                    fontWeight: "500",
                  }}
                >
                  {cloud.provider}
                </td>
                <td
                  style={{
                    padding: "1rem",
                    fontSize: "0.875rem",
                    color: "#374151",
                  }}
                >
                  {cloud.accountEmail}
                </td>
                <td
                  style={{
                    padding: "1rem",
                    fontSize: "0.875rem",
                    color: "#374151",
                  }}
                >
                  {cloud.ownerUser}
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
                        cloud.status === "Connected" ? "#d1fae5" : "#fee2e2",
                      color: cloud.status === "Connected" ? "#065f46" : "#991b1b",
                    }}
                  >
                    {cloud.status}
                  </span>
                </td>
                <td
                  style={{
                    padding: "1rem",
                    fontSize: "0.875rem",
                    color: "#6b7280",
                  }}
                >
                  {cloud.lastSync}
                </td>
                <td
                  style={{
                    padding: "1rem",
                    fontSize: "0.875rem",
                  }}
                >
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button
                      onClick={() => handleDisconnect(cloud.id)}
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
                      Disconnect
                    </button>
                    <button
                      onClick={() => handleForceReauth(cloud.id)}
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
                      Force Reauth
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
