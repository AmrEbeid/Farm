import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { Breadcrumbs, Card } from "@/components/ui";
import { FarmCroquis, type CroquisSector } from "@/components/FarmCroquis";
import { attentionFor, type AttentionCounts } from "@/lib/croquis";

/**
 * Farm croquis (Stage 5) — a visual bird's-eye map of the whole structure: sectors → hawshat,
 * each hawsha colour-coded by its worst palm-attention level (healthy/watch/alert), navigable to the
 * 360 pages. Reads the live structure + the watch/sick/dead palm signal (RLS-scoped). Archived nodes
 * are excluded. No new schema — a read view on the Stage-2 structure.
 */
export default async function FarmCroquisPage() {
  await requireMembership();
  const sb = await createClient();

  const [
    { data: sectors, error: sectorsError },
    { data: atRisk, error: atRiskError },
  ] = await Promise.all([
    sb
      .from("sectors")
      .select("id, name, code, hawshat(id, name, code, palm_count_barhi, palm_count_male, archived)")
      .eq("archived", false)
      .order("code"),
    // per-hawsha attention counts come from the live palm statuses (watch/sick/dead), like the landing.
    sb
      .from("assets")
      .select("hawsha_id, status")
      .eq("type", "palm")
      .eq("archived", false)
      .in("status", ["watch", "sick", "dead"]),
  ]);
  if (sectorsError) throw sectorsError;
  if (atRiskError) throw atRiskError;

  // tally watch/sick/dead per hawsha
  const counts = new Map<string, AttentionCounts>();
  for (const a of atRisk ?? []) {
    if (!a.hawsha_id) continue;
    const c = counts.get(a.hawsha_id) ?? { watch: 0, sick: 0, dead: 0 };
    if (a.status === "watch") c.watch++;
    else if (a.status === "sick") c.sick++;
    else if (a.status === "dead") c.dead++;
    counts.set(a.hawsha_id, c);
  }

  const croquis: CroquisSector[] = (sectors ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    code: s.code,
    hawshat: ((s.hawshat ?? []) as {
      id: string;
      name: string;
      code: string;
      palm_count_barhi?: number;
      palm_count_male?: number;
      archived?: boolean;
    }[])
      .filter((h) => !h.archived)
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((h) => {
        const c = counts.get(h.id) ?? { watch: 0, sick: 0, dead: 0 };
        return {
          id: h.id,
          name: h.name,
          code: h.code,
          barhi: Number(h.palm_count_barhi ?? 0),
          male: Number(h.palm_count_male ?? 0),
          attention: attentionFor(c),
          attentionCount: c.watch + c.sick + c.dead,
        };
      }),
  }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumbs
        ariaLabel="المسار"
        items={[
          { id: "farm", label: "المزرعة", href: "/farm" },
          { id: "croquis", label: "الكروكي" },
        ]}
      />
      <h1 className="text-2xl font-bold">كروكي المزرعة</h1>
      <Card title="الخريطة المرئية للمزرعة">
        <FarmCroquis sectors={croquis} />
      </Card>
    </div>
  );
}
