"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Tag, Alert } from "@/components/ui";
import { fmtDate } from "@/lib/dates";
import { signOffPlanOperation } from "@/app/(app)/plans/[planId]/actions";

/**
 * Sign-off pill + action for a single dose-bearing plan operation (docs/CLAUDE.md non-negotiable #4
 * — agronomist-signoff-gate). Two states:
 *   - pending (signedOffBy is null): a warning pill "قالب — يحتاج اعتماد مهندس زراعي" (template —
 *     needs agronomist sign-off) + a sign-off button, shown only to canSignOff callers (defense-in-depth
 *     UI mirror of the DB gate — the RPC re-checks agronomy.signoff itself regardless of this prop).
 *   - signed (signedOffBy set): "معتمد من {name} بتاريخ {date}".
 *
 * This is the GENERIC mechanism only — it does not imply anything about who the real named agronomist
 * is (see the migration header / PR description). Signing does not change execution/engine behaviour.
 */
export function OperationSignOff({
  planId,
  opId,
  signedOffByName,
  signedOffAt,
  canSignOff,
}: {
  planId: string;
  opId: string;
  signedOffByName: string | null;
  signedOffAt: string | null;
  canSignOff: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (signedOffAt) {
    return (
      <Tag tone="ok">
        {signedOffByName ? `معتمد من ${signedOffByName} بتاريخ ${fmtDate(signedOffAt)}` : `معتمد بتاريخ ${fmtDate(signedOffAt)}`}
      </Tag>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone="warning">قالب — يحتاج اعتماد مهندس زراعي</Tag>
        {canSignOff && (
          <Button
            variant="ghost"
            size="sm"
            loading={pending}
            onClick={async () => {
              setPending(true);
              setError(null);
              try {
                const res = await signOffPlanOperation(planId, opId);
                if (res.ok) {
                  router.refresh();
                } else {
                  setError(res.error ?? "تعذّر اعتماد العملية");
                }
              } catch {
                setError("تعذّر الاتصال بالخادم. تحقّق من الاتصال وحاول مرة أخرى.");
              } finally {
                setPending(false);
              }
            }}
          >
            اعتماد كمهندس زراعي
          </Button>
        )}
      </div>
      <div aria-live="assertive" aria-atomic="true">
        {error && <Alert tone="danger" title={error} />}
      </div>
    </div>
  );
}
