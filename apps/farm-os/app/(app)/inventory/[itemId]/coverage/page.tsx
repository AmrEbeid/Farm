import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { Breadcrumbs, VerdictBanner, KpiCard, Card } from "@/components/ui";
import { Entity360Header } from "@/components/Entity360Header";
import { PabChart } from "@/components/charts";
import { CreatePrButton } from "@/components/CreatePrButton";
import { num, coverageDays } from "@/lib/money";
import { fmtDate } from "@/lib/dates";

interface Coverage {
  item_id: string;
  available: number;
  safety_stock: number;
  lead_time_days: number;
  reorder_point: number;
  coverage_days: number | "∞" | null;
  stockout_date: string | null;
  pab: number[];
  first_shortage_period: number | null;
  shortage: boolean;
  shortfall: number;
  recommend_qty: number;
  order_by: string | null;
  message_ar: string;
}

// Runtime guard for the fn_stock_coverage RPC result (defined in migration 0018).
// supabase-js types this RPC's payload as `unknown`/`Json`, so without a check a
// drift in the SQL shape would render undefined/NaN silently. We validate only the
// fields the page actually reads; on mismatch we throw and let the segment error
// boundary (app/(app)/error.tsx) surface it instead of rendering a broken page.
function isCoverage(value: unknown): value is Coverage {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.available === "number" &&
    typeof c.safety_stock === "number" &&
    typeof c.lead_time_days === "number" &&
    typeof c.reorder_point === "number" &&
    (typeof c.coverage_days === "number" ||
      c.coverage_days === "∞" ||
      c.coverage_days === null) &&
    (typeof c.stockout_date === "string" || c.stockout_date === null) &&
    Array.isArray(c.pab) &&
    c.pab.every((n) => typeof n === "number") &&
    (typeof c.first_shortage_period === "number" ||
      c.first_shortage_period === null) &&
    typeof c.shortage === "boolean" &&
    typeof c.shortfall === "number" &&
    typeof c.recommend_qty === "number" &&
    (typeof c.order_by === "string" || c.order_by === null) &&
    typeof c.message_ar === "string"
  );
}

export default async function CoveragePage({
  params,
}: {
  params: Promise<{ itemId: string }>;
}) {
  const { itemId } = await params;
  const m = await requireMembership();
  // Only inventory.write roles can create the PR/reserve (the action 42501s otherwise) — don't
  // show the button to accountant/supervisor/agri_engineer as a dead-end affordance.
  const canReserve = ["owner", "farm_manager", "storekeeper"].includes(m.role);
  const sb = await createClient();

  const { data: item, error: itemError } = await sb
    .from("inventory_items")
    .select("name, unit")
    .eq("id", itemId)
    .maybeSingle();
  // Surface DB read failures to the segment error boundary instead of rendering
  // a misleading empty page. (The RPC below already handles its own error.)
  if (itemError) throw itemError;

  const { data, error } = await sb.rpc("fn_stock_coverage", {
    p_item: itemId,
    p_location: "main",
    p_horizon_weeks: 8,
  });

  if (error || !data) {
    // Never leak a raw English Postgres/PostgREST message to the Arabic UI (non-negotiable #2).
    // The detail is logged server-side; the user sees a static Arabic message.
    if (error) console.error("fn_stock_coverage failed:", error);
    return (
      <div className="p-6">
        <VerdictBanner tone="warning">تعذّر حساب التغطية. حاول مرة أخرى.</VerdictBanner>
      </div>
    );
  }

  // Validate the RPC shape at runtime instead of force-casting it; a drift in
  // fn_stock_coverage's output now fails loudly to the error boundary.
  if (!isCoverage(data)) {
    throw new Error("fn_stock_coverage returned an unexpected shape");
  }
  const c: Coverage = data;
  const unit = item?.unit ?? "كجم";

  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumbs
        ariaLabel="المسار"
        items={[
          { id: "inventory", label: "الأصناف", href: "/inventory" },
          { id: "item", label: item?.name ?? "صنف", href: `/inventory/${itemId}` },
          { id: "coverage", label: "تغطية المخزون" },
        ]}
      />

      <Entity360Header
        title={`تغطية المخزون — ${item?.name ?? "صنف"}`}
        subtitle="محرّك التغطية (fn_stock_coverage)"
        pills={[c.shortage ? { status: "blocked", label: "نقص" } : { status: "active", label: "مغطّى" }]}
        actions={
          <Link
            href={`/inventory/${itemId}`}
            className="inline-flex min-h-9 items-center justify-center rounded-md px-3 text-sm font-semibold"
            style={{ color: "var(--brand)", background: "var(--surface)", border: "1px solid var(--line)" }}
          >
            ملف الصنف
          </Link>
        }
      />

      <VerdictBanner tone={c.shortage ? "danger" : "ok"}>{c.message_ar}</VerdictBanner>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="المتاح" value={num(c.available)} unit={unit} />
        <KpiCard
          label="أيام التغطية"
          value={coverageDays(c.coverage_days)}
          delta={`المهلة ${num(c.lead_time_days)} يوم`}
          deltaDirection={c.shortage ? "down" : "none"}
        />
        <KpiCard label="نقطة إعادة الطلب" value={num(c.reorder_point)} unit={unit} />
        <KpiCard
          label="الكمية الموصى بها"
          value={num(c.recommend_qty)}
          unit={unit}
          deltaDirection={c.recommend_qty > 0 ? "up" : "none"}
        />
      </section>

      <Card title="الرصيد المتوقع عبر الأسابيع">
        <PabChart series={c.pab} firstShortage={c.first_shortage_period} />
        {c.stockout_date && (
          <p className="mt-2 text-sm" style={{ color: "var(--ink-muted)" }}>
            تاريخ نفاد المخزون المتوقع: {fmtDate(c.stockout_date)}
          </p>
        )}
      </Card>

      {c.shortage && (
        <Card title="الإجراء الموصى به">
          <p className="mb-3">
            نقص قدره {num(c.shortfall)} {unit}. ننصح بطلب {num(c.recommend_qty)} {unit} اليوم
            {c.order_by ? ` (آخر موعد للطلب: ${fmtDate(c.order_by)})` : ""}.
          </p>
          {canReserve && (
            <CreatePrButton
              itemId={itemId}
              recommendQty={c.recommend_qty}
              reserveQty={c.recommend_qty}
            />
          )}
        </Card>
      )}
    </div>
  );
}
