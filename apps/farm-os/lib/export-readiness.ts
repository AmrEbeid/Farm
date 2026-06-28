// Pure export-readiness check (SPEC-0016 §4). No I/O, no fabricated data: the destination MRLs and the
// PHI verdict are INPUTS supplied by the caller from authoritative sources (CLAUDE.md #1/#4 — the tool
// never invents a residue limit). Deterministic and side-effect-free, like the other lib/* cores.
//
// FAIL-CLOSED: anything unknown or missing makes a lot INELIGIBLE — an unknown MRL, no residue test, an
// expired/absent registration or accreditation. Compliance must never be asserted on missing evidence
// (the same discipline the stock engine applies to shortages). This INFORMS a human sign-off; it does
// not certify.

export interface ExportRegistration {
  market: string;
  status: string | null;
  valid_from: string | null;
  valid_to: string | null;
}
export interface ExportAccreditation {
  destination_market: string | null;
  crop: string | null;
  variety: string | null;
  valid_from: string | null;
  valid_to: string | null;
}
export interface ResidueResult {
  compound: string;
  value_mg_kg: number | null;
}
export interface ReadinessInput {
  /** Destination market code, e.g. 'CN'. */
  market: string;
  crop: string;
  variety: string;
  /** Date (yyyy-mm-dd) readiness is evaluated for, e.g. the intended ship date. */
  onDate: string;
  registrations: ExportRegistration[];
  accreditations: ExportAccreditation[];
  /** Residue results for the lot's test (empty = no test on file → fail-closed). */
  residueResults: ResidueResult[];
  /** Destination MRLs in mg/kg by compound, from the authoritative published list — NOT fabricated. */
  mrlByCompound: Record<string, number>;
  /** Whether the lot's source operations respected PHI/REI (SPEC-0008), supplied by that check. */
  phiRespected: boolean;
}
export interface ReadinessReason {
  code: "registration" | "accreditation" | "residue" | "phi";
  ok: boolean;
  detail: string;
}
export interface ReadinessResult {
  eligible: boolean;
  reasons: ReadinessReason[];
}

/** ISO yyyy-mm-dd strings compare lexicographically; null bound = open on that side. */
function withinWindow(onDate: string, from: string | null, to: string | null): boolean {
  return (from == null || onDate >= from) && (to == null || onDate <= to);
}

const eq = (a: string | null, b: string) => (a ?? "").trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Compute whether a harvest lot is export-eligible to a market. Eligible iff ALL of: a valid GACC/CIFER
 * registration for the market, a valid seasonal accreditation covering the crop/variety, every residue
 * result at-or-below the market MRL (with a known MRL), and PHI respected. Fail-closed throughout.
 */
export function computeExportReadiness(input: ReadinessInput): ReadinessResult {
  const { market, crop, variety, onDate, registrations, accreditations, residueResults, mrlByCompound, phiRespected } = input;
  const reasons: ReadinessReason[] = [];

  const reg = registrations.find(
    (r) => eq(r.market, market) && eq(r.status, "normal") && withinWindow(onDate, r.valid_from, r.valid_to),
  );
  reasons.push({
    code: "registration",
    ok: !!reg,
    detail: reg ? "تسجيل GACC ساري للسوق" : "لا يوجد تسجيل GACC ساري لهذا السوق",
  });

  const acc = accreditations.find(
    (a) => eq(a.destination_market, market) && eq(a.crop, crop) && eq(a.variety, variety) && withinWindow(onDate, a.valid_from, a.valid_to),
  );
  reasons.push({
    code: "accreditation",
    ok: !!acc,
    detail: acc ? "اعتماد المزرعة ساري للصنف والسوق" : "لا يوجد اعتماد مزرعة ساري للصنف/السوق",
  });

  // residue: need at least one result, and EVERY result must have a known MRL and be ≤ it (fail-closed
  // on an unknown MRL — we cannot certify a compound whose limit we don't have).
  const offending = residueResults.filter((r) => {
    const mrl = mrlByCompound[r.compound];
    return mrl === undefined || (r.value_mg_kg ?? Infinity) > mrl;
  });
  const residueOk = residueResults.length > 0 && offending.length === 0;
  reasons.push({
    code: "residue",
    ok: residueOk,
    detail:
      residueResults.length === 0
        ? "لا يوجد تحليل متبقيات على هذه الشحنة"
        : offending.length > 0
          ? `متبقيات تتجاوز الحد أو بلا حدّ معروف: ${offending.map((o) => o.compound).join("، ")}`
          : "كل المتبقيات ضمن الحد المسموح للسوق",
  });

  reasons.push({
    code: "phi",
    ok: phiRespected,
    detail: phiRespected ? "فترة ما قبل الحصاد محترمة" : "فترة ما قبل الحصاد (PHI) غير محترمة في عمليات المصدر",
  });

  return { eligible: reasons.every((r) => r.ok), reasons };
}
