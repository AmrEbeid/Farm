// Public website content model — the single typed source for the marketing site at `/`.
//
// Phase 1 (this file): the content ships as `SITE_CONTENT_DEFAULTS`, incorporating the Owner's
// approved public copy plus the official GlobalGAP / China-GACC / QCAP / CAPQ documents.
// Phase 2 will populate the SAME `SiteContent` shape
// from the DB via `fn_get_site_content`, falling back to these defaults, so the page renders
// identically before and after the content table exists.
//
// Every human-facing string is bilingual (`Bi`). Identifiers (GGN, China code, registration
// numbers, phone, email) stay in Latin digits in BOTH languages — they are international
// identifiers a buyer cross-checks on a registry, not farm KPIs. Counts/areas render as
// Arabic-Indic in the Arabic view (see `fmtNum`/`fmtDigits` in components/site/format.ts).

export type Lang = "ar" | "en";

/** A bilingual string. */
export interface Bi {
  ar: string;
  en: string;
}

/** A headline KPI in the stat strip. `value` is the raw number; the unit label is bilingual. */
export interface SiteStat {
  value: number;
  /** true → render with a leading "~" / "≈". */
  approx?: boolean;
  label: Bi;
}

/** One row of the production-blocks table. Numbers are raw; `years` is a pre-formatted range. */
export interface SiteBlock {
  name: Bi;
  areaFeddans: number;
  hawshat: number;
  barhiPalms: number;
  /** Planting-year range as written on the farm record, e.g. "2018 / 2019", "2010–2024". */
  years: string;
}

/** A single spec row (label → value). */
export interface SiteSpec {
  label: Bi;
  value: Bi;
}

/** A certification / approval proof card. */
export interface SiteCert {
  title: Bi;
  /** Key detail line (GGN, registration no., certificate no., etc.). */
  detail: Bi;
  /** Certificate image: a bundled path under public/site/proofs, or an uploaded `site-media`
   *  public URL (owner uploads it in the OS editor). Validated by lib/site-certificates.ts. */
  image: string;
  /** Public registry / verification URL. */
  verifyUrl: string;
  /** Short label for the verify link, e.g. "database.globalgap.org". */
  verifyLabel: string;
  /**
   * true → a public registry a buyer can independently search (GlobalGAP, China GACC);
   * false → the issuing authority's official site (QCAP, CAPQ) — the link is labelled
   * "official site" rather than "verify on registry" so it doesn't overpromise.
   */
  verifyIsRegistry: boolean;
}

/** A "why partner" bullet. */
export interface SiteBullet {
  text: Bi;
}

/** A photo-gallery item. `image` is a URL or a path under /public — the owner uploads a photo in
 *  the OS editor (or pastes a URL); the shipped dummy placeholders are hidden on the public site. */
export interface GalleryItem {
  image: string;
  caption: Bi;
}

export interface SiteContent {
  brand: {
    name: Bi;
    /** Registered export name shown on the official registries (for buyer cross-check). */
    registeredName: Bi;
    tagline: Bi;
    location: Bi;
    season: Bi;
  };
  hero: {
    headline: Bi;
    subhead: Bi;
    /** Gold trust badges in the hero. */
    badges: Bi[];
    ctaPrimary: Bi;
    ctaSecondary: Bi;
  };
  stats: SiteStat[];
  about: { heading: Bi; body: Bi };
  whyBarhi: { heading: Bi; features: { icon: string; title: Bi; body: Bi }[] };
  blocks: {
    heading: Bi;
    note: Bi;
    rows: SiteBlock[];
    totalLabel: Bi;
    total: { areaFeddans: number; hawshat: number; barhiPalms: number };
  };
  certifications: { heading: Bi; intro: Bi; items: SiteCert[] };
  specs: { heading: Bi; rows: SiteSpec[] };
  gallery: { heading: Bi; items: GalleryItem[] };
  whyPartner: { heading: Bi; bullets: SiteBullet[] };
  contact: {
    heading: Bi;
    person: Bi;
    email: string;
    phones: string[];
    address: Bi;
    /** Public map/directions URL shown on the marketing website. */
    mapUrl: string;
  };
}

export const SITE_MAP_URL_MAX_LENGTH = 2048;

/** Empty hides the map action; non-empty values must be absolute credential-free HTTPS URLs. */
export function normalizeSiteMapUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > SITE_MAP_URL_MAX_LENGTH)
    return null;
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    return parsed.href.length <= SITE_MAP_URL_MAX_LENGTH ? parsed.href : null;
  } catch {
    return null;
  }
}

