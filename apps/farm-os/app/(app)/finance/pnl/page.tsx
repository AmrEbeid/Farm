import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card, KpiCard } from "@/components/ui";
import { egp } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { operatingProfit, parseOwnerPnlSummary, yearToDatePeriod } from "@/lib/owner-pnl";

/**
 * Owner P&L period summary — additive to the finance dashboard, NOT a rebuild of the full Stage-7
 * accounting framework in PR #368 (branch feat/stage-7-accounting-backend, still an unmerged draft,
 * which adds a `sales` table + a full `/accounting` page). This page:
 *   - is owner/accountant ONLY (never farm_manager — non-negotiable #6 + the intent of the closed,
 *     unmerged #540 privacy fix), enforced BOTH at the app layer (requireRole below) and in the DB
 *     (`fn_owner_pnl_summary`, migration 20260701270000, checks `authorize('finance.read', …)`
 *     itself and rejects any other role with 42501 — not just an app-layer check);
 *   - computes every figure from a real, period-scoped SUM() over `expenses` (no row cap, no
 *     cached/guessed number — the review that scoped this task found the finance dashboard's
 *     headline expense figures were a 12-row sample, not true period totals);
 *   - reports revenue honestly as "no revenue model yet" (there is no `sales` table on `main`)
 *     instead of fabricating a number or assuming revenue = 0;
 *   - shows owner drawings (مسحوبات المالك) in a separate "below the line" section and capex in its
 *     own section — both excluded from the operating-expenses/operating-profit figure (#6).
 */
export default async function OwnerPnlPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const m = await requireRole(["owner", "accountant"]);
  const { from: requestedFrom, to: requestedTo } = await searchParams;
  const defaultPeriod = yearToDatePeriod(new Date());
  const from = requestedFrom || defaultPeriod.from;
  const to = requestedTo || defaultPeriod.to;

  const sb = await createClient();
  const { data, error } = await sb.rpc("fn_owner_pnl_summary", { p_org: m.orgId, p_from: from, p_to: to });
  if (error) throw error;

  const summary = parseOwnerPnlSummary(data);
  // No `sales`/revenue table exists on `main` yet — report that honestly rather than assume 0.
  const revenue: number | null = null;
  const profit = operatingProfit(summary.operatingExpenses, revenue);

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">قائمة الدخل التشغيلية للمالك</h1>
        <p style={{ color: "var(--ink-muted)" }}>
          إيراد − مصروفات تشغيلية = ربح تشغيلي. مسحوبات المالك والرأسمالي منفصلان تمامًا (بند ٦).
        </p>
      </header>

      <Card title="الفترة">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span>من</span>
            <input
              type="date"
              name="from"
              defaultValue={from}
              className="rounded border px-2 py-1"
              style={{ borderColor: "var(--line)" }}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>إلى</span>
            <input
              type="date"
              name="to"
              defaultValue={to}
              className="rounded border px-2 py-1"
              style={{ borderColor: "var(--line)" }}
            />
          </label>
          <button
            type="submit"
            className="rounded px-3 py-1.5 text-sm font-medium"
            style={{ background: "var(--brand,#166534)", color: "white" }}
          >
            تطبيق
          </button>
        </form>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-muted)" }}>
          {fmtDate(from)} → {fmtDate(to)}
        </p>
      </Card>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label="الإيراد" value="لا يوجد نموذج إيرادات بعد" />
        <KpiCard label="المصروفات التشغيلية" value={egp(summary.operatingExpenses)} />
        <KpiCard
          label="الربح التشغيلي"
          value={profit == null ? "غير متاح (لا يوجد نموذج إيرادات)" : egp(profit)}
        />
      </section>

      <Card title="رأسمالي (مستبعد من التشغيلي)">
        <p style={{ color: "var(--ink-muted)" }}>
          مصروفات رأسمالية للفترة، ليست جزءًا من التشغيلي ولا مسحوبات مالك.
        </p>
        <p className="mt-2 text-xl font-semibold">{egp(summary.capex)}</p>
      </Card>

      <Card title="مسحوبات المالك — أسفل الخط (owner/accountant فقط)">
        <p style={{ color: "var(--ink-muted)" }}>
          مسحوبات المالك منفصلة تمامًا عن المصروفات التشغيلية ولا تُحتسب في الربح التشغيلي (بند ٦). هذا
          القسم مقصور على المالك/المحاسب فقط — لا يظهر لمدير المزرعة.
        </p>
        <p className="mt-2 text-xl font-semibold">{egp(summary.ownerDrawings)}</p>
      </Card>
    </div>
  );
}
