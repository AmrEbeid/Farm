import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, BookOpenCheck, CircleAlert, Landmark, ReceiptText, Scale } from "lucide-react";
import { FilterableTable } from "@/components/FilterableTable";
import { PageHeader } from "@/components/PageHeader";
import { PrintButton } from "@/components/print-button";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { EmptyState, StatusPill } from "@/components/ui";
import { subtreeNetByCodeExact } from "@/lib/accounting-rollup";
import type {
  AccountingLedgerSnapshot,
  AccountingRecentEntry,
  AccountingRecentLine,
} from "@/lib/accounting ledger snapshot";
import {
  absoluteDecimal,
  compareDecimals,
  egpExact,
  sumDecimals,
  type DecimalString,
} from "@/lib/decimal";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";

const ACCOUNT_TYPE_AR: Record<string, string> = {
  asset: "أصول",
  liability: "التزامات",
  equity: "حقوق ملكية",
  revenue: "إيرادات",
  expense: "مصروفات",
};

const SOURCE_TYPE_AR: Record<string, string> = {
  custody_owner_funding: "استلام عهدة من المالك",
  expense: "إثبات مصروف",
  expense_payment: "سداد مصروف",
  opening_balance: "رصيد افتتاحي",
  payment_request_funding: "تمويل طلب صرف",
  sale: "إثبات إيراد بيع",
  sale_collection: "تحصيل من عميل",
};

function sourceTypeLabel(sourceType: string): string {
  return SOURCE_TYPE_AR[sourceType] ?? `قيد محاسبي (${sourceType})`;
}

function Metric({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="min-w-0 border-b py-3 last:border-b-0 sm:border-b-0 sm:px-4 sm:first:ps-0 sm:[&:not(:first-child)]:border-s" style={{ borderColor: "var(--line)" }}>
      <div className="flex items-center gap-2 text-xs" style={{ color: "var(--ink-muted)" }}>{icon}{label}</div>
      <strong className="mt-1 block text-lg tabular-nums">{value}</strong>
    </div>
  );
}

function SourceLinks({ line }: { line: AccountingRecentLine }) {
  if (!line.payment_request_id && !line.expense_id) return null;
  return (
    <span className="flex flex-wrap gap-2 text-xs">
      {line.payment_request_id && (
        <Link href={`/custody/request/${line.payment_request_id}`} className="underline underline-offset-4" style={{ color: "var(--brand)" }}>
          طلب الصرف {line.payment_request_id.slice(0, 8)}
        </Link>
      )}
      {line.expense_id && (
        <Link href={`/expenses/${line.expense_id}`} className="underline underline-offset-4" style={{ color: "var(--brand)" }}>
          المصروف {line.expense_id.slice(0, 8)}
        </Link>
      )}
    </span>
  );
}

function JournalLine({ line }: { line: AccountingRecentLine }) {
  const isDebit = compareDecimals(line.debit, "0") > 0;
  return (
    <li className="grid gap-1 border-t py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" style={{ borderColor: "var(--line)" }}>
      <div className="min-w-0">
        <p className="font-semibold"><span className="tabular-nums">{line.account_code}</span> · {line.account_name_ar}</p>
        <p className="text-xs" style={{ color: "var(--ink-muted)" }}>{line.description ?? "لا يوجد بيان إضافي"}</p>
        <SourceLinks line={line} />
      </div>
      <p className="text-sm tabular-nums">
        <span style={{ color: "var(--ink-muted)" }}>{isDebit ? "مدين" : "دائن"} </span>
        <strong>{egpExact(isDebit ? line.debit : line.credit)}</strong>
      </p>
    </li>
  );
}

function JournalEntry({ entry, lines, open }: {
  entry: AccountingRecentEntry;
  lines: AccountingRecentLine[];
  open: boolean;
}) {
  const debit = sumDecimals(lines.map((line) => line.debit)).total;
  const credit = sumDecimals(lines.map((line) => line.credit)).total;
  const balanced = compareDecimals(debit, credit) === 0;
  const posted = entry.status === "posted";
  return (
    <details open={open} className="group border-b last:border-b-0" style={{ borderColor: "var(--line)" }}>
      <summary className="min-h-14 cursor-pointer list-none py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold">{sourceTypeLabel(entry.source_type)}</p>
            <p className="truncate text-xs" style={{ color: "var(--ink-muted)" }}>{fmtDate(entry.entry_date)} · {entry.description ?? "بدون بيان"}</p>
          </div>
          <div className="flex items-center gap-2">
            <strong className="text-sm tabular-nums">{entry.amount === null ? "—" : egpExact(entry.amount)}</strong>
            <StatusPill status={posted ? "done" : "blocked"}>{posted ? "مرحل" : "معكوس"}</StatusPill>
            {!balanced && <StatusPill status="blocked">غير متزن</StatusPill>}
          </div>
        </div>
      </summary>
      <div className="pb-2 ps-3 sm:ps-5">
        <ul>{lines.map((line) => <JournalLine key={line.id} line={line} />)}</ul>
        <p className="py-2 text-xs tabular-nums" style={{ color: "var(--ink-muted)" }}>
          إجمالي المدين {egpExact(debit)} · إجمالي الدائن {egpExact(credit)}
        </p>
      </div>
    </details>
  );
}

