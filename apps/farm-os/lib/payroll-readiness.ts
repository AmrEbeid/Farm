// Payroll pilot readiness — the PURE half of «جاهزية الرواتب للتجربة» (SPEC-0006 · docs/PILOT-READINESS.md).
//
// WHAT THIS IS. A printable checklist an owner and an accountant fill in TOGETHER, on paper if they
// want, before the farm's payroll is treated as real. Nothing here computes a verdict, and nothing
// here is stored: the page renders this list, the three validation-only templates below it produce
// shape evidence, and every actual decision is a dated human signature outside the system.
//
// WHY IT REFUSES TO SCORE ITSELF. A percentage-complete bar on a payroll readiness page is a lie
// with a number attached: the gates that matter — the Stage-M privacy approval, the owner's sign-off
// that a roster and a rate sheet are the RIGHT ones, the decision about whether payment and journal
// posting are even in scope — cannot be observed by the app at all. So this module distinguishes the
// only two kinds of evidence that exist here and never aggregates them:
//
//   "automated" — the app can produce this itself (a template dry-run either has errors or it does
//                 not). It still proves only SHAPE: that a row could be priced, never that it is the
//                 right row for the right worker.
//   "human"     — a person decides, signs, and dates it. The app can carry the line; it cannot fill
//                 it in, and it must not imply that an unsigned line is somehow partially done.
//
// PII. This module names no person, no rate and no farm. It is a list of questions.

export type ReadinessEvidence = "automated" | "human";

export interface ReadinessItem {
  id: string;
  /** The gate, phrased as the thing that must be true. */
  titleAr: string;
  /** What "done" concretely means, and who does it. */
  detailAr: string;
  evidence: ReadinessEvidence;
}

export const READINESS_EVIDENCE_AR: Record<ReadinessEvidence, string> = {
  automated: "دليل آلي",
  human: "بوابة بشرية",
};

/** What each kind of evidence is worth — printed next to the legend so the distinction survives. */
export const READINESS_EVIDENCE_MEANING_AR: Record<ReadinessEvidence, string> = {
  automated:
    "يستطيع النظام إنتاجه بنفسه (نتيجة تحقّق القالب). يثبت شكل البيانات فقط، ولا يثبت أنها البيانات الصحيحة.",
  human: "قرار وتوقيع بشري مؤرَّخ خارج النظام. لا يستطيع النظام إثباته ولا افتراضه.",
};

/** Printed in the status column of every row: nothing is pre-marked, ever. */
export const READINESS_UNSIGNED_AR = "لم تُغلق بعد";

/** The heading statement — the page says what it is before it says anything else. */
export const READINESS_PURPOSE_AR =
  "قائمة تحضير للتجربة، تُملأ وتُوقَّع يدويًا. الصفحة لا تحسب نسبة إنجاز ولا تمنح اعتمادًا ولا تفتح استيراد رواتب.";

/** The boundary sentence, repeated verbatim on the page and in the page help. */
export const READINESS_NO_WRITE_AR =
  "القوالب الثلاثة أدناه للتحقق فقط: لا تكتب أي بيانات في قاعدة البيانات، ولا يوجد لها زر استيراد، ولو كان التحقق خاليًا من الأخطاء تمامًا.";

/** The privacy boundary, stated where the data would be entered. */
export const READINESS_SYNTHETIC_ONLY_AR =
  "استخدم بيانات تجريبية فقط. لا تُدخل أسماء عاملين حقيقيين ولا أجورًا ولا ساعات عمل فعلية في أي قالب قبل اعتماد مراجعة الخصوصية (المرحلة M).";

/** What the checklist explicitly does NOT cover — scope stated, not implied. */
export const READINESS_OUT_OF_SCOPE_AR =
  "لا يشمل هذا التحضير أي صرف نقدي ولا أي قيد محاسبي. إقفال الرواتب يُجمّد لقطة للتقارير فقط، والصرف والقيد يبقيان في مسارَيهما المنفصلين حتى يقرر المالك والمحاسب خلاف ذلك صراحةً.";

/**
 * The gates, in the order they must actually be cleared: privacy and data provenance BEFORE any
 * data is entered, then the shape rehearsal, then one full dry cycle through the real surfaces
 * (rates → attendance → close → report → exceptions), then the two signatures, then the explicit
 * decision about what is out of scope.
 */
