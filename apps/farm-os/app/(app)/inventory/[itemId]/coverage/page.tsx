import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { VerdictBanner, KpiCard, Card } from "@/components/ui";
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
  first_warning_period: number | null;
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
    (typeof c.first_warning_period === "number" ||
      c.first_warning_period === null) &&
    typeof c.shortage === "boolean" &&
    typeof c.shortfall === "number" &&
    typeof c.recommend_qty === "number" &&
    (typeof c.order_by === "string" || c.order_by === null) &&
    typeof c.message_ar === "string"
  );
}

// Three verdict states, driven by ALL THREE engine signals — not `shortage` alone:
//   ok      = never breaches safety stock in the horizon (no warning, no shortage).
//   warning = stays above zero (never a hard shortage) but dips below safety stock at
//             some future period, OR the engine recommends an early replenishment
//             (recommend_qty > 0) even though shortage never fires. A green pill/banner
//             here would hide a real, actionable early-warning from the engine.
//   danger  = a real projected shortage (first_shortage_period is set).
// Precedence: danger > warning > ok.
type CoverageState = "ok" | "warning" | "danger";

function coverageState(c: Coverage): CoverageState {
  if (c.shortage) return "danger";
  if (c.first_warning_period != null || c.recommend_qty > 0) return "warning";
  return "ok";
}

const STATE_PILL: Record<CoverageState, { status: "blocked" | "warning" | "active"; label: string }> = {
  danger: { status: "blocked", label: "نقص" },
  warning: { status: "warning", label: "تحذير مبكر" },
  ok: { status: "active", label: "مغطّى" },
};

const STATE_TONE: Record<CoverageState, "ok" | "warning" | "danger"> = {
  danger: "danger",
  warning: "warning",
  ok: "ok",
};

// Build the human message CLIENT-SIDE from the structured numeric fields instead of trusting
// the RPC's `message_ar` string: that string hardcodes "كجم" and "الأسبوع القادم" regardless of
// the item's real unit or the real first_shortage_period/first_warning_period number (a SQL
// copy/display bug). Rendering it verbatim also puts a "⚠️ نقص متوقع…" sentence inside a green
// "ok" box whenever shortage=false but recommend_qty>0. Re-deriving the wording here fixes both
// without touching the engine SQL (presentation-layer only, per the review).
function buildVerdictMessage(c: Coverage, unit: string): string {
  const state = coverageState(c);
  if (state === "danger") {
    const periodPhrase =
      c.first_shortage_period != null ? `الأسبوع رقم ${num(c.first_shortage_period)}` : "الفترة القادمة";
    return (
      `⛔ نقص متوقع خلال ${periodPhrase} بعجز ${num(c.shortfall)} ${unit}. ` +
      `اطلب ${num(c.recommend_qty)} ${unit}${c.order_by ? ` بحد أقصى ${fmtDate(c.order_by)}` : " الآن"}.`
    );
  }
  if (state === "warning") {
    const periodPhrase =
      c.first_warning_period != null ? `الأسبوع رقم ${num(c.first_warning_period)}` : "الفترة القادمة";
    return (
      `⚠️ المخزون لن ينفد، لكنه سيهبط دون حد الأمان خلال ${periodPhrase}. ` +
      `يُنصح بطلب ${num(c.recommend_qty)} ${unit} مبكرًا لتفادي النقص.`
    );
  }
  return "✅ المخزون كافٍ. لا حاجة للطلب الآن.";
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
  const state = coverageState(c);
  const pill = STATE_PILL[state];

  return (
    <div className="flex flex-col gap-6 p-6">
      <Entity360Header
        title={`تغطية المخزون — ${item?.name ?? "صنف"}`}
        subtitle="محرّك التغطية (fn_stock_coverage)"
        pills={[{ status: pill.status, label: pill.label }]}
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

      <VerdictBanner tone={STATE_TONE[state]}>{buildVerdictMessage(c, unit)}</VerdictBanner>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="المتاح" value={num(c.available)} unit={unit} />
        <KpiCard
          label="أيام التغطية"
          value={coverageDays(c.coverage_days)}
          delta={`المهلة ${num(c.lead_time_days)} يوم`}
          deltaDirection={state === "ok" ? "none" : "down"}
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
        <PabChart
          series={c.pab}
          firstShortage={c.first_shortage_period}
          firstWarning={c.first_warning_period}
          unit={unit}
        />
        {c.stockout_date && (
          <p className="mt-2 text-sm" style={{ color: "var(--ink-muted)" }}>
            تاريخ نفاد المخزون المتوقع: {fmtDate(c.stockout_date)}
          </p>
        )}
      </Card>

      {/* Show whenever the engine recommends a purchase (recommend_qty > 0), not only on a hard
          shortage — a warning-only recommendation (shortage=false, recommend_qty>0) still needs
          an action affordance, or it's a green dead-end with nothing to act on. */}
      {c.recommend_qty > 0 && (
        <Card title="الإجراء الموصى به">
          <p className="mb-3">
            {state === "danger"
              ? `نقص قدره ${num(c.shortfall)} ${unit}. `
              : "تنبيه مبكر قبل بلوغ حد الأمان: "}
            ننصح بطلب {num(c.recommend_qty)} {unit} {state === "danger" ? "اليوم" : "قريبًا"}
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
