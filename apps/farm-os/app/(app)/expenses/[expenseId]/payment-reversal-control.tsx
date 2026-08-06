"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { reverseExpensePayment } from "../actions";
import type { ExpensePaymentReversalOutcome } from "@/lib/expense-payment-reversal";

type Message = { tone: "ok" | "danger"; text: string } | null;

export function PaymentReversalControl({
  expenseId,
  movementId,
  amount,
  custodyAccountLabel,
  today,
}: {
  expenseId: string;
  movementId: string;
  amount: string;
  custodyAccountLabel: string;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<ExpensePaymentReversalOutcome>("unrouted");
  const [reason, setReason] = useState("");
  const [reversalDate, setReversalDate] = useState(today);
  const [message, setMessage] = useState<Message>(null);
  const [pending, startTransition] = useTransition();

  const effect =
    outcome === "cancelled"
      ? `سيُعاد ${amount} إلى عهدة ${custodyAccountLabel}، ويُعكس القيد، ويُلغى المصروف فلا يدخل في قائمة الربح والخسارة.`
      : `سيُعاد ${amount} إلى عهدة ${custodyAccountLabel}، ويُعكس القيد، ويعود المصروف بلا مسار سداد لتعديله أو توجيهه من جديد.`;

  function submit() {
    setMessage(null);
    startTransition(async () => {
      const result = await reverseExpensePayment({
        expenseId,
        movementId,
        outcome,
        reason,
        reversalDate,
      });
      if (!result.ok) {
        setMessage({ tone: "danger", text: result.error ?? "تعذّر تصحيح السداد" });
        return;
      }
      setMessage({
        tone: "ok",
        text: result.idempotent ? "كان هذا التصحيح مسجلًا بالفعل؛ لم تُضف أي حركة." : "تم تصحيح السداد وربط حركة العكس بالقيد.",
      });
      router.refresh();
    });
  }

  if (!open) {
    return (
      <div>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
          <RotateCcw aria-hidden="true" size={16} />
          سجّلت غلط؟
        </Button>
      </div>
    );
  }

  return (
    <section
      dir="rtl"
      aria-labelledby="expense-payment-reversal-heading"
      className="flex flex-col gap-3 rounded-md p-4"
      style={{ border: "1px solid var(--line)", background: "var(--surface)" }}
    >
      <div>
        <h2 id="expense-payment-reversal-heading" className="text-base font-bold">
          تصحيح سداد المصروف
        </h2>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-muted)" }}>
          السجل الأصلي لا يُحذف. تُضاف حركة عكس مرتبطة وقيد عكسي بسبب مكتوب.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="نتيجة التصحيح" id="expense-reversal-outcome" required>
          <Select
            id="expense-reversal-outcome"
            value={outcome}
            options={[
              { value: "unrouted", label: "السداد فقط خطأ — أعد المصروف للتعديل" },
              { value: "cancelled", label: "المصروف كله خطأ — ألغِ المصروف" },
            ]}
            disabled={pending}
            onChange={(event) => setOutcome(event.target.value as ExpensePaymentReversalOutcome)}
          />
        </Field>
        <Field label="تاريخ التصحيح" id="expense-reversal-date" required>
          <Input
            id="expense-reversal-date"
            type="date"
            value={reversalDate}
            disabled={pending}
            onChange={(event) => setReversalDate(event.target.value)}
          />
        </Field>
      </div>

      <Field label="سبب التصحيح" id="expense-reversal-reason" required>
        <Textarea
          id="expense-reversal-reason"
          value={reason}
          maxLength={500}
          rows={3}
          disabled={pending}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>

      <Alert tone="warning" title="ما سيحدث" description={effect} />

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="danger" loading={pending} disabled={pending} onClick={submit}>
          <RotateCcw aria-hidden="true" size={16} />
          تأكيد التصحيح
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          إلغاء
        </Button>
      </div>

      <div role="alert" aria-live="assertive" aria-atomic="true">
        {message && <Alert tone={message.tone} title={message.text} />}
      </div>
    </section>
  );
}
