"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Alert } from "@/components/ui";
import { runPlanChecks } from "@/app/(app)/plans/[planId]/actions";

export function PlanChecksRunner({ planId }: { planId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <div aria-live="assertive" aria-atomic="true">
        {error && <Alert tone="danger" title={error} />}
      </div>
      <Button
        variant="ghost"
        loading={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            const res = await runPlanChecks(planId);
            if (res.ok) {
              router.refresh();
            } else {
              setError(res.error ?? "تعذّرت إعادة فحص الخطة");
            }
          } catch {
            // Network-failure handling (non-negotiable #2): a network reject must not strand the
            // spinner — surface a retryable Arabic message (mirrors ExecuteForm). The re-check is
            // not queued for replay if the device is actually offline.
            setError("تعذّر الاتصال بالخادم. تحقّق من الاتصال وحاول مرة أخرى.");
          } finally {
            setPending(false);
          }
        }}
      >
        إعادة فحص الخطة
      </Button>
    </div>
  );
}
