export default function OverviewPage() {
  return (
    <div>
      <h1 style={{ fontSize: "1.875rem", fontWeight: "bold", marginBottom: "2rem" }}>
        Overview
      </h1>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
          gap: "1.5rem",
        }}
      >
        {/* Total Users */}
        <div
          style={{
            backgroundColor: "#fff",
            padding: "1.5rem",
            borderRadius: "8px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        >
          <h3 style={{ fontSize: "0.875rem", color: "#666", marginBottom: "0.5rem" }}>
            Total Users
          </h3>
          <p style={{ fontSize: "2rem", fontWeight: "bold", color: "#333" }}>123</p>
        </div>

        {/* Active Users (7d) */}
        <div
          style={{
            backgroundColor: "#fff",
            padding: "1.5rem",
            borderRadius: "8px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        >
          <h3 style={{ fontSize: "0.875rem", color: "#666", marginBottom: "0.5rem" }}>
            Active Users (7d)
          </h3>
          <p style={{ fontSize: "2rem", fontWeight: "bold", color: "#333" }}>45</p>
        </div>

        {/* Connected Clouds */}
        <div
          style={{
            backgroundColor: "#fff",
            padding: "1.5rem",
            borderRadius: "8px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        >
          <h3 style={{ fontSize: "0.875rem", color: "#666", marginBottom: "0.5rem" }}>
            Connected Clouds
          </h3>
          <p style={{ fontSize: "2rem", fontWeight: "bold", color: "#333" }}>67</p>
        </div>

        {/* Active Subscriptions */}
        <div
          style={{
            backgroundColor: "#fff",
            padding: "1.5rem",
            borderRadius: "8px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        >
          <h3 style={{ fontSize: "0.875rem", color: "#666", marginBottom: "0.5rem" }}>
            Active Subscriptions
          </h3>
          <p style={{ fontSize: "2rem", fontWeight: "bold", color: "#333" }}>12</p>
        </div>
      </div>
    </div>
  );
}
