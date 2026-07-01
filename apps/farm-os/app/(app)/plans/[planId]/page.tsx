import Link from "next/link";
import type { ReactNode } from "react";
import type { PillStatus, TabItem } from "@amrebeid/ui";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { Alert, Breadcrumbs, Card, KpiCard, LoopStepper, type LoopStep } from "@/components/ui";
import { tabId, tabPanelId } from "@/lib/tab-ids";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { Entity360Header } from "@/components/Entity360Header";
import { EntityTabs } from "@/components/EntityTabs";
import { OperationBuilder } from "@/components/OperationBuilder";
import { PlanChecksRunner } from "@/components/PlanChecksRunner";
import { POTASSIUM_ID } from "@/lib/nav";
import { egpSummary, egpValue, num, sumMoney } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { OP_STATUS_AR, PLAN_STATUS_AR, SUBTYPE_AR, isExecutableOpStatus } from "@/lib/labels";

const PLAN_TYPE_AR: Record<string, string> = {
  weekly: "الأسبوعية",
  monthly: "الشهرية",
  quarterly: "الربع سنوية",
  annual: "السنوية",
};

const CHECK_AR: Record<string, string> = {
  stock: "المخزون",
  budget: "الموازنة",
  weather: "الطقس",
  labor: "العمالة",
  responsibility: "المسؤولية",
};

// Plan status → semantic 360 pill. Real statuses live in PLAN_STATUS_AR
// (draft/active/closed/abandoned); the legacy planned/scheduled/done/blocked
// values are mapped too so the pill never falls through to a wrong colour.
const PLAN_STATUS_PILL: Record<string, PillStatus> = {
  draft: "draft",
  active: "active",
  approved: "active",
  planned: "scheduled",
  scheduled: "scheduled",
  closed: "done",
  done: "done",
  abandoned: "blocked",
  blocked: "blocked",
};

const TAB_IDS = ["overview", "operations", "checks"] as const;
type PlanTab = (typeof TAB_IDS)[number];

