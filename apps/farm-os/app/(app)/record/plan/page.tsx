import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { PlanWizard } from "@/components/PlanWizard";

// SPEC-0025 U-7 — the plan wizard loader: scope pickers (sectors/hawshat) + inventory items for the
// operation lines. plan.write = owner/farm_manager (the DB re-enforces via fn_create_plan / the multi RPC).

export const dynamic = "force-dynamic";

export default async function RecordPlanPage({
  searchParams,
}: {
  searchParams: Promise<{ planId?: string }>;
}) {
  const { planId } = await searchParams;
  await requireRole(["owner", "farm_manager"]);
  const sb = await createClient();
  const [sectorsRes, hawshatRes, itemsRes] = await Promise.all([
    sb.from("sectors").select("id, name, archived").order("code"),
    sb.from("hawshat").select("id, name, sector_id, archived").order("code"),
    sb.from("inventory_items").select("id, name, unit").order("name"),
  ]);
  return (
    <div className="p-6">
      <PlanWizard
        initialPlanId={planId ?? null}
        sectors={(sectorsRes.data ?? []).filter((s) => !s.archived).map((s) => ({ id: s.id, name: s.name }))}
        hawshat={(hawshatRes.data ?? [])
          .filter((h) => !h.archived)
          .map((h) => ({ id: h.id, name: h.name, sectorId: h.sector_id }))}
        items={(itemsRes.data ?? []).map((i) => ({ id: i.id, name: i.name, unit: i.unit ?? "" }))}
      />
    </div>
  );
}
