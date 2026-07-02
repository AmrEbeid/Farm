"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Select, Alert } from "@/components/ui";
import {
  createCustodyAccount,
  recordCustodyMovement,
  createPaymentRequest,
  addExpenseToRequest,
  recordPaymentRequestFunding,
  confirmRequestExpensePaid,
  closePaymentRequest,
} from "@/app/(app)/custody/actions";

type Acct = { id: string; holder_label: string };
type Msg = { tone: "ok" | "danger"; text: string } | null;
type PaymentRequestExpense = { id: string; label: string };
type PayableRequestExpense = { id: string; label: string };

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
    <div className="flex flex-col gap-3 rounded-lg border p-4" style={{ borderColor: "var(--line)" }}>
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
            <Input id="c-target" type="number" inputMode="decimal" min={0} value={target} onChange={(e) => setTarget(e.target.value)} />
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
            <Input id="m-amount" type="number" inputMode="decimal" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
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
    return <p style={{ color: "var(--ink-muted)" }}>لا توجد مصروفات مؤهلة متاحة للإضافة.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div role="alert" aria-live="assertive" aria-atomic="true">
        {msg && <Alert tone={msg.tone} title={msg.text} />}
      </div>
      <Field label="مصروف مؤهل للطلب" id="request-expense">
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

export function RecordRequestFunding({
  requestId,
  accounts,
  remainingToFund,
}: {
  requestId: string;
  accounts: Acct[];
  remainingToFund: number;
}) {
  const router = useRouter();
  const [custodyAccountId, setCustodyAccountId] = useState(accounts[0]?.id ?? "");
  const [amount, setAmount] = useState(remainingToFund > 0 ? String(remainingToFund) : "");
  const [occurredAt, setOccurredAt] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function submit() {
    if (!custodyAccountId) return;
    setPending(true);
    setMsg(null);
    let res: { ok: boolean; error?: string };
    try {
      res = await recordPaymentRequestFunding({
        requestId,
        custodyAccountId,
        amount: Number(amount),
        occurredAt: occurredAt || null,
        note: note || null,
      });
    } catch {
      res = { ok: false, error: "تعذّر الاتصال بالخادم. حاول مرة أخرى." };
    }
    setPending(false);
    if (res.ok) {
      setMsg({ tone: "ok", text: "تم تسجيل تمويل المالك كعهدة" });
      router.refresh();
    } else {
      setMsg({ tone: "danger", text: res.error ?? "تعذّر تسجيل التمويل" });
    }
  }

  if (accounts.length === 0) {
    return <p style={{ color: "var(--ink-muted)" }}>أضف حساب عهدة قبل تسجيل تمويل المالك.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div role="alert" aria-live="assertive" aria-atomic="true">
        {msg && <Alert tone={msg.tone} title={msg.text} />}
      </div>
      <Field label="إيداع التمويل في عهدة" id="funding-account">
        <Select
          id="funding-account"
          value={custodyAccountId}
          onChange={(e) => setCustodyAccountId(e.target.value)}
          options={accounts.map((a) => ({ value: a.id, label: a.holder_label }))}
        />
      </Field>
      <Field label="المبلغ المستلم من المالك" id="funding-amount">
        <Input id="funding-amount" type="number" inputMode="decimal" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="تاريخ الاستلام" id="funding-date">
        <Input id="funding-date" type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
      </Field>
      <Field label="ملاحظات" id="funding-note">
        <Input id="funding-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
      </Field>
      <div>
        <Button disabled={pending || !custodyAccountId || Number(amount) <= 0} onClick={submit}>
          {pending ? "جارٍ التسجيل…" : "تسجيل التمويل"}
        </Button>
      </div>
    </div>
  );
}

