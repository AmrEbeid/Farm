import type { Metadata } from "next";
import { SiteLanding } from "@/components/site/SiteLanding";
import { PublicSiteAnalytics } from "@/components/site/PublicSiteAnalytics";
import { serializeJsonLd, siteJsonLd, siteMetadata } from "@/lib/site-seo";
import { loadSiteContent } from "@/lib/site-content-db";

// ISR: statically rendered, re-read from the DB at most every 5 min; the editor's server action
// also revalidatePath("/") on save for an immediate refresh. Falls back to the typed defaults when
// the DB is unconfigured / the table isn't applied yet, so the build stays green.
export const revalidate = 300;

// Public, unauthenticated export-credibility website for Ebeid Farm — the ARABIC canonical home.
// The English translation is its own crawlable route at /en; the two are tied
// together by the canonical + hreflang set in lib/site-seo.ts. Employee login lives in the
// header → /login → the Farm OS.

export async function generateMetadata(): Promise<Metadata> {
  return siteMetadata("ar", await loadSiteContent());
}

export default async function Home() {
  const content = await loadSiteContent();
  return (
    <>
      {/* Keep search-engine contact data on the same owner-managed source as the visible links. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(siteJsonLd("ar", content)) }}
      />
      <SiteLanding content={content} lang="ar" />
      <PublicSiteAnalytics />
    </>
  );
}
