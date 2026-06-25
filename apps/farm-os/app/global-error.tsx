"use client";

// Global error boundary — replaces the root layout when the layout itself (or
// anything above the (app) segment) throws. Because it stands in for the root
// layout, it MUST render its own <html>/<body>. The @amrebeid/ui ThemeProvider
// is intentionally not used here: this boundary has to work even when layout
// setup is what failed, so we keep it dependency-light and inline-styled.
// RTL is preserved via lang="ar" dir="rtl". Raw error details are logged to the
// console only, never shown to the user.
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Diagnostics only — not shown to the user.
    console.error("[global] root error:", error);
  }, [error]);

  return (
    <html lang="ar" dir="rtl">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Tahoma, Arial, sans-serif",
          backgroundColor: "#f6f7f6",
          color: "#1a1a1a",
        }}
      >
        <main
          style={{
            maxWidth: "32rem",
            width: "100%",
            textAlign: "center",
            backgroundColor: "#ffffff",
            border: "1px solid rgba(0,0,0,0.08)",
            borderRadius: "0.75rem",
            padding: "2rem",
          }}
        >
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: "0 0 0.5rem" }}>
            حدث خطأ غير متوقع
          </h1>
          <p style={{ color: "#555", margin: "0 0 1.5rem", lineHeight: 1.6 }}>
            نعتذر عن هذا الخلل. يُرجى إعادة المحاولة، وإذا استمرت المشكلة تواصل مع
            الدعم.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              backgroundColor: "#2f7d49",
              color: "#ffffff",
              border: "none",
              borderRadius: "0.5rem",
              padding: "0.625rem 1.25rem",
              fontSize: "1rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            إعادة المحاولة
          </button>
        </main>
      </body>
    </html>
  );
}