export function ConfirmRequestExpensePayment({
  requestId,
  expenses,
  accounts,
}: {
  requestId: string;
  expenses: PayableRequestExpense[];
  accounts: Acct[];
}) {
  const router = useRouter();
  const [expenseId, setExpenseId] = useState(expenses[0]?.id ?? "");
  const [custodyAccountId, setCustodyAccountId] = useState(accounts[0]?.id ?? "");
  const [occurredAt, setOccurredAt] = useState("");
  const [paidBy, setPaidBy] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const selectedExpenseId = expenses.some((expense) => expense.id === expenseId)
    ? expenseId
    : expenses[0]?.id ?? "";

  async function submit() {
    if (!selectedExpenseId || !custodyAccountId) return;
    setPending(true);
    setMsg(null);
    let res: { ok: boolean; error?: string };
    try {
      res = await confirmRequestExpensePaid({
        requestId,
        expenseId: selectedExpenseId,
        custodyAccountId,
        occurredAt: occurredAt || null,
        paidBy: paidBy || null,
        note: note || null,
      });
    } catch {
      res = { ok: false, error: "تعذّر الاتصال بالخادم. حاول مرة أخرى." };
    }
    setPending(false);
    if (res.ok) {
      setMsg({ tone: "ok", text: "تم تأكيد السداد من العهدة" });
      router.refresh();
    } else {
      setMsg({ tone: "danger", text: res.error ?? "تعذّر تأكيد السداد" });
    }
  }

  if (accounts.length === 0) {
    return <p style={{ color: "var(--ink-muted)" }}>أضف حساب عهدة قبل تأكيد السداد.</p>;
  }
  if (expenses.length === 0) {
    return <p style={{ color: "var(--ink-muted)" }}>لا توجد بنود ممولة تنتظر تأكيد السداد.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div role="alert" aria-live="assertive" aria-atomic="true">
        {msg && <Alert tone={msg.tone} title={msg.text} />}
      </div>
      <Field label="البند المطلوب سداده" id="pay-expense">
        <Select
          id="pay-expense"
          value={selectedExpenseId}
          onChange={(e) => setExpenseId(e.target.value)}
          options={expenses.map((e) => ({ value: e.id, label: e.label }))}
        />
      </Field>
      <Field label="مصدر العهدة" id="pay-account">
        <Select
          id="pay-account"
          value={custodyAccountId}
          onChange={(e) => setCustodyAccountId(e.target.value)}
          options={accounts.map((a) => ({ value: a.id, label: a.holder_label }))}
        />
      </Field>
      <Field label="تاريخ السداد" id="pay-date">
        <Input id="pay-date" type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
      </Field>
      <Field label="تم الدفع بواسطة" id="pay-by">
        <Input id="pay-by" value={paidBy} onChange={(e) => setPaidBy(e.target.value)} maxLength={80} />
      </Field>
      <Field label="ملاحظات" id="pay-note">
        <Input id="pay-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
      </Field>
      <div>
        <Button disabled={pending || !selectedExpenseId || !custodyAccountId} onClick={submit}>
          {pending ? "جارٍ التأكيد…" : "تأكيد السداد"}
        </Button>
      </div>
    </div>
  );
}

export function ClosePaymentRequestButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function submit() {
    setPending(true);
    setMsg(null);
    let res: { ok: boolean; error?: string };
    try {
      res = await closePaymentRequest(requestId);
    } catch {
      res = { ok: false, error: "تعذّر الاتصال بالخادم. حاول مرة أخرى." };
    }
    setPending(false);
    if (res.ok) {
      setMsg({ tone: "ok", text: "تم إقفال طلب الصرف" });
      router.refresh();
    } else {
      setMsg({ tone: "danger", text: res.error ?? "تعذّر إقفال الطلب" });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div role="alert" aria-live="assertive" aria-atomic="true">
        {msg && <Alert tone={msg.tone} title={msg.text} />}
      </div>
      <div>
        <Button disabled={pending} onClick={submit}>
          {pending ? "جارٍ الإقفال…" : "إقفال الطلب"}
        </Button>
      </div>
    </div>
  );
}
