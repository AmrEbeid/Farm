"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Alert } from "@/components/ui";
import { ReceiveForm, type ReceiveLine } from "@/components/ReceiveForm";
import {
  submitPurchaseRequest,
  approvePurchaseRequest,
} from "@/app/(app)/purchase-requests/[prId]/actions";

export function PrActions({
  prId,
  status,
  version,
  canApprove,
  canReceive,
  lines,
}: {
  prId: string;
  status: string;
  version: number;
  canApprove: boolean;
  canReceive: boolean;
  lines: ReceiveLine[];
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

  // A receipt may be recorded against an approved PR OR one that is already partially received
  // (real deliveries arrive in instalments — SPEC-0009 #155).
  const receivable = status === "approved" || status === "partially_received";

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
      </div>
      {receivable &&
        (canReceive ? (
          <ReceiveForm prId={prId} lines={lines} />
        ) : (
          <p style={{ color: "var(--ink-muted)" }}>ليس لديك صلاحية استلام المخزون.</p>
        ))}
    </div>
  );
}
