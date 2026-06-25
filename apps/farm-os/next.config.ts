import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Monorepo: pin Turbopack's workspace root to the repo root so it compiles the
  // workspace `@amrebeid/ui` package (outside apps/farm-os). Without this, Vercel's
  // `vercel build` infers the root as apps/farm-os and refuses to compile files outside
  // it → the build fails resolving the library + its styles.css.
  outputFileTracingRoot: path.join(__dirname, "..", ".."),
  // @amrebeid/ui statically re-exports Recharts-based chart components, so any
  // import from the library pulls Recharts into the server module graph.
  // Recharts 2.x is incompatible with React 19 under Next's server module
  // evaluation (its class components throw "Super expression must either be
  // null or a function" at import time). No Phase A route renders a chart, so
  // alias Recharts to a render-nothing stub on the server; the browser keeps
  // the real library so charts work client-side when introduced later.
  //
  // The library's components also use React context, so they are only imported
  // across a "use client" boundary (see components/ui.tsx) — context APIs are
  // unavailable to React Server Components.
  turbopack: {
    root: path.join(__dirname, "..", ".."),
    resolveAlias: {
      recharts: {
        browser: "recharts",
        default: "./recharts-stub.ts",
      },
    },
  },
  // Baseline HTTP security response headers applied to every route. These are
  // low-risk hardening headers only. A Content-Security-Policy is deliberately
  // omitted here — it has a high risk of breaking the app, Supabase, and Vercel
  // and needs dedicated tuning before it can be enabled safely.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
