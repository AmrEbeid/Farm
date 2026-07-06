import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Alert, Card, EmptyState, KpiCard } from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { fmtDate } from "@/lib/dates";
import { egp, num } from "@/lib/money";
import { subtreeNetByCode } from "@/lib/accounting-rollup";

type TrialBalanceRow = {
  account_id: string;
  code: string;
  name_ar: string;
  account_type: string;
  normal_balance: string;
  debit: number;
  credit: number;
  net: number;
};

const ACCOUNT_TYPE_AR: Record<string, string> = {
  asset: "أصل",
  liability: "التزام",
  equity: "حقوق ملكية",
  revenue: "إيراد",
  expense: "مصروف",
};

// journal_entries.source_type is caller-defined free text (no DB CHECK) — every value any
// fn_post_two_line_journal caller passes MUST have a label here, else the GL leaks the raw English key
// (rendered below via SOURCE_TYPE_AR[...] ?? entry.source_type). 'sale'/'sale_collection' come from the
// revenue-sales RPCs (migration 20260701500000); add a label here whenever a new posting source ships.
const SOURCE_TYPE_AR: Record<string, string> = {
  custody_owner_funding: "استلام عهدة من المالك",
  expense_payment: "سداد مصروف",
  payment_request_funding: "تمويل طلب صرف",
  sale: "إثبات إيراد بيع",
  sale_collection: "تحصيل من عميل",
};