export const PAYROLL_READINESS_ITEMS: readonly ReadinessItem[] = [
  {
    id: "privacy-stage-m",
    titleAr: "اعتماد مراجعة الخصوصية (المرحلة M)",
    detailAr:
      "لا تدخل أي بيانات عاملين حقيقية — اسمًا أو أجرًا أو ساعات — إلى أي بيئة قبل اعتماد مكتوب لمراجعة الخصوصية. حتى ذلك الحين كل ما في هذه الصفحة يعمل على بيانات تجريبية.",
    evidence: "human",
  },
  {
    id: "source-approval",
    titleAr: "اعتماد مصادر الكشف والأجور وسجل العمل",
    detailAr:
      "يحدد المالك، كتابةً، أي كشف فريق وأي جدول أجور وأي سجل عمل هو المصدر المعتمد، ومن أعدّه وبأي تاريخ. بدون ذلك لا معنى لأي تحقّق لاحق.",
    evidence: "human",
  },
  {
    id: "template-dry-runs",
    titleAr: "تحقّق القوالب الثلاثة بدون أخطاء",
    detailAr:
      "شغّل «تحقّق» على القوالب الثلاثة أدناه حتى تصبح قائمة الأخطاء فارغة. هذا يثبت أن شكل البيانات قابل للتسعير فقط — ولا يثبت صحة الأسماء ولا صحة الأجور.",
    evidence: "automated",
  },
  {
    id: "compensation-setup",
    titleAr: "مراجعة المالك لإعداد الأجور",
    detailAr:
      "يفتح المالك «أجور الفريق» ويتأكد أن لكل عامل سيظهر في الفترة أجرًا محفوظًا بالطريقة الصحيحة — وللأجر بالقطعة وحدة، وللموسمي تاريخَي عقد مطابقين لفترة الإقفال بالضبط.",
    evidence: "human",
  },
  {
    id: "attendance-entry",
    titleAr: "تسجيل المالك لحضور فترة كاملة",
    detailAr:
      "يسجّل المالك حضور فترة تجريبية كاملة من «تسجيل الحضور» — الساعات مطلوبة في كل طرق الأجر، والكمية والوحدة للقطعة فقط.",
    evidence: "human",
  },
  {
    id: "accountant-close",
    titleAr: "تنفيذ المحاسب لإقفال الفترة",
    detailAr:
      "يقفل المحاسب الفترة التجريبية بنفسه. الإقفال نهائي ولا يمكن التراجع عنه، ويجمّد ساعات الفترة ضد أي تعديل لاحق.",
    evidence: "human",
  },
  {
    id: "frozen-report-review",
    titleAr: "مراجعة التقرير المجمّد سطرًا سطرًا",
    detailAr:
      "يراجع المالك والمحاسب تقرير الفترة المقفلة معًا ويطابقان كل سطر مع ما توقعاه قبل الإقفال. الأرقام في التقرير لقطة مجمّدة لا تتأثر بأي تعديل لاحق.",
    evidence: "human",
  },
  {
    id: "exceptions-resolved",
    titleAr: "إغلاق كل الاستثناءات المكتشفة",
    detailAr:
      "كل فارق أو رفض أو سجل غير مرتبط بعامل مسجَّل يُدوَّن، ويُحدَّد سببه ومن عالجه ومتى — أو يُسجَّل صراحةً أنه مقبول ولماذا.",
    evidence: "human",
  },
  {
    id: "dual-signoff",
    titleAr: "توقيع مؤرَّخ من المالك والمحاسب معًا",
    detailAr:
      "توقيعان منفصلان بتاريخين على هذه الورقة نفسها. توقيع واحد لا يكفي: مراجعة الوصول للرواتب تشترط ألا يكون المُعتمِد هو من نفّذ.",
    evidence: "human",
  },
  {
    id: "payment-journal-scope",
    titleAr: "قرار صريح بشأن نطاق الصرف والقيد المحاسبي",
    detailAr:
      "يقرر المالك والمحاسب كتابةً هل الصرف النقدي والقيد المحاسبي داخل نطاق التجربة أم خارجه. النظام اليوم لا ينفّذ أيًّا منهما، وترك القرار ضمنيًا هو الخطر نفسه.",
    evidence: "human",
  },
];
