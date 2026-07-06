import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { Alert, Card, EmptyState, KpiCard } from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { DashboardKpiLink } from "@/components/DashboardKpiLink";
import { CurrentFilterCard } from "@/components/CurrentFilterCard";
import { CategoryBarChart, CategoryDoughnut } from "@/components/charts";
import { OnboardingChecklist } from "@/components/OnboardingChecklist";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";
import { OP_STATUS_AR, SUBTYPE_AR } from "@/lib/labels";
import { buildPalmCountReconciliation } from "@/lib/palm-count-reconciliation";

const ATTENTION_STATUS_AR: Record<string, string> = {
  watch: "تحت المراقبة",
  sick: "مريضة",
  dead: "ميتة",
};

const FILTER_LABEL_AR: Record<string, string> = {
  all: "كل الجداول",
  attention: "النخيل الذي يحتاج عناية",
  events: "آخر العمليات",
  sectors: "القطاعات",
  hawshat: "الحوشات",
};

export default async function FarmDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter = "all" } = await searchParams;
  const m = await requireMembership();
  const sb = await createClient();
  const canSeeOffshoots = m.role === "owner" || m.role === "accountant" || m.role === "farm_manager";

  const [
    { data: sectors, error: sectorsError },
    { data: hawshat, error: hawshatError },
    { data: atRisk, error: atRiskError, count: atRiskCount },
    { data: events, error: eventsError },
    { data: offshootMovements, error: offshootError },
    { data: reconciliationHawshat, error: reconciliationHawshatError },
    { data: reconciliationLines, error: reconciliationLinesError },
    { data: reconciliationPalms, error: reconciliationPalmsError },
  ] = await Promise.all([
    sb
      .from("sectors")
      .select("id, name, code, crop, hawshat(id, palm_count_barhi, palm_count_male, archived)")
      .eq("archived", false)
      .order("code"),
    sb
      .from("hawshat")
      .select("id, name, code, palm_count_barhi, palm_count_male, sectors(name)")
      .eq("archived", false)
      .order("code")
      .limit(12),
    sb
      .from("assets")
      .select("id, id_tag, name, status, hawshat(name), sectors(name)", { count: "exact" })
      .eq("type", "palm")
      .eq("archived", false)
      .in("status", ["watch", "sick", "dead"])
      .order("status")
      .limit(12),
    sb
      .from("farm_event")
      .select("id, subtype, status, occurred_at, notes")
      .order("occurred_at", { ascending: false })
      .limit(8),
    sb.from("offshoot_movements").select("movement_type, qty").eq("org_id", m.orgId),
    sb
      .from("hawshat")
      .select("id, name, code, palm_count_barhi, palm_count_male")
      .eq("archived", false)
      .order("code"),
    sb
      .from("lines")
      .select("id, line_no, line_code, palm_count, hawshat(name, code)")
      .eq("archived", false)
      .order("line_no"),
    sb
      .from("assets")
      .select("id, hawsha_id, line_id, status, archived")
      .eq("type", "palm")
      .eq("archived", false)
      .in("status", ["active", "watch", "sick", "dead"]),
  ]);
  if (sectorsError) throw sectorsError;
  if (hawshatError) throw hawshatError;
  if (atRiskError) throw atRiskError;
  if (eventsError) throw eventsError;
  if (offshootError) throw offshootError;
  if (reconciliationHawshatError) throw reconciliationHawshatError;
  if (reconciliationLinesError) throw reconciliationLinesError;
  if (reconciliationPalmsError) throw reconciliationPalmsError;

  const tallied = (sectors ?? []).map((s) => {
    const liveHawshat = (
      (s.hawshat ?? []) as {
        palm_count_barhi?: number;
        palm_count_male?: number;
        archived?: boolean;
      }[]
    ).filter((h) => !h.archived);
    const barhi = liveHawshat.reduce((sum, h) => sum + Number(h.palm_count_barhi ?? 0), 0);
    const male = liveHawshat.reduce((sum, h) => sum + Number(h.palm_count_male ?? 0), 0);
    return {
      id: s.id,
      name: s.name,
      code: s.code,
      crop: s.crop ?? "—",
      hawshatCount: liveHawshat.length,
      barhi,
      male,
    };
  });

  const totalHawshat = tallied.reduce((sum, t) => sum + t.hawshatCount, 0);
  const totalBarhi = tallied.reduce((sum, t) => sum + t.barhi, 0);
  const totalMale = tallied.reduce((sum, t) => sum + t.male, 0);

  // Chart data — derived from the sector tally already computed (no new queries).
  const sectorPalmsData = tallied
    .filter((t) => t.barhi + t.male > 0)
    .map((t) => ({ sector: t.name, "برحي": t.barhi, "ذكور": t.male }));
  const palmTypeMix = [
    { name: "برحي", value: totalBarhi },
    { name: "ذكور", value: totalMale },
  ].filter((d) => d.value > 0);
  const offshootProduced = (offshootMovements ?? [])
    .filter((movement) => movement.movement_type === "produce")
    .reduce((sum, movement) => sum + Number(movement.qty ?? 0), 0);
  const offshootUsed = (offshootMovements ?? [])
    .filter((movement) => movement.movement_type === "plant" || movement.movement_type === "replant" || movement.movement_type === "sell")
    .reduce((sum, movement) => sum + Number(movement.qty ?? 0), 0);
  const offshootAvailable = offshootProduced - offshootUsed;
  const palmCountReconciliation = buildPalmCountReconciliation({
    hawshat: reconciliationHawshat ?? [],
    lines: reconciliationLines ?? [],
    palms: reconciliationPalms ?? [],
  });

  const attentionColumns: SimpleColumn[] = [
    { id: "tag", header: "النخلة" },
    { id: "sector", header: "القطاع" },
    { id: "hawsha", header: "الحوشة" },
    { id: "status", header: "الحالة", kind: "status" },
  ];
  const attentionRows = (atRisk ?? []).map((a) => {
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
  const totalAttention = atRiskCount ?? attentionRows.length;

  const eventColumns: SimpleColumn[] = [
    { id: "subtype", header: "العملية" },
    { id: "status", header: "الحالة", kind: "status" },
    { id: "occurred_at", header: "التاريخ" },
    { id: "notes", header: "ملاحظات" },
  ];
  const eventRows = (events ?? []).map((e) => ({
    id: e.id,
    subtype: e.subtype ? SUBTYPE_AR[e.subtype] ?? "عملية" : "عملية",
    status: e.status ? OP_STATUS_AR[e.status] ?? "غير معروف" : "—",
    occurred_at: e.occurred_at ? fmtDate(e.occurred_at) : "—",
    notes: e.notes ?? "—",
  }));

  const sectorColumns: SimpleColumn[] = [
    { id: "name", header: "القطاع" },
    { id: "crop", header: "المحصول" },
    { id: "hawshat", header: "الحوشات", numeric: true },
    { id: "barhi", header: "برحي", numeric: true },
    { id: "male", header: "ذكور", numeric: true },
  ];
  const sectorRows = tallied.map((t) => ({
    id: t.id,
    href: `/farm/sector/${t.id}`,
    name: t.name,
    crop: t.crop,
    hawshat: num(t.hawshatCount),
    barhi: num(t.barhi),
    male: num(t.male),
  }));

  const hawshaColumns: SimpleColumn[] = [
    { id: "name", header: "الحوشة" },
    { id: "sector", header: "القطاع" },
    { id: "barhi", header: "برحي", numeric: true },
    { id: "male", header: "ذكور", numeric: true },
  ];
  const hawshaRows = (hawshat ?? []).map((h) => {
    const sector = (Array.isArray(h.sectors) ? h.sectors[0] : h.sectors) as { name?: string } | null;
    return {
      id: h.id,
      href: `/farm/hawsha/${h.id}`,
      name: h.name ?? h.code ?? h.id,
      sector: sector?.name ?? "—",
      barhi: num(Number(h.palm_count_barhi ?? 0)),
      male: num(Number(h.palm_count_male ?? 0)),
    };
  });
  const reconciliationColumns: SimpleColumn[] = [
    { id: "scope", header: "المستوى" },
    { id: "name", header: "الموقع" },
    { id: "stored", header: "المسجل", numeric: true },
    { id: "actual", header: "الأصول", numeric: true },
    { id: "difference", header: "الفرق", numeric: true },
  ];
  const reconciliationRows = palmCountReconciliation.mismatches.slice(0, 8).map((mismatch) => ({
    id: `${mismatch.scope}-${mismatch.id}`,
    href: mismatch.href,
    scope: mismatch.scope === "hawsha" ? "حوشة" : "خط",
    name: mismatch.parentLabel ? `${mismatch.parentLabel} · ${mismatch.label}` : mismatch.label,
    stored: mismatch.stored == null ? "—" : num(mismatch.stored),
    actual: num(mismatch.actual),
    difference: mismatch.difference > 0 ? `+${num(mismatch.difference)}` : num(mismatch.difference),
  }));
  const hiddenReconciliationCount = palmCountReconciliation.mismatches.length - reconciliationRows.length;

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">لوحة المزرعة</h1>
          <p style={{ color: "var(--ink-muted)" }}>
            مؤشرات الهيكل والنخيل والحوش والعمليات من السجلات الفعلية.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <HeaderLink href="/farm">هيكل المزرعة</HeaderLink>
          {canSeeOffshoots && <HeaderLink href="/farm/offshoots">بنك الفسائل</HeaderLink>}
          <HeaderLink href="/farm/croquis">الكروكي</HeaderLink>
        </div>
      </header>

      {/* First-run guidance: no palms registered yet on this page's own tally
          (totalBarhi, already computed above) — disappears once real data exists. */}
      {totalBarhi === 0 && <OnboardingChecklist role={m.role} />}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        <DashboardKpiLink href="/farm/dashboard?filter=sectors" active={filter === "sectors"}>
          <KpiCard label="القطاعات" value={num((sectors ?? []).length)} />
        </DashboardKpiLink>
        <DashboardKpiLink href="/farm/dashboard?filter=hawshat" active={filter === "hawshat"}>
          <KpiCard label="الحوشات" value={num(totalHawshat)} />
        </DashboardKpiLink>
        <KpiCard label="نخيل برحي" value={num(totalBarhi)} delta={`${num(totalMale)} ذكور`} />
        <DashboardKpiLink href="/farm/dashboard?filter=attention" active={filter === "attention"}>
          <KpiCard
            label="نخيل يحتاج عناية"
            value={num(totalAttention)}
            delta={
              totalAttention > attentionRows.length ? "يعرض الجدول أحدث ١٢" : totalAttention ? "يتطلب متابعة" : "لا توجد حالات"
            }
            deltaDirection={totalAttention ? "down" : "none"}
          />
        </DashboardKpiLink>
        {canSeeOffshoots && (
          <DashboardKpiLink href="/farm/offshoots" active={false}>
            <KpiCard
              label="فسائل متاحة"
              value={num(offshootAvailable)}
              delta={`${num(offshootProduced)} منتج`}
              deltaDirection={offshootAvailable < 0 ? "down" : "none"}
            />
          </DashboardKpiLink>
        )}
      </section>

      {palmCountReconciliation.mismatches.length > 0 && (
        <Card title="مطابقة عداد النخيل">
          <div className="flex flex-col gap-3">
            <Alert
              tone="warning"
              title={`${num(palmCountReconciliation.mismatches.length)} موقع يحتاج مراجعة عداد النخيل`}
              description={`${num(palmCountReconciliation.hawshaMismatches.length)} حوشة · ${num(palmCountReconciliation.lineMismatches.length)} خط`}
            />
            <SimpleTable columns={reconciliationColumns} rows={reconciliationRows} empty="لا توجد فروق" />
            {hiddenReconciliationCount > 0 && (
              <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
                يعرض الجدول أول {num(reconciliationRows.length)} من {num(palmCountReconciliation.mismatches.length)}.
              </p>
            )}
          </div>
        </Card>
      )}

      {(filter === "all" || filter === "sectors") && sectorPalmsData.length > 0 && (
        <section className="grid gap-4 lg:grid-cols-2">
          <Card title="توزيع النخيل حسب القطاع">
            <CategoryBarChart
              data={sectorPalmsData}
              categoryKey="sector"
              series={[
                { dataKey: "برحي", name: "برحي" },
                { dataKey: "ذكور", name: "ذكور" },
              ]}
              ariaLabel="توزيع النخيل حسب القطاع"
              caption="النخيل حسب القطاع"
              columnHeader="القطاع"
            />
          </Card>
          {palmTypeMix.length > 0 && (
            <Card title="تركيبة النخيل">
              <CategoryDoughnut
                data={palmTypeMix}
                ariaLabel="تركيبة النخيل بين برحي وذكور"
                caption="تركيبة النخيل"
                labelHeader="النوع"
                valueHeader="العدد"
              />
            </Card>
          )}
        </section>
      )}

      <CurrentFilterCard
        label={FILTER_LABEL_AR[filter] ?? "فلتر غير معروف"}
        clearHref="/farm/dashboard"
        showClear={filter !== "all"}
      />

      {(filter === "all" || filter === "attention" || filter === "events") && (
        <section className="grid gap-4 md:grid-cols-2">
          {(filter === "all" || filter === "attention") && (
        <Card title="نخيل يحتاج عناية">
          {attentionRows.length === 0 ? (
            <EmptyState title="لا يوجد نخيل يحتاج عناية" />
          ) : (
            <SimpleTable columns={attentionColumns} rows={attentionRows} empty="—" />
          )}
        </Card>
          )}
          {(filter === "all" || filter === "events") && (
        <Card title="آخر العمليات">
          {eventRows.length === 0 ? (
            <EmptyState title="لا توجد عمليات مسجلة" />
          ) : (
            <SimpleTable columns={eventColumns} rows={eventRows} empty="—" />
          )}
        </Card>
          )}
        </section>
      )}

      {(filter === "all" || filter === "sectors") && (
        <Card title="القطاعات">
          <SimpleTable columns={sectorColumns} rows={sectorRows} empty="لا توجد قطاعات" />
        </Card>
      )}

      {(filter === "all" || filter === "hawshat") && (
        <Card title="حوشات للمراجعة">
          <SimpleTable columns={hawshaColumns} rows={hawshaRows} empty="لا توجد حوشات" />
        </Card>
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
