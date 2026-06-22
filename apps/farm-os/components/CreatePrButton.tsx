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
      {error && <Alert tone="danger" title={error} />}
      <Button
        variant="primary"
        loading={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          const res = await createPurchaseRequestFromShortage(
            itemId,
            recommendQty,
            reserveQty,
          );
          setPending(false);
          if (res.ok) {
            // route to the budget gate for this plan
            router.push(`/budget/${SEED_PLAN_ID}/check?pr=${res.prId}`);
            router.refresh();
          } else {
            setError(res.error ?? "تعذّر إنشاء طلب الشراء");
          }
        }}
      >
        إنشاء طلب شراء
      </Button>
    </div>
  );
}
