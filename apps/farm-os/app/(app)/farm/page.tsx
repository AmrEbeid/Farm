import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { KpiCard, Card, FileTimeline, EmptyState, type TimelineEvent } from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { num } from "@/lib/money";
import { OP_STATUS_AR, SUBTYPE_AR } from "@/lib/labels";

// Palm asset statuses that need attention (assets.status — migration 0003).
const ATTENTION_STATUS_AR: Record<string, string> = {
  watch: "تحت المراقبة",
  sick: "مريضة",
  dead: "ميتة",
};

export default async function FarmStructurePage() {
  await requireMembership();
  const sb = await createClient();

  // sectors (the grid) and the farm-level event timeline are independent reads,
  // both RLS-scoped to the caller's org — fetch in parallel.
  const [
    { data: sectors, error },
    { data: events, error: eventsError },
    { data: atRisk, error: atRiskError },
  ] = await Promise.all([
    sb
      .from("sectors")
      .select("id, name, code, crop, hawshat(id, palm_count_barhi, palm_count_male)")
      .order("code"),
    sb
      .from("farm_event")
      .select("id, subtype, status, occurred_at, notes")
      .order("occurred_at", { ascending: false })
      .limit(15),
    // Palms needing attention: watch/sick/dead trees across the org (the agronomy
    // signal), with their location, linked to each palm's file.
    sb
      .from("assets")
      .select("id, id_tag, name, status, hawshat(name), sectors(name)")
      .eq("type", "palm")
      .in("status", ["watch", "sick", "dead"])
      .order("status")
      .limit(100),
  ]);
  // Surface DB read failures to the segment error boundary instead of rendering
  // a misleading empty page.
  if (error) throw error;
  if (eventsError) throw eventsError;
  if (atRiskError) throw atRiskError;

  const timeline: TimelineEvent[] = (events ?? []).map((e) => ({
    id: e.id,
    kind: "operation",
    title: SUBTYPE_AR[e.subtype ?? ""] ?? e.subtype ?? "عملية",
    time: e.occurred_at ? new Date(e.occurred_at).toLocaleDateString("ar-EG") : "—",
    description: e.notes ?? OP_STATUS_AR[e.status ?? ""] ?? e.status ?? "—",
  }));

  const columns: SimpleColumn[] = [
    { id: "name", header: "القطاع" },
    { id: "code", header: "الرمز" },
    { id: "hawshat", header: "عدد الحوشات", numeric: true },
    { id: "barhi", header: "نخيل برحي", numeric: true },
    { id: "male", header: "ذكور", numeric: true },
  ];

  const tallied = (sectors ?? []).map((s) => {
    const hawshat = (s.hawshat ?? []) as { palm_count_barhi?: number; palm_count_male?: number }[];
    const barhi = hawshat.reduce((sum, h) => sum + Number(h.palm_count_barhi ?? 0), 0);
    const male = hawshat.reduce((sum, h) => sum + Number(h.palm_count_male ?? 0), 0);
    return { id: s.id, name: s.name, code: s.code, hawshatCount: hawshat.length, barhi, male };
  });

  const totalBarhi = tallied.reduce((sum, t) => sum + t.barhi, 0);
  const totalMale = tallied.reduce((sum, t) => sum + t.male, 0);
  const totalHawshat = tallied.reduce((sum, t) => sum + t.hawshatCount, 0);

  const rows = tallied.map((t) => ({
    id: t.id,
    href: `/farm/sector/${t.id}`,
    name: t.name,
    code: t.code,
    hawshat: num(t.hawshatCount),
    barhi: num(t.barhi),
    male: num(t.male),
  }));

  const attentionColumns: SimpleColumn[] = [
    { id: "tag", header: "الرمز" },
    { id: "sector", header: "القطاع" },
    { id: "hawsha", header: "الحوشة" },
    { id: "status", header: "الحالة" },
  ];
  const attentionRows = (atRisk ?? []).map((a) => {
    // hawshat/sectors are to-one embeds — PostgREST may return object or array.
    const h = (Array.isArray(a.hawshat) ? a.hawshat[0] : a.hawshat) as { name?: string } | null;
    const s = (Array.isArray(a.sectors) ? a.sectors[0] : a.sectors) as { name?: string } | null;
    return {
      id: a.id,
      href: `/farm/palm/${a.id}`,
      tag: a.id_tag ?? a.name ?? a.id,
      sector: s?.name ?? "—",
      hawsha: h?.name ?? "—",
      status: ATTENTION_STATUS_AR[a.status ?? ""] ?? a.status ?? "—",
    };
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold">هيكل المزرعة</h1>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="القطاعات" value={num((sectors ?? []).length)} />
        <KpiCard label="الحوشات" value={num(totalHawshat)} />
        <KpiCard label="نخيل برحي" value={num(totalBarhi)} />
        <KpiCard label="ذكور" value={num(totalMale)} />
      </section>

      <Card title="نخيل يحتاج عناية">
        {attentionRows.length === 0 ? (
          <EmptyState title="لا يوجد نخيل يحتاج عناية" />
        ) : (
          <SimpleTable columns={attentionColumns} rows={attentionRows} empty="—" />
        )}
      </Card>

      <Card title="القطاعات">
        <SimpleTable columns={columns} rows={rows} empty="لا توجد قطاعات" />
      </Card>

      <Card title="السجل الزمني للمزرعة">
        {timeline.length === 0 ? (
          <EmptyState title="لا توجد عمليات مسجّلة بعد" />
        ) : (
          <FileTimeline events={timeline} ariaLabel="السجل الزمني للمزرعة" />
        )}
      </Card>
    </div>
  );
}
