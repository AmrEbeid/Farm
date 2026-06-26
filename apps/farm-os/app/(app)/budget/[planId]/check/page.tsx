import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { VerdictBanner, KpiCard, Progress, Card, Button } from "@/components/ui";
import { egp, pct } from "@/lib/money";

export default async function BudgetCheckPage({
  params,
  searchParams,
}: {
  params: Promise<{ planId: string }>;
  searchParams: Promise<{ pr?: string }>;
}) {
  const { planId } = await params;
  const { pr } = await searchParams;
  const m = await requireMembership();
  const sb = await createClient();

  // The fertilization category for this plan is أسمدة. Scope to the caller's org so
  // .maybeSingle() stays single-row once a 2nd org exists (otherwise it throws → 500).
  const { data: line, error } = await sb
    .from("budget_lines")
    .select("category, planned, approved, committed, actual")
    .eq("org_id", m.orgId)
    .eq("category", "أسمدة")
    .maybeSingle();
  // Surface DB read failures to the segment error boundary instead of rendering
  // a misleading empty page.
  if (error) throw error;

  const planned = Number(line?.planned ?? 0);
  const approved = Number(line?.approved ?? 0);
  const committed = Number(line?.committed ?? 0);
  const actual = Number(line?.actual ?? 0);
  const available = approved - committed - actual;

  // The pending أسمدة spend for this plan = Σ est_cost of its planned fertilization
  // operations — real plan data, not a fabricated constant (non-negotiable #1). The
  // budget gate must judge the actual cost, never a magic number.
  const { data: ops, error: opsError } = await sb
    .from("plan_operations")
    .select("est_cost")
    .eq("plan_id", planId)
    .eq("subtype", "fertilization")
    .eq("status", "planned");
  if (opsError) throw opsError;
  const thisOp = (ops ?? []).reduce((s, o) => s + Number(o.est_cost ?? 0), 0);

  const after = available - thisOp;
  const utilization = approved > 0 ? Math.round(((committed + actual) / approved) * 100) : 0;

  // Utilization AFTER committing this op. The أسمدة line is already at 94% used
  // (committed 70k + actual 870k of 1,000k); the 42k op pushes it past the 90%
  // comfort threshold, so it routes to owner approval even though it does not
  // technically overspend the approved amount.
  const utilizationAfter =
    approved > 0 ? Math.round(((committed + thisOp + actual) / approved) * 100) : 0;
  const verdict =
    after < 0 ? "block" : utilizationAfter > 90 ? "approval-needed" : "ok";
  const needsOwner = verdict === "block" || verdict === "approval-needed";
  const verdictText =
    verdict === "block"
      ? `⛔ تجاوز للموازنة: المتاح ${egp(available)} لا يغطي ${egp(thisOp)} — يتطلب اعتماد المالك.`
      : verdict === "approval-needed"
        ? `⚠️ الموازنة منخفضة (${utilizationAfter}٪ بعد هذه العملية) — يتطلب اعتماد المالك.`
        : `✓ الموازنة كافية: سيتبقى ${egp(after)}.`;

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">فحص الموازنة — بند الأسمدة</h1>
        <p style={{ color: "var(--ink-muted)" }}>سنة 2025</p>
      </header>

      <VerdictBanner tone={verdict === "block" ? "danger" : verdict === "approval-needed" ? "warning" : "ok"}>
        {verdictText}
      </VerdictBanner>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="المعتمد" value={egp(approved)} />
        <KpiCard label="المنصرف الفعلي" value={egp(actual)} />
        <KpiCard label="المرتبط (ملتزم)" value={egp(committed)} />
        <KpiCard
          label="المتاح"
          value={egp(available)}
          delta={`هذه العملية ${egp(thisOp)}`}
          deltaDirection="down"
        />
      </section>

      <Card title="نسبة استخدام الموازنة">
        <Progress
          value={utilization}
          tone={utilization > 90 ? "danger" : utilization > 75 ? "warning" : "default"}
          label="استخدام بند الأسمدة"
        />
        <p className="mt-2 text-sm" style={{ color: "var(--ink-muted)" }}>
          {pct(utilization)} من المعتمد ({egp(approved)}) مستخدم. المخطط {egp(planned)}.
        </p>
      </Card>

      {needsOwner && pr && (
        <Card title="التوجيه">
          <p className="mb-3">
            تتجاوز هذه العملية حدود بند الأسمدة، لذا يجب توجيه طلب الشراء إلى المالك للاعتماد
            (فصل الواجبات: لا يعتمد مقدّم الطلب طلبه).
          </p>
          <Link href={`/purchase-requests/${pr}`}>
            <Button variant="primary">الذهاب إلى طلب الشراء للاعتماد</Button>
          </Link>
        </Card>
      )}
    </div>
  );
}
