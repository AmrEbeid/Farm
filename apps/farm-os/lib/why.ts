// Rule-based "Why?" content (SPEC-0014 A3). Pure, framework-free, Arabic-first.
// Maps a field-safe error SQLSTATE to a plain-Arabic explanation, the business
// rule behind it (BR-NNN, see docs/BUSINESS-RULES-CATALOG.md), and the next step.
// NO AI — the AI "Why?" is Tier C, gated behind Stage 11. Kept in lib/ so the
// mapping is unit-testable (vitest node env) and stays in parity with lib/errors.ts.

export interface WhyEntry {
  /** The SQLSTATE this explains. */
  code: string;
  /** Why it happened, in plain Arabic. */
  explanation: string;
  /** The business rule behind it (BR id), if any. */
  rule?: string;
  /** What the user can do next, in Arabic. */
  next: string;
}

/** SQLSTATE → explanation. Must cover every code in lib/errors.ts AR_ERROR_CODES. */
export const WHY_BY_CODE: Record<string, WhyEntry> = {
  "42501": {
    code: "42501",
    explanation: "دورك لا يملك صلاحية تنفيذ هذا الإجراء (اعتماد/تنفيذ/كتابة).",
    rule: "BR-030/060–065",
    next: "اطلب من المالك أو مدير المزرعة تنفيذه، أو منحك الدور المطلوب.",
  },
  "23514": {
    code: "23514",
    explanation: "المخزون غير كافٍ؛ العملية تجعل الرصيد أقل من صفر.",
    rule: "BR-014",
    next: "استلم أو عدّل المخزون أولًا، أو قلّل الكمية.",
  },
  "22023": {
    code: "22023",
    explanation: "قيمة غير صالحة (مثل كمية خاطئة، أو نقل نخلة إلى حوشة مؤرشفة).",
    rule: "BR-090/093",
    next: "صحّح القيمة، واختر حوشة أو خطًّا نشطًا.",
  },
  "23505": {
    code: "23505",
    explanation: "نُفّذت العملية بالفعل أو الحالة غير متوقعة (حارس claim-first).",
    rule: "BR-031/042/046",
    next: "حدّث الصفحة — العملية مسجّلة بالفعل، لا تُعدها.",
  },
  "23503": {
    code: "23503",
    explanation: "سجل مرتبط غير موجود (أو يتبع مؤسسة أخرى).",
    rule: "BR-052",
    next: "اختر سجلًا صحيحًا ضمن مؤسستك.",
  },
  "23502": {
    code: "23502",
    explanation: "حقل مطلوب ناقص.",
    rule: "BR-100/103",
    next: "أكمل الحقل المطلوب ثم أعد المحاولة.",
  },
  P0002: {
    code: "P0002",
    explanation: "العنصر المطلوب غير موجود (محذوف أو مؤرشف أو خارج مؤسستك).",
    rule: "BR-050/052",
    next: "تأكد من وجوده وأنه غير مؤرشف.",
  },
  "40001": {
    code: "40001",
    explanation: "تعارض مؤقت بين عمليتين متزامنتين.",
    next: "أعد المحاولة — النظام يحمي دقّة المخزون تحت الضغط.",
  },
  "40P01": {
    code: "40P01",
    explanation: "تعارض مؤقت (deadlock).",
    next: "أعد المحاولة.",
  },
  "57014": {
    code: "57014",
    explanation: "استغرقت العملية وقتًا طويلًا.",
    next: "أعد المحاولة؛ وإن تكرر، ضيّق نطاق الطلب.",
  },
};

/** Returns the "Why?" entry for a SQLSTATE, or null when there is no rule-based explanation. */
export function whyFor(code: string | null | undefined): WhyEntry | null {
  if (!code) return null;
  return WHY_BY_CODE[code] ?? null;
}
