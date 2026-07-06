import { StoryLine } from "@/components/StoryLine";
import { OpsCalendar, type CalendarItem } from "@/components/OpsCalendar";
import Link from "next/link";
import { ClonePlanButton } from "@/components/ClonePlanButton";
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
import { OperationAssignees, type AssigneeInfo } from "@/components/OperationAssignees";
import { OperationTemplatePicker, type TemplateOpt } from "@/components/OperationTemplatePicker";
import { OperationSignOff } from "@/components/OperationSignOff";
import { PlanChecksRunner } from "@/components/PlanChecksRunner";
import { PlanStatusActions } from "@/components/PlanStatusActions";
import { POTASSIUM_ID } from "@/lib/nav";
import { egpSummary, egpValue, num, pct, sumMoney } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import {
  OP_STATUS_AR,
  PLAN_STATUS_AR,
  SUBTYPE_AR,
  isDoseBearingSubtype,
  isExecutableOpStatus,
} from "@/lib/labels";
import { formatDependencyLabel } from "@/lib/relative-schedule";

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
  // agronomy.signoff (agronomist-signoff-gate, docs/CLAUDE.md non-negotiable #4): defense-in-depth UI
  // mirror of the DB gate (authorize()'s owner/agri_engineer grant is a REASONABLE DEFAULT, not the
  // Owner's final word on who the named agronomist is — see the migration header). The RPC re-checks
  // this itself regardless of what this hides.
  const canSignOff = ["owner", "agri_engineer"].includes(m.role);
  const sb = await createClient();

  // These reads are independent, so issue them in parallel.
  const [
    { data: plan, error: planError },
    { data: ops, error: opsError },
    { data: checks, error: checksError },
    { data: items, error: itemsError },
    { data: people, error: peopleError },
    { data: templates, error: templatesError },
  ] = await Promise.all([
    sb
      .from("plans")
      .select("id, type, period_start, period_end, scope_type, status")
      .eq("id", planId)
      .maybeSingle(),
    sb
      .from("plan_operations")
      .select(
        "id, subtype, planned_at, est_cost, status, approval_needed, depends_on_op_id, depends_on_offset_days, signed_off_by, signed_off_at",
      )
      .eq("plan_id", planId)
      .order("planned_at"),
    sb
      .from("plan_checks")
      .select("kind, result, detail")
      .eq("plan_id", planId),
    sb.from("inventory_items").select("id, name, unit").order("name"),
    // Active employees for the operation-assignee picker (#398). Org-scoped by RLS; names only.
    sb.from("people").select("id, name").eq("active", true).order("name"),
    // SPEC-0019 P1-3: the org's named operation templates ("جداول العمليات"), for the
    // "استخدام برنامج جاهز" instantiate picker. Org-scoped by RLS; read is unaffected by plan.write.
    sb.from("plan_operation_templates").select("id, name, subtype, recurrence").order("name"),
  ]);
  // Surface DB read failures to the segment error boundary instead of rendering
  // a misleading empty page.
  if (planError) throw planError;
  if (opsError) throw opsError;
  if (checksError) throw checksError;
  if (itemsError) throw itemsError;
  if (peopleError) throw peopleError;
  if (templatesError) throw templatesError;

  // .maybeSingle() returns null (no error) for a bogus or RLS-hidden id — show a
  // not-found message instead of rendering a blank "الخطة " header (mirrors farm/sector).
  if (!plan) {
    return <div className="p-6">الخطة غير موجودة.</div>;
  }

  // #398 follow-up: who's assigned to each operation was stored (plan_operation_assignees) but never
  // surfaced anywhere. Two flat, non-embedded reads — the assignee rows depend on the op ids just
  // fetched above, and the person names depend on the assignee rows' person_ids — rather than a
  // resource-embed (avoids typing a Supabase embed for a table not yet in the generated
  // database.types.ts; see the augmentation in lib/database.types.ext.ts).
  const opIds = (ops ?? []).map((o) => o.id);
  const { data: assigneeRows, error: assigneesError } = opIds.length
    ? await sb
        .from("plan_operation_assignees")
        .select("id, plan_op_id, person_id, is_lead")
        .in("plan_op_id", opIds)
    : { data: [], error: null };
  if (assigneesError) throw assigneesError;

  // #398 + agronomist-signoff: resolve names for everyone this plan references — both operation
  // assignees AND whoever signed off a dose-bearing op — in ONE id-keyed read (previously two
  // separate `.from("people")` round-trips). Either id can point at a person outside the active-
  // employee list fetched above (an assignee or signer may be inactive), so this stays a flat
  // `.in("id", …)` lookup rather than reusing that list. A person's name is identical regardless of
  // which set referenced them, so a single id→name map serves both consumers.
  const assigneePersonIds = [...new Set((assigneeRows ?? []).map((a) => a.person_id))];
  const signedOffIds = [...new Set((ops ?? []).map((o) => o.signed_off_by).filter((id): id is string => !!id))];
  const namePersonIds = [...new Set([...assigneePersonIds, ...signedOffIds])];
  const { data: namePeople, error: namePeopleError } = namePersonIds.length
    ? await sb.from("people").select("id, name").in("id", namePersonIds)
    : { data: [], error: null };
  if (namePeopleError) throw namePeopleError;
  const nameById = new Map((namePeople ?? []).map((p) => [p.id, p.name]));

  const assigneesByOp = new Map<string, AssigneeInfo[]>();
  for (const row of assigneeRows ?? []) {
    const list = assigneesByOp.get(row.plan_op_id) ?? [];
    list.push({
      id: row.id,
      personId: row.person_id,
      name: nameById.get(row.person_id) ?? "غير معروف",
      isLead: row.is_lead,
    });
    assigneesByOp.set(row.plan_op_id, list);
  }

  const templateOptions: TemplateOpt[] = (templates ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    subtype: t.subtype,
    occurrenceCount: Array.isArray(t.recurrence) ? t.recurrence.length : 0,
  }));

  // Relative operation scheduling (2026-07-01): an op may OPTIONALLY depend on another op in the
  // same plan (depends_on_op_id + depends_on_offset_days, migration 20260701350000). planned_at
  // stays authoritative and unchanged; this is a read-time, presentation-only lookup + pure
  // computation (lib/relative-schedule.ts) — never a fabricated date.
  const opLabel = (o: { id: string; subtype: string | null }) =>
    SUBTYPE_AR[o.subtype ?? ""] ?? "عملية";
  const opsById = new Map((ops ?? []).map((o) => [o.id, o]));
  const dependencyNote = (o: {
    depends_on_op_id: string | null;
    depends_on_offset_days: number | null;
  }): string => {
    if (!o.depends_on_op_id) return "";
    const dep = opsById.get(o.depends_on_op_id);
    if (!dep) return "";
    return formatDependencyLabel(opLabel(dep), o.depends_on_offset_days);
  };

  // Sign-off actor names come from the combined `nameById` map built above (was a separate
  // `.from("people")` read; the agronomist-signoff-gate names are now folded into that single lookup).

  // Dose-bearing ops (fertilization/spraying) needing agronomist sign-off (non-negotiable #4). This is
  // a GENERIC mechanism — it does not gate execution or the engine's demand in this slice.
  const signoffOps = (ops ?? []).filter((o) => isDoseBearingSubtype(o.subtype));

  const opColumns: SimpleColumn[] = [
    { id: "subtype", header: "العملية" },
    { id: "planned_at", header: "التاريخ" },
    {
      id: "assignees",
      header: "المكلّفون",
      render: (row) => (
        <OperationAssignees
          planId={planId}
          opId={row.id}
          assignees={assigneesByOp.get(row.id) ?? []}
          canRemove={canEditPlan}
        />
      ),
    },
    { id: "cost", header: "التكلفة", numeric: true },
    { id: "approval", header: "موافقة؟" },
    { id: "status", header: "الحالة", kind: "status" },
    { id: "dependency", header: "يعتمد على" },
  ];
  const opRows = (ops ?? []).map((o) => ({
    id: o.id,
    subtype: opLabel(o),
    planned_at: fmtDate(o.planned_at),
    cost: egpValue(o.est_cost),
    approval: o.approval_needed ? "نعم" : "لا",
    status: OP_STATUS_AR[o.status ?? "planned"] ?? "غير معروف",
    dependency: dependencyNote(o) || "—",
  }));

  // Existing ops offered to the OperationBuilder's "depends on another operation" picker — same
  // plan only (the DB trigger enforces this too; this is just what's shown to choose from).
  const existingOpOptions = (ops ?? []).map((o) => ({
    id: o.id,
    label: opLabel(o),
    plannedAt: o.planned_at,
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

  // SPEC-0030 A5: derive EACH lifecycle step from real plan data. Previously pr/approve/execute/report were
  // hardcoded "pending" — the stepper advertised a journey it never tracked (read as a broken progress bar).
  const totalStepOps = (ops ?? []).length;
  const doneStepOps = (ops ?? []).filter((o) => o.status === "done").length;
  const opsNeedingApproval = (ops ?? []).filter((o) => o.approval_needed).length;
  const approvedStepOps = (ops ?? []).filter((o) => o.signed_off_at != null).length;
  const steps: LoopStep[] = [
    { id: "plan", label: "الخطة", state: "active" },
    // not-yet-run checks are pending, not "done" — the empty list must not read as a pass.
    { id: "check", label: "الفحوصات", state: !checksRun ? "pending" : blocked ? "blocked" : "done" },
    { id: "coverage", label: "تغطية المخزون", state: stockCheck?.result === "block" ? "active" : "pending" },
    // a stock shortage means a purchase is needed → the PR step is live; otherwise nothing to order from here.
    { id: "pr", label: "طلب الشراء", state: stockCheck?.result === "block" ? "active" : "pending" },
    {
      id: "approve",
      label: "الاعتماد",
      state:
        opsNeedingApproval === 0
          ? totalStepOps > 0
            ? "done"
            : "pending"
          : approvedStepOps >= opsNeedingApproval
            ? "done"
            : "active",
    },
    {
      id: "execute",
      label: "التنفيذ",
      state: totalStepOps === 0 || doneStepOps === 0 ? "pending" : doneStepOps >= totalStepOps ? "done" : "active",
    },
    {
      id: "report",
      label: "المخطط مقابل الفعلي",
      state: doneStepOps === 0 ? "pending" : doneStepOps >= totalStepOps ? "done" : "active",
    },
  ];

  const tabItems: TabItem[] = [
    { id: "overview", label: "نظرة عامة" },
    { id: "operations", label: `العمليات (${num(opRows.length)})` },
    { id: "checks", label: `الفحوص (${num((checks ?? []).length)})` },
  ];

  // SPEC-0026 P-1 (Stage 2 render): the plan's readiness as ONE sentence + actionable notes.
  const allOps = ops ?? [];
  const doneOps = allOps.filter((o) => o.status === "done").length;
  const unsignedDose = signoffOps.filter((o) => !o.signed_off_at).length;
  const readiness = allOps.length > 0 ? Math.round((doneOps / allOps.length) * 100) : 0;
  const planLead =
    allOps.length === 0
      ? "الخطة فارغة — أضِف أول عملية بالمعالج."
      : `نُفّذ ${num(doneOps)} من ${num(allOps.length)} عملية (${pct(readiness)})` +
        (blockedChecks > 0 ? ` — ${num(blockedChecks)} فحص محظور يمنع التفعيل` : checksRun ? " — الفحوصات سليمة" : " — لم تُشغَّل الفحوصات بعد") +
        ".";
  const planNotes: string[] = [];
  if (unsignedDose > 0) planNotes.push(`${num(unsignedDose)} عملية رش/جرعة تنتظر اعتماد المهندس.`);
  if (dueOps.length > 0) planNotes.push(`${num(dueOps.length)} عملية مستحقة خلال الأيام القادمة.`);

  // SPEC-0026 P-8: the plan as a CALENDAR — ops laid on the week grid of the plan period.
  const { data: endsRows } = allOps.length
    ? await sb.from("plan_operations").select("id, ends_on").eq("plan_id", planId)
    : { data: [] };
  const endsById = new Map(
    ((endsRows ?? []) as unknown as { id: string; ends_on: string | null }[]).map((r) => [r.id, r.ends_on]),
  );
  const calendarItems: CalendarItem[] = allOps.map((o) => ({
    id: o.id,
    date: o.planned_at ? String(o.planned_at).slice(0, 10) : null,
    endDate: endsById.get(o.id) ? String(endsById.get(o.id)).slice(0, 10) : null,
    label: SUBTYPE_AR[o.subtype ?? ""] ?? o.subtype ?? "عملية",
    href: `/plans/${planId}?tab=operations`,
    tone: o.status === "done" ? "ok" : dueOps.some((d) => d.id === o.id) ? "warn" : "active",
  }));
  const calStart = plan.period_start ? String(plan.period_start).slice(0, 10) : null;
  const calEnd = plan.period_end ? String(plan.period_end).slice(0, 10) : null;

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

      <StoryLine lead={planLead} notes={planNotes} />
      {canEditPlan && (
        <div className="flex flex-wrap gap-2 text-sm font-bold">
          <Link href={`/record/plan?planId=${planId}`} className="underline underline-offset-4" style={{ color: "var(--brand)" }}>
            + أضِف عمليات بالمعالج (أسطر متعددة)
          </Link>
          <ClonePlanButton planId={planId} />
        </div>
      )}

      <Entity360Header
        title={`الخطة ${PLAN_TYPE_AR[plan.type ?? ""] ?? ""}`}
        subtitle={`${fmtDate(plan.period_start)} إلى ${fmtDate(plan.period_end)}`}
        pills={[{ status: pillStatus, label: pillLabel }]}
        actions={
          canEditPlan ? (
            <>
              <PlanStatusActions planId={planId} status={planStatus} />
              <PlanChecksRunner planId={planId} />
              <OperationTemplatePicker planId={planId} templates={templateOptions} />
              <OperationBuilder
                planId={planId}
                items={items ?? []}
                people={people ?? []}
                existingOps={existingOpOptions}
              />

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
          className="flex flex-col gap-4"
        >
          {calStart && calEnd && calendarItems.length > 0 && (
            <Card title="تقويم الخطة">
              <OpsCalendar start={calStart} end={calEnd} items={calendarItems} todayIso={todayStr} />
            </Card>
          )}
          {signoffOps.length > 0 && (
            // agronomist-signoff-gate (non-negotiable #4): a dose-bearing op (fertilization/spraying)
            // is a TEMPLATE, not a prescription, until a named agronomist signs off. This is the
            // GENERIC mechanism only — execution/engine behaviour is unchanged by this state.
            <Card title="اعتماد العمليات ذات الجرعات">
              <ul className="flex flex-col gap-3">
                {signoffOps.map((o) => (
                  <li
                    key={o.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-b-0 last:pb-0"
                    style={{ borderColor: "var(--line)" }}
                  >
                    <span>
                      {SUBTYPE_AR[o.subtype ?? ""] ?? "عملية"} — {fmtDate(o.planned_at)}
                    </span>
                    <OperationSignOff
                      planId={planId}
                      opId={o.id}
                      signedOffByName={o.signed_off_by ? (nameById.get(o.signed_off_by) ?? null) : null}
                      signedOffAt={o.signed_off_at}
                      canSignOff={canSignOff}
                    />
                  </li>
                ))}
              </ul>
            </Card>
          )}
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
