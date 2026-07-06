"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Alert, useToast } from "@/components/ui";
import { useSubmit } from "@/components/useSubmit";
import { createExpense, type ExpenseKind } from "@/app/(app)/expenses/actions";
import { AccountPicker } from "@/components/AccountPickerClient";
import type { PickableAccount } from "@/lib/account-options";

// Owner drawings (مسحوبات) must be separable from operating expenses (non-negotiable #6). Classifying at
// entry is the write side of that split — the finance dashboard reads expenses.kind.
const KIND_OPTIONS: { value: ExpenseKind; label: string }[] = [
  { value: "operating", label: "تشغيلي" },
  { value: "drawing", label: "مسحوبات (صاحب المزرعة)" },
  { value: "capex", label: "رأسمالي" },
];

/** Record-expense form, shown only to budget.write roles (the page gates it). */
export function AddExpense({
  suppliers,
  accounts,
}: {
  suppliers: { id: string; name: string }[];
  accounts: PickableAccount[];
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [total, setTotal] = useState("");
  const [kind, setKind] = useState<ExpenseKind>("operating");
  const [accountId, setAccountId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [payment, setPayment] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const { pending, submit } = useSubmit();
  const router = useRouter();
  const toast = useToast();
  const matchingAccounts = useMemo(
    () => accounts.filter((account) => account.kind === kind),
    [accounts, kind],
  );
  const accountValue = matchingAccounts.some((account) => account.id === accountId) ? accountId : "";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const r = await submit(() =>
      createExpense({
        date: date || null,
        category,
        description: description || null,
        total: Number(total),
        kind,
        accountId: accountValue || null,
        supplierId: supplierId || null,
        paymentMethod: payment || null,
      }),
    );
    if (r.ok) {
      setOpen(false);
      setDate("");
      setCategory("");
      setDescription("");
      setTotal("");
      setKind("operating");
      setAccountId("");
      setSupplierId("");
      setPayment("");
      toast.ok("تمت إضافة المصروف بنجاح");
      router.refresh();
    } else {
      setMsg({ tone: "danger", text: r.error ?? "تعذّر الحفظ" });
    }
  }

  if (!open) {
    return (
      <div>
        <Button variant="ghost" onClick={() => setOpen(true)}>
          + تسجيل مصروف
        </Button>
      </div>
    );
  }

  const selectClass = "rounded-md border px-2 py-1.5 text-sm";
  const selectStyle = { borderColor: "var(--line)" } as const;

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-lg border p-4"
      style={{ borderColor: "var(--line)" }}
    >
      {msg && <Alert tone={msg.tone} title={msg.text} />}
      <Field label="التاريخ" id="e-date">
        <Input id="e-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label="الفئة" id="e-cat">
        <Input id="e-cat" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={80} required />
      </Field>
      <Field label="البيان" id="e-desc">
        <Input id="e-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
      </Field>
      <Field label="المبلغ (ج.م)" id="e-total">
        <Input id="e-total" type="number" inputMode="decimal" min={0} step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} required />
      </Field>
      <Field label="نوع المصروف" id="e-kind">
        <select
          id="e-kind"
          className={selectClass}
          style={selectStyle}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as ExpenseKind);
            setAccountId("");
          }}
        >
          {KIND_OPTIONS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="الحساب المحاسبي" id="e-account">
        <AccountPicker
          id="e-account"
          value={accountValue}
          onChange={setAccountId}
          accounts={matchingAccounts}
          required={matchingAccounts.length > 0}
          disabled={matchingAccounts.length === 0}
        />
      </Field>
      {matchingAccounts.length === 0 && (
        <Alert
          tone="warning"
          title="لا يوجد حساب فرعي نشط مناسب لهذا النوع. أضف الحساب من شجرة الحسابات قبل إدخال مصروف جديد."
        />
      )}
      <Field label="المورّد" id="e-sup">
        <select
          id="e-sup"
          className={selectClass}
          style={selectStyle}
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
        >
          <option value="">— بدون —</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="طريقة الدفع" id="e-pay">
        <Input id="e-pay" value={payment} onChange={(e) => setPayment(e.target.value)} maxLength={40} />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || matchingAccounts.length === 0}>
          {pending ? "جارٍ الحفظ…" : "حفظ المصروف"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          إلغاء
        </Button>
      </div>
    </form>
  );
}
