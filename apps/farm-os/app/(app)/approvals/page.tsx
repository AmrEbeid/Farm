// «راجع» — the unified approvals inbox (SPEC-0030 §4.1, Phase 2). ONE role-scoped place for every decision
// awaiting the user, so the owner/agronomist/accountant never hunt across three modules again:
//   • plan dose/spray sign-offs (owner, agri_engineer)  — the #4 gate
//   • purchase-request approvals (owner; not one you requested — separation of duties)
//   • payment-request approvals (owner/accountant; the stage legal for the role)
// Each row is a one-liner. Plan sign-offs keep one-tap اعتماد (the gated fn_sign_off_plan_operation); PR and
// payment rows deep-link to their detail where the gated, optimistic-concurrency action lives. Every gate is
// re-enforced in the DB — the UI only mirrors it. Honest-null throughout (#1). Server Component.

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Alert, Card } from "@/components/ui";
import { StoryLine } from "@/components/StoryLine";
import { SignOffButton } from "@/components/SignOffButton";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";
import { SUBTYPE_AR, isDoseBearingSubtype, NON_EXECUTABLE_OP_STATUSES } from "@/lib/labels";
import { paymentRequestLifecyclePermissions } from "@/lib/request-lifecycle";

export const dynamic = "force-dynamic";

const mutedStyle = { color: "var(--ink-muted)" } as const;

