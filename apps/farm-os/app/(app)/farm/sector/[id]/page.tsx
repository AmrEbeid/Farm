import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import {
  Alert,
  Breadcrumbs,
  Card,
  DescriptionList,
  EmptyState,
  FileTimeline,
  KpiCard,
  tabId,
  tabPanelId,
} from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { PalmMap } from "@/components/PalmMap";
import { Entity360Header } from "@/components/Entity360Header";
import { EntityTabs } from "@/components/EntityTabs";
import { StructureForm } from "@/components/StructureForm";
import { StructureArchiveButton } from "@/components/StructureArchiveButton";
import { MediaGallery } from "@/components/MediaGallery";
import { RecordActivity, type ActivityItem } from "@/components/RecordActivity";
import { getAttachments } from "@/app/(app)/farm/structure-actions";
import type { TabItem } from "@amrebeid/ui";
import type { TimelineEvent, PalmLine, PalmStatus } from "@/components/ui";
import { num } from "@/lib/money";
import { OP_STATUS_AR, SUBTYPE_AR } from "@/lib/labels";
import { fmtDate } from "@/lib/dates";

const TAB_IDS = ["overview", "palms", "activity", "media"] as const;
type SectorTab = (typeof TAB_IDS)[number];

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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const tab: SectorTab = (TAB_IDS as readonly string[]).includes(rawTab ?? "")
    ? (rawTab as SectorTab)
    : "overview";
  const m = await requireMembership();
  const sb = await createClient();
  const canEditStructure = ["owner", "farm_manager"].includes(m.role);
  const canAttach = ["owner", "farm_manager", "agri_engineer", "supervisor"].includes(m.role);

  const [
    { data: sector, error: sectorError },
    { data: locs, error: locsError },
    { data: assets, error: assetsError },
    attachments,
  ] = await Promise.all([
    sb
      .from("sectors")
      .select(
        "id, name, code, crop, area_feddan, planting_date, notes, archived, hawshat(id, name, code, palm_count_barhi, palm_count_male, archived)",
      )
      .eq("id", id)
      .maybeSingle(),
    // timeline from done/planned farm_events located in this sector (FF-1 rollup)
    sb.from("event_locations").select("event_id").eq("sector_id", id),
    // palm grid: live palm assets in this sector, grouped by line
    sb
      .from("assets")
      .select("id, id_tag, status, sex, line_id, lines(line_no)")
      .eq("sector_id", id)
      .eq("type", "palm")
      .eq("archived", false)
      .order("id_tag"),
    getAttachments("sector", id),
  ]);
  // Surface DB read failures to the segment error boundary instead of rendering
  // a misleading empty page.
  if (sectorError) throw sectorError;
  if (locsError) throw locsError;
  if (assetsError) throw assetsError;

  if (!sector)
    return (
      <div className="p-6">
        <EmptyState title="القطاع غير موجود." description="قد يكون محذوفًا أو الرابط غير صحيح." icon="🔍" />
      </div>
    );

  const hawshat = ((sector.hawshat ?? []) as {
    id: string;
    name: string;
    code: string;
    palm_count_barhi?: number;
    palm_count_male?: number;
    archived?: boolean;
  }[]).filter((h) => !h.archived);
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
  const palmTotal = barhi + male;

  const tabItems: TabItem[] = [
    { id: "overview", label: "نظرة عامة" },
    { id: "palms", label: `النخيل (${num(palmTotal)})` },
    { id: "activity", label: `النشاط (${num(activities.length)})` },
    { id: "media", label: "المرفقات" },
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumbs
        ariaLabel="المسار"
        items={[
          { id: "farm", label: "المزرعة", href: "/farm" },
          { id: "sector", label: sector.name },
        ]}
      />

      <Entity360Header
        title={sector.name}
        subtitle={`${sector.code} · ${sector.crop ?? "—"} · ${num(palmTotal)} نخلة`}
        pills={sector.archived ? [{ status: "warning", label: "مؤرشف" }] : undefined}
      />

      {sector.archived && (
        <Alert
          tone="warning"
          title="هذا القطاع مُزال (مؤرشف)"
          description="القطاع المؤرشف للعرض فقط؛ لا تُنشأ عليه عمليات جديدة."
        />
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="عدد الحوشات" value={num(hawshat.length)} />
        <KpiCard label="نخيل برحي" value={num(barhi)} />
        <KpiCard label="ذكور" value={num(male)} />
        <KpiCard
          label="المساحة"
          value={sector.area_feddan != null ? `${num(sector.area_feddan)} فدان` : "—"}
        />
      </section>

      <EntityTabs items={tabItems} value={tab} />

      {tab === "overview" && (
        <div
          role="tabpanel"
          id={tabPanelId("overview")}
          aria-labelledby={tabId("overview")}
          tabIndex={0}
          className="flex flex-col gap-4"
        >
          <Card title="بيانات القطاع">
            <DescriptionList
              layout="inline"
              items={[
                { id: "code", term: "الرمز", description: sector.code },
                { id: "crop", term: "المحصول", description: sector.crop ?? "—" },
                {
                  id: "area",
                  term: "المساحة",
                  description: sector.area_feddan != null ? `${num(sector.area_feddan)} فدان` : "—",
                },
                { id: "hawshat", term: "عدد الحوشات", description: num(hawshat.length) },
                { id: "barhi", term: "نخيل برحي", description: num(barhi) },
                { id: "male", term: "ذكور", description: num(male) },
              ]}
            />
          </Card>

          {canEditStructure && (
            <Card title="إدارة القطاع">
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  <StructureForm
                    level="sector"
                    mode="edit"
                    initial={{
                      id: sector.id,
                      name: sector.name,
                      code: sector.code,
                      crop: sector.crop,
                      areaFeddan: sector.area_feddan,
                      plantingDate: sector.planting_date,
                      notes: sector.notes,
                    }}
                    triggerLabel="تعديل بيانات القطاع"
                  />
                  <StructureForm
                    level="hawsha"
                    mode="create"
                    context={{ sectorId: sector.id }}
                    triggerLabel="إضافة حوشة"
                    triggerVariant="primary"
                  />
                </div>
                <StructureArchiveButton type="sector" id={sector.id} archived={!!sector.archived} redirectTo="/farm" />
              </div>
            </Card>
          )}

          <Card title="الحوشات">
            <SimpleTable columns={hawshaColumns} rows={hawshaRows} empty="لا توجد حوشات" />
          </Card>
        </div>
      )}

      {tab === "palms" && (
        <div role="tabpanel" id={tabPanelId("palms")} aria-labelledby={tabId("palms")} tabIndex={0}>
          <Card title="خريطة النخيل">
            {palmLines.length === 0 ? (
              <EmptyState title="لا توجد نخيل مسجّلة" />
            ) : (
              <PalmMap lines={palmLines} ariaLabel={`خريطة نخيل ${sector.name}`} />
            )}
          </Card>
        </div>
      )}

      {tab === "activity" && (
        <div
          role="tabpanel"
          id={tabPanelId("activity")}
          aria-labelledby={tabId("activity")}
          tabIndex={0}
          className="flex flex-col gap-4"
        >
          <RecordActivity
            locationType="sector"
            locationId={sector.id}
            canRecord={canAttach}
            activities={activities}
          />
          <Card title="سجل العمليات">
            {timeline.length === 0 ? (
              <EmptyState title="لا توجد عمليات مسجّلة بعد" />
            ) : (
              <FileTimeline events={timeline} ariaLabel={`السجل الزمني لـ ${sector.name}`} />
            )}
          </Card>
        </div>
      )}

      {tab === "media" && (
        <div role="tabpanel" id={tabPanelId("media")} aria-labelledby={tabId("media")} tabIndex={0}>
          <MediaGallery
            entityType="sector"
            entityId={sector.id}
            orgId={m.orgId}
            initial={attachments}
            canAttach={canAttach}
          />
        </div>
      )}
    </div>
  );
}
