"use client";

import { useState, useTransition } from "react";
import { BadgeCheck, ImageUp, Link2, Plus, Trash2 } from "lucide-react";
import { Button, Field, Input, Textarea, useToast } from "@/components/ui";
import {
  SITE_MAP_URL_MAX_LENGTH,
  type SiteCert,
  type SiteContent,
} from "@/lib/site-content";
import { CERT_LIMITS, MAX_CERTIFICATES } from "@/lib/site-certificates";
import {
  saveSiteContent,
  uploadCertificateImage,
  uploadGalleryImage,
} from "@/app/(app)/website/actions";

// Owner editor for the commonly-changed public-site fields (tagline, hero, headline KPIs, contact,
// photo gallery and the certification cards). It edits a working copy of the FULL SiteContent and
// persists the whole object, so the sections without a form yet (blocks, specs, why-partner) keep
// their current values untouched.
//
// The per-field `maxLength`s below mirror lib/site-certificates.ts — they are a convenience here;
// the ENFORCED check is the server-side validateCertifications() the save action runs first.

/** A new certificate row starts completely blank — never a copy of an existing (real) certificate. */
const BLANK_CERT: SiteCert = {
  title: { ar: "", en: "" },
  detail: { ar: "", en: "" },
  image: "",
  verifyUrl: "",
  verifyLabel: "",
  verifyIsRegistry: false,
};

