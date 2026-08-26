"use client";

// Public export-credibility website for Ebeid Farm. Rendered by BOTH public routes: the Arabic
// canonical home `/` and the crawlable English page `/en`. Server-rendered for SEO (Next SSRs
// client components for first paint).
//
// `lang` is a PROP, not client state: the language a visitor sees is decided by the URL, so each
// language has its own crawlable, linkable, indexable page. An in-component `useState` toggle would
// leave the English copy invisible to a crawler that only ever fetches `/`. The AR⇄EN control is a
// real <Link> between the two routes. Content comes in as a prop (the DB via fn_get_site_content,
// with a claim-free fallback on read failure) so this component never fabricates data.

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Menu } from "lucide-react";
import { Button } from "@/components/ui";
import {
  normalizeSiteMapUrl,
  type Bi,
  type Lang,
  type SiteContent,
} from "@/lib/site-content";
import { isAllowedCertImage, isHttpsUrl } from "@/lib/site-certificates";
import { SITE_DIR, SITE_PATH, otherLang } from "@/lib/site-seo";
import {
  PUBLIC_SITE_PAGES,
  PUBLIC_SITE_PAGE_KEYS,
  publicSitePageCopy,
  publicSitePagePath,
} from "@/lib/site-public-pages";
import { fmtNum } from "@/components/site/format";
import { submitEnquiry } from "@/app/enquiry-actions";
import { trackPublicSiteAction } from "@/components/site/PublicSiteAnalytics";

function waLink(phone: string): string {
  return `https://wa.me/${phone.replace(/[^0-9]/g, "")}`;
}
function safeCertificateHref(url: string): string | null {
  return isHttpsUrl(url) ? new URL(url.trim()).href : null;
}