export default async function MonthlyPlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ planId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { planId } = await params;
  const { tab: rawTab } = await searchParams;
  const tab: PlanTab = (TAB_IDS as readonly string[]).includes(rawTab ?? "")
    ? (rawTab as PlanTab)
    : "overview";
  const m = await requireMembership();
  // Only plan.write roles can add operations / run plan checks (the actions 42501 otherwise) —
  // don't show the edit controls to the other roles as dead-end affordances.
  const canEditPlan = ["owner", "farm_manager"].includes(m.role);
  const sb = await createClient();

  // These four reads are independent, so issue them in parallel.
  const [
    { data: plan, error: planError },
    { data: ops, error: opsError },
    { data: checks, error: checksError },
    { data: items, error: itemsError },
    { data: people, error: peopleError },
  ] = await Promise.all([
    sb
      .from("plans")
      .select("id, type, period_start, period_end, scope_type, status")
      .eq("id", planId)
      .maybeSingle(),
    sb
      .from("plan_operations")
      .select("id, subtype, planned_at, est_cost, status, approval_needed")
      .eq("plan_id", planId)
      .order("planned_at"),
    sb
      .from("plan_checks")
      .select("kind, result, detail")
      .eq("plan_id", planId),
    sb.from("inventory_items").select("id, name, unit").order("name"),
    // Active employees for the operation-assignee picker (#398). Org-scoped by RLS; names only.
    sb.from("people").select("id, name").eq("active", true).order("name"),
  ]);
  // Surface DB read failures to the segment error boundary instead of rendering
  // a misleading empty page.
  if (planError) throw planError;
  if (opsError) throw opsError;
  if (checksError) throw checksError;
  if (itemsError) throw itemsError;
  if (peopleError) throw peopleError;

  // .maybeSingle() returns null (no error) for a bogus or RLS-hidden id — show a
  // not-found message instead of rendering a blank "الخطة " header (mirrors farm/sector).
  if (!plan) {
    return <div className="p-6">الخطة غير موجودة.</div>;
  }

  const opColumns: SimpleColumn[] = [
    { id: "subtype", header: "العملية" },
    { id: "planned_at", header: "التاريخ" },
    { id: "cost", header: "التكلفة", numeric: true },
    { id: "approval", header: "موافقة؟" },
    { id: "status", header: "الحالة", kind: "status" },
  ];
  const opRows = (ops ?? []).map((o) => ({
    id: o.id,
    subtype: SUBTYPE_AR[o.subtype ?? ""] ?? "عملية",
    planned_at: fmtDate(o.planned_at),
    cost: egpValue(o.est_cost),
    approval: o.approval_needed ? "نعم" : "لا",
    status: OP_STATUS_AR[o.status ?? "planned"] ?? "غير معروف",
  }));

  const stockCheck = (checks ?? []).find((c) => c.kind === "stock");
  const budgetCheck = (checks ?? []).find((c) => c.kind === "budget");
  const checksRun = (checks ?? []).length > 0;
  const stockBlocked = stockCheck?.result === "block";
  const budgetBlocked = budgetCheck?.result === "block";
  const blocked = (checks ?? []).some((c) => c.result === "block");
  const blockedChecks = (checks ?? []).filter((c) => c.result === "block").length;
  const totalEstCost = sumMoney((ops ?? []).map((op) => op.est_cost));

  // An operation is "due/overdue" when it is still executable (not done/blocked/
  // abandoned/skipped) and its planned date is today or in the past — those need
  // attention. Data is already in `ops`; this is presentation-only derivation.
  const todayStr = new Date().toISOString().slice(0, 10);
  const dueOps = (ops ?? []).filter(
    (o) =>
      isExecutableOpStatus(o.status) &&
      o.planned_at != null &&
      String(o.planned_at).slice(0, 10) <= todayStr,
  );
  const needsAttention = blockedChecks > 0 || dueOps.length > 0;

  const planStatus = plan.status ?? "draft";
  const pillStatus: PillStatus = PLAN_STATUS_PILL[planStatus] ?? "draft";
  const pillLabel = PLAN_STATUS_AR[planStatus] ?? "غير معروف";

  const steps: LoopStep[] = [
    { id: "plan", label: "الخطة", state: "active" },
    // not-yet-run checks are pending, not "done" — the empty list must not read as a pass.
    { id: "check", label: "الفحوصات", state: !checksRun ? "pending" : blocked ? "blocked" : "done" },
    { id: "coverage", label: "تغطية المخزون", state: stockCheck?.result === "block" ? "active" : "pending" },
    { id: "pr", label: "طلب الشراء", state: "pending" },
    { id: "approve", label: "الاعتماد", state: "pending" },
    { id: "execute", label: "التنفيذ", state: "pending" },
    { id: "report", label: "المخطط مقابل الفعلي", state: "pending" },
  ];

  const tabItems: TabItem[] = [
    { id: "overview", label: "نظرة عامة" },
    { id: "operations", label: `العمليات (${num(opRows.length)})` },
    { id: "checks", label: `الفحوص (${num((checks ?? []).length)})` },
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumbs
        ariaLabel="المسار"
        items={[
          { id: "plans", label: "كل الخطط", href: "/plans" },
          {
            id: "plan",
            label: `الخطة ${PLAN_TYPE_AR[plan.type ?? ""] ?? ""} · ${fmtDate(plan.period_start)} إلى ${fmtDate(plan.period_end)}`,
          },
        ]}
      />

      <Entity360Header
        title={`الخطة ${PLAN_TYPE_AR[plan.type ?? ""] ?? ""}`}
        subtitle={`${fmtDate(plan.period_start)} إلى ${fmtDate(plan.period_end)}`}
        pills={[{ status: pillStatus, label: pillLabel }]}
        actions={
          canEditPlan ? (
            <>
              <PlanChecksRunner planId={planId} />
              <OperationBuilder planId={planId} items={items ?? []} people={people ?? []} />
            </>
          ) : undefined
        }
      />

      {needsAttention && (
        <Alert
          tone="warning"
          title="الخطة تتطلب انتباهًا"
          description={[
            blockedChecks > 0 ? `${num(blockedChecks)} فحص محظور` : null,
            dueOps.length > 0 ? `${num(dueOps.length)} عملية مستحقة أو متأخرة` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        />
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="عمليات الخطة" value={num((ops ?? []).length)} />
        <KpiCard label="التكلفة التقديرية" value={egpSummary(totalEstCost)} />
        <KpiCard label="فحوص مشغّلة" value={num((checks ?? []).length)} />
        <KpiCard
          label="فحوص محظورة"
          value={num(blockedChecks)}
          deltaDirection={blockedChecks ? "down" : "none"}
        />
      </section>

      <EntityTabs items={tabItems} value={tab} />

      {tab === "overview" && (
        <div
          role="tabpanel"
          id={tabPanelId("overview")}
          aria-labelledby={tabId("overview")}
          tabIndex={0}
          className="flex flex-col gap-6"
        >
          <LoopStepper steps={steps} ariaLabel="خطوات الدورة" />

          {blocked && (
            <Alert
              tone="danger"
              // Title the block by its real cause — budget can block with stock OK, in which case the
              // stock detail is {} and the old hardcoded "محظورة بفحص المخزون" showed an empty body.
              title={
                stockBlocked && budgetBlocked
                  ? "الخطة محظورة بفحص المخزون والميزانية"
                  : budgetBlocked
                    ? "الخطة محظورة بفحص الميزانية"
                    : "الخطة محظورة بفحص المخزون"
              }
              description={
                stockBlocked
                  ? Object.values(
                      (stockCheck?.detail as Record<string, { message_ar?: string }> | null) ?? {},
                    )
                      .map((d) => d.message_ar)
                      .filter(Boolean)
                      .join(" · ") || "يوجد نقص متوقع في أحد الأصناف المطلوبة."
                  : "تتجاوز التكلفة المتوقعة الميزانية المتاحة لبنود الخطة."
              }
            />
          )}

          <Card title="إجراءات سريعة">
            <div className="flex flex-col gap-3">
              <ActionLink href={`/inventory/${POTASSIUM_ID}/coverage`} primary>
                عرض تغطية سلفات البوتاسيوم
              </ActionLink>
              <ActionLink href={`/budget/${planId}/check`}>فحص الموازنة</ActionLink>
              <ActionLink href={`/reports/${planId}/pva`}>تقرير المخطط مقابل الفعلي</ActionLink>
            </div>
            {budgetCheck && (
              <p className="mt-3 text-sm" style={{ color: "var(--ink-muted)" }}>
                الموازنة:{" "}
                {budgetCheck.result === "block"
                  ? "تتطلب اعتماد المالك"
                  : budgetCheck.result === "warn"
                    ? "منخفضة"
                    : "كافية"}
              </p>
            )}
          </Card>
        </div>
      )}

      {tab === "operations" && (
        <div
          role="tabpanel"
          id={tabPanelId("operations")}
          aria-labelledby={tabId("operations")}
          tabIndex={0}
        >
          <Card title="العمليات المخطّطة">
            <SimpleTable columns={opColumns} rows={opRows} ariaLabel="العمليات المخطّطة" empty="لا توجد عمليات بعد" />
          </Card>
        </div>
      )}

      {tab === "checks" && (
        <div
          role="tabpanel"
          id={tabPanelId("checks")}
          aria-labelledby={tabId("checks")}
          tabIndex={0}
        >
          <Card title="فحوصات الخطة">
            <ul className="flex flex-col gap-2">
              {(checks ?? []).map((c) => (
                <li key={c.kind} className="flex items-center justify-between">
                  <span>{CHECK_AR[c.kind] ?? "غير معروف"}</span>
                  <span
                    style={{
                      color:
                        c.result === "block"
                          ? "var(--danger,#b91c1c)"
                          : c.result === "warn"
                            ? "var(--warning,#b45309)"
                            : "var(--ok,#15803d)",
                    }}
                  >
                    {c.result === "block" ? "محظور" : c.result === "warn" ? "منخفض" : "سليم"}
                  </span>
                </li>
              ))}
              {(checks ?? []).length === 0 && (
                <li style={{ color: "var(--ink-muted)" }}>لم تُشغّل الفحوصات بعد.</li>
              )}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}

function ActionLink({
  href,
  children,
  primary = false,
}: {
  href: string;
  children: ReactNode;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-9 items-center justify-center rounded-md px-3 text-sm font-semibold"
      style={{
        color: primary ? "var(--surface)" : "var(--brand)",
        background: primary ? "var(--brand)" : "var(--surface)",
        border: "1px solid var(--line)",
      }}
    >
      {children}
    </Link>
  );
}
