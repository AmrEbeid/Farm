import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card, StatusPill, Alert, EmptyState } from "@/components/ui";
import { egp } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { OP_STATUS_AR, SUBTYPE_AR, isExecutableOpStatus } from "@/lib/labels";

function pill(s: string): "active" | "done" | "scheduled" {
  if (s === "done") return "done";
  if (s === "reserved") return "scheduled";
  return "active";
}

export default async function MobileHomePage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string }>;
}) {
  const { done } = await searchParams;
  // Role-gate the field view to match the nav (lib/nav.ts hides الميدان from
  // accountant/storekeeper) and /m/execute's gate — field roles only.
  const m = await requireRole(["supervisor", "agri_engineer", "farm_manager", "owner"]);
  const sb = await createClient();

  const { data: ops, error } = await sb
    .from("plan_operations")
    .select("id, subtype, planned_at, est_cost, status")
    .order("planned_at");
  // Surface DB read failures to the segment error boundary instead of rendering
  // a misleading empty page.
  if (error) throw error;

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-4">
      <header>
        <h1 className="text-xl font-bold">الميدان</h1>
        <p style={{ color: "var(--ink-muted)" }}>{m.name ?? "المشرف"}</p>
      </header>

      {done && <Alert tone="ok" title="تم تسجيل العملية بنجاح." />}

      <h2 className="text-lg font-semibold">العمليات المخطّطة</h2>
      {(ops ?? []).length === 0 ? (
        <EmptyState
          title="لا توجد عمليات مجدولة."
          description="ستظهر العمليات المخطّطة هنا عند جدولتها في الخطة."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {(ops ?? []).map((o) => (
            <Card key={o.id}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{SUBTYPE_AR[o.subtype ?? ""] ?? "عملية"}</div>
                  <div className="text-sm" style={{ color: "var(--ink-muted)" }}>
                    {fmtDate(o.planned_at)} · {egp(Number(o.est_cost ?? 0))}
                  </div>
                </div>
                <StatusPill status={pill(o.status ?? "planned")}>
                  {OP_STATUS_AR[o.status ?? "planned"] ?? "غير معروف"}
                </StatusPill>
              </div>
              {/* Only show the execute affordance for an ACTIVE op — a done/blocked/abandoned/skipped
                  op is not executable (the fn_execute_operation guard rejects it), so the button would
                  be a dead-end that 22023s. Matches the server set via isExecutableOpStatus. */}
              {isExecutableOpStatus(o.status) && (
                <div className="mt-3">
                  <Link
                    href={`/m/execute/${o.id}`}
                    className="inline-flex min-h-10 items-center justify-center rounded-md px-4 text-sm font-semibold"
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
          ))}
        </div>
      )}
    </div>
  );
}
