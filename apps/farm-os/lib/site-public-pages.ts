import type { Bi, Lang, SiteContent } from "@/lib/site-content";

export type PublicSitePageKey =
  | "barhi"
  | "exportSupply"
  | "chinaSupply"
  | "certifications"
  | "wholesale"
  | "farmFacts";

export interface PublicSitePageDefinition {
  path: Record<Lang, string>;
  label: Bi;
  title: Bi;
  description: Bi;
  eyebrow: Bi;
  heading: Bi;
  intro: Bi;
  pageMeta: {
    what: Bi;
    why: Bi;
    when: Bi;
    how: Bi;
    commonMistakes: Bi;
    spec: "docs/superpowers/specs/2026-07-03-public-website-design.md";
    permissions: readonly ["public"];
  };
}

export interface PublicSiteFaq {
  question: Bi;
  answer: Bi;
}

const COMMON_BUYER_FAQ: PublicSiteFaq = {
  question: {
    ar: "هل البيانات المنشورة عرض توريد ملزم؟",
    en: "Is the published information a binding supply offer?",
  },
  answer: {
    ar: "لا. السعر والكمية والتوافر والقدرة والمستندات المطلوبة تُؤكد فقط بعد مراجعة الاستعلام.",
    en: "No. Price, quantity, availability, capacity and required documents are confirmed only after the enquiry is reviewed.",
  },
};

const PAGE_BUYER_FAQ: Record<PublicSitePageKey, PublicSiteFaq> = {
  barhi: {
    question: {
      ar: "متى يتوفر البرحي الطازج؟",
      en: "When is fresh Barhi available?",
    },
    answer: {
      ar: "تعرض الصفحة آخر موسم نشرته المزرعة. يجب تأكيد موعد الحصاد والتوافر الفعلي عند إرسال الاستعلام.",
      en: "The page shows the last season published by the Farm. Confirm harvest timing and actual availability when you enquire.",
    },
  },
  exportSupply: {
    question: {
      ar: "هل مزرعة عبيد هي المصدّر المباشر؟",
      en: "Is Ebeid Farm the direct exporter?",
    },
    answer: {
      ar: "لا تصف الصفحة المزرعة كمصدّر مباشر؛ المزرعة تورد لشركات التصدير، وتُحدد مسؤوليات كل طلب قبل التعاقد.",
      en: "This page does not describe the Farm as the direct exporter. It supplies export companies, with responsibilities agreed before contracting.",
    },
  },
  chinaSupply: {
    question: {
      ar: "هل تعني الصفحة أن التوريد للصين متاح الآن؟",
      en: "Does this page mean China supply is currently available?",
    },
    answer: {
      ar: "لا. تعرض الصفحة فقط سجلات الصين المطابقة المنشورة، ولا تفترض أهلية أو توافرًا أو حق تصدير دون تحقق حالي.",
      en: "No. The page shows only matching published China records and does not assume eligibility, availability or export entitlement without current verification.",
    },
  },
  certifications: {
    question: {
      ar: "ما الفرق بين رابط السجل وموقع الجهة المانحة؟",
      en: "What is the difference between a registry and an authority link?",
    },
    answer: {
      ar: "رابط السجل قد يسمح بالبحث عن سجل محدد. رابط الجهة المانحة يعرّف المصدر لكنه لا يثبت وحده حالة شهادة بعينها.",
      en: "A registry link may let you search a specific record. An authority link identifies the source but does not by itself verify a particular certificate.",
    },
  },
  wholesale: {
    question: {
      ar: "أين السعر والحد الأدنى للطلب؟",
      en: "Where are the price and minimum order?",
    },
    answer: {
      ar: "لا ينشر الموقع سعرًا أو حدًا أدنى ثابتًا. أرسل الكمية والوجهة والتعبئة المطلوبة للحصول على رد مخصص.",
      en: "The site does not publish a fixed price or minimum order. Send the quantity, destination and packing requirement for a tailored response.",
    },
  },
  farmFacts: {
    question: {
      ar: "لماذا لا تعرض الصفحة عدد النخيل أو المساحة؟",
      en: "Why are palm counts and farm area not shown?",
    },
    answer: {
      ar: "هذه الأرقام غير محسومة في سجل المزرعة، لذلك لا تعيد الصفحة نشرها كحقائق حتى تكتمل المطابقة.",
      en: "Those figures are not reconciled in the Farm register, so this page does not republish them as facts until reconciliation is complete.",
    },
  },
};

