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
  await params;
  const { pr } = await searchParams;
  await requireMembership();
  const sb = await createClient();

  // The fertilization category for this plan is أسمدة.
  const { data: line } = await sb
    .from("budget_lines")
    .select("category, planned, approved, committed, actual")
    .eq("category", "أسمدة")
    .maybeSingle();

  const planned = Number(line?.planned ?? 0);
  const approved = Number(line?.approved ?? 0);
  const committed = Number(line?.committed ?? 0);
  const actual = Number(line?.actual ?? 0);
  const available = approved - committed - actual;
  const thisOp = 42000; // the planned fertilization op cost
  const after = available - thisOp;
  const utilization = approved > 0 ? Math.round(((committed + actual) / approved) * 100) : 0;

  const verdict =
    after < 0 ? "block" : after < available * 0.2 ? "warn" : "ok";
  const verdictText =
    verdict === "block"
      ? `⛔ تجاوز للموازنة: المتاح ${egp(available)} لا يغطي ${egp(thisOp)} — يتطلب اعتماد المالك.`
      : verdict === "warn"
        ? `⚠️ الموازنة منخفضة: سيتبقى ${egp(after)} بعد هذه العملية.`
        : `✓ الموازنة كافية: سيتبقى ${egp(after)}.`;

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">فحص الموازنة — بند الأسمدة</h1>
        <p style={{ color: "var(--ink-muted)" }}>سنة 2025</p>
      </header>

      <VerdictBanner tone={verdict === "block" ? "danger" : verdict === "warn" ? "warning" : "ok"}>
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

      {verdict === "block" && pr && (
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
