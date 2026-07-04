"use client";

import { useState } from "react";
import Link from "next/link";
import { Alert, Button, Field, Input } from "@/components/ui";
import { useSubmit } from "@/components/useSubmit";
import { egp, num } from "@/lib/money";
import { LineItemsEditor, type LineState } from "@/components/LineItemsEditor";
import { recordGuidedCollection } from "@/app/(app)/record/actions";

// SPEC-0025 U-2 part 2 (+U-9 multi-line): «حصّلت فلوسًا من عميل» — collect from SEVERAL sales in one
// session. Each line: pick an open-balance sale, amount defaults to the remaining, save; add more lines
// freely (the shared LineItemsEditor pattern). The gated RPC clears A-R + posts the journal per line;
// the Σ ≤ total guard lives in the DB.

export interface OpenSale {
  id: string;
  label: string;
  remaining: number;
}

interface CollectLine extends LineState {
  saleId: string;
  amount: string;
  note: string;
  savedAmount?: number;
}

const sel = "w-full rounded-md px-3 py-2 text-sm";
const selStyle = { border: "1px solid var(--line, rgba(0,0,0,0.15))", background: "var(--surface, #fff)" } as const;

export function CollectWizard({ sales }: { sales: OpenSale[] }) {
  const [lines, setLines] = useState<CollectLine[]>([{ saleId: sales[0]?.id ?? "", amount: "", note: "" }]);
  const { pending, submit } = useSubmit();

  // Remaining per sale, net of amounts already saved in THIS session (so the picker stays honest).
  const savedBySale = new Map<string, number>();
  for (const l of lines) if (l.saved && l.savedAmount) savedBySale.set(l.saleId, (savedBySale.get(l.saleId) ?? 0) + l.savedAmount);
  const remainingOf = (id: string) => {
    const s = sales.find((x) => x.id === id);
    return s ? s.remaining - (savedBySale.get(id) ?? 0) : 0;
  };

  function setLine(i: number, patch: Partial<CollectLine>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  async function saveLine(i: number) {
    const l = lines[i];
    const amount = Number(l.amount);
    if (!l.saleId) return setLine(i, { error: "اختر البيع" });
    if (!(amount > 0)) return setLine(i, { error: "أدخل مبلغًا موجبًا" });
    setLine(i, { error: null });
    const r = await submit(() => recordGuidedCollection({ saleId: l.saleId, amount, note: l.note || null }));
    if (r.ok) setLine(i, { saved: true, savedAmount: amount, error: null });
    else setLine(i, { error: r.error ?? "تعذّر التسجيل" });
  }

  const savedCount = lines.filter((l) => l.saved).length;
  const savedTotal = lines.reduce((t, l) => t + (l.saved ? (l.savedAmount ?? 0) : 0), 0);

  if (sales.length === 0) {
    return (
      <div className="mx-auto max-w-xl">
        <Alert tone="info" title="لا مبيعات عليها مستحقات الآن — كل شيء محصَّل، أو الأسعار لم تُحدَّد بعد (حدّدها من تقارير الإيرادات)." />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <header>
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>حصّلت فلوسًا من عميل</h1>
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          سطر لكل تحصيل — أضِف بعدد ما تريد. المبيعات ذات الرصيد المستحق فقط تظهر هنا.
        </p>
      </header>

      <LineItemsEditor<CollectLine>
        lines={lines}
        pending={pending}
        onAdd={() => setLines((ls) => [...ls, { saleId: sales[0]?.id ?? "", amount: "", note: "" }])}
        onRemove={(i) => setLines((ls) => ls.filter((_, j) => j !== i))}
        onSaveLine={saveLine}
        addLabel="+ تحصيل آخر"
        header={
          savedCount > 0 ? (
            <Alert tone="info" title={`حُفظ ${num(savedCount)} تحصيل بإجمالي ${egp(savedTotal)}`} />
          ) : null
        }
        renderLine={(l, i) => {
          const remaining = remainingOf(l.saleId);
          const amountNum = Number(l.amount);
          return (
            <div className="flex flex-col gap-2">
              <Field label="أي بيع؟" id={`cw-${i}-sale`}>
                <select id={`cw-${i}-sale`} className={sel} style={selStyle} value={l.saleId} disabled={l.saved}
                  onChange={(e) => setLine(i, { saleId: e.target.value, amount: "" })}>
                  {sales.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label} — المتبقي {egp(s.remaining - (savedBySale.get(s.id) ?? 0))}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label={`المبلغ (المتبقي ${egp(remaining)})`} id={`cw-${i}-amt`}>
                  <Input id={`cw-${i}-amt`} type="number" inputMode="decimal" min={0} step="0.01"
                    value={l.amount} disabled={l.saved} placeholder={String(remaining)}
                    onChange={(e) => setLine(i, { amount: e.target.value })} />
                </Field>
                <Field label="ملاحظة (اختياري)" id={`cw-${i}-note`}>
                  <Input id={`cw-${i}-note`} value={l.note} disabled={l.saved} maxLength={200}
                    onChange={(e) => setLine(i, { note: e.target.value })} />
                </Field>
              </div>
              {!l.saved && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="ghost" onClick={() => setLine(i, { amount: String(remaining) })} disabled={!(remaining > 0)}>
                    حصّلت المتبقي كله
                  </Button>
                  {amountNum > 0 && (
                    <span className="text-sm" style={{ color: "var(--ink-muted)" }}>
                      {amountNum < remaining ? `يتبقى بعده ${egp(remaining - amountNum)}` : amountNum === remaining ? "يُغلق الرصيد" : "أكبر من المتبقي!"}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        }}
      />

      <div>
        <Link href="/record" className="inline-block">
          <Button variant="ghost">إنهاء — رجوع إلى «سجّل»</Button>
        </Link>
      </div>
    </div>
  );
}
