"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { useSubmit } from "@/components/useSubmit";
import { egp } from "@/lib/money";
import {
  recordGuidedExpense,
  type GuidedKind,
  type GuidedPayment,
} from "@/app/(app)/record/actions";

// SPEC-0025 U-1 — «دفعت مصروفًا» in ONE flow. Three plain-Arabic steps replace the old four-screen
// journey (expense → account → cost center → custody). The wizard never says "journal", "kind" or
// "payment request" — it asks what a farmer would ask, and the server action does the bookkeeping.

export interface WizardAccount {
  id: string;
  code: string;
  nameAr: string;
  kind: string | null;
}
export interface WizardCenter {
  id: string;
  code: string;
  nameAr: string;
}

const KIND_LABEL: Record<GuidedKind, string> = {
  operating: "مصروف تشغيل المزرعة",
  drawing: "مسحوبات شخصية لصاحب المزرعة",
  capex: "إنشاءات أو معدات (رأسمالي)",
};

const selectClass = "w-full rounded-md px-3 py-2 text-sm";
const selectStyle = {
  border: "1px solid var(--line, rgba(0,0,0,0.15))",
  background: "var(--surface, #fff)",
} as const;

export function ExpenseWizard({
  suppliers,
  accounts,
  centers,
  custodyAccounts,
}: {
  suppliers: { id: string; name: string }[];
  accounts: WizardAccount[];
  centers: WizardCenter[];
  custodyAccounts: { id: string; label: string }[];
}) {
  const [step, setStep] = useState(1);
  const [date, setDate] = useState("");
  const [category, setCategory] = useState("");
  const [total, setTotal] = useState("");
  const [description, setDescription] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [kind, setKind] = useState<GuidedKind>("operating");
  const [accountId, setAccountId] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  // Recommended default: the field team pays from custody day-to-day (Owner decision, SPEC-0025 §8).
  const [payment, setPayment] = useState<GuidedPayment>("custody");
  const [custodyAccountId, setCustodyAccountId] = useState(custodyAccounts[0]?.id ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState<{ paid: boolean } | null>(null);
  const { pending, submit } = useSubmit();

  // Only accounts whose kind matches (or is unset) are valid targets — the DB guard enforces it; the
  // wizard simply doesn't offer a wrong choice (#6: drawings never lands on an operating account).
  const kindAccounts = useMemo(
    () => accounts.filter((a) => a.kind == null || a.kind === kind),
    [accounts, kind],
  );

  const totalNum = Number(total);
  const step1Valid = category.trim() !== "" && Number.isFinite(totalNum) && totalNum > 0;
  const custodyLabel = custodyAccounts.find((c) => c.id === custodyAccountId)?.label;
  const centerLabel = centers.find((c) => c.id === costCenterId)?.nameAr;
  const accountLabel = kindAccounts.find((a) => a.id === accountId)?.nameAr;

  async function onSave() {
    setMsg(null);
    const r = await submit(() =>
      recordGuidedExpense({
        date: date || null,
        category,
        description: description || null,
        total: totalNum,
        supplierId: supplierId || null,
        kind,
        accountId: accountId || null,
        costCenterId: costCenterId || null,
        payment,
        custodyAccountId: payment === "custody" ? custodyAccountId : null,
      }),
    );
    if (r.ok) setDone({ paid: Boolean(r.paid) });
    else setMsg(r.error ?? "تعذّر الحفظ");
  }

  if (done) {
    return (
      <Card>
        <div className="flex flex-col gap-3 p-2">
          <h2 className="text-lg font-bold" style={{ color: "var(--ink)" }}>
            ✅ تم التسجيل
          </h2>
          <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
            {done.paid
              ? "سُجّل المصروف وخُصم من العهدة وقُيّد في الدفاتر — لا خطوات أخرى مطلوبة."
              : payment === "later"
                ? "سُجّل المصروف كآجل. التالي المقترح: أضِفه إلى طلب صرف عندما يحين السداد."
                : "سُجّل المصروف. يمكنك توجيه دفعه لاحقًا من صفحة العهدة."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                // U-9 quick-repeat: keep the where/who-paid defaults, clear only the what/how-much.
                setDate("");
                setCategory("");
                setTotal("");
                setDescription("");
                setSupplierId("");
                setMsg(null);
                setStep(1);
                setDone(null);
              }}
            >
              + مصروف آخر (بنفس النشاط وطريقة الدفع)
            </Button>
            {!done.paid && payment === "later" && (
              <Link href="/custody" className="inline-block">
                <Button variant="ghost">فتح طلبات الصرف</Button>
              </Link>
            )}
            <Link href="/record" className="inline-block">
              <Button variant="ghost">رجوع إلى «سجّل»</Button>
            </Link>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <header>
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>
          دفعت مصروفًا
        </h1>
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          الخطوة {step} من 3 — {step === 1 ? "ماذا وكم؟" : step === 2 ? "على أي نشاط؟" : "من دفع؟"}
        </p>
      </header>

      {msg && <Alert tone="danger" title={msg} />}

      {step === 1 && (
        <Card>
          <div className="flex flex-col gap-3 p-1">
            <Field label="على ماذا صُرف؟ (مثال: أسمدة، سولار، صيانة)" id="w-cat">
              <Input id="w-cat" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={80} required />
            </Field>
            <Field label="المبلغ (ج.م)" id="w-total">
              <Input id="w-total" type="number" inputMode="decimal" min={0} step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} required />
            </Field>
            <Field label="التاريخ (اتركه فارغًا = اليوم)" id="w-date">
              <Input id="w-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="ما نوعه؟" id="w-kind">
              <select id="w-kind" className={selectClass} style={selectStyle} value={kind}
                onChange={(e) => { setKind(e.target.value as GuidedKind); setAccountId(""); }}>
                {(Object.keys(KIND_LABEL) as GuidedKind[]).map((k) => (
                  <option key={k} value={k}>{KIND_LABEL[k]}</option>
                ))}
              </select>
            </Field>
            <Field label="المورّد (اختياري)" id="w-sup">
              <select id="w-sup" className={selectClass} style={selectStyle} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">— بدون —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </Field>
            <Field label="بيان (اختياري)" id="w-desc">
              <Input id="w-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
            </Field>
            <div>
              <Button onClick={() => setStep(2)} disabled={!step1Valid}>التالي ←</Button>
            </div>
          </div>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <div className="flex flex-col gap-3 p-1">
            {centers.length > 0 && (
              <Field label="أي أرض/نشاط خدمه هذا المصروف؟ (اختياري)" id="w-cc">
                <select id="w-cc" className={selectClass} style={selectStyle} value={costCenterId} onChange={(e) => setCostCenterId(e.target.value)}>
                  <option value="">— غير موزَّع الآن —</option>
                  {centers.map((c) => (
                    <option key={c.id} value={c.id}>{c.nameAr}</option>
                  ))}
                </select>
              </Field>
            )}
            {kindAccounts.length > 0 && (
              <Field label="تحت أي بند في شجرة الحسابات؟ (اختياري — يلزم قبل طلب الصرف)" id="w-acct">
                <select id="w-acct" className={selectClass} style={selectStyle} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  <option value="">— أُصنّفه لاحقًا —</option>
                  {kindAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.code} — {a.nameAr}</option>
                  ))}
                </select>
              </Field>
            )}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep(1)}>→ رجوع</Button>
              <Button onClick={() => setStep(3)}>التالي ←</Button>
            </div>
          </div>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <div className="flex flex-col gap-3 p-1">
            <Field label="من دفع هذا المبلغ؟" id="w-pay">
              <select id="w-pay" className={selectClass} style={selectStyle} value={payment} onChange={(e) => setPayment(e.target.value as GuidedPayment)}>
                <option value="custody">دُفع نقدًا من العهدة</option>
                <option value="later">لم يُدفع بعد (آجل — سيدخل طلب صرف)</option>
                <option value="none">سجّل فقط، أوجّه الدفع لاحقًا</option>
              </select>
            </Field>
            {payment === "custody" && custodyAccounts.length > 0 && (
              <Field label="أي عهدة؟" id="w-cust">
                <select id="w-cust" className={selectClass} style={selectStyle} value={custodyAccountId} onChange={(e) => setCustodyAccountId(e.target.value)}>
                  {custodyAccounts.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </Field>
            )}
            {payment === "custody" && custodyAccounts.length === 0 && (
              <Alert tone="warning" title="لا توجد حسابات عهدة نشطة — أنشئ واحدًا من صفحة العهدة أو اختر خيارًا آخر." />
            )}

            <div className="rounded-md p-3 text-sm" style={{ background: "var(--surface-sunken, #f4f7f5)", color: "var(--ink)" }}>
              <strong>سيُسجَّل:</strong> {egp(totalNum || 0)} — {category || "…"}
              {centerLabel ? ` على «${centerLabel}»` : ""}
              {accountLabel ? ` تحت بند «${accountLabel}»` : ""}
              {payment === "custody" && custodyLabel ? `، مدفوعة من عهدة «${custodyLabel}»` : payment === "later" ? "، آجلة (تُسدَّد عبر طلب صرف)" : ""}
              {kind !== "operating" ? ` — ${KIND_LABEL[kind]}` : ""}. صحيح؟
            </div>

            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep(2)}>→ رجوع</Button>
              <Button onClick={onSave} disabled={pending || (payment === "custody" && !custodyAccountId)}>
                {pending ? "جارٍ الحفظ…" : "احفظ ✓"}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
