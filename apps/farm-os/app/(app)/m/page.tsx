import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card, StatusPill, Alert, EmptyState } from "@/components/ui";
import { num } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { OP_STATUS_AR, SUBTYPE_AR, isExecutableOpStatus, NON_EXECUTABLE_OP_STATUSES } from "@/lib/labels";
import { PendingExecutions } from "@/components/PendingExecutions";

function pill(s: string): "active" | "done" | "scheduled" {
  if (s === "done") return "done";
  if (s === "reserved") return "scheduled";
  return "active";
}

type Op = {
  id: string;
  subtype: string | null;
  planned_at: string | null;
  est_cost: number | string | null;
  status: string | null;
  responsible_person_id: string | null;
  plan_id: string | null;
};

/** SPEC-0026 P-6: the four field questions a crew card must answer — أين؟ بماذا؟ مع من؟ (ماذا = subtype). */
interface FieldContext {
  where?: string;
  materials: string[];
  crew: string[];
}

function OpCard({ op, ctx }: { op: Op; ctx?: FieldContext }) {
  return (
    <Card key={op.id}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">{SUBTYPE_AR[op.subtype ?? ""] ?? "عملية"}</div>
          <div className="text-sm" style={{ color: "var(--ink-muted)" }}>
            {fmtDate(op.planned_at)}
            {ctx?.where ? ` · 📍 ${ctx.where}` : ""}
          </div>
          {/* SPEC-0026 P-6: بماذا / مع من — the crew card answers the field questions, and carries
              NO money (decision 8: field roles see quantities, never amounts). */}
          {ctx && ctx.materials.length > 0 && (
            <div className="mt-1 text-sm" style={{ color: "var(--ink-muted)" }}>
              🧰 {ctx.materials.slice(0, 2).join("، ")}
              {ctx.materials.length > 2 ? ` +${num(ctx.materials.length - 2)}` : ""}
            </div>
          )}
          {ctx && ctx.crew.length > 0 && (
            <div className="mt-0.5 text-sm" style={{ color: "var(--ink-muted)" }}>
              👥 {ctx.crew.slice(0, 2).join("، ")}
              {ctx.crew.length > 2 ? ` +${num(ctx.crew.length - 2)}` : ""}
            </div>
          )}
        </div>
        <StatusPill status={pill(op.status ?? "planned")}>
          {OP_STATUS_AR[op.status ?? "planned"] ?? "غير معروف"}
        </StatusPill>
      </div>
      {/* Only show the execute affordance for an ACTIVE op — a done/blocked/abandoned/skipped
          op is not executable (the fn_execute_operation guard rejects it), so the button would
          be a dead-end that 22023s. Matches the server set via isExecutableOpStatus. */}
      {isExecutableOpStatus(op.status) && (
        <div className="mt-3">
          <Link
            href={`/m/execute/${op.id}`}
            className="inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-semibold"
            style={{
              color: "var(--on-brand, #fff)",
              background: "var(--brand)",
            }}
          >
            تسجيل التنفيذ
          </Link>
        </div>
      )}
    </Card>
  );
}

function Section({ title, ops, ctxById }: { title: string; ops: Op[]; ctxById?: Map<string, FieldContext> }) {
  if (ops.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">
        {title} <span style={{ color: "var(--ink-muted)" }}>({num(ops.length)})</span>
      </h2>
      <div className="flex flex-col gap-3">
        {ops.map((o) => (
          <OpCard key={o.id} op={o} ctx={ctxById?.get(o.id)} />
        ))}
      </div>
    </section>
  );
}

