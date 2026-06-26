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

/** Operation subtype (`plan_operations.subtype`) → Arabic. Centralized so a new subtype is
 *  translated everywhere at once (it was duplicated in 8 screens; "pollination" got missed). */
export const SUBTYPE_AR: Record<string, string> = {
  fertilization: "تسميد",
  irrigation: "ري",
  spraying: "رش",
  pollination: "تلقيح",
  inspection: "تفتيش",
};
