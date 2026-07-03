import type { MetadataRoute } from "next";

// The home page `/` is now a PUBLIC export-credibility website we WANT indexed (buyers searching
// "Egypt Barhi dates exporter"). Everything else is the private, auth-gated Farm OS and must stay
// out of the index. So: allow the root page + the public assets it needs to render, disallow the
// rest. `Disallow: /` + `Allow: /$` (exact root, longest-match wins) blocks the app WITHOUT
// enumerating its route names in robots.txt.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: [
        "/$",
        "/site/",
        "/icons/",
        "/icon.png",
        "/apple-icon.png",
        "/opengraph-image.png",
        "/twitter-image.png",
        "/manifest.webmanifest",
      ],
      disallow: "/",
    },
    sitemap: "https://ebeidfarm.business/sitemap.xml",
  };
}