/**
 * Default content — Owner-approved public copy; certificate data per the official documents.
 */
export const SITE_CONTENT_DEFAULTS: SiteContent = {
  brand: {
    name: { ar: "مزرعة عُبيد للتمور", en: "Ebeid Farm" },
    registeredName: {
      ar: "شركة عُبيد للتمور",
      en: "Obaid Company for Dates",
    },
    tagline: {
      ar: "تمور البرحي الطازجة — جودة تصديرية معتمدة",
      en: "Premium Fresh Barhi Dates · GLOBALG.A.P. · Approved for China",
    },
    location: {
      ar: "أبو شلبي · فاقوس · الشرقية · مصر",
      en: "Abou Shalaby, Faqous, El-Sharkia, Egypt",
    },
    season: { ar: "موسم ٢٠٢٥ / ٢٠٢٦", en: "Season 2025 / 2026" },
  },
  hero: {
    headline: {
      ar: "تمور برحي طازجة — معتمدة للتصدير",
      en: "Premium Fresh Barhi Dates — Certified for Export",
    },
    subhead: {
      ar: "منظومة اعتماد كاملة — GLOBALG.A.P. وتكويد الصين وخلو المتبقيات — تمنحك منتجاً آمناً متجانساً كامل التتبّع من النخلة إلى الشحنة، من مصدر واحد معروف في الشرقية.",
      en: "A complete accreditation stack — GLOBALG.A.P., China facility coding and a clean residue certificate — for a safe, uniform, fully traceable product from a single known source in El-Sharkia.",
    },
    badges: [
      { ar: "GLOBALG.A.P. معتمدة", en: "GLOBALG.A.P. Certified" },
      { ar: "مكوّدة للصين", en: "Approved for China" },
      { ar: "خلو المتبقيات · QCAP", en: "QCAP Residue-Free" },
    ],
    ctaPrimary: { ar: "اطلب عرض سعر", en: "Request a Quote" },
    ctaSecondary: { ar: "الشهادات والاعتمادات", en: "View Certifications" },
  },
  stats: [
    { value: 120, approx: true, label: { ar: "فدان", en: "Feddans" } },
    {
      value: 5000,
      approx: true,
      label: { ar: "نخلة برحي", en: "Barhi Palms" },
    },
    {
      value: 202,
      label: { ar: "طن معتمد للصين", en: "Tons Approved (China)" },
    },
    { value: 7, label: { ar: "قطاعات إنتاجية", en: "Production Blocks" } },
  ],
  about: {
    heading: { ar: "من نحن", en: "About Us" },
    body: {
      ar: "تأسست المزرعة منذ 10 سنوات على تربة طينية خصبة، وتمت زراعتها بفسائل نسيجية مختارة مستوردة من شركة ساباد بالمملكة العربية السعودية عبر معمل أنسجة فرنسي معتمد، وفقاً لأفضل الممارسات الزراعية الحديثة، مما أنتج تموراً بارحي متميزة في الحجم والتجانس والطعم. تُروى المزرعة بمياه النيل بنظام الري بالتنقيط، وتُدار العمليات الزراعية ببرامج تسميد ومكافحة موثقة وفترات أمان قبل الحصاد، وفق نظم بيئية وصحية تضمن سلامة وجودة الثمار، مع تقارير قياس أسبوعية موثقة لأقطار الثمار في كل قطاع. تمتد المزرعة على 120 فداناً وتضم نحو 5,000 نخلة بارحي موزعة على 7 قطاعات بأعمار متدرجة تضمن إمداداً متصاعداً موسماً بعد موسم. ولدينا خبرة عملية منذ 4 سنوات في التعامل مع شركات التصدير والمستوردين، ندرك من خلالها متطلبات الفرز والتعبئة والتوثيق لكل سوق، كما تتوفر لدى المزرعة فسائل بارحي مختارة.",
      en: "Established 10 years ago on fertile clay soil, the farm was planted with selected tissue-culture offshoots imported from Sabad in Saudi Arabia through an accredited French tissue laboratory and grown according to modern agricultural practices. This has produced Barhi dates distinguished by their size, uniformity and taste. The farm is irrigated with Nile water through drip irrigation, while documented fertilization and crop-protection programs, pre-harvest safety intervals, environmental and health controls, and weekly fruit-diameter reports support fruit safety and quality in every block. The farm extends across 120 feddans and includes about 5,000 Barhi palms in 7 blocks of staggered ages, providing growing supply season after season. We also bring 4 years of practical experience working with exporters and importers, understand each market's sorting, packing and documentation requirements, and offer selected Barhi offshoots.",
    },
  },
  whyBarhi: {
    heading: { ar: "لماذا البرحي؟", en: "Why Barhi?" },
    features: [
      {
        icon: "🌤️",
        title: { ar: "يُستهلك طازجاً", en: "Eaten Fresh (Khalal)" },
        body: {
          ar: "صنف فاخر في مرحلة الخلال الأصفر — قرمشة مميزة وحلاوة نظيفة، الأعلى طلباً في أسواق آسيا والخليج.",
          en: "A premium variety eaten at the yellow Khalal stage — crisp, cleanly sweet, and the most in-demand across Asian and Gulf markets.",
        },
      },
      {
        icon: "🟡",
        title: { ar: "ثمار ذهبية منتظمة", en: "Uniform Golden Fruit" },
        body: {
          ar: "ثمار ذهبية منتظمة الحجم (١٥–٢٠ جم) ومظهر تسويقي جذاب على العنقود، مع قيمة غذائية عالية.",
          en: "Uniform golden fruit (15–20 g) with an attractive on-cluster appearance and high nutritional value.",
        },
      },
      {
        icon: "📈",
        title: { ar: "طلب عالمي متنامٍ", en: "Growing Global Demand" },
        body: {
          ar: "طلب عالمي متنامٍ على البرحي الطازج بمعدل نمو يقارب ٦–٧٪ سنوياً، وصلاحية جيدة للتداول بسلسلة التبريد.",
          en: "Global demand for fresh Barhi is growing ~6–7% per year, with good shelf life through the cold chain.",
        },
      },
    ],
  },
  blocks: {
    heading: { ar: "القطاعات الإنتاجية", en: "Production Blocks" },
    note: {
      ar: "زراعة على مراحل = إمداد متصاعد. القطاعات الأقدم دخلت طور الإنتاج، بينما تدخل الزراعات الحديثة الإنتاج تباعاً — نمو وثبات في المعروض موسماً بعد موسم يدعم التعاقد طويل الأجل.",
      en: "Phased planting (2010–2025) means a steadily growing, reliable supply — ideal for long-term import contracts.",
    },
    rows: [
      {
        name: { ar: "الـ 22 فدان", en: "Al-22 Feddan" },
        areaFeddans: 22,
        hawshat: 7,
        barhiPalms: 948,
        years: "2018 / 2019",
      },
      {
        name: { ar: "الحصوة", en: "Al-Haswa" },
        areaFeddans: 30,
        hawshat: 8,
        barhiPalms: 1165,
        years: "2022 / 2025",
      },
      {
        name: { ar: "حوض البابور", en: "Hawd Al-Babour" },
        areaFeddans: 30.5,
        hawshat: 5,
        barhiPalms: 1485,
        years: "2023 / 2025",
      },
      {
        name: { ar: "الشفعة", en: "Al-Shafaa" },
        areaFeddans: 9.5,
        hawshat: 4,
        barhiPalms: 269,
        years: "2023",
      },
      {
        name: { ar: "الخطارة", en: "Al-Khattara" },
        areaFeddans: 23,
        hawshat: 4,
        barhiPalms: 513,
        years: "2010–2024",
      },
    ],
    totalLabel: { ar: "الإجمالي", en: "Total" },
    total: { areaFeddans: 115, hawshat: 28, barhiPalms: 4380 },
  },
  certifications: {
    heading: { ar: "الشهادات والتتبّع", en: "Certifications & Traceability" },
    intro: {
      ar: "منظومة GLOBALG.A.P. + التكويد الصيني + شهادة خلو المتبقيات تختصر إجراءات القبول الجمركي والصحي، وتضمن منتجاً مطابقاً للاشتراطات الدولية من مصدر واحد معروف — تتبّع كامل من النخلة إلى الشحنة.",
      en: "GLOBALG.A.P. + China facility coding + a clean residue certificate mean faster customs and phytosanitary clearance and a fully traceable, single-source product.",
    },
    items: [
      {
        title: { ar: "GLOBALG.A.P. (IFA v6)", en: "GLOBALG.A.P. (IFA v6)" },
        detail: {
          ar: "GGN 4059883915303 · عبر HEIACert · ساري حتى 2026-10-06",
          en: "GGN 4059883915303 · via HEIACert · valid to 2026-10-06",
        },
        image: "/site/proofs/globalgap-registry.jpeg",
        verifyUrl: "https://database.globalgap.org/globalgap/indexJSF.faces",
        verifyLabel: "database.globalgap.org",
        verifyIsRegistry: true,
      },
      {
        title: { ar: "تكويد الصين (GACC)", en: "China GACC Coding" },
        detail: {
          ar: "شركة عُبيد للتمور · تسجيل QEGY1425102400002 · كود 55.09.30.03.DAF",
          en: "Obaid Company for Dates · Reg. QEGY1425102400002 · Code 55.09.30.03.DAF",
        },
        image: "/site/proofs/china-gacc-record.jpeg",
        verifyUrl:
          "https://scintl.chinaport.gov.cn/aprwebserver/pages/apr/public/html/companyList.html",
        verifyLabel: "chinaport.gov.cn",
        verifyIsRegistry: true,
      },
      {
        title: { ar: "خلو المتبقيات (QCAP)", en: "Residue-Free (QCAP)" },
        detail: {
          ar: "المعمل المركزي · شهادة Dokki-182904 · مطابقة EN 15662:2018",
          en: "Central Lab · Cert. Dokki-182904 · compliant with EN 15662:2018",
        },
        image: "/site/proofs/qcap-residue-cert.jpeg",
        verifyUrl: "https://www.qcap-egypt.com",
        verifyLabel: "qcap-egypt.com",
        verifyIsRegistry: false,
      },
      {
        title: {
          ar: "اعتماد المزرعة (CAPQ) 2025",
          en: "CAPQ Farm Approval 2025",
        },
        detail: {
          ar: "الحجر الزراعي المصري · برحي · ٢٠٢ طن معتمدة للصين",
          en: "Egyptian Plant Quarantine · Barhi · 202 tons approved for China",
        },
        image: "/site/proofs/capq-farm-approval.jpeg",
        verifyUrl: "https://www.capq.gov.eg",
        verifyLabel: "capq.gov.eg",
        verifyIsRegistry: false,
      },
    ],
  },
  specs: {
    heading: { ar: "طاقة التوريد والمواصفات", en: "Supply & Specifications" },
    rows: [
      {
        label: { ar: "الصنف", en: "Variety" },
        value: { ar: "برحي طازج (خلال أصفر)", en: "Fresh Barhi (Khalal)" },
      },
      {
        label: {
          ar: "الكمية المعتمدة للصين (2025)",
          en: "Approved Quantity (China, 2025)",
        },
        value: { ar: "٢٠٢ طن (CAPQ)", en: "202 tons (CAPQ)" },
      },
      {
        label: { ar: "الموسم", en: "Season" },
        value: { ar: "أغسطس – أكتوبر", en: "August – October" },
      },
      {
        label: { ar: "التعبئة", en: "Packaging" },
        value: {
          ar: "حسب طلب العميل (كراتين ٥ / ١٠ كجم، عبوات عناقيد، تغليف مبرّد)",
          en: "To buyer spec (5 / 10 kg cartons, cluster packs, chilled packaging)",
        },
      },
      {
        label: { ar: "الشحن", en: "Shipping" },
        value: {
          ar: "جوي مبرّد / بحري بسلسلة تبريد",
          en: "Air & reefer sea freight",
        },
      },
      {
        label: { ar: "الوجهات المعتمدة", en: "Certified Destinations" },
        value: {
          ar: "الصين · الإمارات · السعودية · الكويت · أوروبا · دول شرق آسيا",
          en: "China · UAE · Saudi Arabia · Kuwait · EU · East Asian markets",
        },
      },
    ],
  },
  gallery: {
    heading: { ar: "من المزرعة", en: "From the Farm" },
    // Dummy placeholders — the owner replaces each image (paste a real URL) + caption from
    // the OS editor («الموقع» → معرض الصور). The gallery is hidden on the site when it has no items.
    items: [
      {
        image: "/site/gallery/placeholder-1.svg",
        caption: { ar: "بستان البرحي", en: "Barhi orchard" },
      },
      {
        image: "/site/gallery/placeholder-2.svg",
        caption: {
          ar: "عناقيد في مرحلة الخلال",
          en: "Clusters at Khalal stage",
        },
      },
      {
        image: "/site/gallery/placeholder-3.svg",
        caption: { ar: "الحصاد والفرز", en: "Harvest & sorting" },
      },
      {
        image: "/site/gallery/placeholder-4.svg",
        caption: { ar: "التعبئة للتصدير", en: "Export packing" },
      },
    ],
  },
  whyPartner: {
    heading: { ar: "لماذا تتعامل معنا", en: "Why Partner With Us" },
    bullets: [
      {
        text: {
          ar: "مصدر واحد معتمد — جودة متجانسة وكميات يمكن التعاقد عليها (٢٠٢ طن معتمدة للصين موسم ٢٠٢٥).",
          en: "A single certified source — uniform quality and contractable volume (202 tons approved for China, 2025).",
        },
      },
      {
        text: {
          ar: "تعبئة وتغليف حسب علامتك التجارية ومواصفات سوقك.",
          en: "Packaging and branding to your label and market spec.",
        },
      },
      {
        text: {
          ar: "إمداد متصاعد وثابت يدعم التعاقدات الموسمية والسنوية.",
          en: "Growing, reliable supply supporting seasonal and annual contracts.",
        },
      },
      {
        text: {
          ar: "جاهزية كاملة لمتطلبات التصدير والمستندات الصحية (Phytosanitary).",
          en: "Full readiness for export requirements and phytosanitary documentation.",
        },
      },
    ],
  },
  contact: {
    heading: { ar: "تواصل معنا", en: "Contact Us" },
    person: { ar: "مزرعة عبيد للتمور", en: "Ebeid Farm for Dates" },
    email: "ebeidfarm@gmail.com",
    phones: ["+20 100 217 4773", "+20 121 014 1019"],
    address: {
      ar: "أبو شلبي، فاقوس، الشرقية، مصر 44641",
      en: "Abou Shalaby, Faqous, El-Sharkia, Egypt 44641",
    },
    mapUrl: "https://maps.app.goo.gl/G9XhCj1xLHWW3zgu9",
  },
};