export function publicSitePageFaqs(
  key: PublicSitePageKey
): readonly PublicSiteFaq[] {
  return [PAGE_BUYER_FAQ[key], COMMON_BUYER_FAQ];
}

const sharedPageMeta = {
  when: {
    ar: "راجع الصفحة قبل إرسال استعلام تجاري أو طلب مستندات.",
    en: "Review this page before a commercial enquiry or document request.",
  },
  how: {
    ar: "راجع البيانات المنشورة ثم تواصل مع المزرعة لتأكيد التفاصيل الحالية.",
    en: "Review the published information, then contact the Farm to confirm current details.",
  },
  spec: "docs/superpowers/specs/2026-07-03-public-website-design.md",
  permissions: ["public"],
} as const;

export const SITE_HOME_PATH: Record<Lang, string> = { ar: "/", en: "/en" };

// Search-focused pages reorganize the same owner-managed SiteContent used by the homepage. The
// definitions add buyer-oriented headings and route metadata, but no mutable farm figure,
// certificate status, price, availability or capacity. Those facts continue to come from the DB.
export const PUBLIC_SITE_PAGES: Record<
  PublicSitePageKey,
  PublicSitePageDefinition
> = {
  barhi: {
    path: { ar: "/fresh-barhi-dates", en: "/en/fresh-barhi-dates" },
    label: { ar: "تمور البرحي الطازجة", en: "Fresh Barhi Dates" },
    title: {
      ar: "تمور برحي طازجة من مصر | مزرعة عبيد",
      en: "Fresh Barhi Dates from Egypt | Ebeid Farm",
    },
    description: {
      ar: "تعرف على تمور البرحي الطازجة من مزرعة عبيد بالشرقية، وصفات الثمار وموسمها ومواصفات التوريد المنشورة من بيانات المزرعة.",
      en: "Explore fresh Barhi dates from Ebeid Farm in El-Sharkia, Egypt, including fruit characteristics, season and published owner-managed supply specifications.",
    },
    eyebrow: { ar: "الصنف والمنتج", en: "Variety and product" },
    heading: {
      ar: "تمور برحي طازجة من مصر",
      en: "Fresh Barhi Dates from Egypt",
    },
    intro: {
      ar: "صفحة مخصصة للمشترين تجمع وصف صنف البرحي ومواصفات التوريد المنشورة كما تديرها المزرعة.",
      en: "A buyer-focused view of the Barhi variety and the published supply specifications managed by the Farm.",
    },
    pageMeta: {
      ...sharedPageMeta,
      what: {
        ar: "وصف صنف البرحي ومواصفات التوريد المنشورة.",
        en: "Barhi variety details and published supply specifications.",
      },
      why: {
        ar: "لمساعدة المشتري على تقييم ملاءمة المنتج مبدئيًا.",
        en: "Helps a buyer make an initial product-fit assessment.",
      },
      commonMistakes: {
        ar: "اعتبار المواصفات المنشورة تأكيدًا للتوافر أو السعر الحالي.",
        en: "Treating published specifications as confirmation of current availability or price.",
      },
    },
  },
  exportSupply: {
    path: {
      ar: "/barhi-dates-export-supply",
      en: "/en/barhi-dates-export-supply",
    },
    label: { ar: "التوريد لشركات التصدير", en: "Supply for Exporters" },
    title: {
      ar: "توريد تمور برحي لشركات التصدير | مزرعة عبيد",
      en: "Barhi Date Supply for Exporters | Ebeid Farm",
    },
    description: {
      ar: "بيانات توريد تمور البرحي لشركات التصدير من مزرعة عبيد: الموسم والمواصفات والتعبئة والشحن والمستندات وفق المعلومات المعتمدة بالمزرعة.",
      en: "Barhi date supply information for export companies, including season, specifications, packing, shipping and documentation managed by Ebeid Farm.",
    },
    eyebrow: { ar: "التوريد التجاري", en: "Commercial supply" },
    heading: {
      ar: "توريد تمور البرحي لشركات التصدير",
      en: "Barhi Date Supply for Export Companies",
    },
    intro: {
      ar: "المزرعة مورد لشركات التصدير. تعرض هذه الصفحة بيانات المنتج والتجهيز والتوريد دون الادعاء بأن المزرعة هي المصدّر المباشر.",
      en: "The Farm supplies export companies. This page presents product, preparation and supply information without describing the Farm as the direct exporter.",
    },
    pageMeta: {
      ...sharedPageMeta,
      what: {
        ar: "بيانات المنتج والتجهيز والتوريد لشركات التصدير.",
        en: "Product, preparation and supply information for export companies.",
      },
      why: {
        ar: "لتوضيح ما يمكن مناقشته مع المزرعة قبل طلب عرض.",
        en: "Clarifies what can be discussed with the Farm before requesting a quote.",
      },
      commonMistakes: {
        ar: "وصف المزرعة بأنها المصدّر المباشر أو اعتبار البيانات عرضًا ملزمًا.",
        en: "Describing the Farm as the direct exporter or treating the information as a binding offer.",
      },
    },
  },
  chinaSupply: {
    path: {
      ar: "/egyptian-dates-china-supply",
      en: "/en/egyptian-dates-china-supply",
    },
    label: { ar: "التوريد إلى الصين", en: "China Supply" },
    title: {
      ar: "سجلات توريد تمور مصرية إلى الصين | مزرعة عبيد",
      en: "Egyptian Date Supply Records for China | Ebeid Farm",
    },
    description: {
      ar: "راجع سجلات السوق الصيني المنشورة لتمور البرحي من مزرعة عبيد وروابط التحقق المتاحة دون افتراض أهلية أو اعتماد.",
      en: "See Ebeid Farm's published China-market records and available verification links without assuming eligibility or approval.",
    },
    eyebrow: { ar: "السوق الصيني", en: "China market" },
    heading: {
      ar: "سجلات توريد تمور مصرية إلى الصين",
      en: "Egyptian Date Supply Records for China",
    },
    intro: {
      ar: "تجمع هذه الصفحة سجلات التكويد والاعتماد الخاصة بالصين من محتوى الموقع الذي يديره المالك، مع روابط التحقق المتاحة.",
      en: "This page brings together the owner-managed China coding and approval records with the available verification links.",
    },
    pageMeta: {
      ...sharedPageMeta,
      what: {
        ar: "سجلات الصين المنشورة وروابط التحقق المطابقة لها فقط.",
        en: "Published China records and their matching verification links only.",
      },
      why: {
        ar: "لإتاحة مراجعة الدليل المنشور دون استنتاج حالة غير موثقة.",
        en: "Allows review of published evidence without inferring an undocumented status.",
      },
      commonMistakes: {
        ar: "افتراض أهلية الصين أو سعة التوريد دون شهادة مطابقة منشورة.",
        en: "Assuming China eligibility or supply capacity without a matching published certificate.",
      },
    },
  },
  certifications: {
    path: {
      ar: "/date-farm-certifications",
      en: "/en/date-farm-certifications",
    },
    label: { ar: "الشهادات والتتبع", en: "Certifications" },
    title: {
      ar: "شهادات مزرعة تمور البرحي والتتبع | مزرعة عبيد",
      en: "Barhi Date Farm Certifications | Ebeid Farm",
    },
    description: {
      ar: "شهادات واعتمادات مزرعة عبيد للتمور وروابط السجلات أو الجهات المانحة، وفق المستندات المنشورة التي يديرها المالك داخل النظام.",
      en: "Ebeid Farm certifications, approvals and registry or issuing-authority links, based on documents published by the owner in Farm OS.",
    },
    eyebrow: { ar: "الثقة والتحقق", en: "Trust and verification" },
    heading: {
      ar: "شهادات مزرعة تمور البرحي والتتبع",
      en: "Barhi Date Farm Certifications and Traceability",
    },
    intro: {
      ar: "تعرض الصفحة الشهادات المنشورة كما حفظها المالك، مع التمييز بين رابط سجل يمكن البحث فيه وموقع الجهة المانحة.",
      en: "Published owner-managed certificates are shown here, distinguishing searchable registries from issuing-authority websites.",
    },
    pageMeta: {
      ...sharedPageMeta,
      what: {
        ar: "بطاقات الشهادات المنشورة وروابط السجل أو الجهة المانحة.",
        en: "Published certificate cards and registry or issuing-authority links.",
      },
      why: {
        ar: "لتمكين المشتري من مراجعة المستند ومصدر التحقق.",
        en: "Lets a buyer review the document and its verification source.",
      },
      commonMistakes: {
        ar: "اعتبار موقع الجهة المانحة تحققًا مباشرًا من شهادة بعينها.",
        en: "Treating an issuing-authority homepage as direct verification of a specific certificate.",
      },
    },
  },
  wholesale: {
    path: { ar: "/barhi-dates-wholesale", en: "/en/barhi-dates-wholesale" },
    label: { ar: "مواصفات التوريد بالجملة", en: "Wholesale Supply" },
    title: {
      ar: "تمور برحي بالجملة من مصر | مزرعة عبيد",
      en: "Wholesale Barhi Dates from Egypt | Ebeid Farm",
    },
    description: {
      ar: "مواصفات توريد تمور البرحي بالجملة من مزرعة عبيد، تشمل الموسم والتعبئة والشحن كما تظهر في بيانات الموقع المنشورة.",
      en: "Wholesale Barhi date supply specifications from Ebeid Farm, including season, packaging and shipping from published website data.",
    },
    eyebrow: { ar: "معلومات المشتري", en: "Buyer information" },
    heading: {
      ar: "تمور برحي بالجملة من مصر",
      en: "Wholesale Barhi Dates from Egypt",
    },
    intro: {
      ar: "مواصفات التوريد المنشورة ومسار طلب عرض السعر. الأسعار والكميات المتاحة تُحدد فقط عند الاستعلام ولا تُفترض على الموقع.",
      en: "Published supply specifications and the quote-enquiry route. Prices and available quantities are confirmed only through an enquiry and are not assumed on this site.",
    },
    pageMeta: {
      ...sharedPageMeta,
      what: {
        ar: "مواصفات التوريد بالجملة المنشورة ومسار طلب السعر.",
        en: "Published wholesale specifications and the quote-enquiry route.",
      },
      why: {
        ar: "لتجهيز استعلام تجاري واضح قبل التواصل.",
        en: "Helps prepare a clear commercial enquiry before contact.",
      },
      commonMistakes: {
        ar: "اعتبار المواصفات تأكيدًا للكمية أو القدرة أو الوجهة الحالية.",
        en: "Treating specifications as confirmation of current quantity, capacity or destination.",
      },
    },
  },
  farmFacts: {
    path: { ar: "/ebeid-farm-facts", en: "/en/ebeid-farm-facts" },
    label: { ar: "بيانات المزرعة", en: "Farm Facts" },
    title: {
      ar: "مزرعة عبيد للتمور في الشرقية | بيانات المزرعة",
      en: "Ebeid Date Farm in El-Sharkia | Farm Facts",
    },
    description: {
      ar: "البيانات التعريفية لمزرعة عبيد للتمور في الشرقية: الاسم المسجل والموقع والشهادات المنشورة ووسائل التواصل الحالية.",
      en: "Published profile of Ebeid Farm in El-Sharkia: registered name, location, certifications and current contact details.",
    },
    eyebrow: { ar: "الملف التعريفي", en: "Entity profile" },
    heading: {
      ar: "مزرعة عبيد للتمور في الشرقية",
      en: "Ebeid Date Farm in El-Sharkia",
    },
    intro: {
      ar: "مرجع تعريفي واحد يجمع بيانات المزرعة المنشورة التي يديرها المالك داخل النظام.",
      en: "One canonical profile bringing together the published Farm details managed by the owner in Farm OS.",
    },
    pageMeta: {
      ...sharedPageMeta,
      what: {
        ar: "الهوية والموقع وبيانات التواصل والشهادات المنشورة.",
        en: "Published identity, location, contact and certificate information.",
      },
      why: {
        ar: "لتوفير مرجع تعريفي واحد للمزرعة.",
        en: "Provides one canonical identity reference for the Farm.",
      },
      commonMistakes: {
        ar: "إعادة نشر أعداد النخيل أو المساحات غير المحسومة.",
        en: "Republishing disputed palm counts or farm areas.",
      },
    },
  },
};

