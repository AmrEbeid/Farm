import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { Breadcrumbs } from "@/components/ui";
import { SectorFile } from "@/components/SectorFile";
import type { TimelineEvent, PalmLine, PalmStatus } from "@/components/ui";
import { num } from "@/lib/money";

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
  const [{ data: sector }, { data: locs }, { data: assets }] = await Promise.all(
    [
      sb
        .from("sectors")
        .select("id, name, code, crop, hawshat(id, palm_count_barhi, palm_count_male)")
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
    ],
  );

  if (!sector) return <div className="p-6">القطاع غير موجود.</div>;

  const hawshat = (sector.hawshat ?? []) as { palm_count_barhi?: number; palm_count_male?: number }[];
  const barhi = hawshat.reduce((s, h) => s + Number(h.palm_count_barhi ?? 0), 0);
  const male = hawshat.reduce((s, h) => s + Number(h.palm_count_male ?? 0), 0);

  const eventIds = (locs ?? []).map((l) => l.event_id);
  const { data: events } = eventIds.length
    ? await sb
        .from("farm_event")
        .select("id, subtype, status, occurred_at, notes")
        .in("id", eventIds)
        .order("occurred_at", { ascending: false })
    : { data: [] };

  const timeline: TimelineEvent[] = (events ?? []).map((e) => ({
    id: e.id,
    kind: "operation",
    title: SUBTYPE_AR[e.subtype ?? ""] ?? e.subtype ?? "عملية",
    time: e.occurred_at ? new Date(e.occurred_at).toLocaleDateString("ar-EG") : "—",
    description: e.notes ?? (e.status === "done" ? "منفّذة" : e.status),
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
    </div>
  );
}
