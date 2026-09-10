export default function HomePage() {
  return (
    <main style={{ maxWidth: 620, margin: "4rem auto", padding: "1.5rem", textAlign: "center" }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.75rem" }}>
        Research Submission Platform
      </h1>
      <p style={{ color: "#555", marginBottom: "1.5rem" }}>
        This is a working test deployment.
      </p>
      <a
        href="/submit"
        style={{
          display: "inline-block",
          padding: "0.75rem 1.5rem",
          background: "#2563eb",
          color: "white",
          borderRadius: "6px",
          textDecoration: "none",
          fontWeight: 600,
        }}
      >
        Go to the submission form
      </a>
    </main>
  );
}
