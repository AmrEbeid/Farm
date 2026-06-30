import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { KpiCard, Card, FileTimeline, EmptyState, type TimelineEvent } from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { StructureForm } from "@/components/StructureForm";
import { num } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { OP_STATUS_AR, SUBTYPE_AR } from "@/lib/labels";

// Palm asset statuses that need attention (assets.status — migration 0003).
const ATTENTION_STATUS_AR: Record<string, string> = {
  watch: "تحت المراقبة",
  sick: "مريضة",
  dead: "ميتة",
};

export default async function FarmStructurePage() {
  const m = await requireMembership();
  const sb = await createClient();
  // structure.write = owner/farm_manager (migration 0052) — the structural-edit authority.
  const canEditStructure = ["owner", "farm_manager"].includes(m.role);

  // sectors (the grid), the farm row (for "add sector"), the farm-level event timeline, and the
  // at-risk palms are independent reads, all RLS-scoped to the caller's org — fetch in parallel.
  const [
    { data: sectors, error },
    { data: farm, error: farmError },
    { data: events, error: eventsError },
    { data: atRisk, error: atRiskError },
  ] = await Promise.all([
    sb
      .from("sectors")
      .select("id, name, code, crop, hawshat(id, palm_count_barhi, palm_count_male, archived)")
      .eq("archived", false)
      .order("code"),
    sb.from("farms").select("id").eq("archived", false).order("code").limit(1).maybeSingle(),
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
      .eq("archived", false)
      .in("status", ["watch", "sick", "dead"])
      .order("status")
      .limit(100),
  ]);
  // Surface DB read failures to the segment error boundary instead of rendering
  // a misleading empty page.
  if (error) throw error;
  if (farmError) throw farmError;
  if (eventsError) throw eventsError;
  if (atRiskError) throw atRiskError;

  const timeline: TimelineEvent[] = (events ?? []).map((e) => ({
    id: e.id,
    kind: "operation",
    title: e.subtype ? SUBTYPE_AR[e.subtype] ?? "عملية" : "عملية",
    time: fmtDate(e.occurred_at),
    description: e.notes ?? (e.status ? OP_STATUS_AR[e.status] ?? "غير معروف" : "—"),
  }));

  const columns: SimpleColumn[] = [
    { id: "name", header: "القطاع" },
    { id: "code", header: "الرمز" },
    { id: "hawshat", header: "عدد الحوشات", numeric: true },
    { id: "barhi", header: "نخيل برحي", numeric: true },
    { id: "male", header: "ذكور", numeric: true },
  ];

  const tallied = (sectors ?? []).map((s) => {
    // exclude archived (removed) hawshat from the counts.
    const hawshat = ((s.hawshat ?? []) as { palm_count_barhi?: number; palm_count_male?: number; archived?: boolean }[])
      .filter((h) => !h.archived);
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
      status: a.status ? ATTENTION_STATUS_AR[a.status] ?? "غير معروف" : "—",
    };
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">هيكل المزرعة</h1>
          <p style={{ color: "var(--ink-muted)" }}>دليل الهيكل والتعديل؛ ابدأ من لوحة المزرعة للمؤشرات.</p>
        </div>
        <Link
          href="/farm/dashboard"
          className="inline-flex min-h-9 items-center justify-center rounded-md px-3 text-sm font-semibold"
          style={{
            color: "var(--brand)",
            background: "var(--surface)",
            border: "1px solid var(--line)",
          }}
        >
          لوحة المزرعة
        </Link>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="القطاعات" value={num((sectors ?? []).length)} />
        <KpiCard label="الحوشات" value={num(totalHawshat)} />
        <KpiCard label="نخيل برحي" value={num(totalBarhi)} />
        <KpiCard label="ذكور" value={num(totalMale)} />
      </section>

      <Link href="/farm/croquis" className="inline-flex w-fit items-center gap-2 text-sm font-medium text-[var(--brand,#2f7d49)] hover:underline">
        🗺️ عرض كروكي المزرعة
      </Link>

      {canEditStructure && farm?.id && (
        <StructureForm
          level="sector"
          mode="create"
          context={{ farmId: farm.id }}
          triggerLabel="إضافة قطاع"
          triggerVariant="primary"
        />
      )}

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