export function SiteEditor({ orgId, initial }: { orgId: string; initial: SiteContent }) {
  const [content, setContent] = useState<SiteContent>(() => structuredClone(initial));
  const [pending, startTransition] = useTransition();
  // Key of the row currently uploading, e.g. "gallery:2" / "cert:0" — one upload at a time.
  const [uploading, setUploading] = useState<string | null>(null);
  const toast = useToast();

  // Immutable nested update via a small draft-mutating setter.
  function set(mutate: (draft: SiteContent) => void) {
    setContent((prev) => {
      const next = structuredClone(prev);
      mutate(next);
      return next;
    });
  }

  function onSave() {
    startTransition(async () => {
      const res = await saveSiteContent({ orgId, content });
      if (res.ok) toast.ok("تم حفظ محتوى الموقع");
      else toast.danger(res.error);
    });
  }

  // One upload path for both lists: the server action differs only in the storage folder, and the
  // returned public URL is written into the row it was uploaded for.
  async function onUpload(kind: "gallery" | "cert", i: number, file: File) {
    setUploading(`${kind}:${i}`);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = kind === "gallery"
        ? await uploadGalleryImage(fd)
        : await uploadCertificateImage(fd);
      if (res.ok) {
        set((d) => {
          if (kind === "gallery") d.gallery.items[i].image = res.url;
          else d.certifications.items[i].image = res.url;
        });
        toast.ok("تم رفع الصورة — لا تنسَ الحفظ");
      } else {
        toast.danger(res.error);
      }
    } finally {
      setUploading(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-bold text-muted-foreground">العنوان التعريفي (Tagline)</h2>
        <Field id="tagline-ar" label="عربي">
          <Input
            id="tagline-ar"
            value={content.brand.tagline.ar}
            onChange={(e) => set((d) => { d.brand.tagline.ar = e.target.value; })}
          />
        </Field>
        <Field id="tagline-en" label="English">
          <Input
            id="tagline-en"
            dir="ltr"
            value={content.brand.tagline.en}
            onChange={(e) => set((d) => { d.brand.tagline.en = e.target.value; })}
          />
        </Field>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-bold text-muted-foreground">العنوان الرئيسي (Hero)</h2>
        <Field id="headline-ar" label="العنوان — عربي">
          <Input
            id="headline-ar"
            value={content.hero.headline.ar}
            onChange={(e) => set((d) => { d.hero.headline.ar = e.target.value; })}
          />
        </Field>
        <Field id="headline-en" label="Headline — English">
          <Input
            id="headline-en"
            dir="ltr"
            value={content.hero.headline.en}
            onChange={(e) => set((d) => { d.hero.headline.en = e.target.value; })}
          />
        </Field>
        <Field id="subhead-ar" label="النص التمهيدي — عربي">
          <Textarea
            id="subhead-ar"
            rows={3}
            value={content.hero.subhead.ar}
            onChange={(e) => set((d) => { d.hero.subhead.ar = e.target.value; })}
          />
        </Field>
        <Field id="subhead-en" label="Subhead — English">
          <Textarea
            id="subhead-en"
            dir="ltr"
            rows={3}
            value={content.hero.subhead.en}
            onChange={(e) => set((d) => { d.hero.subhead.en = e.target.value; })}
          />
        </Field>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-bold text-muted-foreground">الأرقام الرئيسية</h2>
        <div className="grid grid-cols-2 gap-3">
          {content.stats.map((s, i) => (
            <Field key={i} id={`stat-${i}`} label={s.label.ar}>
              <Input
                id={`stat-${i}`}
                type="number"
                inputMode="numeric"
                dir="ltr"
                value={String(s.value)}
                onChange={(e) =>
                  set((d) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) d.stats[i].value = n;
                  })
                }
              />
            </Field>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-bold text-muted-foreground">بيانات التواصل</h2>
        <Field id="person-ar" label="المسؤول — عربي">
          <Input
            id="person-ar"
            value={content.contact.person.ar}
            onChange={(e) => set((d) => { d.contact.person.ar = e.target.value; })}
          />
        </Field>
        <Field id="person-en" label="Contact — English">
          <Input
            id="person-en"
            dir="ltr"
            value={content.contact.person.en}
            onChange={(e) => set((d) => { d.contact.person.en = e.target.value; })}
          />
        </Field>
        <Field id="email" label="البريد الإلكتروني">
          <Input
            id="email"
            dir="ltr"
            type="email"
            value={content.contact.email}
            onChange={(e) => set((d) => { d.contact.email = e.target.value; })}
          />
        </Field>
        {content.contact.phones.map((p, i) => (
          <Field key={i} id={`phone-${i}`} label={`هاتف ${i + 1}`}>
            <Input
              id={`phone-${i}`}
              dir="ltr"
              value={p}
              onChange={(e) => set((d) => { d.contact.phones[i] = e.target.value; })}
            />
          </Field>
        ))}
        <Field id="map-url" label="رابط موقع المزرعة على الخريطة">
          <Input
            id="map-url"
            dir="ltr"
            type="url"
            maxLength={SITE_MAP_URL_MAX_LENGTH}
            value={content.contact.mapUrl}
            onChange={(e) => set((d) => { d.contact.mapUrl = e.target.value; })}
          />
        </Field>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-bold text-muted-foreground">معرض الصور</h2>
        <p className="text-xs text-muted-foreground">
          ارفع صورة حقيقية لكل بطاقة (أو الصق رابطًا) وعدّل التعليق، ثم احفظ. يظهر المعرض على الموقع
          عند وجود صورة واحدة على الأقل، ويختفي إذا حذفت كل الصور.
        </p>
        {content.gallery.items.map((g, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex items-center gap-3">
              {g.image && (
                // eslint-disable-next-line @next/next/no-img-element -- small editor preview thumbnail
                <img src={g.image} alt="" className="h-14 w-20 rounded border object-cover" />
              )}
              <label>
                <span className="inline-block cursor-pointer rounded border px-3 py-1.5 text-sm hover:bg-muted">
                  {uploading === `gallery:${i}` ? "جارٍ الرفع…" : "رفع صورة"}
                </span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/avif"
                  className="hidden"
                  disabled={uploading !== null}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onUpload("gallery", i, f);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            <Field id={`gal-img-${i}`} label={`رابط الصورة ${i + 1}`}>
              <Input
                id={`gal-img-${i}`}
                dir="ltr"
                placeholder="/site/gallery/… أو https://…"
                value={g.image}
                onChange={(e) => set((d) => { d.gallery.items[i].image = e.target.value; })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field id={`gal-cap-ar-${i}`} label="التعليق — عربي">
                <Input
                  id={`gal-cap-ar-${i}`}
                  value={g.caption.ar}
                  onChange={(e) => set((d) => { d.gallery.items[i].caption.ar = e.target.value; })}
                />
              </Field>
              <Field id={`gal-cap-en-${i}`} label="Caption — English">
                <Input
                  id={`gal-cap-en-${i}`}
                  dir="ltr"
                  value={g.caption.en}
                  onChange={(e) => set((d) => { d.gallery.items[i].caption.en = e.target.value; })}
                />
              </Field>
            </div>
            <div>
              <Button
                variant="ghost"
                disabled={uploading !== null}
                onClick={() => set((d) => { d.gallery.items.splice(i, 1); })}
              >
                حذف الصورة
              </Button>
            </div>
          </div>
        ))}
        <div>
          <Button
            variant="ghost"
            disabled={uploading !== null}
            onClick={() =>
              set((d) => { d.gallery.items.push({ image: "", caption: { ar: "", en: "" } }); })
            }
          >
            + إضافة صورة
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
          <BadgeCheck className="h-4 w-4" aria-hidden="true" />
          الشهادات والاعتمادات
        </h2>
        <p className="text-xs text-muted-foreground">
          كل بطاقة تظهر للمستوردين على الموقع مع صورة الشهادة ورابط التحقق. اكتب البيانات كما هي في
          المستند الرسمي — لا تُدخل بيانات غير موثقة. الحد الأقصى {MAX_CERTIFICATES} شهادة.
        </p>
        <Field id="cert-heading-ar" label="عنوان القسم — عربي">
          <Input
            id="cert-heading-ar"
            maxLength={CERT_LIMITS.heading}
            value={content.certifications.heading.ar}
            onChange={(e) => set((d) => { d.certifications.heading.ar = e.target.value; })}
          />
        </Field>
        <Field id="cert-heading-en" label="Section heading — English">
          <Input
            id="cert-heading-en"
            dir="ltr"
            maxLength={CERT_LIMITS.heading}
            value={content.certifications.heading.en}
            onChange={(e) => set((d) => { d.certifications.heading.en = e.target.value; })}
          />
        </Field>
        <Field id="cert-intro-ar" label="المقدمة — عربي">
          <Textarea
            id="cert-intro-ar"
            rows={3}
            maxLength={CERT_LIMITS.intro}
            value={content.certifications.intro.ar}
            onChange={(e) => set((d) => { d.certifications.intro.ar = e.target.value; })}
          />
        </Field>
        <Field id="cert-intro-en" label="Intro — English">
          <Textarea
            id="cert-intro-en"
            dir="ltr"
            rows={3}
            maxLength={CERT_LIMITS.intro}
            value={content.certifications.intro.en}
            onChange={(e) => set((d) => { d.certifications.intro.en = e.target.value; })}
          />
        </Field>

        {content.certifications.items.map((cert, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-3">
              {cert.image && (
                // eslint-disable-next-line @next/next/no-img-element -- small editor preview thumbnail
                <img src={cert.image} alt="" className="h-14 w-20 rounded border object-cover" />
              )}
              <label>
                <span className="inline-flex cursor-pointer items-center gap-1.5 rounded border px-3 py-1.5 text-sm hover:bg-muted">
                  <ImageUp className="h-4 w-4" aria-hidden="true" />
                  {uploading === `cert:${i}` ? "جارٍ الرفع…" : "رفع صورة الشهادة"}
                </span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/avif"
                  className="hidden"
                  disabled={uploading !== null}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onUpload("cert", i, f);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Field id={`cert-title-ar-${i}`} label="اسم الشهادة — عربي">
                <Input
                  id={`cert-title-ar-${i}`}
                  maxLength={CERT_LIMITS.title}
                  value={cert.title.ar}
                  onChange={(e) => set((d) => { d.certifications.items[i].title.ar = e.target.value; })}
                />
              </Field>
              <Field id={`cert-title-en-${i}`} label="Certificate — English">
                <Input
                  id={`cert-title-en-${i}`}
                  dir="ltr"
                  maxLength={CERT_LIMITS.title}
                  value={cert.title.en}
                  onChange={(e) => set((d) => { d.certifications.items[i].title.en = e.target.value; })}
                />
              </Field>
              <Field id={`cert-detail-ar-${i}`} label="التفاصيل (الأرقام الرسمية) — عربي">
                <Textarea
                  id={`cert-detail-ar-${i}`}
                  rows={2}
                  maxLength={CERT_LIMITS.detail}
                  value={cert.detail.ar}
                  onChange={(e) => set((d) => { d.certifications.items[i].detail.ar = e.target.value; })}
                />
              </Field>
              <Field id={`cert-detail-en-${i}`} label="Detail — English">
                <Textarea
                  id={`cert-detail-en-${i}`}
                  dir="ltr"
                  rows={2}
                  maxLength={CERT_LIMITS.detail}
                  value={cert.detail.en}
                  onChange={(e) => set((d) => { d.certifications.items[i].detail.en = e.target.value; })}
                />
              </Field>
            </div>

            <Field id={`cert-img-${i}`} label="رابط صورة الشهادة">
              <Input
                id={`cert-img-${i}`}
                dir="ltr"
                maxLength={CERT_LIMITS.url}
                placeholder="/site/proofs/… أو https://…"
                value={cert.image}
                onChange={(e) => set((d) => { d.certifications.items[i].image = e.target.value; })}
              />
            </Field>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Field id={`cert-url-${i}`} label="رابط التحقق">
                <Input
                  id={`cert-url-${i}`}
                  dir="ltr"
                  type="url"
                  maxLength={CERT_LIMITS.url}
                  placeholder="https://…"
                  value={cert.verifyUrl}
                  onChange={(e) => set((d) => { d.certifications.items[i].verifyUrl = e.target.value; })}
                />
              </Field>
              <Field id={`cert-label-${i}`} label="اسم الجهة كما يظهر (مثال: database.globalgap.org)">
                <Input
                  id={`cert-label-${i}`}
                  dir="ltr"
                  maxLength={CERT_LIMITS.verifyLabel}
                  value={cert.verifyLabel}
                  onChange={(e) => set((d) => { d.certifications.items[i].verifyLabel = e.target.value; })}
                />
              </Field>
            </div>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={cert.verifyIsRegistry}
                onChange={(e) =>
                  set((d) => { d.certifications.items[i].verifyIsRegistry = e.target.checked; })
                }
              />
              <span className="flex flex-col">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <Link2 className="h-4 w-4" aria-hidden="true" />
                  الرابط سجلّ عام يمكن للمشتري البحث فيه
                </span>
                <span className="text-xs text-muted-foreground">
                  فعّلها للسجلات العامة (GLOBALG.A.P.، تكويد الصين) فيظهر الزر «التحقق على السجل».
                  اتركها فارغة لموقع الجهة المانحة فيظهر «الجهة المانحة» — حتى لا نَعِد بأكثر مما يتيحه الرابط.
                </span>
              </span>
            </label>

            <div>
              <Button
                variant="ghost"
                disabled={uploading !== null || content.certifications.items.length <= 1}
                onClick={() => set((d) => { d.certifications.items.splice(i, 1); })}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                حذف الشهادة
              </Button>
            </div>
          </div>
        ))}

        <div>
          <Button
            variant="ghost"
            disabled={
              uploading !== null || content.certifications.items.length >= MAX_CERTIFICATES
            }
            onClick={() =>
              set((d) => { d.certifications.items.push(structuredClone(BLANK_CERT)); })
            }
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            إضافة شهادة
          </Button>
        </div>
      </section>

      <div>
        <Button variant="primary" onClick={onSave} disabled={pending || uploading !== null}>
          {pending ? "جارٍ الحفظ…" : "حفظ التغييرات"}
        </Button>
      </div>
    </div>
  );
}
