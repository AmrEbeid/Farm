"use client";

import { useState } from "react";
import { Button, Alert } from "@/components/ui";
import {
  submitPaymentRequest,
  approveRequestOperational,
  approveRequestFinal,
} from "@/app/(app)/custody/actions";

type Role = string;

/** Lifecycle actions for one payment request — shows only the button legal for (status, role). */
export function RequestLifecycle({ requestId, status, role }: { requestId: string; status: string; role: Role }) {
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setPending(true);
    setErr(null);
    let r: { ok: boolean; error?: string };
    try {
      r = await fn();
    } catch {
      r = { ok: false, error: "تعذّر الاتصال بالخادم. حاول مرة أخرى." };
    }
    setPending(false);
    if (r.ok) window.location.reload();
    else setErr(r.error ?? "تعذّر تنفيذ الإجراء");
  }

  const canPrepare = role === "owner" || role === "farm_manager" || role === "accountant";
  const canApproveOp = role === "owner" || role === "farm_manager";
  const canApproveFinal = role === "owner";

  return (
    <div className="flex flex-col gap-2 no-print">
      <div role="alert" aria-live="assertive" aria-atomic="true">
        {err && <Alert tone="danger" title={err} />}
      </div>
      <div className="flex flex-wrap gap-2">
        {status === "draft" && canPrepare && (
          <Button disabled={pending} onClick={() => run(() => submitPaymentRequest(requestId))}>
            {pending ? "…" : "إرسال للاعتماد"}
          </Button>
        )}
        {status === "submitted" && canApproveOp && (
          <Button disabled={pending} onClick={() => run(() => approveRequestOperational(requestId))}>
            {pending ? "…" : "اعتماد تشغيلي (مدير المزرعة)"}
          </Button>
        )}
        {status === "approved_operational" && canApproveFinal && (
          <Button disabled={pending} onClick={() => run(() => approveRequestFinal(requestId))}>
            {pending ? "…" : "اعتماد نهائي (المالك)"}
          </Button>
        )}
        <Button variant="ghost" onClick={() => window.print()}>طباعة الإذن</Button>
      </div>
    </div>
  );
}
