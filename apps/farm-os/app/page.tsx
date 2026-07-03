import type { Metadata } from "next";
import "./site.css";
import { SiteLanding } from "@/components/site/SiteLanding";
import { SITE_CONTENT_DEFAULTS } from "@/lib/site-content";

// Public, unauthenticated export-credibility website for Ebeid Farm. Server-rendered for SEO;
// the AR⇄EN toggle and text direction live in the SiteLanding client island. Phase 1 renders
// the typed defaults (real figures from the 2025 farm record + official certificates — nothing
// fabricated, non-negotiable #1). Phase 2 will read the same shape from the DB
// (fn_get_site_content) with these defaults as the fallback. Employee login lives in the
// header → /login → the Farm OS.

export const metadata: Metadata = {
  // `absolute` so the root layout's "· نظام تشغيل المزارع" template does NOT append the
  // internal app name to the public marketing page's <title>.
  title: { absolute: "مزرعة عُبيد للتمور · Ebeid Farm — Premium Barhi Dates" },
  description:
    "Ebeid Farm — premium fresh Barhi dates from El-Sharkia, Egypt. GLOBALG.A.P. certified, approved for China (GACC), residue-free (QCAP). Single-source, fully traceable export supply.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Ebeid Farm — Premium Fresh Barhi Dates · GLOBALG.A.P. · Approved for China",
    description:
      "Certified Egyptian exporter of fresh Barhi dates — 202 tons approved for China, GLOBALG.A.P. certified, fully traceable.",
    type: "website",
  },
};

// Organization structured data (schema.org) so search engines understand the exporter, its
// certifications, and how to contact it. All values are the real, owner-provided facts.
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Ebeid Farm",
  alternateName: "مزرعة عُبيد للتمور",
  legalName: "Obaid Company for Dates",
  url: "https://ebeidfarm.business",
  logo: "https://ebeidfarm.business/icon.png",
  image: "https://ebeidfarm.business/opengraph-image.png",
  description:
    "Certified Egyptian exporter of premium fresh Barhi dates from El-Sharkia — GLOBALG.A.P. certified, approved for China (GACC), residue-free (QCAP), single-source and fully traceable.",
  email: "ebeidfarm@gmail.com",
  telephone: "+201002174773",
  address: {
    "@type": "PostalAddress",
    streetAddress: "Abou Shalaby, Faqous",
    addressRegion: "El-Sharkia",
    addressCountry: "EG",
    postalCode: "44641",
  },
  areaServed: ["CN", "AE", "SA", "KW", "EU", "EG"],
  knowsAbout: ["Barhi dates", "date export", "GLOBALG.A.P.", "phytosanitary export"],
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <SiteLanding content={SITE_CONTENT_DEFAULTS} />
    </>
  );
}
