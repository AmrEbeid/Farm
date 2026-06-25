"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Alert } from "@/components/ui";
import {
  submitPurchaseRequest,
  approvePurchaseRequest,
  recordReceipt,
} from "@/app/(app)/purchase-requests/[prId]/actions";

export function PrActions({
  prId,
  status,
  version,
  canApprove,
  canReceive,
}: {
  prId: string;
  status: string;
  version: number;
  canApprove: boolean;
  canReceive: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setPending(true);
    setError(null);
    const res = await fn();
    setPending(false);
    if (res.ok) router.refresh();
    else setError(res.error ?? "تعذّر تنفيذ الإجراء");
  }

  return (
    <div className="flex flex-col gap-3">
      <div aria-live="assertive" aria-atomic="true">
        {error && <Alert tone="danger" title={error} />}
      </div>
      <div className="flex flex-wrap gap-2">
        {status === "draft" && (
          <Button variant="primary" loading={pending} onClick={() => run(() => submitPurchaseRequest(prId))}>
            إرسال للاعتماد
          </Button>
        )}
        {status === "submitted" && (
          <Button
            variant="primary"
            loading={pending}
            disabled={!canApprove}
            onClick={() => run(() => approvePurchaseRequest(prId, version))}
          >
            {canApprove ? "اعتماد (المالك)" : "الاعتماد للمالك فقط"}
          </Button>
        )}
        {status === "approved" && (
          <Button
            variant="primary"
            loading={pending}
            disabled={!canReceive}
            onClick={() => run(() => recordReceipt(prId))}
          >
            تسجيل الاستلام
          </Button>
        )}
      </div>
    </div>
  );
}
