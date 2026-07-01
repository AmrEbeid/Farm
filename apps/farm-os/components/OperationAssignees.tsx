"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconButton, Tag } from "@/components/ui";
import { unassignPlanOperationAssignee } from "@/app/(app)/plans/[planId]/actions";

export interface AssigneeInfo {
  /** plan_operation_assignees.id — used as the React key (unique per row). */
  id: string;
  personId: string;
  name: string;
  isLead: boolean;
}

/**
 * Renders the people assigned to a plan operation as badges, the lead visually distinguished with a
 * "قائد" tag (#398 follow-up — assignees were stored but never surfaced anywhere in the app).
 *
 * Honest-empty-state convention: an operation with no assignees shows "غير مُكلَّف", never a blank cell
 * (silently omitting the column would read as "no data available" rather than "nobody is assigned").
 *
 * `canRemove` gates the "×" un-assign affordance (defense-in-depth mirror of the DB's plan.write gate on
 * fn_unassign_plan_operation — pass `false` for read-only surfaces like the PvA accountability report,
 * where un-assigning a person from an already-executed operation makes no sense).
 */
export function OperationAssignees({
  planId,
  opId,
  assignees,
  canRemove,
}: {
  planId: string;
  opId: string;
  assignees: AssigneeInfo[];
  canRemove: boolean;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (assignees.length === 0) {
    return <span style={{ color: "var(--ink-muted)" }}>غير مُكلَّف</span>;
  }

  async function handleRemove(personId: string) {
    setPendingId(personId);
    setError(null);
    try {
      const res = await unassignPlanOperationAssignee(planId, opId, personId);
      if (res.ok) {
        router.refresh();
      } else {
        setError(res.error ?? "تعذّر إزالة المكلّف");
      }
    } catch {
      // Offline-tolerant (non-negotiable #2): a network reject must not strand the spinner.
      setError("تعذّر الاتصال بالخادم. تحقّق من الاتصال وحاول مرة أخرى.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        {assignees.map((a) => (
          <span key={a.id} className="inline-flex items-center gap-1">
            <Tag tone={a.isLead ? "accent" : "neutral"}>{a.isLead ? `${a.name} · قائد` : a.name}</Tag>
            {canRemove && (
              <IconButton
                label={`إزالة ${a.name} من العملية`}
                size="sm"
                variant="ghost"
                loading={pendingId === a.personId}
                onClick={() => handleRemove(a.personId)}
              >
                ×
              </IconButton>
            )}
          </span>
        ))}
      </div>
      {error && (
        <p role="alert" aria-live="assertive" className="text-xs" style={{ color: "var(--danger,#b91c1c)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
