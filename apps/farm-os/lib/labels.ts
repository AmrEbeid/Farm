/**
 * Arabic labels for raw DB enum values rendered to users (non-negotiable #2).
 *
 * Operation status (`plan_operations.status`, free text: planned/approved/
 * in_progress/done) was being rendered raw — unlike purchase-request status,
 * which already maps through a PR_STATUS_AR table. The Arabic chosen here matches
 * the `statusFor()` cases in `components/SimpleTable.tsx` so the status pill keeps
 * the correct colour (مخطط→active, معتمد/منفذ→done).
 */
export const OP_STATUS_AR: Record<string, string> = {
  planned: "مخطط",
  approved: "معتمد",
  reserved: "محجوز",
  ready: "جاهز",
  in_progress: "قيد التنفيذ",
  done: "منفذ",
  blocked: "محظور",
  abandoned: "ملغاة",
  skipped: "متخطّاة",
};

/**
 * Terminal / non-executable operation statuses — an op in one of these cannot be executed.
 * Mirrors the fn_execute_operation server guard (migration 0057): `blocked`/`abandoned`/`skipped`
 * are terminal/cancelled (executing them would issue stock for a dead op) and `done` is already
 * executed. Defined as the NEGATIVE set (like the RPC) so any active status — planned, approved,
 * reserved, ready, in_progress — is executable without having to be enumerated. Used to gate the
 * execute affordances (`/m`, `/m/execute/[opId]`) so they match the server, not as the enforcement
 * itself (the RPC is the enforcement).
 */
const NON_EXECUTABLE_OP_STATUSES = new Set(["done", "blocked", "abandoned", "skipped"]);

export function isExecutableOpStatus(status: string | null | undefined): boolean {
  return !NON_EXECUTABLE_OP_STATUSES.has(status ?? "planned");
}

/** Operation subtype (`plan_operations.subtype`) → Arabic. Centralized so a new subtype is
 *  translated everywhere at once (it was duplicated in 8 screens; "pollination" got missed). */
export const SUBTYPE_AR: Record<string, string> = {
  fertilization: "تسميد",
  irrigation: "ري",
  spraying: "رش",
  pollination: "تلقيح",
  inspection: "تفتيش",
  // Not yet offered by OperationBuilder's fixed <select> — only reachable today via an
  // instantiated operation template (fn_instantiate_operation_template). Matches the eventual
  // controlled vocabulary text (SPEC-0019 / PR #543, not merged) without depending on it.
  pest_scouting: "فحص مصائد السوسة",
};

/**
 * Dose-bearing operation subtypes (docs/CLAUDE.md non-negotiable #4 — agronomist-signoff-gate).
 * These are the subtypes whose plan_material_requirements carry an actual NPK/pesticide DOSE
 * decision, not just a logistics quantity — so until a named agronomist signs off, the op is a
 * TEMPLATE, not a prescription. Deliberately a small, explicit, extensible constant (not an
 * inference from arbitrary material categories) — mirrors the migration's authorize()
 * agronomy.signoff gate, which only distinguishes WHO may sign, not WHICH ops need it (that's here).
 * Extend this list — not a magic rule — as new dose-bearing subtypes are added.
 */
export const DOSE_BEARING_SUBTYPES: ReadonlySet<string> = new Set(["fertilization", "spraying"]);

export function isDoseBearingSubtype(subtype: string | null | undefined): boolean {
  return DOSE_BEARING_SUBTYPES.has(subtype ?? "");
}

/** An op is pending agronomist sign-off when it is dose-bearing and neither sign-off column is set. */
export function isPendingSignoff(
  subtype: string | null | undefined,
  signedOffBy: string | null | undefined,
): boolean {
  return isDoseBearingSubtype(subtype) && !signedOffBy;
}

export const PLAN_TYPE_AR: Record<string, string> = {
  weekly: "أسبوعية",
  monthly: "شهرية",
  quarterly: "ربع سنوية",
  annual: "سنوية",
};

export const PLAN_STATUS_AR: Record<string, string> = {
  draft: "مسودة",
  active: "نشطة",
  closed: "مغلقة",
  abandoned: "ملغاة",
};

export const MOVEMENT_TYPE_AR: Record<string, string> = {
  receipt: "استلام",
  issue: "صرف",
  return: "مرتجع",
  adjustment: "تسوية",
  transfer: "تحويل",
  loss: "فاقد",
  expiry: "منتهي",
  reserve: "حجز",
  release: "فك حجز",
};

export const BUDGET_STATUS_AR: Record<string, string> = {
  draft: "مسودة",
  active: "نشطة",
  approved: "معتمدة",
  closed: "مغلقة",
  archived: "مؤرشفة",
};

export const EXPENSE_STATUS_AR: Record<string, string> = {
  draft: "مسودة",
  posted: "مرحّلة",
  paid: "مدفوعة",
  approved: "معتمدة",
  void: "ملغاة",
  cancelled: "ملغاة",
};

export const PAYMENT_METHOD_AR: Record<string, string> = {
  cash: "نقدي",
  bank: "تحويل بنكي",
  transfer: "تحويل",
  card: "بطاقة",
  check: "شيك",
  cheque: "شيك",
  credit: "آجل",
};

export const EMP_TYPE_AR: Record<string, string> = {
  permanent: "دائم",
  seasonal: "موسمي",
  daily: "يومي",
  contractor: "مقاول",
};

/** RPW-1: pest-trap status (`pest_traps.status`) → Arabic. */
export const TRAP_STATUS_AR: Record<string, string> = {
  active: "نشطة",
  removed: "مُزالة",
};

/** RPW-1: pest-incident severity (`pest_incidents.severity`) → Arabic. An observation, not a
 *  diagnosis — "confirmed" means visually confirmed in the field, not a lab result. */
export const INCIDENT_SEVERITY_AR: Record<string, string> = {
  watch: "متابعة",
  suspected: "اشتباه إصابة",
  confirmed: "إصابة مؤكدة",
};

export const PR_STATUS_AR: Record<string, string> = {
  draft: "مسودة",
  submitted: "مرسل",
  approved: "معتمد",
  rejected: "مرفوض",
  received: "مُستلم",
  partially_received: "مُستلم جزئيًا",
};
