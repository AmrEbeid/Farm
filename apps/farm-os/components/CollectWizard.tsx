"use client";

import { useState } from "react";
import Link from "next/link";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { useSubmit } from "@/components/useSubmit";
import { egp } from "@/lib/money";
import { recordGuidedCollection } from "@/app/(app)/record/actions";

// SPEC-0025 U-2 part 2 — «حصّلت فلوسًا من عميل»: pick the open sale, enter the amount (default = the
// remaining balance), confirm. The gated RPC clears the receivable + posts the journal; the Σ ≤ total
// guard lives in the DB. Plain Arabic; partial collections are first-class.

export interface OpenSale {
  id: string;
  label: string;
  remaining: number;
}

export function CollectWizard({ sales }: { sales: OpenSale[] }) {
  const [saleId, setSaleId] = useState(sales[0]?.id ?? "");
  const sel = sales.find((s) => s.id === saleId);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const { pending, submit } = useSubmit();
  const amountNum = Number(amount);

  async function onSave() {
    setMsg(null);
    const r = await submit(() => recordGuidedCollection({ saleId, amount: amountNum, note: note || null }));
    if (r.ok) setDone(true);
    else setMsg(r.error ?? "تعذّر التسجيل");
  }

  if (done) {
    return (
      <Card>
        <div className="flex flex-col gap-3 p-2">
          <h2 className="text-lg font-bold" style={{ color: "var(--ink)" }}>
            ✅ تم التحصيل وقُيّد في الدفاتر.
          </h2>
          <div className="flex gap-2">
            <Button onClick={() => window.location.reload()}>+ تحصيل آخر</Button>
            <Link href="/record" className="inline-block"><Button variant="ghost">رجوع إلى «سجّل»</Button></Link>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <header>
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>حصّلت فلوسًا من عميل</h1>
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>المبيعات التي عليها رصيد مستحق فقط تظهر هنا.</p>
      </header>
      {msg && <Alert tone="danger" title={msg} />}
      {sales.length === 0 ? (
        <Alert tone="info" title="لا مبيعات عليها مستحقات الآن — كل شيء محصَّل، أو الأسعار لم تُحدَّد بعد (حدّدها من تقارير الإيرادات)." />
      ) : (
        <Card>
          <div className="flex flex-col gap-3 p-1">
            <Field label="أي بيع؟" id="cw-sale">
              <select
                id="cw-sale"
                className="w-full rounded-md px-3 py-2 text-sm"
                style={{ border: "1px solid var(--line, rgba(0,0,0,0.15))", background: "var(--surface, #fff)" }}
                value={saleId}
                onChange={(e) => { setSaleId(e.target.value); setAmount(""); }}
              >
                {sales.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label} — المتبقي {egp(s.remaining)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={`المبلغ المحصَّل (المتبقي ${sel ? egp(sel.remaining) : "—"})`} id="cw-amt">
              <Input id="cw-amt" type="number" inputMode="decimal" min={0} step="0.01"
                value={amount} placeholder={sel ? String(sel.remaining) : ""} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="ملاحظة (اختياري)" id="cw-note">
              <Input id="cw-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
            </Field>
            {sel && amountNum > 0 && (
              <div className="rounded-md p-3 text-sm" style={{ background: "var(--surface-sunken, #f4f7f5)", color: "var(--ink)" }}>
                <strong>سيُسجَّل:</strong> تحصيل {egp(amountNum)} على «{sel.label}»
                {amountNum < sel.remaining ? ` (يتبقى بعده ${egp(sel.remaining - amountNum)})` : " (يُغلق الرصيد)"} — صحيح؟
              </div>
            )}
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => sel && setAmount(String(sel.remaining))}
                disabled={!sel}
              >
                حصّلت المتبقي كله
              </Button>
              <Button onClick={onSave} disabled={pending || !(amountNum > 0) || !saleId}>
                {pending ? "جارٍ الحفظ…" : "احفظ ✓"}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
