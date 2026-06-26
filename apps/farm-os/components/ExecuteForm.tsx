"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, FormRow, Input, Textarea, Alert } from "@/components/ui";
import { executeOperation } from "@/app/(app)/m/execute/[opId]/actions";

export function ExecuteForm({
  opId,
  defaultQty,
  defaultNote = "",
  unit,
}: {
  opId: string;
  defaultQty: number | null;
  defaultNote?: string;
  unit: string;
}) {
  const router = useRouter();
  const [qty, setQty] = useState(defaultQty != null ? String(defaultQty) : "");
  const [labor, setLabor] = useState("4");
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
          const res = await executeOperation(opId, {
            actualQty: Number(qty),
            laborCount: Number(labor),
            note,
          });
          setPending(false);
          if (res.ok) router.push("/m?done=1");
          else setError(res.error ?? "تعذّر التنفيذ");
        }}
      >
        إنهاء العملية
      </Button>
    </div>
  );
}
