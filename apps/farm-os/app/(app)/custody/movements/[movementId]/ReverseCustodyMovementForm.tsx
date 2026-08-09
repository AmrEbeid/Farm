"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, Input } from "@/components/ui";
import { reverseCustodyMovement } from "@/app/(app)/custody/actions";

export function ReverseCustodyMovementForm({
  movementId,
  today,
}: {
  movementId: string;
  today: string;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [reversalDate, setReversalDate] = useState(today);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  async function submit() {
    setPending(true);
    setMessage(null);
    let result: { ok: boolean; error?: string };
    try {
      result = await reverseCustodyMovement({ movementId, reason, reversalDate });
    } catch {
      result = { ok: false, error: "تعذّر الاتصال بالخادم. حاول مرة أخرى." };
    }
    setPending(false);
    if (result.ok) {
      setMessage({ tone: "ok", text: "تم عكس التمويل مع حفظ الحركة والقيد الأصليين." });
      router.refresh();
      return;
    }
    setMessage({ tone: "danger", text: result.error ?? "تعذّر عكس الحركة" });
  }

  return (
    <div className="flex flex-col gap-3">
      <div role="alert" aria-live="assertive" aria-atomic="true">
        {message && <Alert tone={message.tone} title={message.text} />}
      </div>
      <Alert
        tone="warning"
        title="سيُسجَّل صادر بنفس المبلغ وقيد عكسي مرتبط. لن تُحذف الحركة الأصلية."
      />
      <Field label="تاريخ التصحيح" id="custody-reversal-date">
        <Input
          id="custody-reversal-date"
          type="date"
          max={today}
          value={reversalDate}
          onChange={(event) => setReversalDate(event.target.value)}
        />
      </Field>
      <Field label="سبب التصحيح" id="custody-reversal-reason">
        <Input
          id="custody-reversal-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={500}
          placeholder="مثال: تم تسجيل التمويل مرتين"
        />
      </Field>
      <div>
        <Button disabled={pending || !reason.trim() || !reversalDate} onClick={submit}>
          {pending ? "جارٍ العكس…" : "تأكيد عكس التمويل"}
        </Button>
      </div>
    </div>
  );
}
