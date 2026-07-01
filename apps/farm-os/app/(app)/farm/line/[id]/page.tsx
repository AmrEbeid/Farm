import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import type { TabItem } from "@amrebeid/ui";
import { Breadcrumbs, Card, DescriptionList, Alert, EmptyState } from "@/components/ui";
import { tabId, tabPanelId } from "@/lib/tab-ids";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
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
import { num } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { SUBTYPE_AR } from "@/lib/labels";

const STATUS_AR: Record<string, string> = {
  active: "سليمة",
  watch: "تحت المراقبة",
  sick: "مريضة",
  dead: "ميتة",
  removed: "مُزالة",
  replaced: "مُستبدلة",
};

const TAB_IDS = ["overview", "palms", "plans", "tasks", "activity", "finance", "report"] as const;
type LineTab = (typeof TAB_IDS)[number];

function one<T>(rel: unknown): T | null {
  return (Array.isArray(rel) ? rel[0] : rel) as T | null;
}

export default async function LineFilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  let tab: LineTab = (TAB_IDS as readonly string[]).includes(rawTab ?? "")
    ? (rawTab as LineTab)
    : "overview";
  const m = await requireMembership();
  const sb = await createClient();
  const canEditStructure = ["owner", "farm_manager"].includes(m.role);
  const canAttach = ["owner", "farm_manager", "agri_engineer", "supervisor"].includes(m.role);
  const canSeeFinance = ["owner", "accountant"].includes(m.role);
  if (tab === "finance" && !canSeeFinance) tab = "overview";

  const [
    { data: line, error: lineError },
    { data: palms, error: palmsError },
    attachments,
    linkedWork,
  ] = await Promise.all([
    sb
      .from("lines")
      .select(
        "id, line_no, line_code, palm_count, direction, notes, archived, hawsha_id, hawshat(id, name, sector_id, sectors(id, name))",
      )
      .eq("id", id)
      .maybeSingle(),
    sb
      .from("assets")
      .select("id, id_tag, name, status, sex, variety")
      .eq("line_id", id)
      .eq("type", "palm")
      .eq("archived", false)
      .order("id_tag"),
    getAttachments("line", id),
    getLinkedWorkContext(sb, {
      orgId: m.orgId,
      entityType: "line",
      entityId: id,
      canSeeFinance,
    }),
  ]);
  if (lineError) throw lineError;
  if (palmsError) throw palmsError;

  if (!line)
    return (
      <div className="p-6">
        <EmptyState title="الخط غير موجود." description="قد يكون محذوفًا أو الرابط غير صحيح." icon="🔍" />
      </div>
    );

  const hawsha = one<{ id?: string; name?: string; sector_id?: string; sectors?: unknown }>(line.hawshat);
  const sector = one<{ id?: string; name?: string }>(hawsha?.sectors);
  const label = `خط ${num(line.line_no)}`;

  const palmColumns: SimpleColumn[] = [
    { id: "tag", header: "الرمز" },
    { id: "variety", header: "الصنف" },
    { id: "status", header: "الحالة" },
  ];
  const palmRows = (palms ?? []).map((p) => ({
    id: p.id,
    href: `/farm/palm/${p.id}`,
    tag: p.id_tag ?? p.name ?? p.id,
    variety: p.variety ?? "—",
    status: p.status ? STATUS_AR[p.status] ?? "غير معروف" : "—",
  }));

  // activities recorded against this line (event_locations.line_id rollup)
  const { data: locs } = await sb.from("event_locations").select("event_id").eq("line_id", id);
  const eventIds = (locs ?? []).map((l) => l.event_id);
  const { data: events } = eventIds.length
    ? await sb
        .from("farm_event")
        .select("id, subtype, status, occurred_at")
        .in("id", eventIds)
        .order("occurred_at", { ascending: false })
    : { data: [] };
  const activities: ActivityItem[] = (events ?? []).map((e) => ({
    id: e.id,
    title: e.subtype ? SUBTYPE_AR[e.subtype] ?? "نشاط" : "نشاط",
    status: e.status ?? "done",
    time: fmtDate(e.occurred_at),
  }));

  // Header subtitle: sector / hawsha context + palm count.
  const contextParts = [
    sector?.name,
    hawsha?.name,
    `${num(palmRows.length)} نخلة`,
  ].filter(Boolean);

  const tabItems: TabItem[] = [
    { id: "overview", label: "نظرة عامة" },
    { id: "palms", label: `النخيل (${num(palmRows.length)})` },
    { id: "plans", label: `الخطط (${num(linkedWork.plans.length)})` },
    { id: "tasks", label: `المهام (${num(linkedWork.openOperations.length)})` },
    { id: "activity", label: `النشاط (${num(activities.length)})` },
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
          ...(hawsha?.id
            ? [{ id: "hawsha", label: hawsha.name ?? "الحوشة", href: `/farm/hawsha/${hawsha.id}` }]
            : []),
          { id: "line", label },
        ]}
      />

      <Entity360Header
        title={label}
        subtitle={contextParts.join(" · ")}
        pills={line.archived ? [{ status: "warning", label: "مؤرشف" }] : undefined}
        actions={
          <>
            {hawsha?.id && <HeaderLink href={`/farm/hawsha/${hawsha.id}`}>الحوشة</HeaderLink>}
            <HeaderLink href="/farm">المزرعة</HeaderLink>
          </>
        }
      />

      {line.archived && (
        <Alert
          tone="warning"
          title="هذا الخط مُزال (مؤرشف)"
          description="لا تظهر العمليات الجديدة على الخطوط المؤرشفة."
        />
      )}

      <LinkedWorkKpis context={linkedWork} canSeeFinance={canSeeFinance} />

      <EntityTabs items={tabItems} value={tab} />

      {tab === "overview" && (
        <div
          role="tabpanel"
          id={tabPanelId("overview")}
          aria-labelledby={tabId("overview")}
          tabIndex={0}
          className="flex flex-col gap-4"
        >
          <Card title="بيانات الخط">
            <DescriptionList
              layout="inline"
              items={[
                { id: "no", term: "رقم الخط", description: num(line.line_no) },
                { id: "code", term: "الرمز", description: line.line_code ?? "—" },
                {
                  id: "count",
                  term: "عدد النخيل",
                  description: line.palm_count != null ? num(line.palm_count) : "—",
                },
                { id: "dir", term: "الاتجاه", description: line.direction ?? "—" },
                { id: "notes", term: "ملاحظات", description: line.notes ?? "—" },
              ]}
            />
          </Card>

          {canEditStructure && (
            <Card title="إدارة الخط">
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  <StructureForm
                    level="line"
                    mode="edit"
                    initial={{
                      id: line.id,
                      lineNo: line.line_no,
                      lineCode: line.line_code,
                      palmCount: line.palm_count,
                      direction: line.direction,
                      notes: line.notes,
                    }}
                    triggerLabel="تعديل بيانات الخط"
                  />
                  {hawsha?.id && (
                    <StructureForm
                      level="palm"
                      mode="create"
                      context={{ hawshaId: hawsha.id, lineId: line.id }}
                      triggerLabel="إضافة نخلة"
                      triggerVariant="primary"
                    />
                  )}
                </div>
                <StructureArchiveButton
                  type="line"
                  id={line.id}
                  archived={!!line.archived}
                  redirectTo={hawsha?.id ? `/farm/hawsha/${hawsha.id}` : "/farm"}
                />
              </div>
            </Card>
          )}
        </div>
      )}

      {tab === "palms" && (
        <div role="tabpanel" id={tabPanelId("palms")} aria-labelledby={tabId("palms")} tabIndex={0}>
          <Card title="النخيل في هذا الخط">
            {palmRows.length === 0 ? (
              <EmptyState title="لا يوجد نخيل مسجّل على هذا الخط" />
            ) : (
              <SimpleTable columns={palmColumns} rows={palmRows} ariaLabel="النخيل في هذا الخط" empty="—" />
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
            locationType="line"
            locationId={line.id}
            canRecord={canAttach}
            activities={activities}
          />
          <MediaGallery
            entityType="line"
            entityId={line.id}
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
          <LinkedReportCard context={linkedWork} title={label} canSeeFinance={canSeeFinance} />
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
