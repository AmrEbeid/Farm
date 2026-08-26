import type { MetadataRoute } from "next";
import { sitePublicSitemap } from "@/lib/site-seo";

// Only the two public marketing pages belong in the sitemap. The rest of the app is auth-gated
// and returns a response-level no-index policy. Each entry carries the full hreflang alternate
// set (ar / en / x-default) from the same helper the pages use, so sitemap and <head> cannot disagree.
export default function sitemap(): MetadataRoute.Sitemap {
  return sitePublicSitemap();
}
