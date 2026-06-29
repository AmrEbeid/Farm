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
};

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

export const PR_STATUS_AR: Record<string, string> = {
  draft: "مسودة",
  submitted: "مرسل",
  approved: "معتمد",
  rejected: "مرفوض",
  received: "مُستلم",
  partially_received: "مُستلم جزئيًا",
};
