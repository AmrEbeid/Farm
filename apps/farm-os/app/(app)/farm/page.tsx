import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { KpiCard, Card, FileTimeline, EmptyState, type TimelineEvent } from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { num } from "@/lib/money";

const SUBTYPE_AR: Record<string, string> = {
  fertilization: "تسميد",
  irrigation: "ري",
  spraying: "رش",
  inspection: "تفتيش",
};

export default async function FarmStructurePage() {
  await requireMembership();
  const sb = await createClient();

  // sectors (the grid) and the farm-level event timeline are independent reads,
  // both RLS-scoped to the caller's org — fetch in parallel.
  const [{ data: sectors, error }, { data: events, error: eventsError }] = await Promise.all([
    sb
      .from("sectors")
      .select("id, name, code, crop, hawshat(id, palm_count_barhi, palm_count_male)")
      .order("code"),
    sb
      .from("farm_event")
      .select("id, subtype, status, occurred_at, notes")
      .order("occurred_at", { ascending: false })
      .limit(15),
  ]);
  // Surface DB read failures to the segment error boundary instead of rendering
  // a misleading empty page.
  if (error) throw error;
  if (eventsError) throw eventsError;

  const timeline: TimelineEvent[] = (events ?? []).map((e) => ({
    id: e.id,
    kind: "operation",
    title: SUBTYPE_AR[e.subtype ?? ""] ?? e.subtype ?? "عملية",
    time: e.occurred_at ? new Date(e.occurred_at).toLocaleDateString("ar-EG") : "—",
    description: e.notes ?? (e.status === "done" ? "منفّذة" : e.status),
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

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold">هيكل المزرعة</h1>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="القطاعات" value={num((sectors ?? []).length)} />
        <KpiCard label="الحوشات" value={num(totalHawshat)} />
        <KpiCard label="نخيل برحي" value={num(totalBarhi)} />
        <KpiCard label="ذكور" value={num(totalMale)} />
      </section>

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
