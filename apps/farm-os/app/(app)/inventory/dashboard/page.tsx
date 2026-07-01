import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { Card, KpiCard } from "@/components/ui";
import { FilterableTable } from "@/components/FilterableTable";
import { type SimpleColumn, type SimpleRow } from "@/components/SimpleTable";
import { DashboardKpiLink } from "@/components/DashboardKpiLink";
import { CurrentFilterCard } from "@/components/CurrentFilterCard";
import { CategoryDoughnut } from "@/components/charts";
import { OnboardingChecklist } from "@/components/OnboardingChecklist";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";
import { PR_STATUS_AR } from "@/lib/labels";

const FILTER_LABEL_AR: Record<string, string> = {
  all: "كل العناصر",
  reorder: "أصناف تحت حد إعادة الطلب",
  submitted: "طلبات بانتظار الاعتماد",
  partial: "استلامات جزئية",
  "active-pr": "طلبات نشطة",
};

export default async function InventoryDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  await requireMembership();
  const { filter = "all" } = await searchParams;
  const sb = await createClient();

  const [
    { data: items, error: itemsError },
    { data: prs, error: prsError },
    { data: suppliers, error: suppliersError },
  ] = await Promise.all([
    sb
      .from("inventory_items")
      .select("id, name, category, unit, min_stock, reorder_point, inventory_bin(on_hand, reserved)")
      .order("name"),
    sb
      .from("purchase_requests")
      .select("id, code, status, reason, needed_by")
      .order("code", { ascending: false }),
    sb
      .from("suppliers")
      .select("id, name, lead_time_days")
      .order("name"),
  ]);
  if (itemsError) throw itemsError;
  if (prsError) throw prsError;
  if (suppliersError) throw suppliersError;

  const itemRows = (items ?? []).map((it) => {
    const bin = (Array.isArray(it.inventory_bin) ? it.inventory_bin[0] : it.inventory_bin) as
      | { on_hand?: number; reserved?: number }
      | null;
    const onHand = Number(bin?.on_hand ?? 0);
    const reserved = Number(bin?.reserved ?? 0);
    const available = onHand - reserved;
    const threshold = Number(it.reorder_point ?? it.min_stock ?? 0);
    // STATIC level check against today's `available` — NOT the engine's forward-looking
    // projection. fn_stock_coverage can return shortage=true for an item that looks fine here
    // (plenty on hand today, demand spike next week), which is why the label below is an honest
    // point-in-time reading of the reorder threshold ("جيد" implied a coverage verdict this check
    // doesn't compute) and every row links to the authoritative per-item coverage page. Batching
    // fn_stock_coverage across this whole list is deferred — a separate, performance-sensitive
    // change (N+1 RPC calls per item), not done here.
    const needsReorder = threshold > 0 && available < threshold;

    return {
      id: it.id,
      href: `/inventory/${it.id}`,
      name: it.name,
      category: it.category ?? "—",
      status: needsReorder ? "تحت حد إعادة الطلب" : "فوق حد إعادة الطلب",
      metric: `${num(available)} ${it.unit ?? ""}`.trim(),
      date: "—",
      filterKey: needsReorder ? "reorder" : "all",
      sortWeight: needsReorder ? 0 : 3,
      coverageHref: `/inventory/${it.id}/coverage`,
    };
  });

  const prRows = (prs ?? []).map((pr) => {
    const active =
      pr.status === "submitted" ||
      pr.status === "approved" ||
      pr.status === "partially_received";

    return {
      id: pr.id,
      href: `/purchase-requests/${pr.id}`,
      name: pr.code,
      category: pr.reason ?? "—",
      status: PR_STATUS_AR[pr.status] ?? "غير معروف",
      metric: pr.status === "partially_received" ? "استلام جزئي" : "طلب شراء",
      date: pr.needed_by ? fmtDate(pr.needed_by) : "—",
      filterKey:
        pr.status === "submitted"
          ? "submitted"
          : pr.status === "partially_received"
            ? "partial"
            : active
              ? "active-pr"
              : "all",
      sortWeight: pr.status === "submitted" ? 1 : pr.status === "partially_received" ? 2 : active ? 3 : 4,
      // No per-item coverage page for a purchase request row.
      coverageHref: undefined as string | undefined,
    };
  });

  const allRows = [...itemRows, ...prRows].sort((a, b) => a.sortWeight - b.sortWeight);
  const filteredRows =
    filter === "all"
      ? allRows
      : filter === "active-pr"
        ? allRows.filter((row) => ["active-pr", "submitted", "partial"].includes(row.filterKey))
        : allRows.filter((row) => row.filterKey === filter);

  const reorderItems = itemRows.filter((row) => row.filterKey === "reorder").length;
  const submittedPrs = prRows.filter((row) => row.filterKey === "submitted").length;
  const partialReceipts = prRows.filter((row) => row.filterKey === "partial").length;
  const activePrs = prRows.filter((row) =>
    row.filterKey === "active-pr" || row.filterKey === "submitted" || row.filterKey === "partial",
  ).length;

  // Chart data — derived from the items / PRs already fetched (no new queries).
  const itemsByStatus = [
    { name: "فوق حد إعادة الطلب", value: itemRows.length - reorderItems },
    { name: "تحت حد إعادة الطلب", value: reorderItems },
  ].filter((d) => d.value > 0);
  const prsByStatus = Object.entries(
    (prs ?? []).reduce<Record<string, number>>((acc, pr) => {
      const label = PR_STATUS_AR[pr.status] ?? "غير معروف";
      acc[label] = (acc[label] ?? 0) + 1;
      return acc;
    }, {}),
  ).map(([name, value]) => ({ name, value }));

  const columns: SimpleColumn[] = [
    { id: "name", header: "العنصر" },
    { id: "category", header: "التفصيل" },
    { id: "status", header: "الحالة", kind: "status" },
    { id: "metric", header: "المؤشر" },
    { id: "date", header: "التاريخ" },
    { id: "coverage", header: "تغطية المخزون", kind: "link" },
  ];

  const rows: SimpleRow[] = filteredRows.map((row) => ({
    id: row.id,
    href: row.href,
    name: row.name,
    category: row.category,
    status: row.status,
    metric: row.metric,
    date: row.date,
    // Only item rows carry a coverage link — PR rows leave this blank ("—").
    coverage: row.coverageHref ? "عرض تغطية المخزون" : undefined,
    coverage_href: row.coverageHref,
  }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">لوحة المخزون والمشتريات</h1>
          <p style={{ color: "var(--ink-muted)" }}>
            مؤشرات قابلة للتصفية؛ اضغط على البطاقة لتصفية جدول العمل.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <HeaderLink href="/inventory">الأصناف</HeaderLink>
          <HeaderLink href="/purchase-requests">طلبات الشراء</HeaderLink>
        </div>
      </header>

      {/* First-run guidance: no inventory items registered yet (already-fetched
          `items`, no new query) — disappears once the org has real stock. */}
      {(items ?? []).length === 0 && <OnboardingChecklist />}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <DashboardKpiLink href="/inventory/dashboard?filter=reorder" active={filter === "reorder"}>
          <KpiCard
            label="أصناف تحت حد إعادة الطلب"
            value={num(reorderItems)}
            deltaDirection={reorderItems ? "down" : "none"}
          />
        </DashboardKpiLink>
        <DashboardKpiLink href="/inventory/dashboard?filter=submitted" active={filter === "submitted"}>
          <KpiCard
            label="طلبات بانتظار الاعتماد"
            value={num(submittedPrs)}
            deltaDirection={submittedPrs ? "up" : "none"}
          />
        </DashboardKpiLink>
        <DashboardKpiLink href="/inventory/dashboard?filter=partial" active={filter === "partial"}>
          <KpiCard
            label="استلامات جزئية"
            value={num(partialReceipts)}
            deltaDirection={partialReceipts ? "up" : "none"}
          />
        </DashboardKpiLink>
        <DashboardKpiLink href="/inventory/dashboard?filter=active-pr" active={filter === "active-pr"}>
          <KpiCard label="طلبات نشطة" value={num(activePrs)} />
        </DashboardKpiLink>
      </section>

      {itemsByStatus.length > 0 && (
        <section className="grid gap-4 lg:grid-cols-2">
          <Card title="الأصناف حسب حالة المخزون">
            <CategoryDoughnut
              data={itemsByStatus}
              ariaLabel="توزيع الأصناف حسب حالة المخزون"
              caption="الأصناف حسب الحالة"
              labelHeader="الحالة"
              valueHeader="عدد الأصناف"
            />
          </Card>
          {prsByStatus.length > 0 && (
            <Card title="طلبات الشراء حسب الحالة">
              <CategoryDoughnut
                data={prsByStatus}
                ariaLabel="توزيع طلبات الشراء حسب الحالة"
                caption="طلبات الشراء حسب الحالة"
                labelHeader="الحالة"
                valueHeader="عدد الطلبات"
              />
            </Card>
          )}
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card title="ملخص الموردين">
          <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
            {num(suppliers?.length ?? 0)} مورّد مسجّل. تُستخدم مدد التوريد في توصيات التغطية عندما تكون متاحة.
          </p>
          <Link
            href="/suppliers"
            className="mt-3 inline-block font-medium underline underline-offset-4"
            style={{ color: "var(--brand)" }}
          >
            فتح الموردين
          </Link>
        </Card>
        <Card title="نطاق هذه اللوحة">
          <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
            هذه قراءة تشغيلية من المخزون وطلبات الشراء فقط. توقعات النقص التفصيلية تبقى داخل صفحة تغطية كل صنف.
          </p>
        </Card>
        <CurrentFilterCard
          label={FILTER_LABEL_AR[filter] ?? "فلتر غير معروف"}
          clearHref="/inventory/dashboard"
          showClear={filter !== "all"}
        />
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">جدول العمل</h2>
          <span className="text-sm tabular-nums" style={{ color: "var(--ink-muted)" }}>
            {num(rows.length)} عنصر
          </span>
        </div>
        <FilterableTable
          columns={columns}
          rows={rows}
          ariaLabel="جدول العمل"
          empty="لا توجد عناصر لهذا الفلتر"
          searchColumns={["name", "category", "status"]}
          placeholder="ابحث في المخزون والطلبات…"
          minRowsForSearch={1}
        />
      </section>
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
