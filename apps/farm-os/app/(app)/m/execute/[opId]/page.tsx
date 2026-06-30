import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card, EmptyState } from "@/components/ui";
import { ExecuteForm } from "@/components/ExecuteForm";
import { fmtDate } from "@/lib/dates";
import { SUBTYPE_AR, OP_STATUS_AR, isExecutableOpStatus } from "@/lib/labels";

// Subtype-derived default note (no hardcoded location); blank when subtype is unknown.
const SUBTYPE_NOTE_AR: Record<string, string> = {
  fertilization: "تم التسميد",
  irrigation: "تم الري",
  spraying: "تم الرش",
  inspection: "تم التفتيش",
};

export default async function ExecutePage({
  params,
}: {
  params: Promise<{ opId: string }>;
}) {
  const { opId } = await params;
  await requireRole(["supervisor", "agri_engineer", "farm_manager", "owner"]);
  const sb = await createClient();

  const { data: op, error } = await sb
    .from("plan_operations")
    .select(
      "id, subtype, planned_at, est_cost, status, plan_material_requirements(qty, unit), plan_labor_requirements(count)",
    )
    .eq("id", opId)
    .maybeSingle();
  // Surface DB read failures to the segment error boundary instead of rendering
  // a misleading empty page.
  if (error) throw error;

  if (!op)
    return (
      <div className="p-6">
        <EmptyState title="العملية غير موجودة." description="قد تكون محذوفة أو الرابط غير صحيح." icon="🔍" />
      </div>
    );

  const req = (op.plan_material_requirements ?? [])[0] as { qty?: number; unit?: string } | undefined;
  const laborReq = (op.plan_labor_requirements ?? [])[0] as { count?: number } | undefined;

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 p-4">
      <header>
        <h1 className="text-xl font-bold">تنفيذ العملية — {SUBTYPE_AR[op.subtype ?? ""] ?? "عملية"}</h1>
        <p style={{ color: "var(--ink-muted)" }}>{fmtDate(op.planned_at)}</p>
      </header>

      {isExecutableOpStatus(op.status) ? (
        <Card title="سجّل الفعلي">
          <ExecuteForm
            opId={opId}
            defaultQty={req?.qty != null ? Number(req.qty) : null}
            defaultLabor={laborReq?.count != null ? Number(laborReq.count) : null}
            defaultNote={SUBTYPE_NOTE_AR[op.subtype ?? ""] ?? ""}
            unit={req?.unit ?? "كجم"}
          />
        </Card>
      ) : op.status === "done" ? (
        <Card title="تم التنفيذ">
          <p>سُجّلت هذه العملية بالفعل.</p>
        </Card>
      ) : (
        // blocked / abandoned / skipped — terminal, not executable (matches the fn_execute_operation
        // guard, which 22023s these); don't render the form as a dead-end.
        <Card title="غير قابلة للتنفيذ">
          <p>
            لا يمكن تنفيذ هذه العملية في حالتها الحالية (
            {OP_STATUS_AR[op.status ?? ""] ?? "غير معروف"}).
          </p>
        </Card>
      )}
    </div>
  );
}
