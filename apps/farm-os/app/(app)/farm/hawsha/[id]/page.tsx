import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { Breadcrumbs } from "@/components/ui";
import { SectorFile } from "@/components/SectorFile";
import type { TimelineEvent, PalmLine, PalmStatus } from "@/components/ui";
import { num } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { OP_STATUS_AR } from "@/lib/labels";

const SUBTYPE_AR: Record<string, string> = {
  fertilization: "تسميد",
  irrigation: "ري",
  spraying: "رش",
  inspection: "تفتيش",
};

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

export default async function HawshaFilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireMembership();
  const sb = await createClient();

  // hawsha (+ its sector for the breadcrumb), the hawsha's event_locations, and
  // its palm assets are all keyed on the hawsha id and independent of each
  // other, so fetch them in parallel. The farm_event read below filters by the
  // ids from locs, so it stays sequential.
  const [
    { data: hawsha, error: hawshaError },
    { data: locs, error: locsError },
    { data: assets, error: assetsError },
  ] = await Promise.all([
    sb
      .from("hawshat")
      .select(
        "id, name, code, area_qirat, row_count, palm_count_barhi, palm_count_male, planting_date, sector_id, sectors(id, name)",
      )
      .eq("id", id)
      .maybeSingle(),
    // timeline from farm_events located in this hawsha (FF-1 rollup)
    sb.from("event_locations").select("event_id").eq("hawsha_id", id),
    // palm grid: assets in this hawsha, grouped by line
    sb
      .from("assets")
      .select("id, id_tag, status, sex, line_id, lines(line_no)")
      .eq("hawsha_id", id)
      .eq("type", "palm")
      .order("id_tag"),
  ]);
  // Surface DB read failures to the segment error boundary instead of rendering
  // a misleading empty page.
  if (hawshaError) throw hawshaError;
  if (locsError) throw locsError;
  if (assetsError) throw assetsError;

  if (!hawsha) return <div className="p-6">الحوشة غير موجودة.</div>;

  // PostgREST returns a to-one embed as an object or a single-element array
  // depending on FK detection — normalise both to one sector (for the breadcrumb).
  const sectorRel = hawsha.sectors as unknown;
  const sector = (Array.isArray(sectorRel) ? sectorRel[0] : sectorRel) as
    | { id?: string; name?: string }
    | null;

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
          ...(sector?.id
            ? [{ id: "sector", label: sector.name ?? "القطاع", href: `/farm/sector/${sector.id}` }]
            : []),
          { id: "hawsha", label: hawsha.name },
        ]}
      />
      <h1 className="text-2xl font-bold">{hawsha.name}</h1>
      <SectorFile
        name={hawsha.name}
        overviewTitle="بيانات الحوشة"
        meta={[
          { id: "code", term: "الرمز", description: hawsha.code },
          {
            id: "area",
            term: "المساحة",
            description: hawsha.area_qirat != null ? `${num(hawsha.area_qirat)} قيراط` : "—",
          },
          { id: "rows", term: "عدد الصفوف", description: hawsha.row_count != null ? num(hawsha.row_count) : "—" },
          { id: "barhi", term: "نخيل برحي", description: num(hawsha.palm_count_barhi ?? 0) },
          { id: "male", term: "ذكور", description: num(hawsha.palm_count_male ?? 0) },
          {
            id: "planting",
            term: "تاريخ الزراعة",
            description: hawsha.planting_date
              ? new Date(hawsha.planting_date).toLocaleDateString("ar-EG")
              : "—",
          },
        ]}
        events={timeline}
        palmLines={palmLines}
      />
    </div>
  );
}
