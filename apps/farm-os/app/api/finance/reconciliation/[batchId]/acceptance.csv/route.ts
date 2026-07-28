/**
 * CSV annex for the reconciliation acceptance report: EVERY row of one batch, in the same
 * evidence-locator order the printed report is signed against.
 *
 * READ-ONLY. It performs the same bounded, org-scoped, single-snapshot read the report page does
 * (`loadAcceptanceBatch` → the SECURITY INVOKER `fn_reconciliation_acceptance_snapshot`, whose body is
 * SELECTs only) — downloading the annex cannot review, freeze, approve, execute, or roll back
 * anything. Uses the USER-SESSION server client, so RLS applies exactly as it does on the page; the
 * service-role client would bypass it and is deliberately not used here.
 *
 * FAIL-CLOSED. Unauthenticated → 401, wrong role → 403, unknown/cross-org batch → 404, a batch larger
 * than the whole-batch bound → 413, a batch whose stored row count contradicts what staging recorded →
 * 409, and any other read failure or row/count mismatch → 500. None of those emits a partial CSV: a
 * truncated annex attached to a signed acceptance would misstate the batch.
 *
 * BOUND TO ITS REPORT. The annex is built by the same `buildAcceptancePackage` the report page uses,
 * so every row — and the filename — carries the SHA-256 digest of the content THIS read returned. An
 * annex downloaded after the batch changed carries a different digest than the signed page, which is
 * exactly the mismatch an accountant needs to see.
 */
import "server-only";
import { NextResponse } from "next/server";
import { getActiveMembership } from "@/lib/auth";
import { rowsToCsv } from "@/lib/export-csv";
import { ACCEPTANCE_CSV_COLUMNS, buildAcceptancePackage } from "@/lib/reconciliation acceptance";
import { loadAcceptanceBatch } from "@/lib/reconciliation acceptance data";
import { isUuid } from "@/lib/reconciliation review";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: string, status: number): Response {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * One HTTP status per refusal. `overflow` is 413 (too large to serve in full); `count_mismatch` and
 * `empty` are 409, because both are states of the batch itself rather than server faults — it
 * contradicts its own staging record, or it has no rows to accept. Everything else that is not
 * `not_found` is a 500.
 */
const REFUSAL_STATUS: Record<string, number> = {
  overflow: 413,
  count_mismatch: 409,
  empty: 409,
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ batchId: string }> },
): Promise<Response> {
  const member = await getActiveMembership();
  if (!member) return jsonError("غير مصرّح", 401);
  if (member.role !== "owner" && member.role !== "accountant") {
    return jsonError("ليست لديك صلاحية تنزيل تقرير القبول", 403);
  }

  const { batchId } = await params;
  if (!isUuid(batchId)) return jsonError("مُعرّف الدفعة غير صالح", 400);

  const sb = await createClient();
  const load = await loadAcceptanceBatch(sb, batchId, member.orgId);
  if (!load.ok) {
    if (load.kind === "not_found") return jsonError("الدفعة غير موجودة", 404);
    return jsonError(load.error, REFUSAL_STATUS[load.kind] ?? 500);
  }

  const pkg = buildAcceptancePackage(load.batch, load.rows);
  const csv = rowsToCsv(pkg.csvRows, ACCEPTANCE_CSV_COLUMNS);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${pkg.csvFilename}"`,
      "Cache-Control": "no-store",
    },
  });
}
