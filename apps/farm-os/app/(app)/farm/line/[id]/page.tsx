import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { Breadcrumbs, Card, DescriptionList, Alert, EmptyState } from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { StructureForm } from "@/components/StructureForm";
import { StructureArchiveButton } from "@/components/StructureArchiveButton";
import { MediaGallery } from "@/components/MediaGallery";
import { RecordActivity, type ActivityItem } from "@/components/RecordActivity";
import { getAttachments } from "@/app/(app)/farm/structure-actions";
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

function one<T>(rel: unknown): T | null {
  return (Array.isArray(rel) ? rel[0] : rel) as T | null;
}

export default async function LineFilePage({
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
    { data: line, error: lineError },
    { data: palms, error: palmsError },
    attachments,
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
      <h1 className="text-2xl font-bold">{label}</h1>

      {line.archived && <Alert tone="warning" title="هذا الخط مُزال (مؤرشف)" />}

      <Card title="بيانات الخط">
        <DescriptionList
          layout="inline"
          items={[
            { id: "no", term: "رقم الخط", description: num(line.line_no) },
            { id: "code", term: "الرمز", description: line.line_code ?? "—" },
            { id: "count", term: "عدد النخيل", description: line.palm_count != null ? num(line.palm_count) : "—" },
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

      <Card title="النخيل في هذا الخط">
        {palmRows.length === 0 ? (
          <EmptyState title="لا يوجد نخيل مسجّل على هذا الخط" />
        ) : (
          <SimpleTable columns={palmColumns} rows={palmRows} empty="—" />
        )}
      </Card>

      <RecordActivity locationType="line" locationId={line.id} canRecord={canAttach} activities={activities} />

      <MediaGallery
        entityType="line"
        entityId={line.id}
        orgId={m.orgId}
        initial={attachments}
        canAttach={canAttach}
      />
    </div>
  );
}
