import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { Breadcrumbs, Alert, EmptyState } from "@/components/ui";
import type { TimelineEvent } from "@/components/ui";
import { Entity360Header } from "@/components/Entity360Header";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";
import { PalmFile } from "@/components/PalmFile";
import { type ActivityItem } from "@/components/RecordActivity";
import { getAttachments } from "@/app/(app)/farm/structure-actions";
import { getLinkedWorkContext } from "@/lib/linked-work-context";
import {
  LinkedFinanceCard,
  LinkedPlansCard,
  LinkedReportCard,
  LinkedTasksCard,
  LinkedWorkKpis,
} from "@/components/linked-work-sections";
import { ASSET_STATUS_AR as STATUS_AR, SUBTYPE_AR } from "@/lib/labels";

// assets.status — the closed set from migration 0003.
// health_status — legacy coded values from the seed (good / leaf_spot_watch / rpw_suspected); newer
// entries are free-text Arabic from the form. Map the known codes to Arabic and fall back to the raw
// value (the free-text case) so a field user never sees raw English (non-negotiable #2).
const HEALTH_STATUS_AR: Record<string, string> = {
  good: "جيدة",
  healthy: "سليمة",
  leaf_spot_watch: "مراقبة تبقّع الأوراق",
  rpw_suspected: "اشتباه إصابة بسوسة النخيل الحمراء",
};

// Map assets.status → an Entity360 pill tone. Healthy is the only "active"; watch/sick warn;
// dead is "blocked"; removed/replaced (archived/superseded) read as muted "draft".
const STATUS_PILL: Record<string, "active" | "warning" | "blocked" | "draft"> = {
  active: "active",
  watch: "warning",
  sick: "warning",
  dead: "blocked",
  removed: "draft",
  replaced: "draft",
};

function one<T>(rel: unknown): T | null {
  // PostgREST returns a to-one embed as an object or single-element array.
  return (Array.isArray(rel) ? rel[0] : rel) as T | null;
}

