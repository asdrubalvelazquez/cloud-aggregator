export default function SystemPage() {
  const mockMetrics = [
    {
      label: "Backend Status",
      value: "Healthy",
      status: "ok",
    },
    {
      label: "API Latency (avg)",
      value: "120ms",
      status: "ok",
    },
    {
      label: "OAuth Errors (24h)",
      value: "2",
      status: "warning",
    },
    {
      label: "Failed Jobs",
      value: "1",
      status: "warning",
    },
    {
      label: "Last Deploy",
      value: "2 hours ago",
      status: "ok",
    },
  ];

  return (
    <div>
      <h1 style={{ fontSize: "1.875rem", fontWeight: "bold", marginBottom: "2rem" }}>
        System
      </h1>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
          gap: "1.5rem",
        }}
      >
        {mockMetrics.map((metric, index) => (
          <div
            key={index}
            style={{
              backgroundColor: "#fff",
              padding: "1.5rem",
              borderRadius: "8px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            }}
          >
            <h3
              style={{
                fontSize: "0.875rem",
                color: "#666",
                marginBottom: "0.75rem",
              }}
            >
              {metric.label}
            </h3>
            <p
              style={{
                fontSize: "1.75rem",
                fontWeight: "bold",
                color: "#333",
              }}
            >
              {metric.value}
            </p>
            <div
              style={{
                marginTop: "0.5rem",
                fontSize: "0.75rem",
                color:
                  metric.status === "ok"
                    ? "#10b981"
                    : metric.status === "warning"
                    ? "#f59e0b"
                    : "#ef4444",
              }}
            >
              {metric.status === "ok" ? "✓ Normal" : "⚠ Review"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