export default async function ApprovalsInboxPage() {
  const m = await requireRole(["owner", "agri_engineer", "accountant"]);
  const sb = await createClient();
  const { role, userId } = m;

  // ── 1) Plan dose/spray sign-offs — owner, agri_engineer (the #4 gate) ──
  const canSignoff = role === "owner" || role === "agri_engineer";
  let signoffs: { id: string; plan_id: string | null; subtype: string | null; planned_at: string | null; mats: string[] }[] = [];
  if (canSignoff) {
    const { data: ops } = await sb
      .from("plan_operations")
      .select("id, plan_id, subtype, planned_at, signed_off_at, status")
      .is("signed_off_at", null)
      .not("status", "in", `(${NON_EXECUTABLE_OP_STATUSES.join(",")})`)
      .order("planned_at", { ascending: true });
    const pending = (ops ?? []).filter((o) => isDoseBearingSubtype(o.subtype));
    const opIds = pending.map((o) => o.id);
    const { data: matRows } = opIds.length
      ? await sb.from("plan_material_requirements").select("plan_op_id, qty, unit, item_id").in("plan_op_id", opIds)
      : { data: [] };
    const itemIds = [...new Set((matRows ?? []).map((r) => r.item_id).filter(Boolean))] as string[];
    const { data: items } = itemIds.length
      ? await sb.from("inventory_items").select("id, name").in("id", itemIds)
      : { data: [] };
    const itemName = new Map((items ?? []).map((i) => [i.id, i.name]));
    signoffs = pending.map((op) => ({
      id: op.id,
      plan_id: op.plan_id,
      subtype: op.subtype,
      planned_at: op.planned_at,
      mats: (matRows ?? [])
        .filter((r) => r.plan_op_id === op.id)
        .map((r) => `${r.qty ? num(Number(r.qty)) + " " : ""}${r.unit ?? ""} ${itemName.get(r.item_id) ?? ""}`.trim()),
    }));
  }

  // ── 2) Purchase-request approvals — owner only, and never one you requested (separation of duties) ──
  const canApprovePr = role === "owner";
  let prs: { id: string; code: string; reason: string | null; needed_by: string | null }[] = [];
  if (canApprovePr) {
    const { data } = await sb
      .from("purchase_requests")
      .select("id, code, status, reason, needed_by, requested_by")
      .eq("status", "submitted")
      .order("needed_by", { ascending: true });
    prs = (data ?? [])
      .filter((p) => p.requested_by !== userId)
      .map((p) => ({ id: p.id, code: p.code, reason: p.reason, needed_by: p.needed_by }));
  }

  // ── 3) Payment-request approvals — the stage legal for this role ──
  let payments: { id: string; request_no: number; stage: string }[] = [];
  {
    const { data } = await sb
      .from("payment_requests")
      .select("id, request_no, status, created_at")
      .in("status", ["submitted", "approved_operational"])
      .order("created_at", { ascending: true });
    payments = (data ?? []).flatMap((p) => {
      const perm = paymentRequestLifecyclePermissions(role, p.status);
      if (p.status === "submitted" && perm.canApproveOperational) return [{ id: p.id, request_no: p.request_no, stage: "اعتماد تشغيلي" }];
      if (p.status === "approved_operational" && perm.canApproveFinal) return [{ id: p.id, request_no: p.request_no, stage: "اعتماد نهائي" }];
      return [];
    });
  }

  const total = signoffs.length + prs.length + payments.length;
  const parts = [
    signoffs.length ? `${num(signoffs.length)} جرعة/رش` : "",
    prs.length ? `${num(prs.length)} طلب شراء` : "",
    payments.length ? `${num(payments.length)} طلب صرف` : "",
  ].filter(Boolean);
  const lead =
    total === 0
      ? "لا قرارات تنتظرك — كل شيء معتمد ✓"
      : `لديك ${num(total)} ${total === 1 ? "قرار" : "قرارًا"} بانتظارك: ${parts.join("، ")}.`;

  return (
    <div className="flex flex-col gap-4 p-6">
      <header>
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>راجع — ما يحتاج قرارك</h1>
        <p className="text-sm" style={mutedStyle}>
          كل ما ينتظر اعتمادك أو توقيعك في مكان واحد — الجرعات والرش، وطلبات الشراء، وطلبات الصرف. لا تنقّل بين
          الشاشات للبحث عمّا يحتاج قرارك.
        </p>
      </header>

      <StoryLine lead={lead} />

      {total === 0 ? (
        <Alert tone="info" title="صندوقك فارغ ✓" description="لا شيء ينتظر قرارك الآن." />
      ) : (
        <>
          {signoffs.length > 0 && (
            <Card title={`اعتمادات الجرعات والرش (${num(signoffs.length)})`}>
              <div className="flex flex-col gap-3">
                {signoffs.map((s) => (
                  <div key={s.id} className="flex flex-wrap items-center gap-3 border-b pb-3 last:border-0 last:pb-0" style={{ borderColor: "var(--line)" }}>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold" style={{ color: "var(--ink)" }}>
                        {SUBTYPE_AR[s.subtype ?? ""] ?? s.subtype} · {s.planned_at ? fmtDate(s.planned_at) : "بدون تاريخ"}
                      </div>
                      {s.mats.length > 0 && (
                        <div className="text-sm" style={mutedStyle}>🧪 {s.mats.join("، ")}</div>
                      )}
                      {s.plan_id && (
                        <Link href={`/plans/${s.plan_id}?tab=operations`} className="text-xs underline underline-offset-4" style={{ color: "var(--brand)" }}>
                          فتح الخطة ←
                        </Link>
                      )}
                    </div>
                    {s.plan_id && <SignOffButton planId={s.plan_id} opId={s.id} />}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {prs.length > 0 && (
            <Card title={`طلبات شراء بانتظار اعتمادك (${num(prs.length)})`}>
              <div className="flex flex-col gap-3">
                {prs.map((p) => (
                  <Link
                    key={p.id}
                    href={`/purchase-requests/${p.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 last:border-0 last:pb-0"
                    style={{ borderColor: "var(--line)" }}
                  >
                    <div className="min-w-0">
                      <div className="font-bold" style={{ color: "var(--ink)" }}>{p.code}{p.reason ? ` · ${p.reason}` : ""}</div>
                      <div className="text-sm" style={mutedStyle}>{p.needed_by ? `مطلوب بحلول ${fmtDate(p.needed_by)}` : "بدون موعد"}</div>
                    </div>
                    <span className="text-sm font-bold underline underline-offset-4" style={{ color: "var(--brand)" }}>اعتمِد ←</span>
                  </Link>
                ))}
              </div>
            </Card>
          )}

          {payments.length > 0 && (
            <Card title={`طلبات صرف بانتظار اعتمادك (${num(payments.length)})`}>
              <div className="flex flex-col gap-3">
                {payments.map((p) => (
                  <Link
                    key={p.id}
                    href={`/custody/request/${p.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 last:border-0 last:pb-0"
                    style={{ borderColor: "var(--line)" }}
                  >
                    <div className="min-w-0">
                      <div className="font-bold" style={{ color: "var(--ink)" }}>طلب صرف #{num(p.request_no)}</div>
                      <div className="text-sm" style={mutedStyle}>الخطوة التالية: {p.stage}</div>
                    </div>
                    <span className="text-sm font-bold underline underline-offset-4" style={{ color: "var(--brand)" }}>راجِع ←</span>
                  </Link>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
