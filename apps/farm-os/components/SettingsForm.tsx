"use client";

import { useState } from "react";
import { Button, Field, Input, Alert } from "@/components/ui";
import { updateOrgSettings } from "@/app/(app)/settings/actions";

export interface OrgSettings {
  id: string;
  name: string;
  locale: string;
  currency: string;
  areaUnit: string;
  fiscalYearStart: string | null;
}

export function SettingsForm({ org }: { org: OrgSettings }) {
  const [name, setName] = useState(org.name);
  const [locale, setLocale] = useState(org.locale);
  const [currency, setCurrency] = useState(org.currency);
  const [areaUnit, setAreaUnit] = useState(org.areaUnit);
  const [fiscal, setFiscal] = useState(org.fiscalYearStart ?? "");
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setMsg(null);
    const r = await updateOrgSettings({
      orgId: org.id,
      name,
      locale,
      currency,
      areaUnit,
      fiscalYearStart: fiscal || null,
    });
    setPending(false);
    setMsg(
      r.ok
        ? { tone: "ok", text: "تم حفظ الإعدادات" }
        : { tone: "danger", text: r.error ?? "تعذّر الحفظ" },
    );
  }

  const selectClass = "rounded-md border px-2 py-1.5 text-sm";
  const selectStyle = { borderColor: "var(--border)" } as const;

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      {msg && <Alert tone={msg.tone} title={msg.text} />}
      <Field label="اسم المزرعة" id="org-name">
        <Input
          id="org-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          required
        />
      </Field>
      <Field label="اللغة" id="org-locale">
        <select
          id="org-locale"
          className={selectClass}
          style={selectStyle}
          value={locale}
          onChange={(e) => setLocale(e.target.value)}
        >
          <option value="ar">العربية</option>
          <option value="en">English</option>
        </select>
      </Field>
      <Field label="العملة" id="org-currency">
        <select
          id="org-currency"
          className={selectClass}
          style={selectStyle}
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
        >
          <option value="EGP">جنيه مصري (EGP)</option>
          <option value="SAR">ريال سعودي (SAR)</option>
          <option value="USD">دولار أمريكي (USD)</option>
        </select>
      </Field>
      <Field label="وحدة المساحة" id="org-area">
        <select
          id="org-area"
          className={selectClass}
          style={selectStyle}
          value={areaUnit}
          onChange={(e) => setAreaUnit(e.target.value)}
        >
          <option value="feddan">فدان</option>
          <option value="hectare">هكتار</option>
          <option value="qirat">قيراط</option>
        </select>
      </Field>
      <Field label="بداية السنة المالية" id="org-fiscal">
        <Input
          id="org-fiscal"
          type="date"
          value={fiscal}
          onChange={(e) => setFiscal(e.target.value)}
        />
      </Field>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "جارٍ الحفظ…" : "حفظ الإعدادات"}
        </Button>
      </div>
    </form>
  );
}
