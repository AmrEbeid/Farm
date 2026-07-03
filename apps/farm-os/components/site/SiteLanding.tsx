"use client";

// Public export-credibility website for Ebeid Farm, rendered at `/`. Server-rendered for SEO
// (Next SSRs client components for first paint); the only client state is the AR⇄EN language
// toggle, which also flips text direction. Content comes in as a prop (Phase 1: the typed
// defaults; Phase 2: the DB via fn_get_site_content) so this component never fabricates data.

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui";
import type { Bi, Lang, SiteContent } from "@/lib/site-content";
import { fmtDigits, fmtNum } from "@/components/site/format";

function waLink(phone: string): string {
  return `https://wa.me/${phone.replace(/[^0-9]/g, "")}`;
}

export function SiteLanding({ content: c }: { content: SiteContent }) {
  const [lang, setLang] = useState<Lang>("ar");
  const dir = lang === "ar" ? "rtl" : "ltr";
  const t = (b: Bi) => b[lang];
  const other = lang === "ar" ? "English" : "عربي";
  const primaryPhone = c.contact.phones[0] ?? "";

  const nav = [
    { href: "#about", label: { ar: "من نحن", en: "About" } },
    { href: "#certifications", label: { ar: "الشهادات", en: "Certifications" } },
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
            <img className="site__brand-logo" src="/site/ebeid-logo.png" alt={t(c.brand.name)} />
          </a>
          <nav className="site__nav" aria-label={lang === "ar" ? "روابط الموقع" : "Site links"}>
            {nav.map((n) => (
              <a key={n.href} href={n.href}>{t(n.label)}</a>
            ))}
          </nav>
          <div className="site__actions">
            <button
              type="button"
              className="site__lang"
              onClick={() => setLang((l) => (l === "ar" ? "en" : "ar"))}
              aria-label={lang === "ar" ? "Switch to English" : "التحويل إلى العربية"}
            >
              {other}
            </button>
            <Link href="/login">
              <Button variant="primary">{lang === "ar" ? "تسجيل الدخول" : "Login"}</Button>
            </Link>
          </div>
        </div>
      </header>

      <main id="top">
        {/* ---- Hero ---- */}
        <section className="site__hero">
          <div className="site__hero-inner">
            <p className="site__eyebrow">{t(c.brand.tagline)}</p>
            <h1 className="site__title">{t(c.hero.headline)}</h1>
            <p className="site__lede">{t(c.hero.subhead)}</p>
            <ul className="site__badges">
              {c.hero.badges.map((b, i) => (
                <li key={i} className="site__badge">{t(b)}</li>
              ))}
            </ul>
            <div className="site__cta">
              <a href="#contact"><Button variant="primary">{t(c.hero.ctaPrimary)}</Button></a>
              <a href="#certifications"><Button variant="ghost">{t(c.hero.ctaSecondary)}</Button></a>
            </div>
            <p className="site__hero-loc">{t(c.brand.location)} · {t(c.brand.season)}</p>
          </div>
        </section>

        {/* ---- Stat strip ---- */}
        <section className="site__stats" aria-label={t(c.about.heading)}>
          {c.stats.map((s, i) => (
            <div key={i} className="site__stat">
              <span className="site__stat-n">{fmtNum(s.value, lang, { approx: s.approx })}</span>
              <span className="site__stat-l">{t(s.label)}</span>
            </div>
          ))}
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
          <div className="site__section-head"><h2>{t(c.whyBarhi.heading)}</h2></div>
          <div className="site__features">
            {c.whyBarhi.features.map((f, i) => (
              <article key={i} className="site__feature">
                <span className="site__feature-ic" aria-hidden="true">{f.icon}</span>
                <h3>{t(f.title)}</h3>
                <p>{t(f.body)}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ---- Production blocks ---- */}
        <section className="site__section">
          <div className="site__section-head"><h2>{t(c.blocks.heading)}</h2></div>
          <div className="site__table-wrap">
            <table className="site__table">
              <thead>
                <tr>
                  <th>{lang === "ar" ? "القطاع" : "Block"}</th>
                  <th>{lang === "ar" ? "المساحة (فدان)" : "Area (feddans)"}</th>
                  <th>{lang === "ar" ? "الحوشات" : "Hawshat"}</th>
                  <th>{lang === "ar" ? "نخيل برحي" : "Barhi Palms"}</th>
                  <th>{lang === "ar" ? "سنة الزراعة" : "Planting Year"}</th>
                </tr>
              </thead>
              <tbody>
                {c.blocks.rows.map((r, i) => (
                  <tr key={i}>
                    <td>{t(r.name)}</td>
                    <td>{fmtNum(r.areaFeddans, lang)}</td>
                    <td>{fmtNum(r.hawshat, lang)}</td>
                    <td>{fmtNum(r.barhiPalms, lang)}</td>
                    <td>{fmtDigits(r.years, lang)}</td>
                  </tr>
                ))}
                <tr className="site__table-total">
                  <td>{t(c.blocks.totalLabel)}</td>
                  <td>{fmtNum(c.blocks.total.areaFeddans, lang, { approx: true })}</td>
                  <td>{fmtNum(c.blocks.total.hawshat, lang)}</td>
                  <td>{fmtNum(c.blocks.total.barhiPalms, lang, { approx: true })}</td>
                  <td>—</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="site__note">{t(c.blocks.note)}</p>
        </section>

        {/* ---- Certifications & proof ---- */}
        <section id="certifications" className="site__section site__band site__band--green">
          <div className="site__section-head">
            <h2>{t(c.certifications.heading)}</h2>
            <p className="site__intro">{t(c.certifications.intro)}</p>
          </div>
          <div className="site__certs">
            {c.certifications.items.map((cert, i) => (
              <article key={i} className="site__cert">
                <a
                  className="site__cert-thumb"
                  href={cert.verifyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- static local proof scan, not a signed URL */}
                  <img src={cert.image} alt={t(cert.title)} loading="lazy" />
                </a>
                <div className="site__cert-body">
                  <h3>{t(cert.title)}</h3>
                  <p>{t(cert.detail)}</p>
                  <a
                    className="site__cert-verify"
                    href={cert.verifyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {cert.verifyIsRegistry
                      ? lang === "ar" ? "التحقق على السجل" : "Verify on registry"
                      : lang === "ar" ? "الجهة المانحة" : "Issuing authority"} ↗
                    <span className="site__cert-host">{cert.verifyLabel}</span>
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* ---- Why partner ---- */}
        <section className="site__section site__band">
          <div className="site__section-head"><h2>{t(c.whyPartner.heading)}</h2></div>
          <ul className="site__bullets">
            {c.whyPartner.bullets.map((b, i) => (
              <li key={i}>{t(b.text)}</li>
            ))}
          </ul>
        </section>

        {/* ---- Supply specs + Commercial enquiries (2-column, Stitch layout) ---- */}
        <section id="supply" className="site__section">
          <div className="site__supply-grid">
            <div>
              <div className="site__section-head"><h2>{t(c.specs.heading)}</h2></div>
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
                  <a href={waLink(primaryPhone)} target="_blank" rel="noopener noreferrer" className="site__contact-btn site__contact-btn--wa">
                    WhatsApp · <bdi dir="ltr">{primaryPhone}</bdi>
                  </a>
                )}
                <a href={`mailto:${c.contact.email}`} className="site__contact-btn">
                  ✉︎ <bdi dir="ltr">{c.contact.email}</bdi>
                </a>
                {c.contact.phones.map((p) => (
                  <a key={p} href={`tel:${p.replace(/[^0-9+]/g, "")}`} className="site__contact-btn site__contact-btn--ghost">
                    ☎ <bdi dir="ltr">{p}</bdi>
                  </a>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ---- Footer ---- */}
      <footer className="site__footer">
        <p className="site__footer-brand">
          {t(c.brand.name)} · {t(c.brand.registeredName)}
        </p>
        <p className="site__footer-tag">{t(c.brand.tagline)}</p>
        <p className="site__footer-note">
          {lang === "ar"
            ? "الأرقام والمساحات تقديرية وفق سجل المزرعة 2025؛ بيانات الشهادات وفق المستندات الرسمية."
            : "Figures per the 2025 farm record; certificate data per official documents."}
        </p>
      </footer>
    </div>
  );
}
