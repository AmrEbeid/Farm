import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
    resolveAlias: {
      recharts: {
        browser: "recharts",
        default: "./recharts-stub.ts",
      },
    },
  },
};

export default nextConfig;
