"use client";

import { useState } from "react";
import Link from "next/link";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { useSubmit } from "@/components/useSubmit";
import { egp, num } from "@/lib/money";
import { finalizeSalePrice } from "@/app/(app)/record/actions";

// R-3 — «حدّدت سعرًا»: pick the pending delivery → enter the agreed price/kg → live total →
// confirm sentence → the gated RPC posts Dr ذمم / Cr إيراد. Season anchor shown: target ≥52ج.

export interface PendingSale {
  id: string;
  label: string;
  qty: number;
  unit: string;
}

export function PriceWizard({ pending }: { pending: PendingSale[] }) {
  const [saleId, setSaleId] = useState(pending[0]?.id ?? "");
  const [price, setPrice] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const { pending: busy, submit } = useSubmit();
  const sel = pending.find((p) => p.id === saleId);
  const priceNum = Number(price);
  const total = sel && priceNum > 0 ? sel.qty * priceNum : 0;

  async function onSave() {
    setMsg(null);
    const r = await submit(() => finalizeSalePrice(saleId, priceNum));
    if (r.ok) setDone(r.total ?? total);
    else setMsg(r.error ?? "تعذّر الحفظ");
  }

  if (done != null) {
    return (
      <Card>
        <div className="flex flex-col gap-3 p-2">
          <h2 className="text-lg font-bold" style={{ color: "var(--ink)" }}>
            ✅ سُعّر التسليم — {egp(done)} دخلت الدفاتر (ذمم على التاجر حتى التحصيل).
          </h2>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => window.location.reload()}>+ سعّر تسليمًا آخر</Button>
            <Link href="/record/collect" className="inline-block"><Button variant="ghost">حصّل منه الآن</Button></Link>
            <Link href="/record" className="inline-block"><Button variant="ghost">رجوع إلى «سجّل»</Button></Link>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <header>
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>حدّدت سعر بيع</h1>
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          هدف موسم البرحي: من ٥٢ ج/كجم (متوسط ٢٠٢٥ كان ٤٦٫٤).
        </p>
      </header>
      {msg && <Alert tone="danger" title={msg} />}
      {pending.length === 0 ? (
        <Alert tone="info" title="لا تسليمات بسعر معلّق — كل شيء مُسعّر ✓" />
      ) : (
        <Card>
          <div className="flex flex-col gap-3 p-1">
            <Field label="أي تسليم؟" id="pw-sale">
              <select
                id="pw-sale"
                className="w-full rounded-md px-3 py-2 text-sm"
                style={{ border: "1px solid var(--line, rgba(0,0,0,0.15))", background: "var(--surface, #fff)" }}
                value={saleId}
                onChange={(e) => { setSaleId(e.target.value); setPrice(""); }}
              >
                {pending.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </Field>
            <Field label={`السعر المتفق (ج لكل ${sel?.unit || "وحدة"})`} id="pw-price">
              <Input id="pw-price" type="number" inputMode="decimal" min={0} step="0.25" value={price} onChange={(e) => setPrice(e.target.value)} />
            </Field>
            {sel && priceNum > 0 && (
              <div className="rounded-md p-3 text-sm" style={{ background: "var(--surface-sunken, #f4f7f5)", color: "var(--ink)" }}>
                <strong>سيُقيَّد:</strong> {num(sel.qty)} {sel.unit} × {egp(priceNum)} = <strong>{egp(total)}</strong> إيرادًا وذممًا على التاجر — صحيح؟
              </div>
            )}
            <Button onClick={onSave} disabled={busy || !saleId || !(priceNum > 0)}>
              {busy ? "جارٍ القيد…" : "اعتمد السعر ✓"}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
