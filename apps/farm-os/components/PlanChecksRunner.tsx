"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { runPlanChecks } from "@/app/(app)/plans/[planId]/actions";

export function PlanChecksRunner({ planId }: { planId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <Button
      variant="ghost"
      loading={pending}
      onClick={async () => {
        setPending(true);
        await runPlanChecks(planId);
        setPending(false);
        router.refresh();
      }}
    >
      إعادة فحص الخطة
    </Button>
  );
}
