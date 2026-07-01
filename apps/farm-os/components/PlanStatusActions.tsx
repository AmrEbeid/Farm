"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Alert } from "@/components/ui";
import { setPlanStatus, type PlanStatus } from "@/app/(app)/plans/[planId]/actions";

/**
 * Plan lifecycle transition buttons (draft → active → closed/abandoned). Only rendered by the
 * caller for plan.write roles (owner/farm_manager) — the DB gate in fn_set_plan_status is
 * authoritative, but a role without plan.write should never see a button that just 42501s.
 *
 * `closed`/`abandoned` are terminal: the caller stops rendering this component for those
 * statuses, so there is nothing to do here beyond draft/active.
 *
 * This repo has no wired-up confirm-dialog/toast system yet (@amrebeid/ui's ConfirmDialog isn't
 * re-exported from components/ui.tsx) — a plain window.confirm() is the pragmatic, in-scope
 * choice for the two irreversible transitions (close/abandon) rather than standing up that
 * larger, separate piece of infrastructure here.
 */
export function PlanStatusActions({ planId, status }: { planId: string; status: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<PlanStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function transition(next: PlanStatus, successMessage: string) {
    setPending(next);
    setError(null);
    setSuccess(null);
    try {
      const res = await setPlanStatus(planId, next);
      if (res.ok) {
        setSuccess(successMessage);
        router.refresh();
      } else {
        setError(res.error ?? "تعذّر تغيير حالة الخطة");
      }
    } catch {
      // Offline-tolerant (non-negotiable #2): a network reject must not strand the spinner.
      setError("تعذّر الاتصال بالخادم. تحقّق من الاتصال وحاول مرة أخرى.");
    } finally {
      setPending(null);
    }
  }

  if (status !== "draft" && status !== "active") return null;

  return (
    <div className="flex flex-col items-end gap-2">
      <div aria-live="assertive" aria-atomic="true">
        {error && <Alert tone="danger" title={error} />}
        {success && !error && <Alert tone="ok" title={success} />}
      </div>
      <div className="flex flex-wrap gap-2">
        {status === "draft" && (
          <Button
            variant="primary"
            loading={pending === "active"}
            onClick={() => transition("active", "تم تفعيل الخطة")}
          >
            تفعيل الخطة
          </Button>
        )}
        {status === "active" && (
          <>
            <Button
              variant="primary"
              loading={pending === "closed"}
              onClick={() => {
                if (window.confirm("هل تريد إغلاق هذه الخطة؟ لن يمكن التراجع عن هذا الإجراء.")) {
                  void transition("closed", "تم إغلاق الخطة");
                }
              }}
            >
              إغلاق الخطة
            </Button>
            <Button
              variant="ghost"
              size="sm"
              loading={pending === "abandoned"}
              onClick={() => {
                if (window.confirm("هل تريد إلغاء هذه الخطة؟ لن يمكن التراجع عن هذا الإجراء.")) {
                  void transition("abandoned", "تم إلغاء الخطة");
                }
              }}
            >
              إلغاء الخطة
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
