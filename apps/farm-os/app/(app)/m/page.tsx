import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card, StatusPill, Alert, EmptyState } from "@/components/ui";
import { egpValue, num } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { OP_STATUS_AR, SUBTYPE_AR, isExecutableOpStatus, NON_EXECUTABLE_OP_STATUSES } from "@/lib/labels";

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
};

function OpCard({ op }: { op: Op }) {
  return (
    <Card key={op.id}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-medium">{SUBTYPE_AR[op.subtype ?? ""] ?? "عملية"}</div>
          <div className="text-sm" style={{ color: "var(--ink-muted)" }}>
            {fmtDate(op.planned_at)} · {egpValue(op.est_cost)}
          </div>
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

function Section({ title, ops }: { title: string; ops: Op[] }) {
  if (ops.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">
        {title} <span style={{ color: "var(--ink-muted)" }}>({num(ops.length)})</span>
      </h2>
      <div className="flex flex-col gap-3">
        {ops.map((o) => (
          <OpCard key={o.id} op={o} />
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
    .select("id, subtype, planned_at, est_cost, status, responsible_person_id")
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
        <p style={{ color: "var(--ink-muted)" }}>{m.name ?? "المشرف"}</p>
      </header>

      {done && <Alert tone="ok" title="تم تسجيل العملية بنجاح." />}

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
