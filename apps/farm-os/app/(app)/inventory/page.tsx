import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ImportPanel } from "@/components/import/ImportPanel";
import { requireMembership } from "@/lib/auth";
import { num, egp } from "@/lib/money";
import { EmptyState, KpiCard } from "@/components/ui";
import { type SimpleColumn } from "@/components/SimpleTable";
import { FilterableTable } from "@/components/FilterableTable";
import { DashboardKpiLink } from "@/components/DashboardKpiLink";

type ItemFilter = "all" | "reorder" | "uncosted";

function parseItemFilter(raw: string | undefined): ItemFilter {
  return raw === "reorder" || raw === "uncosted" ? raw : "all";
}

export default async function InventoryListPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  await requireMembership();
  const sb = await createClient();
  const filter = parseItemFilter((await searchParams).filter);

  const { data: items, error } = await sb
    .from("inventory_items")
    .select("id, name, category, unit, unit_cost, min_stock, reorder_point, inventory_bin(on_hand, reserved)")
    .order("name");
  // Surface DB read failures to the segment error boundary instead of rendering
  // a misleading empty page.
  if (error) throw error;

  const enriched = (items ?? []).map((it) => {
    const bin = (Array.isArray(it.inventory_bin) ? it.inventory_bin[0] : it.inventory_bin) as
      | { on_hand?: number; reserved?: number }
      | null;
    const onHand = Number(bin?.on_hand ?? 0);
    const reserved = Number(bin?.reserved ?? 0);
    const available = onHand - reserved;
    const threshold = Number(it.reorder_point ?? it.min_stock ?? 0);
    // This is a STATIC level check against today's `available` — NOT the engine's forward-looking
    // projection (fn_stock_coverage can flag shortage=true for plenty-today-but-spikes-next-week
    // items that this check would call "above reorder point"). Label it honestly as a point-in-time
    // reading of the reorder threshold, never as a coverage verdict, and always offer a link to the
    // authoritative per-item coverage page below. Deferred follow-up: batching fn_stock_coverage
    // across the whole list is a separate, performance-sensitive change (N+1 RPC calls) — not done here.
    const needsReorder = threshold > 0 && available < threshold;
    const uncosted = it.unit_cost == null;
    // Honest valuation (#89-B posture): only costed items contribute; a NULL unit_cost contributes
    // NOTHING (never a fake 0 that silently understates) — the «بلا تكلفة» chip carries the gap instead.
    const value = uncosted ? null : onHand * Number(it.unit_cost);
    // Point-in-time coverage bar (Stitch): available as a % of the reorder threshold,
    // capped at 100. Honest framing matches `needsReorder` above — NOT the forward-looking
    // engine verdict (the per-item coverage link stays for that). No threshold ⇒ full/ok.
    const covPct = threshold > 0 ? Math.max(0, Math.min(100, Math.round((available / threshold) * 100))) : 100;
    const covTone = threshold <= 0 ? "ok" : available < threshold ? "danger" : available < threshold * 1.5 ? "warn" : "ok";
    return { it, onHand, reserved, available, needsReorder, uncosted, value, covPct, covTone };
  });

  const kpiValue = enriched.reduce((sum, e) => sum + (e.value ?? 0), 0);
  const kpis: { key: ItemFilter; label: string; value: number; danger?: boolean }[] = [
    { key: "all", label: "كل الأصناف", value: enriched.length },
    {
      key: "reorder",
      label: "تحت حد إعادة الطلب (لحظي)",
      value: enriched.filter((e) => e.needsReorder).length,
      danger: true,
    },
    { key: "uncosted", label: "بلا تكلفة معروفة", value: enriched.filter((e) => e.uncosted).length },
  ];

  const columns: SimpleColumn[] = [
    { id: "name", header: "الصنف" },
    { id: "category", header: "الفئة" },
    { id: "on_hand", header: "الموجود", numeric: true },
    { id: "reserved", header: "المحجوز", numeric: true },
    { id: "available", header: "المتاح", numeric: true },
    { id: "coverage_bar", header: "التغطية", kind: "bar" },
    { id: "value", header: "القيمة (تقديرية)", numeric: true },
    { id: "flag", header: "حد إعادة الطلب", kind: "status" },
    { id: "coverage", header: "تغطية المخزون", kind: "link" },
  ];

  const rows = enriched
    .filter((e) => (filter === "reorder" ? e.needsReorder : filter === "uncosted" ? e.uncosted : true))
    .map(({ it, onHand, reserved, available, needsReorder, value, covPct, covTone }) => ({
      id: it.id,
      href: `/inventory/${it.id}`,
      name: it.name,
      category: it.category ?? "—",
      on_hand: `${num(onHand)} ${it.unit ?? ""}`,
      reserved: `${num(reserved)} ${it.unit ?? ""}`,
      available: `${num(available)} ${it.unit ?? ""}`,
      coverage_bar: covPct,
      coverage_bar_tone: covTone,
      value: value == null ? "—" : egp(value),
      flag: needsReorder ? "تحت حد إعادة الطلب" : "فوق حد إعادة الطلب",
      coverage: "عرض تغطية المخزون",
      coverage_href: `/inventory/${it.id}/coverage`,
    }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">المخزون</h1>
            <p style={{ color: "var(--ink-muted)" }}>دليل الأصناف؛ ابدأ من لوحة المخزون للمخاطر وطلبات الشراء.</p>
          </div>
          <Link
            href="/inventory/dashboard"
            className="inline-flex min-h-9 items-center justify-center rounded-md px-3 text-sm font-semibold"
            style={{
              color: "var(--brand)",
              background: "var(--surface)",
              border: "1px solid var(--line)",
            }}
          >
            لوحة المخزون
          </Link>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((chip) => (
          <DashboardKpiLink
            key={chip.key}
            href={chip.key === "all" ? "/inventory" : `/inventory?filter=${chip.key}`}
            active={filter === chip.key}
          >
            <KpiCard
              label={chip.label}
              value={num(chip.value)}
              deltaDirection={chip.danger && chip.value > 0 ? "down" : "none"}
            />
          </DashboardKpiLink>
        ))}
        {/* Display-only: valuation at the manual standard cost (#89-B), costed items only. */}
        <KpiCard label="قيمة المخزون (تقديرية، بسعر قياسي)" value={egp(kpiValue)} deltaDirection="none" />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={filter === "all" ? "لا توجد أصناف" : "لا توجد أصناف مطابقة لهذا الفلتر"}
          description={
            filter === "all" ? "تُدار الأصناف حاليًا من قِبل الإدارة." : "جرّب فلترًا آخر أو ارجع إلى كل الأصناف."
          }
        />
      ) : (
        <FilterableTable
          ariaLabel="المخزون"
          columns={columns}
          rows={rows}
          empty="لا توجد أصناف"
          searchColumns={["name", "category"]}
          placeholder="ابحث عن صنف…"
          exportFilename="inventory"
        />
      )}

      {/* SPEC-0024 S-9 (D.1): template download + Excel/CSV import for this entry.  */}
      <ImportPanel descriptorKey="inventory-items" titleAr="أصناف المخزون" />
    </div>
  );
}
