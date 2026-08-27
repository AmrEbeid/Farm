import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";
import { PublicSiteAnalytics } from "@/components/site/PublicSiteAnalytics";
import { isAllowedCertImage, isHttpsUrl } from "@/lib/site-certificates";
import type { Bi, Lang, SiteCert, SiteContent } from "@/lib/site-content";
import {
  PUBLIC_SITE_PAGES,
  PUBLIC_SITE_PAGE_KEYS,
  SITE_HOME_PATH,
  isChinaCertificateText,
  publicSitePageCopy,
  publicSitePageFaqs,
  publicSitePagePath,
  type PublicSitePageKey,
} from "@/lib/site-public-pages";
import { SITE_DIR, otherLang } from "@/lib/site-seo";

function safeExternalHref(value: string): string | null {
  return isHttpsUrl(value) ? new URL(value.trim()).href : null;
}

function CertificationGrid({ items, lang }: { items: SiteCert[]; lang: Lang }) {
  if (items.length === 0) {
    return (
      <p className="site-detail__empty">
        {lang === "ar"
          ? "لا توجد شهادة منشورة في هذه الفئة حاليًا."
          : "No certificate is currently published in this category."}
      </p>
    );
  }
  return (
    <div className="site-detail__certs">
      {items.map((cert, index) => {
        const verifiedHref = safeExternalHref(cert.verifyUrl);
        const imageSrc = isAllowedCertImage(cert.image)
          ? cert.image.trim()
          : null;
        return (
          <article
            className="site-detail__cert"
            key={`${cert.title.en}-${index}`}
          >
            {imageSrc ? (
              // eslint-disable-next-line @next/next/no-img-element -- validated bundled or Farm storage proof image
              <img
                src={imageSrc}
                alt={cert.title[lang]}
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div
                className="site-detail__cert-image-unavailable"
                aria-hidden="true"
              />
            )}
            <div>
              <h3>{cert.title[lang]}</h3>
              <p>{cert.detail[lang]}</p>
              {verifiedHref ? (
                <a
                  href={verifiedHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                >
                  {cert.verifyIsRegistry
                    ? lang === "ar"
                      ? "التحقق على السجل"
                      : "Verify on registry"
                    : lang === "ar"
                    ? "موقع الجهة المانحة"
                    : "Issuing authority"}
                  <ExternalLink size={16} aria-hidden="true" />
                  <span>{cert.verifyLabel}</span>
                </a>
              ) : (
                <span className="site-detail__cert-unavailable">
                  {lang === "ar"
                    ? "رابط التحقق غير متاح"
                    : "Verification link unavailable"}
                </span>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function Specs({ content, lang }: { content: SiteContent; lang: Lang }) {
  const safeLabels = new Set(["variety", "season", "packaging", "shipping"]);
  const rows = content.specs.rows.filter((row) =>
    safeLabels.has(row.label.en.trim().toLowerCase())
  );
  return (
    <dl className="site-detail__specs">
      {rows.map((row, index) => (
        <div key={`${row.label.en}-${index}`}>
          <dt>{row.label[lang]}</dt>
          <dd>{row.value[lang]}</dd>
        </div>
      ))}
    </dl>
  );
}

function SupplyDisclosure({ lang }: { lang: Lang }) {
  return (
    <p className="site-detail__disclosure">
      {lang === "ar"
        ? "هذه القيم تنقل محتوى الموقع الذي يديره المالك، وليست عرض سعر أو تأكيدًا للكمية المتاحة أو القدرة الحالية أو حق التصدير. يجب تأكيد جميع التفاصيل عند الاستعلام."
        : "These values reproduce owner-managed website content. They are not a quote or confirmation of available quantity, current capacity, or export entitlement. Confirm every detail during the enquiry."}
    </p>
  );
}

function SeasonNotice({ content, lang }: { content: SiteContent; lang: Lang }) {
  return (
    <aside
      className="site-detail__season"
      aria-label={lang === "ar" ? "تحديث الموسم" : "Season update"}
    >
      <strong>
        {lang === "ar" ? "آخر موسم منشور" : "Last published season"}
      </strong>
      <span>{content.brand.season[lang]}</span>
      <p>
        {lang === "ar"
          ? "هذه ليست حالة توافر مباشرة. أكد موعد الحصاد والكمية عند الاستعلام."
          : "This is not a live availability status. Confirm harvest timing and quantity when you enquire."}
      </p>
    </aside>
  );
}

function BuyerFaqs({ lang, page }: { lang: Lang; page: PublicSitePageKey }) {
  return (
    <section className="site-detail__section site-detail__faqs">
      <SectionTitle>
        {lang === "ar" ? "أسئلة المشترين" : "Buyer FAQs"}
      </SectionTitle>
      <div>
        {publicSitePageFaqs(page).map((faq) => (
          <details key={faq.question.en}>
            <summary>{faq.question[lang]}</summary>
            <p>{faq.answer[lang]}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="site-detail__section-title">{children}</h2>;
}

function PageContent({
  content,
  lang,
  page,
}: {
  content: SiteContent;
  lang: Lang;
  page: PublicSitePageKey;
}) {
  if (page === "barhi") {
    return (
      <>
        <section className="site-detail__section">
          <SectionTitle>{content.whyBarhi.heading[lang]}</SectionTitle>
          <div className="site-detail__features">
            {content.whyBarhi.features.map((feature, index) => (
              <article key={`${feature.title.en}-${index}`}>
                <span aria-hidden="true">{feature.icon}</span>
                <h3>{feature.title[lang]}</h3>
                <p>{feature.body[lang]}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="site-detail__section site-detail__section--tint">
          <SectionTitle>{content.specs.heading[lang]}</SectionTitle>
          <Specs content={content} lang={lang} />
          <SupplyDisclosure lang={lang} />
        </section>
      </>
    );
  }

  if (page === "exportSupply") {
    return (
      <>
        <section className="site-detail__section">
          <SectionTitle>
            {lang === "ar"
              ? "بيانات التوريد المنشورة"
              : "Published supply information"}
          </SectionTitle>
          <Specs content={content} lang={lang} />
          <SupplyDisclosure lang={lang} />
        </section>
        <section className="site-detail__section site-detail__section--tint">
          <SectionTitle>
            {lang === "ar"
              ? "قبل التوريد لشركة تصدير"
              : "Before supplying an export company"}
          </SectionTitle>
          <ol className="site-detail__steps">
            <li>
              {lang === "ar"
                ? "تحدد شركة التصدير السوق والكمية والتعبئة والمواعيد المطلوبة."
                : "The export company defines the market, quantity, packing and required timing."}
            </li>
            <li>
              {lang === "ar"
                ? "تراجع المزرعة التوافر والمواصفات والمستندات المطلوبة للطلب المحدد."
                : "The Farm reviews availability, specifications and documents for that specific request."}
            </li>
            <li>
              {lang === "ar"
                ? "تُتفق مسؤوليات الفرز والتعبئة والشحن والتصدير قبل التعاقد."
                : "Sorting, packing, shipping and export responsibilities are agreed before contracting."}
            </li>
          </ol>
        </section>
      </>
    );
  }

  if (page === "chinaSupply") {
    const chinaCertificates = content.certifications.items.filter((cert) =>
      isChinaCertificateText(`${cert.title.en} ${cert.detail.en}`)
    );
    return (
      <section className="site-detail__section">
        <SectionTitle>
          {lang === "ar" ? "سجلات الصين المنشورة" : "Published China records"}
        </SectionTitle>
        {chinaCertificates.length > 0 && (
          <p className="site-detail__lead">
            {content.certifications.intro[lang]}
          </p>
        )}
        <CertificationGrid items={chinaCertificates} lang={lang} />
      </section>
    );
  }

  if (page === "certifications") {
    return (
      <section className="site-detail__section">
        <SectionTitle>{content.certifications.heading[lang]}</SectionTitle>
        {content.certifications.items.length > 0 && (
          <p className="site-detail__lead">
            {content.certifications.intro[lang]}
          </p>
        )}
        <CertificationGrid items={content.certifications.items} lang={lang} />
      </section>
    );
  }

  if (page === "wholesale") {
    return (
      <>
        <section className="site-detail__section">
          <SectionTitle>
            {lang === "ar"
              ? "مواصفات التوريد المنشورة"
              : "Published supply specifications"}
          </SectionTitle>
          <Specs content={content} lang={lang} />
          <SupplyDisclosure lang={lang} />
        </section>
        <section className="site-detail__section site-detail__section--tint">
          <SectionTitle>
            {lang === "ar" ? "جهّز طلب السعر" : "Prepare your quote request"}
          </SectionTitle>
          <ul className="site-detail__steps">
            <li>{lang === "ar" ? "الكمية المطلوبة" : "Required quantity"}</li>
            <li>
              {lang === "ar"
                ? "بلد ومدينة التسليم"
                : "Delivery country and city"}
            </li>
            <li>
              {lang === "ar" ? "نوع ووزن العبوة" : "Pack type and weight"}
            </li>
            <li>
              {lang === "ar"
                ? "موعد الاستلام المطلوب"
                : "Required delivery date"}
            </li>
          </ul>
        </section>
      </>
    );
  }

  return (
    <>
      <section className="site-detail__section">
        <SectionTitle>
          {lang === "ar" ? "بيانات المزرعة المنشورة" : "Published Farm facts"}
        </SectionTitle>
        <div className="site-detail__facts">
          <div>
            <span>{lang === "ar" ? "الاسم" : "Name"}</span>
            <strong>{content.brand.name[lang]}</strong>
          </div>
          <div>
            <span>{lang === "ar" ? "الاسم المسجل" : "Registered name"}</span>
            <strong>{content.brand.registeredName[lang]}</strong>
          </div>
          <div>
            <span>{lang === "ar" ? "الموقع" : "Location"}</span>
            <strong>{content.brand.location[lang]}</strong>
          </div>
          <div>
            <span>{lang === "ar" ? "الموسم المنشور" : "Published season"}</span>
            <strong>{content.brand.season[lang]}</strong>
          </div>
          <div>
            <span>{lang === "ar" ? "مسؤول التواصل" : "Contact person"}</span>
            <strong>{content.contact.person[lang]}</strong>
          </div>
          <div>
            <span>{lang === "ar" ? "البريد" : "Email"}</span>
            <strong>
              <bdi dir="ltr">{content.contact.email}</bdi>
            </strong>
          </div>
        </div>
        <p className="site-detail__disclosure">
          {lang === "ar"
            ? "تعرض الصفحة فقط البيانات التعريفية المنشورة حاليًا في سجل محتوى الموقع؛ لا تنشر أعداد النخيل أو المساحات المتنازع عليها."
            : "This page shows only the identity details currently published in the website content record; disputed palm counts and areas are not republished here."}
        </p>
      </section>
      <section className="site-detail__section site-detail__section--tint">
        <SectionTitle>{content.certifications.heading[lang]}</SectionTitle>
        <CertificationGrid items={content.certifications.items} lang={lang} />
      </section>
    </>
  );
}

export function SiteDetailPage({
  content,
  lang,
  page,
}: {
  content: SiteContent;
  lang: Lang;
  page: PublicSitePageKey;
}) {
  const definition = PUBLIC_SITE_PAGES[page];
  const copy = publicSitePageCopy(lang, page, content);
  const opposite = otherLang(lang);
  const DirectionArrow = lang === "ar" ? ArrowLeft : ArrowRight;
  const t = (value: Bi) => value[lang];
  const brandTagline =
    content.certifications.items.length > 0
      ? content.brand.tagline[lang]
      : lang === "ar"
      ? "تمور برحي طازجة من الشرقية"
      : "Fresh Barhi dates from El-Sharkia";

  return (
    <div className="site site-detail" dir={SITE_DIR[lang]} lang={lang}>
      <header className="site-detail__header">
        <div className="site-detail__bar">
          <Link href={SITE_HOME_PATH[lang]} className="site-detail__brand">
            <Image
              src="/site/ebeid-logo.png"
              alt={content.brand.name[lang]}
              width={160}
              height={50}
              sizes="(max-width: 760px) 109px, 128px"
            />
          </Link>
          <nav aria-label={lang === "ar" ? "روابط الصفحة" : "Page links"}>
            <Link href={SITE_HOME_PATH[lang]}>
              {lang === "ar" ? "الرئيسية" : "Home"}
            </Link>
            <Link href={publicSitePagePath(lang, "certifications")}>
              {PUBLIC_SITE_PAGES.certifications.label[lang]}
            </Link>
            <Link href={publicSitePagePath(lang, "wholesale")}>
              {PUBLIC_SITE_PAGES.wholesale.label[lang]}
            </Link>
          </nav>
          <div className="site-detail__actions">
            <Link
              href={definition.path[opposite]}
              hrefLang={opposite}
              lang={opposite}
              className="site__lang"
            >
              {lang === "ar" ? "English" : "عربي"}
            </Link>
            <Link href="/login" className="site__button site__button--primary">
              {lang === "ar" ? "دخول" : "Login"}
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="site-detail__hero">
          <Image
            className="site-detail__hero-image"
            src="/site/hero-orchard.jpg"
            alt=""
            fill
            preload
            fetchPriority="high"
            sizes="100vw"
            quality={55}
          />
          <div>
            <nav
              className="site-detail__breadcrumb"
              aria-label={lang === "ar" ? "مسار الصفحة" : "Breadcrumb"}
            >
              <Link href={SITE_HOME_PATH[lang]}>
                {content.brand.name[lang]}
              </Link>
              <span aria-hidden="true">/</span>
              <span>{definition.label[lang]}</span>
            </nav>
            <p className="site-detail__eyebrow">{definition.eyebrow[lang]}</p>
            <h1>{copy.heading}</h1>
            <p>{copy.intro}</p>
            <div className="site-detail__hero-actions">
              <Link
                href={`${SITE_HOME_PATH[lang]}#contact`}
                className="site__button site__button--primary"
              >
                {lang === "ar" ? "اطلب عرض سعر" : "Request a Quote"}
              </Link>
              <Link
                href={`${SITE_HOME_PATH[lang]}#supply`}
                className="site-detail__text-link"
              >
                {lang === "ar" ? "مواصفات التوريد" : "Supply specifications"}
                <DirectionArrow size={17} aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>

        {(
          ["barhi", "exportSupply", "wholesale"] as PublicSitePageKey[]
        ).includes(page) && <SeasonNotice content={content} lang={lang} />}
        <PageContent content={content} lang={lang} page={page} />
        <BuyerFaqs lang={lang} page={page} />

        <section className="site-detail__section site-detail__explore">
          <SectionTitle>
            {lang === "ar" ? "استكشف مزرعة عبيد" : "Explore Ebeid Farm"}
          </SectionTitle>
          <div className="site-detail__links">
            {PUBLIC_SITE_PAGE_KEYS.filter((key) => key !== page).map((key) => (
              <Link key={key} href={publicSitePagePath(lang, key)}>
                <span>{t(PUBLIC_SITE_PAGES[key].label)}</span>
                <DirectionArrow size={18} aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>

        <section className="site-detail__contact-band">
          <div>
            <p>
              {lang === "ar" ? "للطلبات التجارية" : "For commercial enquiries"}
            </p>
            <h2>{content.contact.heading[lang]}</h2>
            <span>{content.contact.address[lang]}</span>
          </div>
          <Link
            href={`${SITE_HOME_PATH[lang]}#contact`}
            className="site__button site__button--primary"
          >
            {lang === "ar" ? "تواصل مع المزرعة" : "Contact the Farm"}
          </Link>
        </section>
      </main>

      <footer className="site__footer">
        <p className="site__footer-brand">
          {content.brand.name[lang]} · {content.brand.registeredName[lang]}
        </p>
        <p className="site__footer-tag">{brandTagline}</p>
        <p className="site__footer-note">
          {lang === "ar"
            ? "بيانات الصفحة من محتوى الموقع الذي يديره مالك المزرعة؛ حالة الشهادات وفق المستندات المنشورة."
            : "Page facts come from owner-managed website content; certificate status follows the published documents."}
        </p>
      </footer>
      <PublicSiteAnalytics />
    </div>
  );
}
