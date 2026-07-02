import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { EmptyState, KpiCard } from "@/components/ui";
import { type SimpleColumn } from "@/components/SimpleTable";
import { FilterableTable } from "@/components/FilterableTable";
import { DashboardKpiLink } from "@/components/DashboardKpiLink";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";
import { PR_STATUS_AR } from "@/lib/labels";
import { classifyPr, matchesFilter, parsePrConsoleFilter } from "@/lib/pr-console";

/**
 * Open-orders console (INVENTORY-360 gap #8): KPI strip + URL-param filter
 * chips over the purchase-request directory. The «لا يُحسب في التغطية» badge
 * mirrors the coverage engine's own supply rule (see lib/pr-console.ts) so a
 * stale PO is finally visible somewhere — previously it silently stopped
 * counting with no signal on any page.
 */
export default async function PurchaseRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  await requireMembership();
  const sb = await createClient();
  const filter = parsePrConsoleFilter((await searchParams).filter);

  const { data: prs, error } = await sb
    .from("purchase_requests")
    .select(
      "id, code, status, reason, needed_by, purchase_request_items(qty, received_qty, inventory_items(name))",
    )
    .order("code", { ascending: false });
  // Surface DB read failures to the segment error boundary instead of rendering
  // a misleading empty page.
  if (error) throw error;

  // UTC calendar date, deliberately: the engine's `current_date` runs in the
  // DB's UTC clock, and the whole point of the stale badge is to agree with
  // the engine — not with the browser's timezone.
  const today = new Date().toISOString().slice(0, 10);
  const classified = (prs ?? []).map((p) => {
    const items = p.purchase_request_items ?? [];
    return {
      pr: p,
      items,
      c: classifyPr({ status: p.status, needed_by: p.needed_by, items }, today),
    };
  });

  const kpis = {
    open: classified.filter(({ c }) => c.isOpen).length,
    submitted: classified.filter(({ c }) => c.isAwaitingApproval).length,
    openOrders: classified.filter(({ c }) => c.isOpenOrder).length,
    overdue: classified.filter(({ c }) => c.isOverdue).length,
    stale: classified.filter(({ c }) => c.isStaleForCoverage).length,
  };

  const columns: SimpleColumn[] = [
    { id: "code", header: "الرمز", kind: "code" },
    { id: "items", header: "الأصناف" },
    { id: "remaining", header: "الكمية المتبقية" },
    { id: "needed_by", header: "مطلوب بحلول" },
    { id: "alert", header: "تنبيه", kind: "tag-warn" },
    { id: "status", header: "الحالة", kind: "status" },
  ];

  const rows = classified
    .filter(({ c }) => matchesFilter(c, filter))
    .map(({ pr, items, c }) => ({
      id: pr.id,
      href: `/purchase-requests/${pr.id}`,
      code: pr.code,
      items:
        items
          .map((it) => it.inventory_items?.name)
          .filter(Boolean)
          .join("، ") || "—",
      remaining: num(c.remainingQty),
      needed_by: pr.needed_by ? fmtDate(pr.needed_by) : "—",
      alert: c.isStaleForCoverage ? "لا يُحسب في التغطية" : c.isOverdue ? "متأخر" : "",
      status: PR_STATUS_AR[pr.status] ?? "غير معروف",
    }));

  const chips: { key: ReturnType<typeof parsePrConsoleFilter>; label: string; value: number }[] = [
    { key: "all", label: "كل الطلبات المفتوحة", value: kpis.open },
    { key: "submitted", label: "بانتظار الاعتماد", value: kpis.submitted },
    { key: "open", label: "أوامر شراء جارية", value: kpis.openOrders },
    { key: "overdue", label: "متأخرة عن موعدها", value: kpis.overdue },
    { key: "stale", label: "لا تُحسب في التغطية", value: kpis.stale },
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold">طلبات الشراء</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {chips.map((chip) => (
          <DashboardKpiLink
            key={chip.key}
            href={chip.key === "all" ? "/purchase-requests" : `/purchase-requests?filter=${chip.key}`}
            active={filter === chip.key}
          >
            <KpiCard
              label={chip.label}
              value={num(chip.value)}
              deltaDirection={
                (chip.key === "overdue" || chip.key === "stale") && chip.value > 0 ? "down" : "none"
              }
            />
          </DashboardKpiLink>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={filter === "all" ? "لا توجد طلبات شراء" : "لا توجد طلبات مطابقة لهذا الفلتر"}
          description={
            filter === "all"
              ? "تُنشأ الطلبات تلقائيًا من شاشة تغطية المخزون عند وجود نقص."
              : "جرّب فلترًا آخر أو ارجع إلى كل الطلبات."
          }
        />
      ) : (
        <FilterableTable
          ariaLabel="طلبات الشراء"
          columns={columns}
          rows={rows}
          searchColumns={["code", "items", "status", "alert"]}
          placeholder="ابحث عن طلب أو صنف…"
          exportFilename="purchase-requests"
        />
      )}
    </div>
  );
}