export default async function PalmFilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const m = await requireMembership();
  const sb = await createClient();
  const canSeeFinance = ["owner", "accountant"].includes(m.role);

  // asset (+ its sector/hawsha/line for the breadcrumb), its status history, its media, its past
  // individual treatments (plan_operations targeted at this palm), and the org's inventory items
  // (for the treatment form's optional material picker) are independent reads keyed on the asset id
  // — fetch in parallel. RLS scopes all.
  const [
    { data: asset, error: assetError },
    { data: history, error: historyError },
    attachments,
    linkedWork,
    { data: treatmentOps, error: treatmentError },
    { data: items },
  ] = await Promise.all([
    sb
      .from("assets")
      .select(
        "id, name, variety, sex, status, health_status, planting_date, id_tag, archived, sector_id, hawsha_id, line_id, sectors(id, name), hawshat(id, name), lines(line_no)",
      )
      .eq("id", id)
      .eq("type", "palm")
      .maybeSingle(),
    sb
      .from("palm_status_history")
      .select("id, status, health_status, changed_at, reason")
      .eq("asset_id", id)
      .order("changed_at", { ascending: false }),
    getAttachments("palm", id),
    getLinkedWorkContext(sb, {
      orgId: m.orgId,
      entityType: "palm",
      entityId: id,
      canSeeFinance,
    }),
    sb
      .from("plan_operations")
      .select("id, subtype, status, planned_at, note")
      .eq("target_type", "palm")
      .eq("target_id", id)
      .order("planned_at", { ascending: false }),
    sb.from("inventory_items").select("id, name, unit").order("name"),
  ]);
  // Surface DB read failures to the segment error boundary instead of a misleading empty page.
  if (assetError) throw assetError;
  if (historyError) throw historyError;
  if (treatmentError) throw treatmentError;

  if (!asset)
    return (
      <div className="p-6">
        <EmptyState title="النخلة غير موجودة." description="قد تكون محذوفة أو الرابط غير صحيح." icon="🔍" />
      </div>
    );

  const sector = one<{ id?: string; name?: string }>(asset.sectors);
  const hawsha = one<{ id?: string; name?: string }>(asset.hawshat);
  const line = one<{ line_no?: number }>(asset.lines);
  const label = asset.id_tag ?? asset.name ?? "نخلة";
  // Field roles may update tree health (op.execute); others get a read-only file (the action re-checks).
  const canEdit = ["supervisor", "agri_engineer", "farm_manager", "owner"].includes(m.role);
  // structural edits (identity / remove) are owner/farm_manager only (structure.write).
  const canEditStructure = ["owner", "farm_manager"].includes(m.role);

  const timeline: TimelineEvent[] = (history ?? []).map((h) => ({
    id: h.id,
    kind: "operation",
    title: h.status ? STATUS_AR[h.status] ?? "تغيير الحالة" : "تغيير الحالة",
    time: fmtDate(h.changed_at),
    description: h.reason ?? HEALTH_STATUS_AR[h.health_status ?? ""] ?? h.health_status ?? "—",
  }));

  // activities recorded against this palm (linked via event_assets)
  // A6: surface DB read failures to the segment error boundary — a swallowed transient error would
  // render an empty "activities" section, silently hiding real work (non-negotiable #1).
  const { data: evAssets, error: evAssetsError } = await sb.from("event_assets").select("event_id").eq("asset_id", id);
  if (evAssetsError) throw evAssetsError;
  const palmEventIds = (evAssets ?? []).map((e) => e.event_id);
  const { data: palmEvents, error: palmEventsError } = palmEventIds.length
    ? await sb
        .from("farm_event")
        .select("id, subtype, status, occurred_at")
        .in("id", palmEventIds)
        .order("occurred_at", { ascending: false })
    : { data: [], error: null };
  if (palmEventsError) throw palmEventsError;
  const activities: ActivityItem[] = (palmEvents ?? []).map((e) => ({
    id: e.id,
    title: e.subtype ? SUBTYPE_AR[e.subtype] ?? "نشاط" : "نشاط",
    status: e.status ?? "done",
    time: fmtDate(e.occurred_at),
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
          ...(hawsha?.id
            ? [{ id: "hawsha", label: hawsha.name ?? "الحوشة", href: `/farm/hawsha/${hawsha.id}` }]
            : []),
          { id: "palm", label },
        ]}
      />
      <Entity360Header
        title={label}
        subtitle={[
          asset.variety ?? undefined,
          asset.sex === "male" ? "ذكر" : asset.sex === "female" ? "أنثى" : undefined,
          line?.line_no != null ? `خط ${num(line.line_no)}` : undefined,
        ]
          .filter(Boolean)
          .join(" · ")}
        pills={[
          {
            status: STATUS_PILL[asset.status ?? ""] ?? "draft",
            label: STATUS_AR[asset.status ?? ""] ?? asset.status ?? "—",
          },
        ]}
      />

      {asset.archived && <Alert tone="warning" title="هذه النخلة مُزالة (مؤرشفة)" />}

      {asset.status === "sick" && (
        <Alert
          tone="danger"
          title="هذه النخلة تحتاج عناية عاجلة"
          description="النخلة مسجّلة كمريضة — راجع الحالة الصحية وسجّل المعالجة اللازمة."
        />
      )}
      {asset.status === "dead" && (
        <Alert
          tone="danger"
          title="النخلة مسجّلة كميتة"
          description="راجع سبب النفوق وحدّث السجل أو ابدأ إجراء الإحلال."
        />
      )}

      <PalmFile
        label={label}
        meta={[
          { id: "tag", term: "الرمز", description: asset.id_tag ?? "—" },
          { id: "variety", term: "الصنف", description: asset.variety ?? "—" },
          // sex is nullable; don't render unknown as "أنثى" — sex drives pollination role.
          { id: "sex", term: "النوع", description: asset.sex === "male" ? "ذكر" : asset.sex === "female" ? "أنثى" : "—" },
          { id: "status", term: "الحالة", description: STATUS_AR[asset.status ?? ""] ?? asset.status ?? "—" },
          { id: "health", term: "الحالة الصحية", description: HEALTH_STATUS_AR[asset.health_status ?? ""] ?? asset.health_status ?? "—" },
          { id: "line", term: "الخط", description: line?.line_no != null ? `خط ${num(line.line_no)}` : "—" },
          { id: "planting", term: "تاريخ الزراعة", description: asset.planting_date ? fmtDate(asset.planting_date) : "—" },
        ]}
        timeline={timeline}
        activities={activities}
        canEdit={canEdit}
        canEditStructure={canEditStructure}
        asset={{
          id: asset.id,
          status: asset.status,
          name: asset.name,
          variety: asset.variety,
          sex: asset.sex,
          id_tag: asset.id_tag,
          planting_date: asset.planting_date,
          health_status: asset.health_status,
          hawsha_id: asset.hawsha_id,
          line_id: asset.line_id,
          archived: !!asset.archived,
        }}
        orgId={m.orgId}
        hawshaRedirect={hawsha?.id ? `/farm/hawsha/${hawsha.id}` : "/farm"}
        attachments={attachments}
        treatmentItems={items ?? []}
        treatments={(treatmentOps ?? []).map((o) => ({
          id: o.id,
          subtype: o.subtype,
          status: o.status,
          plannedAt: o.planned_at ? fmtDate(o.planned_at) : null,
          note: o.note,
        }))}
      />

      <LinkedWorkKpis context={linkedWork} canSeeFinance={canSeeFinance} />
      <section className="grid gap-5 xl:grid-cols-2">
        <LinkedPlansCard context={linkedWork} />
        <LinkedTasksCard context={linkedWork} />
      </section>
      {canSeeFinance && <LinkedFinanceCard context={linkedWork} />}
      <LinkedReportCard context={linkedWork} title={label} canSeeFinance={canSeeFinance} />
    </div>
  );
}
