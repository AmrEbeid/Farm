"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil } from "lucide-react";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { correctAndRerouteExpense } from "../actions";
import type { ExpenseCorrectionRoute } from "@/lib/expense-payment-reversal";

type Option = { id: string; label: string };

export function ExpenseCorrectionControl({
  expense,
  suppliers,
  accounts,
  costCenters,
  custodyAccounts,
}: {
  expense: {
    id: string;
    date: string | null;
    category: string | null;
    description: string | null;
    total: number | string | null;
    supplierId: string | null;
    accountId: string | null;
    costCenterId: string | null;
  };
  suppliers: Option[];
  accounts: Option[];
  costCenters: Option[];
  custodyAccounts: Option[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(expense.date ?? "");
  const [category, setCategory] = useState(expense.category ?? "");
  const [description, setDescription] = useState(expense.description ?? "");
  const [total, setTotal] = useState(expense.total == null ? "" : String(expense.total));
  const [supplierId, setSupplierId] = useState(expense.supplierId ?? "");
  const [accountId, setAccountId] = useState(expense.accountId ?? "");
  const [costCenterId, setCostCenterId] = useState(expense.costCenterId ?? "");
  const [route, setRoute] = useState<ExpenseCorrectionRoute>(custodyAccounts.length ? "custody" : "later");
  const [custodyAccountId, setCustodyAccountId] = useState(custodyAccounts[0]?.id ?? "");
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setMessage(null);
    startTransition(async () => {
      const result = await correctAndRerouteExpense({
        expenseId: expense.id,
        date,
        category,
        description,
        total,
        supplierId,
        accountId,
        costCenterId,
        route,
        custodyAccountId,
      });
      if (!result.ok) {
        setMessage({ tone: "danger", text: result.error ?? "تعذّر حفظ التصحيح" });
        return;
      }
      setMessage({
        tone: "ok",
        text: route === "custody" ? "حُفظ التصحيح وسُجّل السداد من العهدة." : route === "later" ? "حُفظ التصحيح وأصبح المصروف آجلًا." : "حُفظ التصحيح بلا مسار سداد.",
      });
      router.refresh();
    });
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md p-3" style={{ border: "1px solid var(--line)", background: "var(--surface)" }}>
        <Alert tone="warning" title="أكمل تصحيح المصروف" description="السداد الخاطئ عُكس. عدّل بيانات المصروف ثم وجّه السداد الصحيح من هنا." />
        <Button type="button" size="sm" onClick={() => setOpen(true)}>
          <Pencil aria-hidden="true" size={16} />
          تعديل وتوجيه
        </Button>
      </div>
    );
  }

  return (
    <section
      dir="rtl"
      aria-labelledby="expense-correction-heading"
      className="flex flex-col gap-3 rounded-md p-4"
      style={{ border: "1px solid var(--line)", background: "var(--surface)" }}
    >
      <div>
        <h2 id="expense-correction-heading" className="text-base font-bold">تعديل المصروف وتوجيهه</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-muted)" }}>
          عدّل البيانات الخاطئة ثم اختر مسار السداد الصحيح. سجل السداد السابق وعكسه سيبقيان محفوظين.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="على ماذا صُرف؟" id="correct-expense-category" required>
          <Input id="correct-expense-category" value={category} maxLength={80} disabled={pending} onChange={(event) => setCategory(event.target.value)} />
        </Field>
        <Field label="المبلغ (ج.م)" id="correct-expense-total" required>
          <Input id="correct-expense-total" type="number" inputMode="decimal" min={0.01} step="0.01" value={total} disabled={pending} onChange={(event) => setTotal(event.target.value)} />
        </Field>
        <Field label="التاريخ" id="correct-expense-date">
          <Input id="correct-expense-date" type="date" value={date} disabled={pending} onChange={(event) => setDate(event.target.value)} />
        </Field>
        <Field label="المورّد" id="correct-expense-supplier">
          <Select id="correct-expense-supplier" value={supplierId} disabled={pending} options={[{ value: "", label: "بدون مورّد" }, ...suppliers.map((option) => ({ value: option.id, label: option.label }))]} onChange={(event) => setSupplierId(event.target.value)} />
        </Field>
        <Field label="الحساب المحاسبي" id="correct-expense-account">
          <Select id="correct-expense-account" value={accountId} disabled={pending} options={[{ value: "", label: "بدون حساب" }, ...accounts.map((option) => ({ value: option.id, label: option.label }))]} onChange={(event) => setAccountId(event.target.value)} />
        </Field>
        <Field label="مركز التكلفة" id="correct-expense-cost-center">
          <Select id="correct-expense-cost-center" value={costCenterId} disabled={pending} options={[{ value: "", label: "غير موزّع" }, ...costCenters.map((option) => ({ value: option.id, label: option.label }))]} onChange={(event) => setCostCenterId(event.target.value)} />
        </Field>
      </div>

      <Field label="بيان" id="correct-expense-description">
        <Textarea id="correct-expense-description" value={description} maxLength={200} rows={2} disabled={pending} onChange={(event) => setDescription(event.target.value)} />
      </Field>

      <Field label="مسار السداد الصحيح" id="correct-expense-route" required>
        <Select
          id="correct-expense-route"
          value={route}
          disabled={pending}
          options={[
            ...(custodyAccounts.length ? [{ value: "custody", label: "دُفع نقدًا من العهدة" }] : []),
            { value: "later", label: "لم يُدفع بعد — يدخل طلب صرف" },
            { value: "none", label: "احفظ فقط وأوجّه السداد لاحقًا" },
          ]}
          onChange={(event) => setRoute(event.target.value as ExpenseCorrectionRoute)}
        />
      </Field>

      {route === "custody" && (
        <Field label="أي عهدة؟" id="correct-expense-custody" required>
          <Select id="correct-expense-custody" value={custodyAccountId} disabled={pending} options={custodyAccounts.map((option) => ({ value: option.id, label: option.label }))} onChange={(event) => setCustodyAccountId(event.target.value)} />
        </Field>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" loading={pending} disabled={pending} onClick={submit}>
          <Check aria-hidden="true" size={16} />
          حفظ التصحيح
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>إغلاق</Button>
      </div>

      <div role="alert" aria-live="assertive" aria-atomic="true">
        {message && <Alert tone={message.tone} title={message.text} />}
      </div>
    </section>
  );
}
