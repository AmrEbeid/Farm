"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { useSubmit } from "@/components/useSubmit";
import { clonePlan } from "@/app/(app)/plans/plans-actions";

/** SPEC-0026 P-2 — «انسخ إلى الفترة القادمة»: clone this plan's lines into a new shifted draft. */
export function ClonePlanButton({ planId }: { planId: string }) {
  const router = useRouter();
  const { pending, submit } = useSubmit();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={async () => {
        const r = await submit(() => clonePlan(planId));
        if (r.ok && r.data) router.push(`/plans/${r.data}`);
        else window.alert(("error" in r && r.error) || "تعذّر النسخ");
      }}
    >
      {pending ? "جارٍ النسخ…" : "⧉ انسخ إلى الفترة القادمة"}
    </Button>
  );
}
