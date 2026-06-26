import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { Breadcrumbs, Card } from "@/components/ui";
import { SectorFile } from "@/components/SectorFile";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import type { TimelineEvent, PalmLine, PalmStatus } from "@/components/ui";
import { num } from "@/lib/money";
import { OP_STATUS_AR, SUBTYPE_AR } from "@/lib/labels";
import { fmtDate } from "@/lib/dates";

function palmStatus(assetStatus: string, sex: string | null): PalmStatus {
  if (sex === "male") return "male";
  switch (assetStatus) {
    case "watch":
      return "watch";
    case "sick":
      return "sick";
    case "dead":
      return "dead";
    case "removed":
    case "replaced":
      return "removed";
    default:
      return "healthy";
  }
}

export default async function SectorFilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireMembership();
  const sb = await createClient();

  // sector, the sector's event_locations, and its palm assets are all keyed on
  // the sector id and independent of each other, so fetch them in parallel. The
  // farm_event read below is dependent (it filters by the ids from locs), so it
  // stays sequential.
  const [
    { data: sector, error: sectorError },
    { data: locs, error: locsError },
    { data: assets, error: assetsError },
  ] = await Promise.all([
    sb
      .from("sectors")
      .select("id, name, code, crop, hawshat(id, name, code, palm_count_barhi, palm_count_male)")
      .eq("id", id)
      .maybeSingle(),
    // timeline from done/planned farm_events located in this sector (FF-1 rollup)
    sb.from("event_locations").select("event_id").eq("sector_id", id),
    // palm grid: assets in this sector, grouped by line
    sb
      .from("assets")
      .select("id, id_tag, status, sex, line_id, lines(line_no)")
      .eq("sector_id", id)
      .eq("type", "palm")
      .order("id_tag"),
  ]);
  // Surface DB read failures to the segment error boundary instead of rendering
  // a misleading empty page.
  if (sectorError) throw sectorError;
  if (locsError) throw locsError;
  if (assetsError) throw assetsError;

  if (!sector) return <div className="p-6">القطاع غير موجود.</div>;

  const hawshat = (sector.hawshat ?? []) as {
    id: string;
    name: string;
    code: string;
    palm_count_barhi?: number;
    palm_count_male?: number;
  }[];
  const barhi = hawshat.reduce((s, h) => s + Number(h.palm_count_barhi ?? 0), 0);
  const male = hawshat.reduce((s, h) => s + Number(h.palm_count_male ?? 0), 0);

  const hawshaColumns: SimpleColumn[] = [
    { id: "name", header: "الحوشة" },
    { id: "code", header: "الرمز" },
    { id: "barhi", header: "نخيل برحي", numeric: true },
    { id: "male", header: "ذكور", numeric: true },
  ];
  const hawshaRows = [...hawshat]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((h) => ({
      id: h.id,
      href: `/farm/hawsha/${h.id}`,
      name: h.name,
      code: h.code,
      barhi: num(h.palm_count_barhi ?? 0),
      male: num(h.palm_count_male ?? 0),
    }));

  const eventIds = (locs ?? []).map((l) => l.event_id);
  const { data: events, error: eventsError } = eventIds.length
    ? await sb
        .from("farm_event")
        .select("id, subtype, status, occurred_at, notes")
        .in("id", eventIds)
        .order("occurred_at", { ascending: false })
    : { data: [], error: null };
  if (eventsError) throw eventsError;

  const timeline: TimelineEvent[] = (events ?? []).map((e) => ({
    id: e.id,
    kind: "operation",
    title: SUBTYPE_AR[e.subtype ?? ""] ?? e.subtype ?? "عملية",
    time: fmtDate(e.occurred_at),
    description: e.notes ?? OP_STATUS_AR[e.status ?? ""] ?? e.status,
  }));

  const lineMap = new Map<string, PalmLine>();
  for (const a of assets ?? []) {
    const lineNo = (a.lines as { line_no?: number } | null)?.line_no ?? 0;
    const lineId = a.line_id ?? `line-${lineNo}`;
    if (!lineMap.has(lineId)) {
      lineMap.set(lineId, { id: lineId, label: `خط ${num(lineNo)}`, cells: [] });
    }
    lineMap.get(lineId)!.cells.push({
      id: a.id,
      status: palmStatus(a.status, a.sex),
      ariaLabel: a.id_tag ?? a.id,
    });
  }
  const palmLines = Array.from(lineMap.values());

  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumbs
        ariaLabel="المسار"
        items={[
          { id: "farm", label: "المزرعة", href: "/farm" },
          { id: "sector", label: sector.name },
        ]}
      />
      <h1 className="text-2xl font-bold">{sector.name}</h1>
      <SectorFile
        name={sector.name}
        meta={[
          { id: "code", term: "الرمز", description: sector.code },
          { id: "crop", term: "المحصول", description: sector.crop ?? "—" },
          { id: "hawshat", term: "عدد الحوشات", description: num(hawshat.length) },
          { id: "barhi", term: "نخيل برحي", description: num(barhi) },
          { id: "male", term: "ذكور", description: num(male) },
        ]}
        events={timeline}
        palmLines={palmLines}
      />
      <Card title="الحوشات">
        <SimpleTable columns={hawshaColumns} rows={hawshaRows} empty="لا توجد حوشات" />
      </Card>
    </div>
  );
}
