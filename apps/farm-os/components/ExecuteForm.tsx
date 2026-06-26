"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, FormRow, Input, Textarea, Alert } from "@/components/ui";
import { executeOperation } from "@/app/(app)/m/execute/[opId]/actions";

export function ExecuteForm({
  opId,
  defaultQty,
  defaultLabor = null,
  defaultNote = "",
  unit,
}: {
  opId: string;
  defaultQty: number | null;
  defaultLabor?: number | null;
  defaultNote?: string;
  unit: string;
}) {
  const router = useRouter();
  const [qty, setQty] = useState(defaultQty != null ? String(defaultQty) : "");
  // Prefill from the op's planned labor (plan_labor_requirements.count) like qty — never a
  // hardcoded magic default, which would persist fabricated actual-labor data (non-negotiable #1).
  const [labor, setLabor] = useState(defaultLabor != null ? String(defaultLabor) : "");
  const [note, setNote] = useState(defaultNote);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div aria-live="assertive" aria-atomic="true">
        {error && <Alert tone="danger" title={error} />}
      </div>
      <FormRow id="qty" label={`الكمية المستخدمة (${unit})`}>
        <Input type="number" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
      </FormRow>
      <FormRow id="labor" label="عدد العمال">
        <Input type="number" inputMode="numeric" value={labor} onChange={(e) => setLabor(e.target.value)} />
      </FormRow>
      <FormRow id="note" label="ملاحظة">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      </FormRow>
      <Button
        variant="primary"
        loading={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            const res = await executeOperation(opId, {
              actualQty: Number(qty),
              laborCount: Number(labor),
              note,
            });
            if (res.ok) {
              router.push("/m?done=1");
              return;
            }
            setError(res.error ?? "تعذّر التنفيذ");
          } catch {
            // Field PWA is offline-tolerant (non-negotiable #2): a network failure rejects the
            // server-action fetch and the await throws. Without this catch the button would stay
            // stuck on its spinner forever (setPending never resets, event-handler throws aren't
            // caught by an error boundary). Surface a retryable Arabic message instead.
            setError("تعذّر الاتصال بالخادم. تحقّق من الاتصال وحاول مرة أخرى.");
          } finally {
            setPending(false);
          }
        }}
      >
        إنهاء العملية
      </Button>
    </div>
  );
}
