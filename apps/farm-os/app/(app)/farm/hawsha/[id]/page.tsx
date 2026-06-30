import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { Breadcrumbs, Card, Alert, EmptyState } from "@/components/ui";
import { SectorFile } from "@/components/SectorFile";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { StructureForm } from "@/components/StructureForm";
import { StructureArchiveButton } from "@/components/StructureArchiveButton";
import { MediaGallery } from "@/components/MediaGallery";
import { RecordActivity, type ActivityItem } from "@/components/RecordActivity";
import { getAttachments } from "@/app/(app)/farm/structure-actions";
import type { TimelineEvent, PalmLine, PalmStatus } from "@/components/ui";
import { num } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { OP_STATUS_AR, SUBTYPE_AR } from "@/lib/labels";

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
  const m = await requireMembership();
  const sb = await createClient();
  const canEditStructure = ["owner", "farm_manager"].includes(m.role);
  const canAttach = ["owner", "farm_manager", "agri_engineer", "supervisor"].includes(m.role);

  const [
    { data: hawsha, error: hawshaError },
    { data: locs, error: locsError },
    { data: assets, error: assetsError },
    { data: lineRows, error: linesError },
    attachments,
  ] = await Promise.all([
    sb
      .from("hawshat")
      .select(
        "id, name, code, area_qirat, row_count, palm_count_barhi, palm_count_male, planting_date, notes, archived, sector_id, sectors(id, name)",
      )
      .eq("id", id)
      .maybeSingle(),
    // timeline from farm_events located in this hawsha (FF-1 rollup)
    sb.from("event_locations").select("event_id").eq("hawsha_id", id),
    // palm grid: live palm assets in this hawsha, grouped by line
    sb
      .from("assets")
      .select("id, id_tag, status, sex, line_id, lines(line_no)")
      .eq("hawsha_id", id)
      .eq("type", "palm")
      .eq("archived", false)
      .order("id_tag"),
    // the hawsha's lines (for the lines list + per-line files)
    sb
      .from("lines")
      .select("id, line_no, line_code, palm_count")
      .eq("hawsha_id", id)
      .eq("archived", false)
      .order("line_no"),
    getAttachments("hawsha", id),
  ]);
  // Surface DB read failures to the segment error boundary instead of rendering
  // a misleading empty page.
  if (hawshaError) throw hawshaError;
  if (locsError) throw locsError;
  if (assetsError) throw assetsError;
  if (linesError) throw linesError;

  if (!hawsha)
    return (
      <div className="p-6">
        <EmptyState title="الحوشة غير موجودة." description="قد تكون محذوفة أو الرابط غير صحيح." icon="🔍" />
      </div>
    );

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
    title: e.subtype ? SUBTYPE_AR[e.subtype] ?? "عملية" : "عملية",
    time: fmtDate(e.occurred_at),
    description: e.notes ?? (e.status ? OP_STATUS_AR[e.status] ?? "غير معروف" : "—"),
  }));

  const activities: ActivityItem[] = (events ?? []).map((e) => ({
    id: e.id,
    title: e.subtype ? SUBTYPE_AR[e.subtype] ?? "نشاط" : "نشاط",
    status: e.status ?? "done",
    time: fmtDate(e.occurred_at),
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

  const lineColumns: SimpleColumn[] = [
    { id: "line_no", header: "رقم الخط" },
    { id: "line_code", header: "الرمز" },
    { id: "palm_count", header: "عدد النخيل", numeric: true },
  ];
  const lineList = (lineRows ?? []).map((l) => ({
    id: l.id,
    href: `/farm/line/${l.id}`,
    line_no: `خط ${num(l.line_no)}`,
    line_code: l.line_code ?? "—",
    palm_count: l.palm_count != null ? num(l.palm_count) : "—",
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
          { id: "hawsha", label: hawsha.name },
        ]}
      />
      <h1 className="text-2xl font-bold">{hawsha.name}</h1>

      {hawsha.archived && <Alert tone="warning" title="هذه الحوشة مُزالة (مؤرشفة)" />}

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
            description: fmtDate(hawsha.planting_date),
          },
        ]}
        events={timeline}
        palmLines={palmLines}
      />

      {canEditStructure && (
        <Card title="إدارة الحوشة">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <StructureForm
                level="hawsha"
                mode="edit"
                initial={{
                  id: hawsha.id,
                  name: hawsha.name,
                  code: hawsha.code,
                  areaQirat: hawsha.area_qirat,
                  rowCount: hawsha.row_count,
                  palmCountBarhi: hawsha.palm_count_barhi,
                  palmCountMale: hawsha.palm_count_male,
                  plantingDate: hawsha.planting_date,
                  notes: hawsha.notes,
                }}
                triggerLabel="تعديل بيانات الحوشة"
              />
              <StructureForm
                level="line"
                mode="create"
                context={{ hawshaId: hawsha.id }}
                triggerLabel="إضافة خط"
                triggerVariant="primary"
              />
              <StructureForm
                level="palm"
                mode="create"
                context={{ hawshaId: hawsha.id }}
                triggerLabel="إضافة نخلة"
                triggerVariant="primary"
              />
            </div>
            <StructureArchiveButton
              type="hawsha"
              id={hawsha.id}
              archived={!!hawsha.archived}
              redirectTo={sector?.id ? `/farm/sector/${sector.id}` : "/farm"}
            />
          </div>
        </Card>
      )}

      <Card title="الخطوط">
        <SimpleTable columns={lineColumns} rows={lineList} empty="لا توجد خطوط مسجّلة" />
      </Card>

      <RecordActivity locationType="hawsha" locationId={hawsha.id} canRecord={canAttach} activities={activities} />

      <MediaGallery
        entityType="hawsha"
        entityId={hawsha.id}
        orgId={m.orgId}
        initial={attachments}
        canAttach={canAttach}
      />
    </div>
  );
}
