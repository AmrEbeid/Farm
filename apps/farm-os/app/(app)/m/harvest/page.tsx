import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { HarvestDayCounter } from "@/components/HarvestDayCounter";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";

// SPEC-0027 H-B — يوم قطف: the field crate counter. plan.write is the RPC gate, so the page is
// owner/farm_manager (the FM logs each block's tally; widening to supervisors is an authorize()
// decision deliberately not taken here).

export const dynamic = "force-dynamic";

export default async function HarvestDayPage() {
  const m = await requireRole(["owner", "farm_manager"]);
  const sb = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const [centersRes, todayRes] = await Promise.all([
    sb.from("cost_centers").select("id, name_ar, parent_id, active").order("code"),
    sb.from("harvest_days").select("id, crates_picked, cost_center_id, crop, note").eq("day", today).eq("org_id", m.orgId),
  ]);
  const rows = centersRes.data ?? [];
  const parents = new Set(rows.filter((c) => c.active && c.parent_id).map((c) => c.parent_id as string));
  const leaves = rows.filter((c) => c.active && !parents.has(c.id)).map((c) => ({ id: c.id, nameAr: c.name_ar }));
  const centerName = new Map(rows.map((c) => [c.id, c.name_ar]));
  const logged = (todayRes.data ?? []).map((h) => ({
    id: h.id,
    label: `${num(Number(h.crates_picked))} عبوة — ${h.cost_center_id ? centerName.get(h.cost_center_id) ?? "" : "بدون مركز"}${h.note ? ` (${h.note})` : ""}`,
  }));
  const todayTotal = (todayRes.data ?? []).reduce((t, h) => t + Number(h.crates_picked ?? 0), 0);
  return (
    <div className="p-4">
      <HarvestDayCounter centers={leaves} logged={logged} todayTotal={todayTotal} todayLabel={fmtDate(today)} />
    </div>
  );
}
