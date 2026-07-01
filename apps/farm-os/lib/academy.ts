// Stage 10 (SPEC-0008 / non-negotiable #4) — the agronomy-content AUTHORITATIVENESS GATE. This is the
// engineering enforcement of the legal control: NPK/irrigation/**pesticide** figures are editable
// TEMPLATES, never authoritative prescriptions, UNTIL a named local agronomist signs off the figures
// AND (for any named chemical) a CURRENT Egyptian pesticide registration is on file. Until then content
// is "advisory" and MUST carry the "review with your agronomist" disclaimer.
//
// Pure + content-free: it judges a sign-off record, never stores or ships agronomy numbers. The content
// store, the editor, and the actual agronomist sign-off WORKFLOW are the gated remainder (they need the
// real expert). This module guarantees that nothing renders as authoritative without a valid sign-off.

import { fmtDate } from "./dates";

export interface SignOff {
  agronomistName: string; // the named local agronomist (required — #4)
  signedAt: string; // ISO date of sign-off
  scope?: string;
  pesticideRegValidUntil?: string | null; // Egyptian registration expiry (ISO); required iff chemical
}

export interface AcademyContent {
  id: string;
  title: string;
  hasChemical: boolean; // names a pesticide/chemical → triggers the registration requirement
  signOff?: SignOff | null;
}

export type Authoritativeness = "authoritative" | "advisory";

const isISO = (s: unknown): s is string => typeof s === "string" && !Number.isNaN(Date.parse(s));
const ms = (d: Date | string) => (typeof d === "string" ? Date.parse(d) : d.getTime());

/**
 * Decide whether content may be presented as AUTHORITATIVE. Authoritative ONLY if a named agronomist
 * signed off, AND — when the content names a chemical — a present, non-expired (as of `asOf`) Egyptian
 * pesticide registration is on file. Anything else (no sign-off, blank signer, missing/expired
 * registration on chemical content) is "advisory". `asOf` is passed in so the function stays pure.
 */
export function authoritativeness(c: AcademyContent, asOf: Date | string): Authoritativeness {
  const s = c.signOff;
  if (!s || typeof s.agronomistName !== "string" || s.agronomistName.trim() === "") return "advisory";
  if (!isISO(s.signedAt)) return "advisory";

  if (c.hasChemical) {
    // chemical content additionally needs a CURRENT Egyptian pesticide registration.
    if (!isISO(s.pesticideRegValidUntil ?? "")) return "advisory";
    const now = ms(asOf);
    const exp = Date.parse(s.pesticideRegValidUntil as string);
    if (Number.isNaN(now) || exp < now) return "advisory"; // expired / unknown → advisory
  }
  return "authoritative";
}

export interface Disclaimer {
  authoritative: boolean;
  ar: string; // the mandatory Arabic banner text
}

/**
 * The banner state to render. Advisory content ALWAYS carries the "review with your agronomist —
 * not approved" disclaimer (#4); authoritative content shows who approved it and when.
 */
export function disclaimer(c: AcademyContent, asOf: Date | string): Disclaimer {
  if (authoritativeness(c, asOf) === "authoritative") {
    return {
      authoritative: true,
      // fmtDate → Arabic-Indic digits (ar-EG); a raw ISO slice would leak Western digits into the RTL UI.
      ar: `معتمد من المهندس ${c.signOff!.agronomistName} — ${fmtDate(c.signOff!.signedAt)}`,
    };
  }
  return {
    authoritative: false,
    ar: "قالب استرشادي — راجِع مهندسك الزراعي قبل التطبيق (غير معتمد، ولا يُعدّ وصفة)",
  };
}
