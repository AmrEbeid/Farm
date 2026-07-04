"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { useSubmit } from "@/components/useSubmit";
import { signOffPlanOperation } from "@/app/(app)/plans/[planId]/actions";

/** SPEC-0026 P-4 — one-tap agronomist sign-off (the DB re-checks agronomy.signoff, #4). */
export function SignOffButton({ planId, opId }: { planId: string; opId: string }) {
  const router = useRouter();
  const { pending, submit } = useSubmit();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        disabled={pending}
        onClick={async () => {
          setErr(null);
          const r = await submit(() => signOffPlanOperation(planId, opId));
          if (r.ok) router.refresh();
          else setErr(("error" in r && r.error) || "تعذّر الاعتماد");
        }}
      >
        {pending ? "جارٍ…" : "🖊 اعتمد"}
      </Button>
      {err && (
        <span className="text-xs" style={{ color: "var(--danger, #b23b3b)" }}>
          {err}
        </span>
      )}
    </div>
  );
}
