import "server-only";
import { NextResponse } from "next/server";
import { getActiveMembership } from "@/lib/auth";
import { parseBalanceSheet } from "@/lib/balance-sheet";
import { parseIncomeStatement } from "@/lib/income-statement";
import { renderStatementPackagePdf, statementPackagePdfFilename } from "@/lib/finance-statement-pdf";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function firstOfMonth(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-01`;
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
    return jsonError("ليست لديك صلاحية تنزيل حزمة القوائم", 403);
  }

  const url = new URL(req.url);
  const today = new Date();
  const generatedOn = isoDate(today);
  const start = parseDateParam(url.searchParams.get("start"), firstOfMonth(today));
  const end = parseDateParam(url.searchParams.get("end"), generatedOn);
  const asOf = parseDateParam(url.searchParams.get("asOf"), end);
  const sb = await createClient();

  const [incomeRes, balanceRes] = await Promise.all([
    sb.rpc("fn_accounting_income_statement", { p_org: member.orgId, p_from: start, p_to: end }),
    sb.rpc("fn_accounting_balance_sheet", { p_org: member.orgId, p_as_of: asOf }),
  ]);
  if (incomeRes.error) throw incomeRes.error;
  if (balanceRes.error) throw balanceRes.error;

  const pdf = await renderStatementPackagePdf({
    incomeStatement: parseIncomeStatement(incomeRes.data),
    balanceSheet: parseBalanceSheet(balanceRes.data),
    start,
    end,
    asOf,
    generatedOn,
  });
  return new Response(pdf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${statementPackagePdfFilename(start, end, asOf)}"`,
      "Cache-Control": "no-store",
    },
  });
}
