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
      {error && <Alert tone="danger" title={error} />}
      <Button
        variant="ghost"
        loading={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          const res = await runPlanChecks(planId);
          setPending(false);
          if (res.ok) {
            router.refresh();
          } else {
            setError(res.error ?? "تعذّرت إعادة فحص الخطة");
          }
        }}
      >
        إعادة فحص الخطة
      </Button>
    </div>
  );
}
