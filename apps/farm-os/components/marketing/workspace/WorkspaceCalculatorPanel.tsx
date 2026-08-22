"use client";

import { useState } from "react";
import { Button, Field, Input, Select, useToast } from "@/components/ui";
import { num } from "@/lib/money";
import {
  calculateExwNet,
  calculateLandedCost,
  LOGISTICS_FREIGHT_RATES,
  summarizeCampaignFunnel,
  summarizeWeeklyAvailability,
  type CampaignFunnelCounts,
  type WeeklyAvailabilityRow,
  type WeeklyAvailabilitySummary,
} from "@/lib/marketing/workspace/calculators";
import type { MarketingCalculatorId } from "@/lib/marketing/fidelity-manifest";

function parseNum(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * SPEC-0032 — the two real source calculators (`calculateExwNet()`, `logCalc()` — see
 * `lib/marketing/workspace/calculators.ts` for the transcribed formulas and oracle tests), plus the
 * two calculatorId slots the manifest declares that have no source formula at all: those render the
 * real closest source computation instead (`renderFunnelSummary()`'s live count table, and a plain
 * arithmetic total over the real weekly-availability register) rather than an invented percentage.
 */
export function WorkspaceCalculatorPanel({
  title,
  description,
  calculatorId,
  funnelCounts,
  weeklyAvailabilityRows,
  weeklyAvailabilitySummary,
}: {
  title: string;
  description?: string;
  calculatorId: MarketingCalculatorId;
  funnelCounts?: CampaignFunnelCounts;
  weeklyAvailabilityRows?: readonly WeeklyAvailabilityRow[];
  weeklyAvailabilitySummary?: WeeklyAvailabilitySummary;
}) {
  if (calculatorId === "campaign-funnel") {
    const rows = summarizeCampaignFunnel(
      funnelCounts ?? {
        exportersContacted: 0,
        directoryContacted: 0,
        linkedinLeads: 0,
        exwBids: 0,
        brokersContacted: 0,
        offshootLeads: 0,
        localLeads: 0,
        dailySalesReportDays: 0,
      },
    );
    return (
      <section className="flex flex-col gap-3 rounded-lg border p-4" style={{ borderColor: "var(--line)" }}>
        <div>
          <h2 className="text-lg font-bold">{title}</h2>
          {description && <p style={{ color: "var(--ink-muted)" }}>{description}</p>}
          <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
            نفس جدول العدّ من الملف المصدر (renderFunnelSummary) — عدد فعلي من قاعدة البيانات، وليس نسبة مخترعة.
          </p>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b" style={{ borderColor: "var(--line)" }}>
                <td className="p-2">{r.label}</td>
                <td className="p-2 font-bold">{num(r.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  }

  if (calculatorId === "availability-mix") {
    const summary = weeklyAvailabilitySummary ?? summarizeWeeklyAvailability(weeklyAvailabilityRows ?? []);
    return (
      <section className="flex flex-col gap-3 rounded-lg border p-4" style={{ borderColor: "var(--line)" }}>
        <div>
          <h2 className="text-lg font-bold">{title}</h2>
          {description && <p style={{ color: "var(--ink-muted)" }}>{description}</p>}
          <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
            لا توجد حاسبة نسب فاقد/حصة سوق محلي في الملف المصدر لهذا القسم — هذا مجموع حسابي مباشر
            لسجل «التوافر الأسبوعي» الفعلي، وليس صيغة مخترعة.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="أسابيع مسجّلة" value={num(summary.weeks)} />
          <Stat label="Premium (طن)" value={num(summary.premiumTons, 2)} />
          <Stat label="Large (طن)" value={num(summary.largeTons, 2)} />
          <Stat label="Commercial (طن)" value={num(summary.commercialTons, 2)} />
        </div>
        <div className="rounded-md border p-3 font-bold" style={{ borderColor: "var(--line)" }}>
          الإجمالي: {num(summary.totalTons, 2)} طن
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4" style={{ borderColor: "var(--line)" }}>
      <div>
        <h2 className="text-lg font-bold">{title}</h2>
        {description && <p style={{ color: "var(--ink-muted)" }}>{description}</p>}
      </div>
      {calculatorId === "exw-net" ? <ExwNetForm /> : <LandedCostForm />}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-2 text-sm" style={{ borderColor: "var(--line)" }}>
      <div style={{ color: "var(--ink-muted)" }}>{label}</div>
      <div className="font-bold">{value}</div>
    </div>
  );
}

/** Source: `calculateExwNet()` — see calculators.ts for the transcribed algebra + oracle tests. */
function ExwNetForm() {
  const toast = useToast();
  const [f, setF] = useState<Record<string, string>>({});
  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF((v) => ({ ...v, [key]: e.target.value }));
  const r = calculateExwNet({
    qtyKg: parseNum(f.qtyKg),
    pricePerKg: parseNum(f.pricePerKg),
    sortCostPerKg: parseNum(f.sortCostPerKg),
    packCostPerKg: parseNum(f.packCostPerKg),
    loadCostPerKg: parseNum(f.loadCostPerKg),
    lossPct: parseNum(f.lossPct),
  });
  const resultLine = `الكمية الصافية بعد الفاقد: ${num(r.netQtyKg, 2)} كجم — الإيراد: ${num(r.revenue, 0)} — التكاليف: ${num(r.costs, 0)} — الصافي: ${num(r.net, 0)} (${num(r.netPerKg, 2)} لكل كجم صافي)`;
  const fields: { key: string; label: string }[] = [
    { key: "qtyKg", label: "الكمية (كجم)" },
    { key: "pricePerKg", label: "سعر EXW (جنيه/كجم)" },
    { key: "sortCostPerKg", label: "تكلفة الفرز (جنيه/كجم)" },
    { key: "packCostPerKg", label: "تكلفة التعبئة (جنيه/كجم)" },
    { key: "loadCostPerKg", label: "تكلفة التحميل (جنيه/كجم)" },
    { key: "lossPct", label: "نسبة الفاقد %" },
  ];
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => (
          <Field key={field.key} id={`exw-net-${field.key}`} label={field.label}>
            <Input id={`exw-net-${field.key}`} type="number" value={f[field.key] ?? ""} onChange={set(field.key)} />
          </Field>
        ))}
      </div>
      <div className="rounded-md border p-3 font-bold" style={{ borderColor: "var(--line)" }}>{resultLine}</div>
      <div className="no-print">
        <Button variant="ghost" onClick={() => { void navigator.clipboard.writeText(resultLine); toast.ok("تم نسخ النتيجة"); }}>
          نسخ النتيجة
        </Button>
      </div>
    </>
  );
}

/** Source: `logCalc()` — see calculators.ts for the transcribed algebra + oracle tests. */
function LandedCostForm() {
  const toast = useToast();
  const [destIndex, setDestIndex] = useState(0);
  const [f, setF] = useState<Record<string, string>>({ marginPct: "25" });
  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF((v) => ({ ...v, [key]: e.target.value }));
  const dest = LOGISTICS_FREIGHT_RATES[destIndex];
  const r = calculateLandedCost({
    qtyKg: parseNum(f.qtyKg),
    destinationRateUsdPerKg: dest.rateUsdPerKg,
    cartonPriceEgp: parseNum(f.cartonPriceEgp),
    packCostEgpPerCarton: parseNum(f.packCostEgpPerCarton),
    prodCostPerKgEgp: f.prodCostPerKgEgp ? parseNum(f.prodCostPerKgEgp) : undefined,
    marginPct: parseNum(f.marginPct),
  });
  const resultLine = `لـ${num(parseNum(f.qtyKg))} كجم إلى ${dest.label}: ${num(r.cartons)} كرتونة — إجمالي التكلفة اللوجستية ${num(r.logisticsTotalEgp, 0)} ج — السعر المقترح للبيع: ${num(r.suggestedPerKgEgp, 2)} ج/كجم (إجمالي الصفقة ≈ ${num(r.suggestedTotalEgp, 0)} ج)`;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="landed-cost-dest" label="الوجهة">
          <Select
            id="landed-cost-dest"
            value={String(destIndex)}
            onChange={(e) => setDestIndex(Number(e.target.value))}
            options={LOGISTICS_FREIGHT_RATES.map((d, i) => ({ value: String(i), label: `${d.label} — ${d.rateUsdPerKg}$/كجم` }))}
          />
        </Field>
        <Field id="landed-cost-qty" label="الكمية الصافية (كجم)">
          <Input id="landed-cost-qty" type="number" value={f.qtyKg ?? ""} onChange={set("qtyKg")} />
        </Field>
        <Field id="landed-cost-carton" label="سعر الكرتونة الواحدة (جنيه)">
          <Input id="landed-cost-carton" type="number" value={f.cartonPriceEgp ?? ""} onChange={set("cartonPriceEgp")} />
        </Field>
        <Field id="landed-cost-pack" label="تكلفة التعبئة والتغليف لكل كرتونة (جنيه)">
          <Input id="landed-cost-pack" type="number" value={f.packCostEgpPerCarton ?? ""} onChange={set("packCostEgpPerCarton")} />
        </Field>
        <Field id="landed-cost-prod" label="تكلفة إنتاج/فارم-جيت للكيلو (اختياري، جنيه)">
          <Input id="landed-cost-prod" type="number" value={f.prodCostPerKgEgp ?? ""} onChange={set("prodCostPerKgEgp")} />
        </Field>
        <Field id="landed-cost-margin" label="هامش الربح المستهدف (%)">
          <Input id="landed-cost-margin" type="number" value={f.marginPct ?? ""} onChange={set("marginPct")} />
        </Field>
      </div>
      <div className="rounded-md border p-3 font-bold" style={{ borderColor: "var(--line)" }}>{resultLine}</div>
      <div className="no-print">
        <Button variant="ghost" onClick={() => { void navigator.clipboard.writeText(resultLine); toast.ok("تم نسخ النتيجة"); }}>
          نسخ النتيجة
        </Button>
      </div>
    </>
  );
}