function ledgerValues(snapshot: AccountingLedgerSnapshot) {
  const accountTree = snapshot.trialBalance.map((row) => ({
    id: row.account_id,
    org_id: row.org_id,
    code: row.code,
    parent_id: row.parent_id,
  }));
  const orgId = snapshot.trialBalance[0]?.org_id ?? "";
  const value = (code: string): DecimalString => subtreeNetByCodeExact(accountTree, snapshot.trialBalance, code, orgId);
  return {
    custodyCash: value("1000"),
    ownerFunding: absoluteDecimal(value("3000")),
    drawings: value("3100"),
    capex: value("1500"),
    operatingExpenses: value("5000"),
  };
}

export function AccountingLedgerView({ snapshot }: { snapshot: AccountingLedgerSnapshot }) {
  const values = ledgerValues(snapshot);
  const totalDebit = sumDecimals(snapshot.trialBalance.map((row) => row.debit)).total;
  const totalCredit = sumDecimals(snapshot.trialBalance.map((row) => row.credit)).total;
  const ledgerBalanced = compareDecimals(totalDebit, totalCredit) === 0;
  const postingAccounts = snapshot.trialBalance.filter((row) => row.has_postings).length;
  const linesByEntry = new Map<string, AccountingRecentLine[]>();
  for (const line of snapshot.recentLines) {
    const entryLines = linesByEntry.get(line.journal_entry_id) ?? [];
    entryLines.push(line);
    linesByEntry.set(line.journal_entry_id, entryLines);
  }

  const trialCols: SimpleColumn[] = [
    { id: "code", header: "الكود" },
    { id: "account", header: "الحساب" },
    { id: "type", header: "النوع" },
    { id: "debit", header: "مدين", numeric: true, decimal: true, kind: "money-preserve-exact" },
    { id: "credit", header: "دائن", numeric: true, decimal: true, kind: "money-preserve-exact" },
    { id: "net", header: "الصافي", numeric: true, decimal: true, kind: "money-preserve-exact" },
  ];
  const trialRows = snapshot.trialBalance.filter((row) => row.active || row.has_postings).map((row) => ({
    id: row.account_id,
    code: row.code,
    account: row.name_ar,
    type: ACCOUNT_TYPE_AR[row.account_type] ?? "غير مصنف",
    debit: row.debit,
    credit: row.credit,
    net: row.net,
  }));

  return (
    <main
      className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4"
      data-testid="accounting-ledger"
      style={{ "--ink-muted": "#5f7066" } as CSSProperties}
    >
      <PageHeader
        title="دفتر الأستاذ"
        subtitle="مراجعة حركة النقد والقيود المرحّلة، من المصدر إلى الحساب."
        metadata={<StatusPill status={ledgerBalanced ? "done" : "blocked"}>{ledgerBalanced ? "الدفتر متزن" : "راجع الاتزان"}</StatusPill>}
        actions={<div className="no-print flex flex-wrap gap-2"><PrintButton label="طباعة الدفتر" /><Link href="/record" className="fos-btn fos-btn--primary fos-btn--md">سجّل عملية</Link></div>}
      />

      {!ledgerBalanced && (
        <section className="flex items-start gap-2 border-y py-3" style={{ color: "var(--danger-fg)", borderColor: "var(--line)" }}>
          <CircleAlert size={18} aria-hidden className="mt-0.5 shrink-0" />
          <div><h2 className="text-sm font-bold">ميزان المراجعة غير متزن</h2><p className="text-xs">أوقف الإقفال وراجع القيود قبل أي قرار مالي.</p></div>
        </section>
      )}

      <section aria-labelledby="ledger-position-title">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div><h2 id="ledger-position-title" className="text-base font-bold">الموقف النقدي</h2><p className="text-xs" style={{ color: "var(--ink-muted)" }}>أرصدة مرحّلة فقط؛ المصروف الآجل لا يظهر قبل السداد.</p></div>
          <Link href="/custody" className="text-sm font-semibold underline underline-offset-4" style={{ color: "var(--brand)" }}>راجع العهدة وطلبات الصرف</Link>
        </div>
        <div className="mt-2 grid border-y sm:grid-cols-2 lg:grid-cols-5" style={{ borderColor: "var(--line)" }}>
          <Metric label="نقد العهدة" value={egpExact(values.custodyCash)} icon={<Landmark size={16} aria-hidden />} />
          <Metric label="تمويل المالك" value={egpExact(values.ownerFunding)} icon={<ReceiptText size={16} aria-hidden />} />
          <Metric label="تشغيل" value={egpExact(values.operatingExpenses)} icon={<BookOpenCheck size={16} aria-hidden />} />
          <Metric label="رأسمالي" value={egpExact(values.capex)} icon={<Scale size={16} aria-hidden />} />
          <Metric label="مسحوبات مالك" value={egpExact(values.drawings)} icon={<ReceiptText size={16} aria-hidden />} />
        </div>
      </section>

      <nav aria-label="أعمال المحاسبة" className="no-print grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <WorkflowLink href="/finance/reconciliation" title="طابق السجلات" detail="راجع الدفعات المجهزة" />
        <WorkflowLink href="/finance/periods" title="أقفل الفترة" detail="بعد اكتمال المراجعة" />
        <WorkflowLink href="/finance/income-statement" title="قائمة الدخل" detail="النتيجة حسب الفترة" />
        <WorkflowLink href="/finance/balance-sheet" title="المركز المالي" detail="الأصول والالتزامات" />
      </nav>

      <section aria-labelledby="recent-journals-title" className="no-print">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div><h2 id="recent-journals-title" className="text-base font-bold">آخر القيود</h2><p className="text-xs" style={{ color: "var(--ink-muted)" }}>أحدث {num(snapshot.entryLimit)} قيدًا كحد أقصى، ومعها كل سطورها.</p></div>
          <span className="text-xs tabular-nums" style={{ color: "var(--ink-muted)" }}>{num(snapshot.recentEntries.length)} قيد · {num(snapshot.recentLines.length)} سطر</span>
        </div>
        {snapshot.recentEntries.length === 0 ? (
          <EmptyState title="لا توجد قيود مرحّلة بعد" description="ابدأ بتسجيل تمويل عهدة أو عملية مالية مكتملة." action={<Link href="/record" className="fos-btn fos-btn--primary fos-btn--md">سجّل عملية</Link>} />
        ) : (
          <div className="mt-2 border-y" style={{ borderColor: "var(--line)" }}>
            {snapshot.recentEntries.map((entry, index) => (
              <JournalEntry key={entry.id} entry={entry} lines={linesByEntry.get(entry.id) ?? []} open={index === 0} />
            ))}
          </div>
        )}
      </section>

      <details className="no-print border-y py-3" style={{ borderColor: "var(--line)" }}>
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
          <span>ميزان المراجعة الكامل</span>
          <span className="text-xs font-normal tabular-nums" style={{ color: "var(--ink-muted)" }}>{num(postingAccounts)} حساب عليه حركة · مدين {egpExact(totalDebit)} · دائن {egpExact(totalCredit)}</span>
        </summary>
        <div className="mt-3">
          {trialRows.length ? (
            <FilterableTable columns={trialCols} rows={trialRows} ariaLabel="ميزان المراجعة النقدي" empty="—" exportFilename="accounting-trial-balance.csv" minRowsForSearch={1} />
          ) : <EmptyState title="لا توجد حسابات أو قيود بعد" />}
        </div>
      </details>

      <section className="print-only" aria-label="دفتر الأستاذ الكامل للطباعة">
        <h2 className="mb-2 text-base font-bold">القيود المحاسبية المعروضة</h2>
        <p className="mb-3 text-sm">
          هذه النسخة تعرض أحدث {num(snapshot.entryLimit)} قيدًا كحد أقصى، وليست سجل القيود التاريخي الكامل.
        </p>
        {snapshot.recentEntries.length === 0 ? <p>لا توجد قيود محاسبية بعد.</p> : (
          <div className="border-y" style={{ borderColor: "var(--line)" }}>
            {snapshot.recentEntries.map((entry) => (
              <JournalEntry key={entry.id} entry={entry} lines={linesByEntry.get(entry.id) ?? []} open />
            ))}
          </div>
        )}
        <h2 className="mb-2 mt-5 text-base font-bold">ميزان المراجعة الكامل</h2>
        {trialRows.length ? (
          <SimpleTable columns={trialCols} rows={trialRows} ariaLabel="ميزان المراجعة النقدي الكامل للطباعة" empty="—" />
        ) : <p>لا توجد حسابات أو قيود بعد.</p>}
      </section>
    </main>
  );
}

function WorkflowLink({ href, title, detail }: { href: string; title: string; detail: string }) {
  return (
    <Link href={href} className="flex min-h-16 items-center justify-between gap-3 border-y px-1 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" style={{ borderColor: "var(--line)" }}>
      <span><strong className="block text-sm">{title}</strong><span className="text-xs" style={{ color: "var(--ink-muted)" }}>{detail}</span></span>
      <ArrowLeft size={17} aria-hidden style={{ color: "var(--brand)" }} />
    </Link>
  );
}
