import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Alert, Card, EmptyState, KpiCard } from "@/components/ui";
import { FilterableTable } from "@/components/FilterableTable";
import { type SimpleColumn } from "@/components/SimpleTable";
import { PrintButton } from "@/components/print-button";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";
import { absoluteDecimal, egpExact } from "@/lib/decimal";
import { subtreeNetByCodeExact } from "@/lib/accounting-rollup";
import { parseAccountingLedgerSnapshot } from "@/lib/accounting ledger snapshot";

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

  const snapshotRes = await sb.rpc("fn_accounting_ledger_snapshot", {
    p_org: m.orgId,
    p_entry_limit: 20,
  });
  if (snapshotRes.error) throw snapshotRes.error;
  const { trialBalance, recentEntries: entries, recentLines: lines } =
    parseAccountingLedgerSnapshot(snapshotRes.data, m.orgId);

  // The snapshot carries the account tree and exact posted-only balances from one database statement.
  const accountTree = trialBalance.map((row) => ({
    id: row.account_id,
    org_id: row.org_id,
    code: row.code,
    parent_id: row.parent_id,
  }));
  const custodyCash = subtreeNetByCodeExact(accountTree, trialBalance, "1000", m.orgId);
  const ownerFunding = absoluteDecimal(subtreeNetByCodeExact(accountTree, trialBalance, "3000", m.orgId));
  const drawings = subtreeNetByCodeExact(accountTree, trialBalance, "3100", m.orgId);
  const capex = subtreeNetByCodeExact(accountTree, trialBalance, "1500", m.orgId);
  const operatingExpenses = subtreeNetByCodeExact(accountTree, trialBalance, "5000", m.orgId);

  const trialCols: SimpleColumn[] = [
    { id: "code", header: "الكود" },
    { id: "account", header: "الحساب" },
    { id: "type", header: "النوع" },
    { id: "debit", header: "مدين", numeric: true, decimal: true, kind: "money-preserve-exact" },
    { id: "credit", header: "دائن", numeric: true, decimal: true, kind: "money-preserve-exact" },
    { id: "net", header: "الصافي", numeric: true, decimal: true, kind: "money-preserve-exact" },
  ];
  const trialRows = trialBalance.filter((row) => row.active || row.has_postings).map((row) => ({
    id: row.account_id,
    code: row.code,
    account: row.name_ar,
    type: ACCOUNT_TYPE_AR[row.account_type] ?? row.account_type,
    debit: row.debit,
    credit: row.credit,
    net: row.net,
  }));

  const entryCols: SimpleColumn[] = [
    { id: "date", header: "التاريخ" },
    { id: "source", header: "المصدر" },
    { id: "description", header: "البيان" },
    { id: "amount", header: "القيمة", numeric: true, decimal: true, kind: "money-preserve-exact" },
    { id: "status", header: "الحالة" },
  ];
  const entryRows = entries.map((entry) => {
    return {
      id: entry.id,
      date: fmtDate(entry.entry_date),
      source: SOURCE_TYPE_AR[entry.source_type] ?? entry.source_type,
      description: entry.description ?? "—",
      amount: entry.amount ?? undefined,
      status: entry.status === "posted" ? "مرحل" : entry.status,
    };
  });

  const lineCols: SimpleColumn[] = [
    { id: "account", header: "الحساب" },
    { id: "description", header: "البيان" },
    { id: "debit", header: "مدين", numeric: true, decimal: true, kind: "money-preserve-exact" },
    { id: "credit", header: "دائن", numeric: true, decimal: true, kind: "money-preserve-exact" },
    { id: "link", header: "الرابط" },
  ];
  const lineRows = lines.map((line) => {
    const link = line.payment_request_id
      ? `طلب صرف ${line.payment_request_id.slice(0, 8)}`
      : line.expense_id
        ? `مصروف ${line.expense_id.slice(0, 8)}`
        : "—";
    return {
      id: line.id,
      account: `${line.account_code} · ${line.account_name_ar}`,
      description: line.description ?? "—",
      debit: line.debit,
      credit: line.credit,
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
          <PrintButton label="طباعة الدفتر" />
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
        <KpiCard label="عهدة نقدية" value={egpExact(custodyCash)} />
        <KpiCard label="تمويل المالك" value={egpExact(ownerFunding)} />
        <KpiCard label="مصروفات تشغيلية" value={egpExact(operatingExpenses)} />
        <KpiCard label="رأسمالي" value={egpExact(capex)} />
        <KpiCard label="مسحوبات مالك" value={egpExact(drawings)} />
      </section>

      <Card title="ميزان المراجعة النقدي">
        {trialRows.length ? (
          <FilterableTable
            columns={trialCols}
            rows={trialRows}
            ariaLabel="ميزان المراجعة النقدي"
            empty="—"
            exportFilename="accounting-trial-balance.csv"
            minRowsForSearch={1}
          />
        ) : (
          <EmptyState title="لا توجد قيود محاسبية بعد" />
        )}
      </Card>

      <section className="grid gap-5 xl:grid-cols-2">
        <Card title={`آخر القيود (${num(entryRows.length)})`}>
          <FilterableTable
            columns={entryCols}
            rows={entryRows}
            ariaLabel="آخر القيود"
            empty="لا توجد قيود بعد"
            minRowsForSearch={1}
          />
        </Card>
        <Card title="تفاصيل القيود">
          <p className="mb-2 text-sm" style={{ color: "var(--ink-muted)" }}>
            تعرض هذه القائمة سطور القيود العشرين المعروضة في «آخر القيود» فقط، وليست سجلاً كاملاً لكل
            سطور اليومية.
          </p>
          <FilterableTable
            columns={lineCols}
            rows={lineRows}
            ariaLabel="تفاصيل القيود"
            empty="لا توجد سطور قيود بعد"
            minRowsForSearch={1}
          />
        </Card>
      </section>
    </div>
  );
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
