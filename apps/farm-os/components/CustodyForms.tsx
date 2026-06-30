"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Select, Alert } from "@/components/ui";
import {
  createCustodyAccount,
  recordCustodyMovement,
  createPaymentRequest,
  addExpenseToRequest,
} from "@/app/(app)/custody/actions";

type Acct = { id: string; holder_label: string };
type Msg = { tone: "ok" | "danger"; text: string } | null;
type PaymentRequestExpense = { id: string; label: string };

const MOVEMENT_TYPES = [
  "استلام عهدة من المالك",
  "تسليم عهدة للمحاسب",
  "صرف نقدي",
  "رد/إيداع",
  "تسوية",
];

/** SPEC-0018 slice 4 — write surface for the custody module (shown only to finance write-roles). */
export function CustodyForms({ accounts }: { accounts: Acct[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<null | "acct" | "move" | "req">(null);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  // add-account
  const [label, setLabel] = useState("");
  const [target, setTarget] = useState("30000");
  // movement
  const [acct, setAcct] = useState(accounts[0]?.id ?? "");
  const [mtype, setMtype] = useState(MOVEMENT_TYPES[0]);
  const [dir, setDir] = useState<"in" | "out">("in");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  // request
  const [reqAcct, setReqAcct] = useState(accounts[0]?.id ?? "");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    setPending(true);
    setMsg(null);
    let r: { ok: boolean; error?: string };
    try {
      r = await fn();
    } catch {
      r = { ok: false, error: "تعذّر الاتصال بالخادم. حاول مرة أخرى." };
    }
    setPending(false);
    if (r.ok) {
      setMsg({ tone: "ok", text: okText });
      router.refresh();
    } else {
      setMsg({ tone: "danger", text: r.error ?? "تعذّر الحفظ" });
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4" style={{ borderColor: "var(--border)" }}>
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" onClick={() => setOpen(open === "acct" ? null : "acct")}>+ حساب عهدة</Button>
        <Button variant="ghost" onClick={() => setOpen(open === "move" ? null : "move")}>+ حركة عهدة</Button>
        <Button variant="ghost" onClick={() => setOpen(open === "req" ? null : "req")}>+ طلب صرف</Button>
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true">
        {msg && <Alert tone={msg.tone} title={msg.text} />}
      </div>

      {open === "acct" && (
        <div className="flex flex-col gap-3">
          <Field label="صاحب العهدة (مثلاً: مدير المزرعة)" id="c-label">
            <Input id="c-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} />
          </Field>
          <Field label="العهدة المستهدفة (ج.م)" id="c-target">
            <Input id="c-target" type="number" min={0} value={target} onChange={(e) => setTarget(e.target.value)} />
          </Field>
          <div>
            <Button disabled={pending} onClick={() => run(() => createCustodyAccount({ holderLabel: label, targetFloat: Number(target) }), "تمت إضافة حساب العهدة")}>
              {pending ? "جارٍ الحفظ…" : "حفظ الحساب"}
            </Button>
          </div>
        </div>
      )}

      {open === "move" && (
        <div className="flex flex-col gap-3">
          <Field label="حساب العهدة" id="m-acct">
            <Select id="m-acct" value={acct} onChange={(e) => setAcct(e.target.value)}
              options={accounts.map((a) => ({ value: a.id, label: a.holder_label }))} />
          </Field>
          <Field label="نوع الحركة" id="m-type">
            <Select id="m-type" value={mtype} onChange={(e) => setMtype(e.target.value)}
              options={MOVEMENT_TYPES.map((t) => ({ value: t, label: t }))} />
          </Field>
          <Field label="الاتجاه" id="m-dir">
            <Select id="m-dir" value={dir} onChange={(e) => setDir(e.target.value as "in" | "out")}
              options={[{ value: "in", label: "وارد (استلام)" }, { value: "out", label: "صادر (صرف/تسليم)" }]} />
          </Field>
          <Field label="المبلغ (ج.م)" id="m-amount">
            <Input id="m-amount" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="ملاحظات" id="m-note">
            <Input id="m-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
          </Field>
          <div>
            <Button disabled={pending || !acct} onClick={() => run(() => recordCustodyMovement({
              accountId: acct, movementType: mtype,
              amountIn: dir === "in" ? Number(amount) : 0, amountOut: dir === "out" ? Number(amount) : 0,
              note: note || null,
            }), "تم تسجيل الحركة")}>
              {pending ? "جارٍ الحفظ…" : "تسجيل الحركة"}
            </Button>
          </div>
        </div>
      )}

      {open === "req" && (
        <div className="flex flex-col gap-3">
          <Field label="حساب العهدة المرتبط (للتغذية)" id="r-acct">
            <Select id="r-acct" value={reqAcct} onChange={(e) => setReqAcct(e.target.value)}
              options={accounts.map((a) => ({ value: a.id, label: a.holder_label }))} />
          </Field>
          <Field label="من تاريخ" id="r-start">
            <Input id="r-start" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </Field>
          <Field label="إلى تاريخ" id="r-end">
            <Input id="r-end" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </Field>
          <div>
            <Button disabled={pending} onClick={() => run(() => createPaymentRequest({
              custodyAccountId: reqAcct || null, periodStart: periodStart || null, periodEnd: periodEnd || null,
            }), "تم إنشاء طلب الصرف")}>
              {pending ? "جارٍ الإنشاء…" : "إنشاء طلب الصرف"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AddExpenseToPaymentRequest({
  requestId,
  expenses,
}: {
  requestId: string;
  expenses: PaymentRequestExpense[];
}) {
  const router = useRouter();
  const [selectedExpenseId, setSelectedExpenseId] = useState(expenses[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const expenseId = expenses.some((expense) => expense.id === selectedExpenseId)
    ? selectedExpenseId
    : expenses[0]?.id ?? "";

  async function submit() {
    if (!expenseId) return;
    setPending(true);
    setMsg(null);
    let res: { ok: boolean; error?: string };
    try {
      res = await addExpenseToRequest(requestId, expenseId);
    } catch {
      res = { ok: false, error: "تعذّر الاتصال بالخادم. حاول مرة أخرى." };
    }
    setPending(false);
    if (res.ok) {
      setMsg({ tone: "ok", text: "تمت إضافة المصروف للطلب" });
      router.refresh();
    } else {
      setMsg({ tone: "danger", text: res.error ?? "تعذّر إضافة المصروف" });
    }
  }

  if (expenses.length === 0) {
    return <p style={{ color: "var(--ink-muted)" }}>لا توجد مصروفات آجلة متاحة للإضافة.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div role="alert" aria-live="assertive" aria-atomic="true">
        {msg && <Alert tone={msg.tone} title={msg.text} />}
      </div>
      <Field label="مصروف آجل غير مدفوع" id="request-expense">
        <Select
          id="request-expense"
          value={expenseId}
          onChange={(e) => setSelectedExpenseId(e.target.value)}
          options={expenses.map((e) => ({ value: e.id, label: e.label }))}
        />
      </Field>
      <div>
        <Button disabled={pending || !expenseId} onClick={submit}>
          {pending ? "جارٍ الإضافة…" : "إضافة للطلب"}
        </Button>
      </div>
    </div>
  );
}