export const PUBLIC_SITE_PAGE_KEYS = Object.keys(
  PUBLIC_SITE_PAGES
) as PublicSitePageKey[];

export function publicSitePagePath(lang: Lang, key: PublicSitePageKey): string {
  return PUBLIC_SITE_PAGES[key].path[lang];
}

export function isChinaCertificateText(value: string): boolean {
  return /china|gacc/i.test(value);
}

export function publicSitePageCopy(
  lang: Lang,
  key: PublicSitePageKey,
  content: SiteContent
): { title: string; description: string; heading: string; intro: string } {
  const page = PUBLIC_SITE_PAGES[key];
  if (
    key === "chinaSupply" &&
    !content.certifications.items.some((cert) =>
      isChinaCertificateText(`${cert.title.en} ${cert.detail.en}`)
    )
  ) {
    return lang === "ar"
      ? {
          title: "سجلات توريد التمور إلى الصين | مزرعة عبيد",
          description:
            "صفحة سجلات السوق الصيني في مزرعة عبيد. لا توجد شهادة منشورة في هذه الفئة حاليًا، ويمكن الرجوع إلى المزرعة للحصول على أحدث حالة.",
          heading: "سجلات توريد التمور إلى الصين",
          intro:
            "لا توجد شهادة منشورة في هذه الفئة حاليًا. لا تفترض الصفحة أهلية أو اعتمادًا دون مستند منشور.",
        }
      : {
          title: "China Date Supply Records | Ebeid Farm",
          description:
            "Ebeid Farm's China-market records page. No certificate is currently published in this category; contact the Farm for the latest status.",
          heading: "China Date Supply Records",
          intro:
            "No certificate is currently published in this category. This page does not assume eligibility or approval without a published record.",
        };
  }
  if (key === "certifications" && content.certifications.items.length === 0) {
    return lang === "ar"
      ? {
          title: "سجلات وشهادات مزرعة عبيد للتمور",
          description:
            "صفحة سجلات وشهادات مزرعة عبيد. لا توجد شهادة منشورة حاليًا، ويمكن التواصل مع المزرعة للحصول على أحدث مستندات متاحة.",
          heading: "سجلات وشهادات مزرعة عبيد للتمور",
          intro:
            "لا توجد شهادة منشورة حاليًا. لا تعرض الصفحة أي حالة اعتماد دون مستند منشور.",
        }
      : {
          title: "Ebeid Farm Date Records and Certificates",
          description:
            "Ebeid Farm's records and certificates page. No certificate is currently published; contact the Farm for the latest available documents.",
          heading: "Ebeid Farm Date Records and Certificates",
          intro:
            "No certificate is currently published. This page does not present a certification status without a published document.",
        };
  }
  return {
    title: page.title[lang],
    description: page.description[lang],
    heading: page.heading[lang],
    intro: page.intro[lang],
  };
}

export const SITE_PUBLIC_PATHS = [
  SITE_HOME_PATH.ar,
  SITE_HOME_PATH.en,
  ...PUBLIC_SITE_PAGE_KEYS.flatMap((key) => [
    PUBLIC_SITE_PAGES[key].path.ar,
    PUBLIC_SITE_PAGES[key].path.en,
  ]),
];