export default async function MobileHomePage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; mine?: string }>;
}) {
  const { done, mine } = await searchParams;
  // Role-gate the field view to match the nav (lib/nav.ts hides الميدان from
  // accountant/storekeeper) and /m/execute's gate — field roles only.
  const m = await requireRole(["supervisor", "agri_engineer", "farm_manager", "owner"]);
  const mineOnly = m.personId != null ? mine !== "0" : mine === "1";
  const sb = await createClient();

  const { data: ops, error } = await sb
    .from("plan_operations")
    .select("id, subtype, planned_at, est_cost, status, responsible_person_id, plan_id")
    // F5: bound the field feed. It was fetching EVERY plan_operation ever (mostly the
    // season-over-season backlog of terminal `done` rows) and discarding them client-side.
    // Drop terminal statuses at the source using the same set the execute-gate uses — they are
    // never actionable in the field view (the execute button is already hidden for them, and the
    // overdue bucket already requires an executable status), so this hides no actionable work.
    .not("status", "in", `(${NON_EXECUTABLE_OP_STATUSES.join(",")})`)
    .order("planned_at");
  // Surface DB read failures to the segment error boundary instead of rendering
  // a misleading empty page.
  if (error) throw error;
  const allOps = (ops ?? []) as Op[];

  // "مهامي فقط": an op is "mine" when the current user's linked person is the op's
  // responsible_person_id (the single-lead back-compat pointer, kept per migration
  // 20260622000090) OR appears in plan_operation_assignees (the multi-person assignment
  // join table added by the same migration). Reads are org-scoped RLS (tenant_all
  // policy), so this second query only ever returns rows the signed-in user can see.
  let myAssignedOpIds = new Set<string>();
  if (mineOnly && m.personId) {
    const { data: assignRows, error: assignError } = await sb
      .from("plan_operation_assignees")
      .select("plan_op_id")
      .eq("person_id", m.personId);
    if (assignError) throw assignError;
    myAssignedOpIds = new Set((assignRows ?? []).map((r) => r.plan_op_id));
  }

  const visibleOps = mineOnly
    ? allOps.filter(
        (o) => o.responsible_person_id === m.personId || myAssignedOpIds.has(o.id),
      )
    : allOps;

  // Grouping is presentation-only derivation over already-fetched rows (no fabricated
  // data). Terminal ops (done/blocked/abandoned/skipped) never read as "overdue" even
  // if their planned date has passed — they're no longer actionable — so they simply
  // fall out of all three buckets once their date isn't today or in the future, same
  // as the "due/overdue" convention in plans/[planId]/page.tsx.
  // SPEC-0026 P-6: the field context per op — بماذا (materials) / مع من (crew) / أين (plan scope).
  const visibleIds = visibleOps.map((o) => o.id);
  const planIds = [...new Set(visibleOps.map((o) => o.plan_id).filter(Boolean))] as string[];
  const [matsRes, assignRes2, plansRes] = await Promise.all([
    visibleIds.length
      ? sb.from("plan_material_requirements").select("plan_op_id, qty, unit, item_id").in("plan_op_id", visibleIds)
      : Promise.resolve({ data: [], error: null } as const),
    visibleIds.length
      ? sb.from("plan_operation_assignees").select("plan_op_id, person_id").in("plan_op_id", visibleIds)
      : Promise.resolve({ data: [], error: null } as const),
    planIds.length
      ? sb.from("plans").select("id, scope_type, scope_id").in("id", planIds)
      : Promise.resolve({ data: [], error: null } as const),
  ]);
  const itemIds = [...new Set((matsRes.data ?? []).map((r) => r.item_id).filter(Boolean))] as string[];
  const personIds2 = [...new Set((assignRes2.data ?? []).map((r) => r.person_id).filter(Boolean))] as string[];
  const scopeSectorIds = (plansRes.data ?? []).filter((p) => p.scope_type === "sector" && p.scope_id).map((p) => p.scope_id as string);
  const scopeHawshaIds = (plansRes.data ?? []).filter((p) => p.scope_type === "hawsha" && p.scope_id).map((p) => p.scope_id as string);
  const [itemsRes2, peopleRes2, sectorsRes2, hawshatRes2] = await Promise.all([
    itemIds.length ? sb.from("inventory_items").select("id, name").in("id", itemIds) : Promise.resolve({ data: [], error: null } as const),
    personIds2.length ? sb.from("people").select("id, name").in("id", personIds2) : Promise.resolve({ data: [], error: null } as const),
    scopeSectorIds.length ? sb.from("sectors").select("id, name").in("id", scopeSectorIds) : Promise.resolve({ data: [], error: null } as const),
    scopeHawshaIds.length ? sb.from("hawshat").select("id, name").in("id", scopeHawshaIds) : Promise.resolve({ data: [], error: null } as const),
  ]);
  const itemName = new Map((itemsRes2.data ?? []).map((i) => [i.id, i.name]));
  const personName2 = new Map((peopleRes2.data ?? []).map((p) => [p.id, p.name]));
  const scopeName = new Map<string, string>();
  for (const p of plansRes.data ?? []) {
    if (p.scope_type === "farm") scopeName.set(p.id, "المزرعة كلها");
    else if (p.scope_type === "sector") scopeName.set(p.id, (sectorsRes2.data ?? []).find((x) => x.id === p.scope_id)?.name ?? "قطاع");
    else if (p.scope_type === "hawsha") scopeName.set(p.id, (hawshatRes2.data ?? []).find((x) => x.id === p.scope_id)?.name ?? "حوش");
  }
  const ctxById = new Map<string, FieldContext>();
  for (const o of visibleOps) {
    ctxById.set(o.id, {
      where: o.plan_id ? scopeName.get(o.plan_id) : undefined,
      materials: (matsRes.data ?? [])
        .filter((r) => r.plan_op_id === o.id)
        .map((r) => `${r.qty ? num(Number(r.qty)) + " " : ""}${r.unit ?? ""} ${itemName.get(r.item_id) ?? ""}`.trim()),
      crew: (assignRes2.data ?? [])
        .filter((r) => r.plan_op_id === o.id)
        .map((r) => personName2.get(r.person_id) ?? "")
        .filter(Boolean),
    });
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const dateStr = (o: Op) => (o.planned_at != null ? String(o.planned_at).slice(0, 10) : null);

  const overdueOps = visibleOps.filter((o) => {
    const d = dateStr(o);
    return d != null && d < todayStr && isExecutableOpStatus(o.status);
  });
  const todayOps = visibleOps.filter((o) => dateStr(o) === todayStr);
  const upcomingOps = visibleOps.filter((o) => {
    const d = dateStr(o);
    return d != null && d > todayStr;
  });

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-4">
      <header>
        <h1 className="text-xl font-bold">الميدان</h1>
      {/* «يوم قطف» opens /m/harvest, which is gated to owner/farm_manager — only show the button to them, else
          a supervisor/agri_engineer taps the biggest button on their home and bounces (SPEC-0030 flow audit A1). */}
      {(m.role === "owner" || m.role === "farm_manager") && (
        <Link
          href="/m/harvest"
          className="inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-semibold"
          style={{ color: "var(--on-brand, #fff)", background: "var(--brand)" }}
        >
          🧺 يوم قطف — عدّاد العبوات
        </Link>
      )}
        <p style={{ color: "var(--ink-muted)" }}>{m.name ?? "المشرف"}</p>
      </header>

      {done && <Alert tone="ok" title="تم تسجيل العملية بنجاح." />}

      {/* F1: on-device outbox of executions that failed to send (network drop) — resend on reconnect. */}
      <PendingExecutions />

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{m.personId ? "مهامي المخطّطة" : "العمليات المخطّطة"}</h2>
        {m.personId && (
          <Link
            href={mineOnly ? "/m?mine=0" : "/m"}
            className="inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-semibold"
            style={{ borderColor: "var(--border, currentColor)" }}
          >
            {mineOnly ? "عرض كل العمليات" : "مهامي فقط"}
          </Link>
        )}
      </div>

      {allOps.length === 0 ? (
        <EmptyState
          title={m.personId ? "لا توجد مهام مسندة لك." : "لا توجد عمليات مجدولة."}
          description={
            m.personId
              ? "ستظهر هنا العمليات التي يسندها مدير المزرعة أو المهندس إليك."
              : "ستظهر العمليات المخطّطة هنا عند جدولتها في الخطة."
          }
        />
      ) : visibleOps.length === 0 ? (
        <EmptyState
          title="لا توجد عمليات مُسندة إليك."
          description="جرّب عرض كل العمليات."
        />
      ) : (
        <>
          {overdueOps.length > 0 && (
            <Alert
              tone="danger"
              title={`${num(overdueOps.length)} عملية متأخرة`}
              description="تحتاج تنفيذ فوري."
            />
          )}
          <Section title="متأخرة" ops={overdueOps} />
          <Section title="اليوم" ops={todayOps} />
          <Section title="قادم" ops={upcomingOps} />
        </>
      )}
    </div>
  );
}
