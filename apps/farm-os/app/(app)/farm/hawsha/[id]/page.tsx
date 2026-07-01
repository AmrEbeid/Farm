import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import type { TabItem } from "@amrebeid/ui";
import { Alert, Breadcrumbs, Card, DescriptionList, EmptyState, FileTimeline, KpiCard } from "@/components/ui";
import { tabId, tabPanelId } from "@/lib/tab-ids";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { PalmMap } from "@/components/PalmMap";
import { StructureForm } from "@/components/StructureForm";
import { StructureArchiveButton } from "@/components/StructureArchiveButton";
import { MediaGallery } from "@/components/MediaGallery";
import { RecordActivity, type ActivityItem } from "@/components/RecordActivity";
import { Entity360Header } from "@/components/Entity360Header";
import { EntityTabs } from "@/components/EntityTabs";
import { getAttachments } from "@/app/(app)/farm/structure-actions";
import { getLinkedWorkContext } from "@/lib/linked work context";
import {
  LinkedFinanceCard,
  LinkedPlansCard,
  LinkedReportCard,
  LinkedTasksCard,
  LinkedWorkKpis,
} from "@/components/linked work sections";
import type { TimelineEvent, PalmLine, PalmStatus } from "@/components/ui";
import { num } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { OP_STATUS_AR, SUBTYPE_AR } from "@/lib/labels";

const TAB_IDS = ["overview", "palms", "plans", "tasks", "activity", "finance", "report"] as const;
type HawshaTab = (typeof TAB_IDS)[number];

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

// Palm-cell colour encodes health status; carry it in the cell's accessible name too so SR / colourblind
// users aren't left with colour alone (WCAG 1.4.1). Same Arabic status words used on the palm-360 page.
const PALM_STATUS_AR: Record<PalmStatus, string> = {
  healthy: "سليمة",
  watch: "تحت المراقبة",
  sick: "مريضة",
  dead: "ميتة",
  removed: "مُزالة",
  male: "ذكر",
};

