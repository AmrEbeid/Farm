import type { MetadataRoute } from "next";

// Only the public marketing home is indexable; the rest of the app is auth-gated and disallowed
// in robots.ts. Single-entry sitemap keeps that explicit.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://ebeidfarm.business/",
      changeFrequency: "monthly",
      priority: 1,
    },
  ];
}
