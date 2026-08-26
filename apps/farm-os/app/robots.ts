import type { MetadataRoute } from "next";

// Crawlers must be able to request private route URLs in order to observe their
// `X-Robots-Tag: noindex` response. Authentication protects the data; the sitemap lists only
// routes from the typed public-site registry that are eligible for indexing.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: "https://ebeidfarm.business/sitemap.xml",
  };
}
