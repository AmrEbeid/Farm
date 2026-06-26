"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Alert } from "@/components/ui";
import { createPurchaseRequestFromShortage } from "@/app/(app)/inventory/[itemId]/coverage/actions";
import { SEED_PLAN_ID } from "@/lib/nav";

export function CreatePrButton({
  itemId,
  recommendQty,
  reserveQty,
}: {
  itemId: string;
  recommendQty: number;
  reserveQty: number;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <div aria-live="assertive" aria-atomic="true">
        {error && <Alert tone="danger" title={error} />}
      </div>
      <Button
        variant="primary"
        loading={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            const res = await createPurchaseRequestFromShortage(
              itemId,
              recommendQty,
              reserveQty,
            );
            if (res.ok) {
              // route to the budget gate for this plan
              router.push(`/budget/${SEED_PLAN_ID}/check?pr=${res.prId}`);
              router.refresh();
              return;
            }
            setError(res.error ?? "تعذّر إنشاء طلب الشراء");
          } catch {
            // Offline-tolerant (non-negotiable #2): a network reject must not strand the spinner —
            // surface a retryable Arabic message (mirrors ExecuteForm).
            setError("تعذّر الاتصال بالخادم. تحقّق من الاتصال وحاول مرة أخرى.");
          } finally {
            setPending(false);
          }
        }}
      >
        إنشاء طلب شراء
      </Button>
    </div>
  );
}
