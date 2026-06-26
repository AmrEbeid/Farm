import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card } from "@/components/ui";
import { ExecuteForm } from "@/components/ExecuteForm";
import { fmtDate } from "@/lib/dates";

const SUBTYPE_AR: Record<string, string> = {
  fertilization: "تسميد",
  irrigation: "ري",
  spraying: "رش",
  inspection: "تفتيش",
};

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
    .select("id, subtype, planned_at, est_cost, status, plan_material_requirements(qty, unit)")
    .eq("id", opId)
    .maybeSingle();
  // Surface DB read failures to the segment error boundary instead of rendering
  // a misleading empty page.
  if (error) throw error;

  if (!op) return <div className="p-6">العملية غير موجودة.</div>;

  const req = (op.plan_material_requirements ?? [])[0] as { qty?: number; unit?: string } | undefined;

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 p-4">
      <header>
        <h1 className="text-xl font-bold">تنفيذ العملية — {SUBTYPE_AR[op.subtype ?? ""] ?? op.subtype}</h1>
        <p style={{ color: "var(--ink-muted)" }}>{fmtDate(op.planned_at)}</p>
      </header>

      {op.status === "done" ? (
        <Card title="تم التنفيذ">
          <p>سُجّلت هذه العملية بالفعل.</p>
        </Card>
      ) : (
        <Card title="سجّل الفعلي">
          <ExecuteForm
            opId={opId}
            defaultQty={req?.qty != null ? Number(req.qty) : null}
            defaultNote={SUBTYPE_NOTE_AR[op.subtype ?? ""] ?? ""}
            unit={req?.unit ?? "kg"}
          />
        </Card>
      )}
    </div>
  );
}
