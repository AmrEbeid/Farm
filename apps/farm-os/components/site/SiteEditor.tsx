"use client";

import { useState, useTransition } from "react";
import { Button, Field, Input, Textarea, useToast } from "@/components/ui";
import type { SiteContent } from "@/lib/site-content";
import { saveSiteContent } from "@/app/(app)/website/actions";

// Owner editor for the commonly-changed public-site fields (tagline, hero, headline KPIs, contact).
// It edits a working copy of the FULL SiteContent and persists the whole object, so the less-often-
// changed sections (blocks, certifications, specs) keep their current values untouched. A structured
// form for those is a later enhancement.

export function SiteEditor({ orgId, initial }: { orgId: string; initial: SiteContent }) {
  const [content, setContent] = useState<SiteContent>(() => structuredClone(initial));
  const [pending, startTransition] = useTransition();
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
      </section>

      <div>
        <Button variant="primary" onClick={onSave} disabled={pending}>
          {pending ? "جارٍ الحفظ…" : "حفظ التغييرات"}
        </Button>
      </div>
    </div>
  );
}