export default async function HawshaFilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  let tab: HawshaTab = (TAB_IDS as readonly string[]).includes(rawTab ?? "")
    ? (rawTab as HawshaTab)
    : "overview";
  const m = await requireMembership();
  const sb = await createClient();
  const canEditStructure = ["owner", "farm_manager"].includes(m.role);
  const canAttach = ["owner", "farm_manager", "agri_engineer", "supervisor"].includes(m.role);
  const canSeeFinance = ["owner", "accountant"].includes(m.role);
  if (tab === "finance" && !canSeeFinance) tab = "overview";

  const [
    { data: hawsha, error: hawshaError },
    { data: locs, error: locsError },
    { data: assets, error: assetsError },
    { data: lineRows, error: linesError },
    attachments,
    linkedWork,
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
    getLinkedWorkContext(sb, {
      orgId: m.orgId,
      entityType: "hawsha",
      entityId: id,
      canSeeFinance,
    }),
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
      ariaLabel: `${a.id_tag ?? a.id} — ${PALM_STATUS_AR[palmStatus(a.status, a.sex)]}`,
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

  // Header subtitle: code · sector · palm totals, joining only the parts we have.
  const totalPalms = (hawsha.palm_count_barhi ?? 0) + (hawsha.palm_count_male ?? 0);
  const subtitleParts = [
    hawsha.code,
    sector?.name,
    `${num(totalPalms)} نخلة`,
  ].filter((part): part is string => Boolean(part));

  const tabItems: TabItem[] = [
    { id: "overview", label: "نظرة عامة" },
    { id: "palms", label: `الخطوط/النخيل (${num((lineRows ?? []).length)})` },
    { id: "plans", label: `الخطط (${num(linkedWork.plans.length)})` },
    { id: "tasks", label: `المهام (${num(linkedWork.openOperations.length)})` },
    { id: "activity", label: `النشاط (${num((events ?? []).length)})` },
    ...(canSeeFinance ? [{ id: "finance", label: "المالية" }] : []),
    { id: "report", label: "تقرير" },
  ];

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

      <Entity360Header
        title={hawsha.name}
        subtitle={subtitleParts.join(" · ")}
        pills={hawsha.archived ? [{ status: "warning", label: "مؤرشف" }] : undefined}
        actions={
          <>
            {sector?.id && <HeaderLink href={`/farm/sector/${sector.id}`}>القطاع</HeaderLink>}
            <HeaderLink href="/farm">المزرعة</HeaderLink>
          </>
        }
      />

      {hawsha.archived && (
        <Alert
          tone="warning"
          title="هذه الحوشة مُزالة (مؤرشفة)"
          description="لا تظهر في القوائم النشطة؛ البيانات معروضة للمراجعة فقط."
        />
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="نخيل برحي" value={num(hawsha.palm_count_barhi ?? 0)} />
        <KpiCard label="ذكور" value={num(hawsha.palm_count_male ?? 0)} />
        <KpiCard label="الخطوط" value={num((lineRows ?? []).length)} />
        <KpiCard
          label="المساحة"
          value={hawsha.area_qirat != null ? `${num(hawsha.area_qirat)} قيراط` : "—"}
        />
      </section>

      <LinkedWorkKpis context={linkedWork} canSeeFinance={canSeeFinance} />

      <EntityTabs items={tabItems} value={tab} />

      {tab === "overview" && (
        <div
          role="tabpanel"
          id={tabPanelId("overview")}
          aria-labelledby={tabId("overview")}
          tabIndex={0}
          className="flex flex-col gap-6"
        >
          <Card title="بيانات الحوشة">
            <DescriptionList
              layout="inline"
              items={[
                { id: "code", term: "الرمز", description: hawsha.code },
                {
                  id: "area",
                  term: "المساحة",
                  description: hawsha.area_qirat != null ? `${num(hawsha.area_qirat)} قيراط` : "—",
                },
                {
                  id: "rows",
                  term: "عدد الصفوف",
                  description: hawsha.row_count != null ? num(hawsha.row_count) : "—",
                },
                { id: "barhi", term: "نخيل برحي", description: num(hawsha.palm_count_barhi ?? 0) },
                { id: "male", term: "ذكور", description: num(hawsha.palm_count_male ?? 0) },
                { id: "planting", term: "تاريخ الزراعة", description: fmtDate(hawsha.planting_date) },
              ]}
            />
          </Card>

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
        </div>
      )}

      {tab === "palms" && (
        <div
          role="tabpanel"
          id={tabPanelId("palms")}
          aria-labelledby={tabId("palms")}
          tabIndex={0}
          className="flex flex-col gap-6"
        >
          <Card title="الخطوط">
            <SimpleTable columns={lineColumns} rows={lineList} ariaLabel="الخطوط" empty="لا توجد خطوط مسجّلة" />
          </Card>
          <Card title="خريطة النخيل">
            {palmLines.length === 0 ? (
              <EmptyState title="لا توجد نخيل مسجّلة" />
            ) : (
              <PalmMap lines={palmLines} ariaLabel={`خريطة نخيل ${hawsha.name}`} />
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
          className="flex flex-col gap-6"
        >
          <Card title="سجل العمليات">
            {timeline.length === 0 ? (
              <EmptyState title="لا توجد عمليات مسجّلة بعد" />
            ) : (
              <FileTimeline events={timeline} ariaLabel={`السجل الزمني لـ ${hawsha.name}`} />
            )}
          </Card>

          <RecordActivity
            locationType="hawsha"
            locationId={hawsha.id}
            canRecord={canAttach}
            activities={activities}
          />

          <MediaGallery
            entityType="hawsha"
            entityId={hawsha.id}
            orgId={m.orgId}
            initial={attachments}
            canAttach={canAttach}
          />
        </div>
      )}

      {tab === "plans" && (
        <div role="tabpanel" id={tabPanelId("plans")} aria-labelledby={tabId("plans")} tabIndex={0}>
          <LinkedPlansCard context={linkedWork} />
        </div>
      )}

      {tab === "tasks" && (
        <div role="tabpanel" id={tabPanelId("tasks")} aria-labelledby={tabId("tasks")} tabIndex={0}>
          <LinkedTasksCard context={linkedWork} />
        </div>
      )}

      {tab === "finance" && canSeeFinance && (
        <div role="tabpanel" id={tabPanelId("finance")} aria-labelledby={tabId("finance")} tabIndex={0}>
          <LinkedFinanceCard context={linkedWork} />
        </div>
      )}

      {tab === "report" && (
        <div role="tabpanel" id={tabPanelId("report")} aria-labelledby={tabId("report")} tabIndex={0}>
          <LinkedReportCard context={linkedWork} title={hawsha.name} canSeeFinance={canSeeFinance} />
        </div>
      )}
    </div>
  );
}

function HeaderLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-9 items-center justify-center rounded-md px-3 text-sm font-semibold"
      style={{
        color: "var(--brand)",
        background: "var(--surface)",
        border: "1px solid var(--line)",
      }}
    >
      {children}
    </Link>
  );
}
