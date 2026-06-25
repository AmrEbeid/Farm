import type { MetadataRoute } from "next";

// Farm OS is a private, auth-gated app — it must not be indexed by crawlers.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
  };
}
