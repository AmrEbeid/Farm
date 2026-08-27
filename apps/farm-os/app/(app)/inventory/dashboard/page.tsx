import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { Card, KpiCard } from "@/components/ui";
import { PageHeader } from "@/components/PageHeader";
import { FilterableTable } from "@/components/FilterableTable";
import { type SimpleColumn, type SimpleRow } from "@/components/SimpleTable";
import { DashboardKpiLink } from "@/components/DashboardKpiLink";
import { CurrentFilterCard } from "@/components/CurrentFilterCard";
import { CategoryDoughnut } from "@/components/charts";
import { OnboardingChecklist } from "@/components/OnboardingChecklist";
import { PrintButton } from "@/components/print-button";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";
import { PR_STATUS_AR } from "@/lib/labels";
import { currentInventoryState } from "@/lib/inventory-current-state";
import { StorekeeperHome } from "./storekeeper-home";

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
  const m = await requireMembership();
  // SPEC-0033 R3f: the Storekeeper gets a dedicated home from ONE bounded, storekeeper-only
  // snapshot. Branched BEFORE anything else so the legacy multi-table dashboard below — which fans
  // out over every inventory item and purchase request and renders charts — is never
  // executed for this role. Owner, farm manager, accountant and agri_engineer keep it untouched.
  if (m.role === "storekeeper") return <StorekeeperHome orgId={m.orgId} />;
  const { filter = "all" } = await searchParams;
  const sb = await createClient();

  const [{ data: items, error: itemsError }, { data: prs, error: prsError }] = await Promise.all([
    sb
      .from("inventory_items")
      .select("id, name, category, unit, min_stock, reorder_point, inventory_bin(on_hand, reserved)")
      .order("name"),
    sb
      .from("purchase_requests")
      .select("id, code, status, reason, needed_by")
      .order("code", { ascending: false }),
  ]);
  if (itemsError) throw itemsError;
  if (prsError) throw prsError;

  const itemRows = (items ?? []).map((it) => {
    const bins = (Array.isArray(it.inventory_bin) ? it.inventory_bin : it.inventory_bin ? [it.inventory_bin] : []) as
      Array<{ on_hand?: number | null; reserved?: number | null }>;
    const stock = currentInventoryState(bins, it.reorder_point, it.min_stock);
    // STATIC level check against today's `available` — NOT the engine's forward-looking
    // projection. fn_stock_coverage can return shortage=true for an item that looks fine here
    // (plenty on hand today, demand spike next week), which is why the label below is an honest
    // point-in-time reading of the reorder threshold ("جيد" implied a coverage verdict this check
    // doesn't compute) and every row links to the authoritative per-item coverage page. Batching
    // fn_stock_coverage across this whole list is deferred — a separate, performance-sensitive
    // change (N+1 RPC calls per item), not done here.
    const needsReorder = stock.status === "reorder";
    const stockUnknown = stock.status === "unknown";

    return {
      id: it.id,
      href: `/inventory/${it.id}`,
      name: it.name,
      category: it.category ?? "—",
      status: stockUnknown ? "غير معروف" : needsReorder ? "تحت حد إعادة الطلب" : "فوق حد إعادة الطلب",
      metric: stock.available === null ? "—" : `${num(stock.available)} ${it.unit ?? ""}`.trim(),
      date: "—",
      filterKey: stockUnknown ? "unknown" : needsReorder ? "reorder" : "all",
      sortWeight: needsReorder ? 0 : stockUnknown ? 1 : 3,
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
  const unknownItems = itemRows.filter((row) => row.filterKey === "unknown").length;
  const submittedPrs = prRows.filter((row) => row.filterKey === "submitted").length;
  const partialReceipts = prRows.filter((row) => row.filterKey === "partial").length;
  const activePrs = prRows.filter((row) =>
    row.filterKey === "active-pr" || row.filterKey === "submitted" || row.filterKey === "partial",
  ).length;

  // Chart data — derived from the items / PRs already fetched (no new queries).
  const itemsByStatus = [
    { name: "فوق حد إعادة الطلب", value: itemRows.length - reorderItems - unknownItems },
    { name: "تحت حد إعادة الطلب", value: reorderItems },
    { name: "غير معروف", value: unknownItems },
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
      <PageHeader
        title="لوحة المخزون والمشتريات"
        subtitle="مؤشرات قابلة للتصفية؛ اضغط على البطاقة لتصفية جدول العمل."
        actions={
          <div className="no-print flex flex-wrap gap-2">
            <PrintButton label="طباعة لوحة المخزون" />
            <HeaderLink href="/inventory">الأصناف</HeaderLink>
            <HeaderLink href="/purchase-requests">طلبات الشراء</HeaderLink>
          </div>
        }
      />

      {/* First-run guidance: no inventory items registered yet (already-fetched
          `items`, no new query) — disappears once the org has real stock. */}
      {(items ?? []).length === 0 && (
        <div className="no-print">
          <OnboardingChecklist role={m.role} />
        </div>
      )}

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

      <div className="no-print">
        <CurrentFilterCard
          label={FILTER_LABEL_AR[filter] ?? "فلتر غير معروف"}
          clearHref="/inventory/dashboard"
          showClear={filter !== "all"}
        />
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">جدول العمل</h2>
          <span className="no-print text-sm tabular-nums" style={{ color: "var(--ink-muted)" }}>
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
          exportFilename="inventory-dashboard-work"
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
