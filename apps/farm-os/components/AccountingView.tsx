"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Select, Alert, Card } from "@/components/ui";
import { saveSale, setExpenseKind } from "@/app/(app)/accounting/actions";
import type { PnlSummary, ExpenseKind } from "@/lib/pnl";

interface ExpenseRow {
  id: string;
  category: string;
  total: number;
  kind: ExpenseKind;
}
interface SaleRow {
  id: string;
  crop: string;
  total: number;
  date: string | null;
}

const KINDS = [
  { value: "operating", label: "تشغيلي" },
  { value: "drawing", label: "مسحوبات المالك" },
  { value: "capex", label: "رأسمالي" },
];
const egp = (n: number) => `${n.toLocaleString("ar-EG")} ج.م`;

export function AccountingView({
  orgId,
  pnl,
  expenses,
  sales,
}: {
  orgId: string;
  pnl: PnlSummary;
  expenses: ExpenseRow[];
  sales: SaleRow[];
}) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);

  async function classify(id: string, kind: string) {
    setErr(null);
    const r = await setExpenseKind({ id, kind });
    if (!r.ok) return setErr(r.error);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <div>
        <h1 className="text-xl font-bold">الحسابات والأرباح والخسائر</h1>
        <Alert
          tone="warning"
          title="بيانات تجريبية — لا تُعتمد الأرقام إلا بعد مطابقتها بدفتر الإكسل الفعلي (٧ سنوات) ومراجعة مستقلة"
        />
      </div>
      {err && <Alert tone="danger" title={err} />}

      {/* ── P&L summary ── */}
      <Card className="p-4">
        <h2 className="mb-3 font-semibold">ملخص التشغيل</h2>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <Stat label="الإيرادات" value={egp(pnl.revenue)} tone="text-green-700" />
          <Stat label="المصروفات التشغيلية" value={egp(pnl.operatingExpenses)} tone="text-red-700" />
          <Stat
            label="صافي التشغيل"
            value={egp(pnl.netOperating)}
            tone={pnl.netOperating >= 0 ? "text-green-800" : "text-red-800"}
          />
          <Stat label="مسحوبات المالك (مستبعدة)" value={egp(pnl.drawings)} tone="text-amber-700" />
          <Stat label="مصروفات رأسمالية (مستبعدة)" value={egp(pnl.capex)} tone="text-amber-700" />
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">
          المسحوبات والمصروفات الرأسمالية مفصولة عن التشغيل ولا تدخل في صافي التشغيل (القاعدة #6).
        </p>
        {pnl.byCategory.length > 0 && (
          <div className="mt-3">
            <h3 className="mb-1 text-sm font-medium">المصروفات التشغيلية حسب البند</h3>
            <ul className="text-sm">
              {pnl.byCategory.map((c) => (
                <li key={c.category} className="flex justify-between border-b py-1">
                  <span>{c.category}</span>
                  <span>{egp(c.operating)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* ── add revenue ── */}
      <SaleForm orgId={orgId} onDone={() => router.refresh()} onError={setErr} />

      {/* ── recent sales ── */}
      <Card className="p-4">
        <h2 className="mb-2 font-semibold">المبيعات الأخيرة</h2>
        {sales.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد مبيعات مسجّلة.</p>
        ) : (
          <ul className="text-sm">
            {sales.map((s) => (
              <li key={s.id} className="flex justify-between border-b py-1">
                <span>
                  {s.crop} {s.date ? `· ${s.date}` : ""}
                </span>
                <span>{egp(s.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ── classify expenses (#6) ── */}
      <Card className="p-4">
        <h2 className="mb-2 font-semibold">تصنيف المصروفات (فصل المسحوبات)</h2>
        {expenses.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد مصروفات.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {expenses.slice(0, 30).map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 border-b py-1">
                <span className="flex-1">{e.category}</span>
                <span className="w-28 text-left">{egp(e.total)}</span>
                <Select
                  options={KINDS}
                  value={e.kind}
                  onChange={(ev) => classify(e.id, ev.target.value)}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`font-semibold ${tone}`}>{value}</dd>
    </div>
  );
}

function SaleForm({
  orgId,
  onDone,
  onError,
}: {
  orgId: string;
  onDone: () => void;
  onError: (m: string) => void;
}) {
  const [crop, setCrop] = useState("");
  const [total, setTotal] = useState("");
  const [date, setDate] = useState("");
  const [buyer, setBuyer] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(total);
    if (!Number.isFinite(amount) || amount < 0) return onError("أدخل مبلغًا صحيحًا");
    setPending(true);
    const r = await saveSale({
      orgId,
      crop: crop || null,
      total: amount,
      date: date || null,
      buyer: buyer || null,
    });
    setPending(false);
    if (!r.ok) return onError(r.error);
    setCrop("");
    setTotal("");
    setDate("");
    setBuyer("");
    onDone();
  }

  return (
    <Card className="p-4">
      <h2 className="mb-2 font-semibold">تسجيل إيراد (بيع)</h2>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <Field label="المحصول" id="sale-crop">
          <Input value={crop} onChange={(e) => setCrop(e.target.value)} placeholder="برحي" />
        </Field>
        <Field label="المبلغ (ج.م)" id="sale-total">
          <Input type="number" min="0" step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} required />
        </Field>
        <Field label="التاريخ" id="sale-date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="المشتري" id="sale-buyer">
          <Input value={buyer} onChange={(e) => setBuyer(e.target.value)} />
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? "…" : "حفظ"}
        </Button>
      </form>
    </Card>
  );
}
