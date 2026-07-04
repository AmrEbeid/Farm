import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Alert, Card } from "@/components/ui";
import { StoryLine } from "@/components/StoryLine";
import { SignOffButton } from "@/components/SignOffButton";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";
import { SUBTYPE_AR, isDoseBearingSubtype, NON_EXECUTABLE_OP_STATUSES } from "@/lib/labels";

// SPEC-0026 P-4 — «اعتمادات مطلوبة»: the agronomist's cross-plan sign-off inbox. Today he hunts plan by
// plan; this lists every dose-bearing operation still awaiting sign-off (#4), with its materials in the
// row and one-tap اعتماد (the gated fn_sign_off_plan_operation — the DB re-checks agronomy.signoff).

export const dynamic = "force-dynamic";

export default async function ApprovalsQueuePage() {
  await requireRole(["owner", "agri_engineer"]);
  const sb = await createClient();

  const { data: ops, error } = await sb
    .from("plan_operations")
    .select("id, plan_id, subtype, planned_at, signed_off_at, status")
    .is("signed_off_at", null)
    .not("status", "in", `(${NON_EXECUTABLE_OP_STATUSES.join(",")})`)
    .order("planned_at", { ascending: true });
  if (error) throw error;

  const pending = (ops ?? []).filter((o) => isDoseBearingSubtype(o.subtype));
  const opIds = pending.map((o) => o.id);
  const { data: mats } = opIds.length
    ? await sb.from("plan_material_requirements").select("plan_op_id, qty, unit, item_id").in("plan_op_id", opIds)
    : { data: [] };
  const itemIds = [...new Set((mats ?? []).map((m) => m.item_id).filter(Boolean))] as string[];
  const { data: items } = itemIds.length
    ? await sb.from("inventory_items").select("id, name").in("id", itemIds)
    : { data: [] };
  const itemName = new Map((items ?? []).map((i) => [i.id, i.name]));

  const lead =
    pending.length === 0
      ? "لا عمليات رش أو جرعات تنتظر اعتمادك — كل شيء معتمد."
      : `${num(pending.length)} عملية رش/جرعة تنتظر اعتمادك — أقربها ${pending[0]?.planned_at ? fmtDate(pending[0].planned_at) : "بدون تاريخ"}.`;

  return (
    <div className="flex flex-col gap-4 p-6">
      <header>
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>
          اعتمادات مطلوبة
        </h1>
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          كل عمليات الرش والجرعات غير المعتمدة، من كل الخطط — الاعتماد شرط للتنفيذ (قاعدة #4).
        </p>
      </header>

      <StoryLine lead={lead} />

      {pending.length === 0 ? (
        <Alert tone="info" title="صندوقك فارغ ✓" />
      ) : (
        <div className="flex flex-col gap-3">
          {pending.map((op) => {
            const opMats = (mats ?? [])
              .filter((m) => m.plan_op_id === op.id)
              .map((m) => `${m.qty ? num(Number(m.qty)) + " " : ""}${m.unit ?? ""} ${itemName.get(m.item_id) ?? ""}`.trim());
            return (
              <Card key={op.id}>
                <div className="flex flex-wrap items-center gap-3 p-1">
                  <div className="min-w-0 flex-1">
                    <div className="font-bold" style={{ color: "var(--ink)" }}>
                      {SUBTYPE_AR[op.subtype ?? ""] ?? op.subtype} · {op.planned_at ? fmtDate(op.planned_at) : "بدون تاريخ"}
                    </div>
                    {opMats.length > 0 && (
                      <div className="text-sm" style={{ color: "var(--ink-muted)" }}>
                        🧪 {opMats.join("، ")}
                      </div>
                    )}
                    {op.plan_id && (
                      <Link href={`/plans/${op.plan_id}?tab=operations`} className="text-xs underline underline-offset-4" style={{ color: "var(--brand)" }}>
                        فتح الخطة ←
                      </Link>
                    )}
                  </div>
                  {op.plan_id && <SignOffButton planId={op.plan_id} opId={op.id} />}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