export default async function AccountingPage() {
  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();

  const [trialRes, entriesRes, linesRes, accountsRes] = await Promise.all([
    sb.rpc("fn_accounting_trial_balance", { p_org: m.orgId }),
    sb
      .from("journal_entries")
      .select("id, entry_date, source_type, source_id, description, status, posted_at")
      .eq("org_id", m.orgId)
      .order("entry_date", { ascending: false })
      .order("posted_at", { ascending: false })
      .limit(20),
    sb
      .from("journal_lines")
      .select("id, journal_entry_id, account_id, debit, credit, description, payment_request_id, expense_id")
      .eq("org_id", m.orgId)
      .order("created_at", { ascending: false })
      .limit(80),
    sb
      .from("accounts")
      .select("id, org_id, code, name_ar, account_type, normal_balance, parent_id")
      .eq("org_id", m.orgId)
      .order("code"),
  ]);
  if (trialRes.error) throw trialRes.error;
  if (entriesRes.error) throw entriesRes.error;
  if (linesRes.error) throw linesRes.error;
  if (accountsRes.error) throw accountsRes.error;

  const trialBalance = parseTrialBalance(trialRes.data);
  const accounts = accountsRes.data ?? [];
  const lines = linesRes.data ?? [];
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const linesByEntry = new Map<string, typeof lines>();
  for (const line of lines) {
    const current = linesByEntry.get(line.journal_entry_id) ?? [];
    current.push(line);
    linesByEntry.set(line.journal_entry_id, current);
  }

  // fn_accounting_trial_balance groups journal_lines by account_id with NO subtree rollup, but real expenses
  // post to LEAF accounts. Roll parent KPIs over the active org's subtree only; RLS can expose several
  // member orgs when no active_org_id claim is present, and duplicate account codes are normal per org.
  const custodyCash = subtreeNetByCode(accounts, trialBalance, "1000", m.orgId);
  const ownerFunding = Math.abs(subtreeNetByCode(accounts, trialBalance, "3000", m.orgId));
  const drawings = subtreeNetByCode(accounts, trialBalance, "3100", m.orgId);
  const capex = subtreeNetByCode(accounts, trialBalance, "1500", m.orgId);
  const operatingExpenses = subtreeNetByCode(accounts, trialBalance, "5000", m.orgId);

  const trialCols: SimpleColumn[] = [
    { id: "code", header: "الكود" },
    { id: "account", header: "الحساب" },
    { id: "type", header: "النوع" },
    { id: "debit", header: "مدين", numeric: true, kind: "money" },
    { id: "credit", header: "دائن", numeric: true, kind: "money" },
    { id: "net", header: "الصافي", numeric: true, kind: "money" },
  ];
  const trialRows = trialBalance.map((row) => ({
    id: row.account_id,
    code: row.code,
    account: row.name_ar,
    type: ACCOUNT_TYPE_AR[row.account_type] ?? row.account_type,
    debit: Number(row.debit ?? 0),
    credit: Number(row.credit ?? 0),
    net: Number(row.net ?? 0),
  }));

  const entryCols: SimpleColumn[] = [
    { id: "date", header: "التاريخ" },
    { id: "source", header: "المصدر" },
    { id: "description", header: "البيان" },
    { id: "amount", header: "القيمة", numeric: true, kind: "money" },
    { id: "status", header: "الحالة" },
  ];
  const entryRows = (entriesRes.data ?? []).map((entry) => {
    const entryLines = linesByEntry.get(entry.id) ?? [];
    const amount = entryLines.reduce((sum, line) => sum + Number(line.debit ?? 0), 0);
    return {
      id: entry.id,
      date: fmtDate(entry.entry_date),
      source: SOURCE_TYPE_AR[entry.source_type] ?? entry.source_type,
      description: entry.description ?? "—",
      amount,
      status: entry.status === "posted" ? "مرحل" : entry.status,
    };
  });

  const lineCols: SimpleColumn[] = [
    { id: "account", header: "الحساب" },
    { id: "description", header: "البيان" },
    { id: "debit", header: "مدين", numeric: true, kind: "money" },
    { id: "credit", header: "دائن", numeric: true, kind: "money" },
    { id: "link", header: "الرابط" },
  ];
  const lineRows = lines.map((line) => {
    const account = accountById.get(line.account_id);
    const link = line.payment_request_id
      ? `طلب صرف ${line.payment_request_id.slice(0, 8)}`
      : line.expense_id
        ? `مصروف ${line.expense_id.slice(0, 8)}`
        : "—";
    return {
      id: line.id,
      account: account ? `${account.code} · ${account.name_ar}` : "—",
      description: line.description ?? "—",
      debit: Number(line.debit ?? 0),
      credit: Number(line.credit ?? 0),
      link,
    };
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">المحاسبة</h1>
          <p style={{ color: "var(--ink-muted)" }}>
            دفتر نقدي مستقل مرتبط بالعهدة وطلبات الصرف والمصروفات.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <HeaderLink href="/finance/reports">تقارير التكلفة</HeaderLink>
          <HeaderLink href="/custody">العهدة وطلبات الصرف</HeaderLink>
          <HeaderLink href="/expenses">المصروفات</HeaderLink>
        </div>
      </header>

      <Alert
        tone="warning"
        title="أساس نقدي"
        description="المصروفات الآجلة تظهر في طلب الصرف، ولا تدخل الدفتر إلا بعد استلام تمويل المالك كعهدة ثم تأكيد السداد من مصدر العهدة."
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="عهدة نقدية" value={egp(custodyCash)} />
        <KpiCard label="تمويل المالك" value={egp(ownerFunding)} />
        <KpiCard label="مصروفات تشغيلية" value={egp(operatingExpenses)} />
        <KpiCard label="رأسمالي" value={egp(capex)} />
        <KpiCard label="مسحوبات مالك" value={egp(drawings)} />
      </section>

      <Card title="ميزان المراجعة النقدي">
        {trialRows.length ? (
          <SimpleTable columns={trialCols} rows={trialRows} ariaLabel="ميزان المراجعة النقدي" empty="—" />
        ) : (
          <EmptyState title="لا توجد قيود محاسبية بعد" />
        )}
      </Card>

      <section className="grid gap-5 xl:grid-cols-2">
        <Card title={`آخر القيود (${num(entryRows.length)})`}>
          <SimpleTable columns={entryCols} rows={entryRows} ariaLabel="آخر القيود" empty="لا توجد قيود بعد" />
        </Card>
        <Card title="تفاصيل القيود">
          <SimpleTable columns={lineCols} rows={lineRows} ariaLabel="تفاصيل القيود" empty="لا توجد سطور قيود بعد" />
        </Card>
      </section>
    </div>
  );
}

function parseTrialBalance(value: unknown): TrialBalanceRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const r = row as Record<string, unknown>;
    if (typeof r.account_id !== "string" || typeof r.code !== "string" || typeof r.name_ar !== "string") {
      return [];
    }
    return [{
      account_id: r.account_id,
      code: r.code,
      name_ar: r.name_ar,
      account_type: typeof r.account_type === "string" ? r.account_type : "asset",
      normal_balance: typeof r.normal_balance === "string" ? r.normal_balance : "debit",
      debit: Number(r.debit ?? 0),
      credit: Number(r.credit ?? 0),
      net: Number(r.net ?? 0),
    }];
  });
}

function HeaderLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-9 items-center justify-center rounded-md px-3 text-sm font-semibold"
      style={{
        color: "var(--brand)",
        background: "var(--surface)",
        border: "1px solid var(--line)",
      }}
    >
      {children}
    </Link>
  );
}
