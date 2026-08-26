import type { Metadata } from "next";
import "../../site.css";
import { SiteLanding } from "@/components/site/SiteLanding";
import { PublicSiteAnalytics } from "@/components/site/PublicSiteAnalytics";
import { serializeJsonLd, siteJsonLd, siteMetadata } from "@/lib/site-seo";
import { loadSiteContent } from "@/lib/site-content-db";

// Same ISR contract as the Arabic home; the editor revalidates both public paths on save.
export const revalidate = 300;

// The ENGLISH public page. Its own URL (not a client-side toggle on `/`) so the English copy is
// server-rendered, crawlable and linkable on its own; `/` stays the Arabic canonical home.
// Metadata, hreflang and JSON-LD come from the shared helper so the two routes cannot drift.

export async function generateMetadata(): Promise<Metadata> {
  return siteMetadata("en", await loadSiteContent());
}

export default async function EnglishHome() {
  const content = await loadSiteContent();
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(siteJsonLd("en", content)) }}
      />
      <SiteLanding content={content} lang="en" />
      <PublicSiteAnalytics />
    </>
  );
}
