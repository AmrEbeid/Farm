import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { Breadcrumbs, Card, DescriptionList, FileTimeline, EmptyState } from "@/components/ui";
import type { TimelineEvent } from "@/components/ui";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";
import { PalmStatusForm } from "@/components/PalmStatusForm";

// assets.status — the closed set from migration 0003.
const STATUS_AR: Record<string, string> = {
  active: "سليمة",
  watch: "تحت المراقبة",
  sick: "مريضة",
  dead: "ميتة",
  removed: "مُزالة",
  replaced: "مُستبدلة",
};

// assets.health_status — coded agronomy values; map to Arabic so the palm file never
// shows raw English (non-negotiable #2). Unmapped codes fall back to the raw value.
const HEALTH_STATUS_AR: Record<string, string> = {
  good: "سليمة",
  leaf_spot_watch: "مراقبة تبقّع الأوراق",
  rpw_suspected: "اشتباه سوسة النخيل الحمراء",
};

function one<T>(rel: unknown): T | null {
  // PostgREST returns a to-one embed as an object or single-element array.
  return (Array.isArray(rel) ? rel[0] : rel) as T | null;
}

export default async function PalmFilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const m = await requireMembership();
  const sb = await createClient();

  // asset (+ its sector/hawsha/line for the breadcrumb) and its status history are
  // independent reads keyed on the asset id — fetch in parallel. RLS scopes both.
  const [
    { data: asset, error: assetError },
    { data: history, error: historyError },
  ] = await Promise.all([
    sb
      .from("assets")
      .select(
        "id, name, variety, sex, status, health_status, planting_date, id_tag, sector_id, hawsha_id, sectors(id, name), hawshat(id, name), lines(line_no)",
      )
      .eq("id", id)
      .eq("type", "palm")
      .maybeSingle(),
    sb
      .from("palm_status_history")
      .select("id, status, health_status, changed_at, reason")
      .eq("asset_id", id)
      .order("changed_at", { ascending: false }),
  ]);
  // Surface DB read failures to the segment error boundary instead of a misleading empty page.
  if (assetError) throw assetError;
  if (historyError) throw historyError;

  if (!asset) return <div className="p-6">النخلة غير موجودة.</div>;

  const sector = one<{ id?: string; name?: string }>(asset.sectors);
  const hawsha = one<{ id?: string; name?: string }>(asset.hawshat);
  const line = one<{ line_no?: number }>(asset.lines);
  const label = asset.id_tag ?? asset.name ?? "نخلة";
  // Field roles may update tree health; others get a read-only file (the action re-checks).
  const canEdit = ["supervisor", "agri_engineer", "farm_manager", "owner"].includes(m.role);

  const timeline: TimelineEvent[] = (history ?? []).map((h) => ({
    id: h.id,
    kind: "operation",
    title: STATUS_AR[h.status ?? ""] ?? h.status ?? "تغيير الحالة",
    time: fmtDate(h.changed_at),
    description: h.reason ?? (h.health_status ? (HEALTH_STATUS_AR[h.health_status] ?? h.health_status) : null) ?? "—",
  }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumbs
        ariaLabel="المسار"
        items={[
          { id: "farm", label: "المزرعة", href: "/farm" },
          ...(sector?.id
            ? [{ id: "sector", label: sector.name ?? "القطاع", href: `/farm/sector/${sector.id}` }]
            : []),
          ...(hawsha?.id
            ? [{ id: "hawsha", label: hawsha.name ?? "الحوشة", href: `/farm/hawsha/${hawsha.id}` }]
            : []),
          { id: "palm", label },
        ]}
      />
      <h1 className="text-2xl font-bold">{label}</h1>

      <Card title="بيانات النخلة">
        <DescriptionList
          layout="inline"
          items={[
            { id: "tag", term: "الرمز", description: asset.id_tag ?? "—" },
            { id: "variety", term: "الصنف", description: asset.variety ?? "—" },
            {
              id: "sex",
              term: "النوع",
              // sex is nullable; don't render unknown as "أنثى" — sex drives pollination role.
              description: asset.sex === "male" ? "ذكر" : asset.sex === "female" ? "أنثى" : "—",
            },
            { id: "status", term: "الحالة", description: STATUS_AR[asset.status ?? ""] ?? asset.status ?? "—" },
            { id: "health", term: "الحالة الصحية", description: asset.health_status ? (HEALTH_STATUS_AR[asset.health_status] ?? asset.health_status) : "—" },
            { id: "line", term: "الخط", description: line?.line_no != null ? `خط ${num(line.line_no)}` : "—" },
            {
              id: "planting",
              term: "تاريخ الزراعة",
              description: asset.planting_date ? fmtDate(asset.planting_date) : "—",
            },
          ]}
        />
      </Card>

      <Card title="سجل الحالة">
        {timeline.length === 0 ? (
          <EmptyState title="لا يوجد سجل حالة لهذه النخلة بعد" />
        ) : (
          <FileTimeline events={timeline} ariaLabel={`سجل حالة ${label}`} />
        )}
      </Card>

      {canEdit && (
        <Card title="تحديث حالة النخلة">
          <PalmStatusForm assetId={asset.id} currentStatus={asset.status} />
        </Card>
      )}
    </div>
  );
}
