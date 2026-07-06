import "server-only";
import { NextResponse } from "next/server";
import { getActiveMembership } from "@/lib/auth";
import { parseBalanceSheet } from "@/lib/balance-sheet";
import { balanceSheetPdfFilename, renderBalanceSheetPdf } from "@/lib/finance-statement-pdf";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function parseDateParam(value: string | null, fallback: string): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function jsonError(error: string, status: number): Response {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: Request): Promise<Response> {
  const member = await getActiveMembership();
  if (!member) return jsonError("غير مصرّح", 401);
  if (member.role !== "owner" && member.role !== "accountant") {
    return jsonError("ليست لديك صلاحية تنزيل هذه القائمة", 403);
  }

  const url = new URL(req.url);
  const today = isoDate(new Date());
  const asOf = parseDateParam(url.searchParams.get("asOf"), today);
  const sb = await createClient();
  const res = await sb.rpc("fn_accounting_balance_sheet", { p_org: member.orgId, p_as_of: asOf });
  if (res.error) throw res.error;

  const pdf = await renderBalanceSheetPdf({ bs: parseBalanceSheet(res.data), asOf, generatedOn: today });
  return new Response(pdf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${balanceSheetPdfFilename(asOf)}"`,
      "Cache-Control": "no-store",
    },
  });
}