type StoredSiteContent = Omit<Partial<SiteContent>, "contact"> & {
  contact?: Partial<SiteContent["contact"]>;
};

/**
 * Merge persisted content with current defaults. Contact is merged one level deeper so newly
 * introduced public fields (such as the map URL) also reach organizations whose existing JSON was
 * saved before the field shipped.
 */
export function mergeSiteContent(stored: StoredSiteContent): SiteContent {
  return {
    ...SITE_CONTENT_DEFAULTS,
    ...stored,
    contact: {
      ...SITE_CONTENT_DEFAULTS.contact,
      ...stored.contact,
    },
  };
}

// A public read failure must not republish mutable claims that an owner may have superseded.
// Keep a minimal identity/contact page available, but remove quantities, operational claims,
// certificates, supply specifications and market-readiness language until the DB recovers.
export const SITE_CONTENT_PUBLIC_READ_FALLBACK: SiteContent = {
  ...SITE_CONTENT_DEFAULTS,
  brand: {
    ...SITE_CONTENT_DEFAULTS.brand,
    tagline: {
      ar: "تمور برحي من الشرقية",
      en: "Barhi dates from El-Sharkia",
    },
    season: { ar: "يُحدّث من سجل المزرعة", en: "Updated from the Farm record" },
  },
  hero: {
    ...SITE_CONTENT_DEFAULTS.hero,
    headline: {
      ar: "مزرعة عُبيد للتمور",
      en: "Ebeid Farm for Dates",
    },
    subhead: {
      ar: "بيانات المنتج والتوريد غير متاحة مؤقتًا. تواصل مع المزرعة لتأكيد التفاصيل الحالية.",
      en: "Product and supply information is temporarily unavailable. Contact the Farm to confirm current details.",
    },
    badges: [],
    ctaSecondary: { ar: "تواصل معنا", en: "Contact Us" },
  },
  stats: [],
  about: {
    ...SITE_CONTENT_DEFAULTS.about,
    body: {
      ar: "مزرعة عُبيد للتمور في أبو شلبي، فاقوس، الشرقية. تواصل مع المزرعة للحصول على أحدث المعلومات المنشورة.",
      en: "Ebeid Farm for Dates is in Abou Shalaby, Faqous, El-Sharkia. Contact the Farm for the latest published information.",
    },
  },
  whyBarhi: { ...SITE_CONTENT_DEFAULTS.whyBarhi, features: [] },
  blocks: {
    ...SITE_CONTENT_DEFAULTS.blocks,
    note: { ar: "", en: "" },
    rows: [],
    total: { areaFeddans: 0, hawshat: 0, barhiPalms: 0 },
  },
  certifications: {
    ...SITE_CONTENT_DEFAULTS.certifications,
    items: [],
  },
  specs: { ...SITE_CONTENT_DEFAULTS.specs, rows: [] },
  gallery: { ...SITE_CONTENT_DEFAULTS.gallery, items: [] },
  whyPartner: { ...SITE_CONTENT_DEFAULTS.whyPartner, bullets: [] },
};
