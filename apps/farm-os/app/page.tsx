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
  title: "مزرعة عُبيد للتمور · Ebeid Farm — Premium Barhi Dates",
  description:
    "Ebeid Farm — premium fresh Barhi dates from El-Sharkia, Egypt. GLOBALG.A.P. certified, approved for China (GACC), residue-free (QCAP). Single-source, fully traceable export supply.",
  openGraph: {
    title: "Ebeid Farm — Premium Fresh Barhi Dates · GLOBALG.A.P. · Approved for China",
    description:
      "Certified Egyptian exporter of fresh Barhi dates — 202 tons approved for China, GLOBALG.A.P. certified, fully traceable.",
    type: "website",
  },
};

export default function Home() {
  return <SiteLanding content={SITE_CONTENT_DEFAULTS} />;
}