export function SiteLanding({
  content: c,
  lang,
}: {
  content: SiteContent;
  lang: Lang;
}) {
  const dir = SITE_DIR[lang];
  const t = (b: Bi) => b[lang];
  const other = lang === "ar" ? "English" : "عربي";
  const otherHref = SITE_PATH[otherLang(lang)];
  const primaryPhone = c.contact.phones[0] ?? "";
  const mapHref = normalizeSiteMapUrl(c.contact.mapUrl) ?? "";
  // Public gallery shows only REAL photos — the shipped dummy placeholders (and empty slots) are
  // hidden on the live site so buyers never see "replace-me" tiles; the owner still sees/edits them
  // in the OS editor. An item goes public once its image is a real upload/URL (not a placeholder).
  const galleryItems = c.gallery.items.filter(
    (g) => g.image && !g.image.includes("/placeholder-")
  );
  const hasCertifications = c.certifications.items.length > 0;
  const DirectionArrow = lang === "ar" ? ArrowLeft : ArrowRight;
  const heroSubhead = hasCertifications
    ? t(c.hero.subhead)
    : lang === "ar"
    ? "تمور برحي طازجة من مزرعة عبيد في الشرقية. تواصل مع المزرعة للحصول على مواصفات التوريد وأحدث المستندات المتاحة."
    : "Fresh Barhi dates from Ebeid Farm in El-Sharkia. Contact the Farm for supply specifications and the latest available documents.";
  const brandTagline = hasCertifications
    ? t(c.brand.tagline)
    : lang === "ar"
    ? "تمور برحي طازجة من الشرقية"
    : "Fresh Barhi dates from El-Sharkia";

  const [enquirySent, setEnquirySent] = useState(false);
  const [enquiryErr, setEnquiryErr] = useState("");
  const [sending, startSend] = useTransition();

  function onEnquiry(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setEnquiryErr("");
    startSend(async () => {
      const res = await submitEnquiry(fd);
      if (res.ok) {
        trackPublicSiteAction("enquiry_submitted", lang);
        setEnquirySent(true);
      } else setEnquiryErr(res.error);
    });
  }

  const nav = [
    { href: "#about", label: { ar: "من نحن", en: "About" } },
    { href: "#explore", label: { ar: "معلومات المشتري", en: "Buyer Info" } },
    ...(hasCertifications
      ? [
          {
            href: "#certifications",
            label: { ar: "الشهادات", en: "Certifications" },
          },
        ]
      : []),
    ...(galleryItems.length > 0
      ? [{ href: "#gallery", label: { ar: "المعرض", en: "Gallery" } }]
      : []),
    { href: "#supply", label: { ar: "التوريد", en: "Supply" } },
    { href: "#contact", label: { ar: "تواصل", en: "Contact" } },
  ];

  return (
    <div className="site" dir={dir} lang={lang}>
      {/* ---- Header ---- */}
      <header className="site__header">
        <div className="site__bar">
          <a href="#top" className="site__brand" aria-label={t(c.brand.name)}>
            {/* eslint-disable-next-line @next/next/no-img-element -- small static brand logo */}
            <img
              className="site__brand-logo"
              src="/site/ebeid-logo.png"
              alt={t(c.brand.name)}
            />
          </a>
          <nav
            className="site__nav"
            aria-label={lang === "ar" ? "روابط الموقع" : "Site links"}
          >
            {nav.map((n) => (
              <a key={n.href} href={n.href}>
                {t(n.label)}
              </a>
            ))}
          </nav>
          <details className="site__mobile-menu">
            <summary
              aria-label={lang === "ar" ? "فتح قائمة الموقع" : "Open site menu"}
            >
              <Menu width={20} height={20} aria-hidden="true" />
            </summary>
            <nav
              className="site__mobile-menu-links"
              aria-label={lang === "ar" ? "روابط الموقع" : "Site links"}
            >
              {nav.map((n) => (
                <a
                  key={n.href}
                  href={n.href}
                  onClick={(event) =>
                    event.currentTarget
                      .closest("details")
                      ?.removeAttribute("open")
                  }
                >
                  {t(n.label)}
                </a>
              ))}
            </nav>
          </details>
          <div className="site__actions">
            {/* Crawlable language switch: a real link between `/` and `/en`, with hreflang so
                the relationship is machine-readable from the page itself (not only from <head>). */}
            <Link
              href={otherHref}
              className="site__lang"
              hrefLang={otherLang(lang)}
              lang={otherLang(lang)}
              aria-label={
                lang === "ar" ? "Switch to English" : "التحويل إلى العربية"
              }
            >
              {other}
            </Link>
            <Link href="/login">
              <Button variant="primary">
                {lang === "ar" ? "تسجيل الدخول" : "Login"}
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main id="top">
        {/* ---- Hero ---- */}
        <section className="site__hero">
          <div className="site__hero-inner">
            <p className="site__eyebrow">{brandTagline}</p>
            <h1 className="site__title">{t(c.hero.headline)}</h1>
            <p className="site__lede">{heroSubhead}</p>
            {hasCertifications && (
              <ul className="site__badges">
                {c.hero.badges.map((b, i) => (
                  <li key={i} className="site__badge">
                    {t(b)}
                  </li>
                ))}
              </ul>
            )}
            <div className="site__cta">
              <a href="#contact">
                <Button variant="primary">{t(c.hero.ctaPrimary)}</Button>
              </a>
              {hasCertifications && (
                <a href="#certifications">
                  <Button variant="ghost">{t(c.hero.ctaSecondary)}</Button>
                </a>
              )}
            </div>
            <p className="site__hero-loc">
              {t(c.brand.location)} · {t(c.brand.season)}
            </p>
          </div>
        </section>

        {/* ---- Stat strip ---- */}
        <section className="site__stats" aria-label={t(c.about.heading)}>
          {c.stats.map((s, i) => (
            <div key={i} className="site__stat">
              <span className="site__stat-n">
                {fmtNum(s.value, lang, { approx: s.approx })}
              </span>
              <span className="site__stat-l">{t(s.label)}</span>
            </div>
          ))}
        </section>

        {/* ---- Focused buyer pages: crawlable internal links, not client-side filters ---- */}
        <section id="explore" className="site__section site__discover">
          <div className="site__section-head">
            <h2>
              {lang === "ar"
                ? "معلومات واضحة لكل قرار شراء"
                : "Clear information for each buying decision"}
            </h2>
            <p className="site__intro">
              {lang === "ar"
                ? "اختر الموضوع المطلوب للوصول مباشرة إلى بيانات المنتج والتوريد والشهادات المنشورة."
                : "Choose a topic to go directly to the published product, supply and certification information."}
            </p>
          </div>
          <div className="site__discover-grid">
            {PUBLIC_SITE_PAGE_KEYS.map((key) => {
              const page = PUBLIC_SITE_PAGES[key];
              const copy = publicSitePageCopy(lang, key, c);
              return (
                <Link key={key} href={publicSitePagePath(lang, key)}>
                  <div>
                    <h3>{page.label[lang]}</h3>
                    <p>{copy.description}</p>
                  </div>
                  <DirectionArrow size={19} aria-hidden="true" />
                </Link>
              );
            })}
          </div>
        </section>

        {/* ---- About ---- */}
        <section id="about" className="site__section site__about">
          <div className="site__section-head">
            <h2>{t(c.about.heading)}</h2>
          </div>
          <p className="site__prose">{t(c.about.body)}</p>
        </section>

        {/* ---- Why Barhi ---- */}
        <section className="site__section site__band">
          <div className="site__section-head">
            <h2>{t(c.whyBarhi.heading)}</h2>
          </div>
          <div className="site__features">
            {c.whyBarhi.features.map((f, i) => (
              <article key={i} className="site__feature">
                <span className="site__feature-ic" aria-hidden="true">
                  {f.icon}
                </span>
                <h3>{t(f.title)}</h3>
                <p>{t(f.body)}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ---- Certifications & proof ---- */}
        {hasCertifications && (
          <section
            id="certifications"
            className="site__section site__band site__band--green"
          >
            <div className="site__section-head">
              <h2>{t(c.certifications.heading)}</h2>
              <p className="site__intro">{t(c.certifications.intro)}</p>
            </div>
            <div className="site__certs">
              {c.certifications.items.map((cert, i) => {
                const verifiedHref = safeCertificateHref(cert.verifyUrl);
                const imageSrc = isAllowedCertImage(cert.image)
                  ? cert.image.trim()
                  : null;
                return (
                  <article key={i} className="site__cert">
                    {verifiedHref ? (
                      <a
                        className="site__cert-thumb"
                        href={verifiedHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        referrerPolicy="no-referrer"
                        onClick={() =>
                          trackPublicSiteAction("certificate_opened", lang, {
                            certificate: i + 1,
                          })
                        }
                      >
                        {imageSrc ? (
                          // eslint-disable-next-line @next/next/no-img-element -- validated bundled or Farm storage proof image
                          <img
                            src={imageSrc}
                            alt={t(cert.title)}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <span
                            className="site__cert-image-unavailable"
                            aria-hidden="true"
                          />
                        )}
                      </a>
                    ) : (
                      <div className="site__cert-thumb">
                        {imageSrc ? (
                          // eslint-disable-next-line @next/next/no-img-element -- validated bundled or Farm storage proof image
                          <img
                            src={imageSrc}
                            alt={t(cert.title)}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <span
                            className="site__cert-image-unavailable"
                            aria-hidden="true"
                          />
                        )}
                      </div>
                    )}
                    <div className="site__cert-body">
                      <h3>{t(cert.title)}</h3>
                      <p>{t(cert.detail)}</p>
                      {verifiedHref ? (
                        <a
                          className="site__cert-verify"
                          href={verifiedHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          referrerPolicy="no-referrer"
                          onClick={() =>
                            trackPublicSiteAction("certificate_opened", lang, {
                              certificate: i + 1,
                            })
                          }
                        >
                          {cert.verifyIsRegistry
                            ? lang === "ar"
                              ? "التحقق على السجل"
                              : "Verify on registry"
                            : lang === "ar"
                            ? "الجهة المانحة"
                            : "Issuing authority"}{" "}
                          ↗
                          <span className="site__cert-host">
                            {cert.verifyLabel}
                          </span>
                        </a>
                      ) : (
                        <span className="site__cert-verify site__cert-verify--unavailable">
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
          </section>
        )}

        {/* ---- Why partner ---- */}
        <section className="site__section site__band">
          <div className="site__section-head">
            <h2>{t(c.whyPartner.heading)}</h2>
          </div>
          <ul className="site__bullets">
            {c.whyPartner.bullets.map((b, i) => (
              <li key={i}>{t(b.text)}</li>
            ))}
          </ul>
        </section>

        {/* ---- Gallery (only REAL photos; dummy placeholders are hidden here, editable in the OS) ---- */}
        {galleryItems.length > 0 && (
          <section id="gallery" className="site__section site__band">
            <div className="site__section-head">
              <h2>{t(c.gallery.heading)}</h2>
            </div>
            <div className="site__gallery">
              {galleryItems.map((g, i) => (
                <figure key={i} className="site__gallery-item">
                  {/* eslint-disable-next-line @next/next/no-img-element -- owner-managed gallery image (URL/path), not a signed URL */}
                  <img src={g.image} alt={t(g.caption)} loading="lazy" />
                  <figcaption>{t(g.caption)}</figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}

        {/* ---- Supply specs + Commercial enquiries (2-column, Stitch layout) ---- */}
        <section id="supply" className="site__section">
          <div className="site__supply-grid">
            <div>
              <div className="site__section-head">
                <h2>{t(c.specs.heading)}</h2>
              </div>
              <dl className="site__specs">
                {c.specs.rows.map((s, i) => (
                  <div key={i} className="site__spec">
                    <dt>{t(s.label)}</dt>
                    <dd>{t(s.value)}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div id="contact" className="site__contact">
              <h2>{t(c.contact.heading)}</h2>
              <p className="site__contact-person">{t(c.contact.person)}</p>
              <p className="site__contact-addr">{t(c.contact.address)}</p>
              <div className="site__contact-actions">
                {/* Latin values are wrapped in <bdi dir="ltr"> so their "+20 …" phone/email runs
                    keep left-to-right order and the leading "+" stays put inside the RTL layout. */}
                {primaryPhone && (
                  <a
                    href={waLink(primaryPhone)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="site__contact-btn site__contact-btn--wa"
                    onClick={() =>
                      trackPublicSiteAction("contact_whatsapp", lang)
                    }
                  >
                    WhatsApp · <bdi dir="ltr">{primaryPhone}</bdi>
                  </a>
                )}
                <a
                  href={`mailto:${c.contact.email}`}
                  className="site__contact-btn"
                  onClick={() => trackPublicSiteAction("contact_email", lang)}
                >
                  ✉︎ <bdi dir="ltr">{c.contact.email}</bdi>
                </a>
                {c.contact.phones.slice(1).map((p) => (
                  <a
                    key={p}
                    href={`tel:${p.replace(/[^0-9+]/g, "")}`}
                    className="site__contact-btn site__contact-btn--ghost"
                    onClick={() => trackPublicSiteAction("contact_phone", lang)}
                  >
                    ☎ <bdi dir="ltr">{p}</bdi>
                  </a>
                ))}
                {mapHref && (
                  <a
                    href={mapHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="site__contact-btn site__contact-btn--ghost"
                    onClick={() =>
                      trackPublicSiteAction("contact_location", lang)
                    }
                  >
                    📍{" "}
                    {lang === "ar" ? "افتح موقع المزرعة" : "Open Farm Location"}
                  </a>
                )}
              </div>

              {enquirySent ? (
                <p className="site__enquiry-done">
                  {lang === "ar"
                    ? "تم إرسال طلبك — سنتواصل معك قريبًا."
                    : "Thank you — we'll be in touch shortly."}
                </p>
              ) : (
                <form className="site__enquiry" onSubmit={onEnquiry}>
                  <p className="site__enquiry-title">
                    {lang === "ar" ? "اطلب عرض سعر" : "Request a Quote"}
                  </p>
                  {/* honeypot — hidden from humans; bots that fill it are dropped server-side */}
                  <input
                    type="text"
                    name="company_website"
                    className="site__hp"
                    tabIndex={-1}
                    autoComplete="off"
                    aria-hidden="true"
                  />
                  <input
                    name="name"
                    required
                    maxLength={200}
                    placeholder={lang === "ar" ? "الاسم *" : "Name *"}
                  />
                  <input
                    name="company"
                    maxLength={200}
                    placeholder={lang === "ar" ? "الشركة" : "Company"}
                  />
                  <div className="site__enquiry-row">
                    <input
                      name="country"
                      maxLength={120}
                      placeholder={lang === "ar" ? "الدولة" : "Country"}
                    />
                    <input
                      name="volume"
                      maxLength={120}
                      placeholder={
                        lang === "ar" ? "الكمية المطلوبة" : "Volume needed"
                      }
                    />
                  </div>
                  <textarea
                    name="message"
                    required
                    rows={3}
                    maxLength={5000}
                    placeholder={lang === "ar" ? "رسالتك *" : "Your message *"}
                  />
                  {enquiryErr && (
                    <p className="site__enquiry-err">{enquiryErr}</p>
                  )}
                  <button
                    type="submit"
                    className="site__contact-btn"
                    disabled={sending}
                  >
                    {sending
                      ? lang === "ar"
                        ? "جارٍ الإرسال…"
                        : "Sending…"
                      : lang === "ar"
                      ? "إرسال الطلب"
                      : "Send Enquiry"}
                  </button>
                </form>
              )}
            </div>
          </div>
        </section>
      </main>

      {/* ---- Footer ---- */}
      <footer className="site__footer">
        <p className="site__footer-brand">
          {t(c.brand.name)} · {t(c.brand.registeredName)}
        </p>
        <p className="site__footer-tag">{brandTagline}</p>
        <p className="site__footer-note">
          {lang === "ar"
            ? "الأرقام والمساحات تقديرية وفق سجل المزرعة 2025؛ بيانات الشهادات وفق المستندات الرسمية."
            : "Figures per the 2025 farm record; certificate data per official documents."}
        </p>
      </footer>
    </div>
  );
}
