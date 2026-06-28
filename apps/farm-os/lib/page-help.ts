// Contextual page help content (SPEC-0014 A1). Pure, framework-free, Arabic-first.
// One entry per primary nav page (keyed by the lib/nav.ts AppNavItem id), answering
// the five questions: what / why / when / how / common-mistakes. A future Help drawer
// (A2) renders this; kept in lib/ so completeness is unit-testable against APP_NAV.
// Source content: docs/PAGE-HELP.md. Agronomy/financial guidance stays template-not-
// prescription (CLAUDE.md #4); no fabricated data (CLAUDE.md #1).

export interface PageHelp {
  /** Arabic page title. */
  title: string;
  /** ما هذه الصفحة؟ */
  what: string;
  /** لماذا توجد؟ */
  why: string;
  /** متى أستخدمها؟ */
  when: string;
  /** كيف أستخدمها؟ */
  how: string;
  /** أخطاء شائعة (مرتبطة بشرح "لماذا؟"). */
  avoid: string;
  /** Related nav ids. */
  related: string[];
}

/** Keyed by the lib/nav.ts AppNavItem id. Every nav page must have an entry (enforced by test). */
export const PAGE_HELP: Record<string, PageHelp> = {
  dashboard: {
    title: "لوحة التحكم",
    what: "نظرة عامة على المزرعة حسب دورك.",
    why: "لتبدأ يومك من أهم المؤشرات والإجراءات.",
    when: "كل يوم، كنقطة انطلاق.",
    how: "تابع المؤشرات وانتقل إلى الصفحة المطلوبة.",
    avoid: "—",
    related: ["plans", "inventory", "purchase"],
  },
  farm: {
    title: "المزرعة",
    what: "هيكل المزرعة: قطاع ← حوشة ← خط ← نخلة.",
    why: "كل عملية وتكلفة وتاريخ يتجمّع على هذا الهيكل.",
    when: "عند الإعداد أو تصحيح التقسيم.",
    how: "أضف أو عدّل قطاعًا/حوشة/خطًّا/نخلة؛ الأرشفة تخفي بدون حذف.",
    avoid: "لا تنقل نخلة إلى حوشة مؤرشفة (خطأ 22023)؛ لا تستعد عنصرًا قبل أصله.",
    related: ["plans", "inventory"],
  },
  weather: {
    title: "الطقس",
    what: "توقعات الطقس وبوابات إرشادية للعمليات.",
    why: "لتفادي الرش/الري في توقيت غير مناسب.",
    when: "قبل جدولة العمليات الحساسة للطقس.",
    how: "اطّلع على النافذة المناسبة للعملية.",
    avoid: "يحتاج تفعيل مفتاح الطقس من الإدارة لظهور البيانات.",
    related: ["plans"],
  },
  plans: {
    title: "الخطط",
    what: "خطط العمليات الآجلة (أسبوعية حتى سنوية) بعملياتها وموادها وعمالتها.",
    why: "خطّط قبل الصرف؛ تغذّي فحص التغطية والموازنة.",
    when: "بداية الموسم أو الشهر.",
    how: "أنشئ خطة ← أضف عملية بعدّة احتياجات (مواد متعددة + عمالة) ومدة (يوم أو أكثر) ← كلّف عاملًا أو أكثر وحدّد المسؤول ← شغّل الفحوصات.",
    avoid: "التكاليف/الكميات السالبة مرفوضة؛ تاريخ الانتهاء يجب ألا يسبق تاريخ البدء؛ الكتابة لمالك/مدير المزرعة فقط (خطأ 42501).",
    related: ["inventory", "budgets", "people"],
  },
  inventory: {
    title: "المخزون",
    what: "الأصناف والموجود والمحجوز والمتاح.",
    why: "حقيقة المخزون هي أساس تغطية المخزون.",
    when: "لمتابعة المخزون وإدارة الأصناف.",
    how: "اعرض الأصناف؛ أمين المخزن أو المدير يستلم ويحجز.",
    avoid: "لا تتوقع رصيدًا سالبًا؛ الكتابة تمرّ عبر العمليات لا مباشرة.",
    related: ["purchase", "suppliers"],
  },
  purchase: {
    title: "طلبات الشراء",
    what: "طلبات شراء متعددة البنود ببوابة موازنة واعتماد.",
    why: "للتحكم في الصرف قبل تحريك المال.",
    when: "عند نقص أو حاجة للشراء.",
    how: "أنشئ البنود ← أرسل ← يعتمدها المالك ← استلم (يجوز جزئيًا).",
    avoid: "لا تعتمد طلبك بنفسك (فصل المهام)؛ لا تعدّل البنود بعد الاعتماد؛ لا تستلم أكثر من المطلوب.",
    related: ["budgets", "inventory", "suppliers"],
  },
  suppliers: {
    title: "الموردون",
    what: "دليل الموردين.",
    why: "لربط المشتريات والمصروفات بالمورّد.",
    when: "عند إضافة أو مراجعة مورد.",
    how: "الكل يطّلع؛ المالك/مدير المزرعة/أمين المخزن يضيف.",
    avoid: "الأدوار الأخرى لا تستطيع الإضافة (خطأ 42501).",
    related: ["purchase", "inventory"],
  },
  expenses: {
    title: "المصروفات",
    what: "تسجيل التكاليف، مع فصل مسحوبات المالك عن المصروفات التشغيلية.",
    why: "لدقّة التكلفة الفعلية.",
    when: "عند صرف مصروف.",
    how: "سجّل المصروف وحدّد نوعه (تشغيلي أو مسحوبات).",
    avoid: "لا تخلط المسحوبات مع المصروفات التشغيلية.",
    related: ["budgets"],
  },
  budgets: {
    title: "الموازنات",
    what: "نظرة عامة على الموازنة حسب الفئة.",
    why: "لمراقبة المخطط مقابل المرتبط والفعلي.",
    when: "للمراجعة المالية.",
    how: "اعرض المخطط/المرتبط/الفعلي لكل فئة.",
    avoid: "الموازنة دعم قرار واعتماد، وليست سقفًا صارمًا في قاعدة البيانات.",
    related: ["expenses", "purchase"],
  },
  people: {
    title: "الفريق",
    what: "دليل الفريق (بيانات الاتصال والأجور محمية).",
    why: "لمعرفة المسؤوليات والأدوار.",
    when: "عند إدارة الفريق.",
    how: "اعرض الأعضاء وأدوارهم.",
    avoid: "لا تتوقع رؤية الهاتف/البريد/الأجور — محمية بالصلاحيات.",
    related: ["plans"],
  },
  mobile: {
    title: "الميدان",
    what: "قائمة مهام الميدان للمشرفين وتنفيذ العمليات.",
    why: "لتسجيل العمل ميدانيًا بأقل احتكاك.",
    when: "أثناء العمل في الحقل.",
    how: "افتح عملية لتنفيذها وأدخل الكمية الفعلية.",
    avoid: "يتحمّل انقطاع الشبكة لكنه ليس بلا اتصال كامل؛ بدون شبكة قد لا تُحمَّل الصفحة؛ لا تُكرّر الإرسال.",
    related: ["plans"],
  },
  profile: {
    title: "الملف الشخصي",
    what: "هويتك ودورك والمؤسسة النشطة (قراءة فقط).",
    why: "لمعرفة صلاحياتك والمؤسسة الحالية.",
    when: "عند الحاجة لمراجعة بياناتك.",
    how: "اعرض اسمك ودورك ومؤسستك النشطة.",
    avoid: "—",
    related: ["settings"],
  },
  settings: {
    title: "الإعدادات",
    what: "إعدادات المؤسسة (الاسم/اللغة/العملة/السنة المالية).",
    why: "لضبط ملف المؤسسة.",
    when: "عند الإعداد أو تغيير الإعدادات.",
    how: "المالك فقط يعدّل الإعدادات.",
    avoid: "متاح للمالك فقط (خطأ 42501 لغيره).",
    related: [],
  },
};

/** Returns the help for a nav id, or null if none is defined. */
export function helpFor(navId: string): PageHelp | null {
  return PAGE_HELP[navId] ?? null;
}
