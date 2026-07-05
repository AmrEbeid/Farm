import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Alert, Card, EmptyState } from "@/components/ui";
import type { PillStatus } from "@amrebeid/ui";
import Link from "next/link";
import { Entity360Header } from "@/components/Entity360Header";
import { ExecuteForm } from "@/components/ExecuteForm";
import { fmtDate } from "@/lib/dates";
import { SUBTYPE_AR, OP_STATUS_AR, isExecutableOpStatus } from "@/lib/labels";
import { computeSprayComplianceWindow, mostRestrictiveComplianceWindow } from "@/lib/spray-compliance";

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
      "id, subtype, planned_at, est_cost, status, plan_material_requirements(id, item_id, qty, unit, rei_hours, phi_days, inventory_items(name)), plan_labor_requirements(count)",
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

  // #520: an op can carry several materials (fn_add_plan_operation_multi). One qty field per
  // material is rendered below (ExecuteForm collapses to the pre-#520 single-field look when there
  // is exactly one, or none, on the op).
  const materials = (op.plan_material_requirements ?? []) as Array<{
    id: string;
    item_id: string;
    qty: number | null;
    unit: string | null;
    rei_hours: number | null;
    phi_days: number | null;
    inventory_items: { name?: string } | null;
  }>;
  const laborReq = (op.plan_labor_requirements ?? [])[0] as { count?: number } | undefined;
  const opPill: PillStatus = op.status === "done" ? "done" : isExecutableOpStatus(op.status) ? "active" : "blocked";

  // REI/PHI decision support (docs/CLAUDE.md #4) — DISPLAY-ONLY, never an automated block (deferred
  // follow-up). Only computed once the op is actually done: fetch the real execution timestamp from
  // farm_event (never guess it). A done op with no matching farm_event row (shouldn't happen, but
  // never assume) yields occurredAt = null, which computeSprayComplianceWindow renders as "N/A".
  //
  // A spray operation can apply MULTIPLE materials (fn_add_plan_operation_multi) with different
  // rei_hours/phi_days — take the MOST RESTRICTIVE window across all of them (whichever closes last),
  // never just the first material's row (that could silently drop a longer, more restrictive window
  // from a second product — the wrong failure mode for a compliance-safety banner).
  let compliance: ReturnType<typeof computeSprayComplianceWindow> | null = null;
  const hasComplianceData = materials.some((m) => m.rei_hours != null || m.phi_days != null);
  if (op.status === "done" && hasComplianceData) {
    const { data: event } = await sb
      .from("farm_event")
      .select("occurred_at, data")
      .eq("status", "done")
      .filter("data->>op_id", "eq", opId)
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const windows = materials.map((m) =>
      m.rei_hours != null || m.phi_days != null
        ? computeSprayComplianceWindow({
            occurredAt: event?.occurred_at ?? null,
            reiHours: m.rei_hours ?? null,
            phiDays: m.phi_days ?? null,
          })
        : null,
    );
    compliance = mostRestrictiveComplianceWindow(windows);
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 p-4">
      <Entity360Header
        title={`تنفيذ العملية — ${SUBTYPE_AR[op.subtype ?? ""] ?? "عملية"}`}
        subtitle={fmtDate(op.planned_at)}
        pills={[{ status: opPill, label: OP_STATUS_AR[op.status ?? ""] ?? "غير معروف" }]}
      />

      {isExecutableOpStatus(op.status) ? (
        <Card title="سجّل الفعلي">
          <ExecuteForm
            opId={opId}
            opLabel={SUBTYPE_AR[op.subtype ?? ""] ?? "عملية"}
            materials={materials.map((m) => ({
              requirementId: m.id,
              itemId: m.item_id,
              defaultQty: m.qty != null ? Number(m.qty) : null,
              unit: m.unit ?? "كجم",
              name: m.inventory_items?.name ?? null,
            }))}
            defaultLabor={laborReq?.count != null ? Number(laborReq.count) : null}
            defaultNote={SUBTYPE_NOTE_AR[op.subtype ?? ""] ?? ""}
          />
        </Card>
      ) : op.status === "done" ? (
        <>
          <Card title="تم التنفيذ">
            <p>سُجّلت هذه العملية بالفعل.</p>
          </Card>
          {compliance && (compliance.withinReentryWindow || compliance.withinHarvestWindow) && (
            <Alert
              tone="warning"
              title="تنبيه سلامة: لا تزال فترة الأمان سارية"
              description={[
                compliance.withinReentryWindow
                  ? `فترة إعادة الدخول سارية حتى ${fmtDate(compliance.safeReentryAt)} — تجنّب دخول المنطقة قبل هذا الموعد.`
                  : null,
                compliance.withinHarvestWindow
                  ? `فترة ما قبل الحصاد سارية حتى ${fmtDate(compliance.earliestSafeHarvestAt)} — لا يُحصد المحصول قبل هذا الموعد.`
                  : null,
              ]
                .filter(Boolean)
                .join(" ")}
            />
          )}
        </>
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

      <Link href="/m" className="font-bold underline underline-offset-4" style={{ color: "var(--brand)" }}>
        → رجوع إلى الميدان
      </Link>
    </div>
  );
}
