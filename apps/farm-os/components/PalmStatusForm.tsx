"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Alert, FormRow, Select, Input, type SelectOption } from "@/components/ui";
import { updatePalmStatus } from "@/app/(app)/farm/palm/[id]/actions";

const STATUS_OPTIONS: SelectOption[] = [
  { value: "active", label: "سليمة" },
  { value: "watch", label: "تحت المراقبة" },
  { value: "sick", label: "مريضة" },
  { value: "dead", label: "ميتة" },
  { value: "removed", label: "مُزالة" },
  { value: "replaced", label: "مُستبدلة" },
];

export function PalmStatusForm({
  assetId,
  currentStatus,
}: {
  assetId: string;
  currentStatus: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(currentStatus);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setDone(false);
    const res = await updatePalmStatus(assetId, status, reason);
    setPending(false);
    if (res.ok) {
      setDone(true);
      setReason("");
      router.refresh(); // re-render the page (overview status + history timeline)
    } else {
      setError(res.error ?? "تعذّر تحديث الحالة");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div aria-live="assertive" aria-atomic="true">
        {error && <Alert tone="danger" title={error} />}
        {done && <Alert tone="ok" title="تم تحديث حالة النخلة" />}
      </div>
      <FormRow id="palm-status" label="الحالة">
        <Select
          options={STATUS_OPTIONS}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        />
      </FormRow>
      <FormRow id="palm-reason" label="السبب (اختياري)">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
      </FormRow>
      <Button type="submit" variant="primary" loading={pending}>
        تحديث الحالة
      </Button>
    </form>
  );
}
