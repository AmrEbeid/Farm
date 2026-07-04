import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { ScaleWizard } from "@/components/ScaleWizard";

// SPEC-0027 H-A — شاشة الميزان loader: named buyers + active leaf cost centers (the crop's home).

export const dynamic = "force-dynamic";

export default async function ScalePage() {
  await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const [buyersRes, centersRes] = await Promise.all([
    sb.from("buyers").select("id, name, active").order("name"),
    sb.from("cost_centers").select("id, code, name_ar, parent_id, active").order("code"),
  ]);
  const rows = centersRes.data ?? [];
  const parents = new Set(rows.filter((c) => c.active && c.parent_id).map((c) => c.parent_id as string));
  const leaves = rows.filter((c) => c.active && !parents.has(c.id)).map((c) => ({ id: c.id, nameAr: c.name_ar }));
  return (
    <div className="p-6">
      <ScaleWizard
        buyers={(buyersRes.data ?? []).filter((b) => b.active !== false).map((b) => ({ id: b.id, name: b.name }))}
        centers={leaves}
      />
    </div>
  );
}
