import type { Metadata } from "next";
import { SiteDetailPage } from "@/components/site/SiteDetailPage";
import type { Lang } from "@/lib/site-content";
import { loadSiteContent } from "@/lib/site-content-db";
import type { PublicSitePageKey } from "@/lib/site-public-pages";
import {
  serializeJsonLd,
  sitePageJsonLd,
  sitePageMetadata,
} from "@/lib/site-seo";

export async function generatePublicSitePageMetadata(
  lang: Lang,
  page: PublicSitePageKey,
): Promise<Metadata> {
  return sitePageMetadata(lang, page, await loadSiteContent());
}

export async function PublicSiteRoute({
  lang,
  page,
}: {
  lang: Lang;
  page: PublicSitePageKey;
}) {
  const content = await loadSiteContent();
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(sitePageJsonLd(lang, page, content)),
        }}
      />
      <SiteDetailPage content={content} lang={lang} page={page} />
    </>
  );
}
