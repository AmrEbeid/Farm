import type { ReactNode } from "react";
import Link from "next/link";
import { CalendarRange, LockKeyhole, LockOpen } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { StatusPill } from "@/components/ui";
import { ExportButton } from "@/components/ExportButton";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";
import { PrintButton } from "@/components/print-button";
import { type SimpleColumn, type SimpleRow } from "@/components/SimpleTable";
import { closePeriod, reopenPeriod } from "./actions";
import { FinanceStatementsNav } from "@/components/FinanceStatementsNav";
import { PageHeader } from "@/components/PageHeader";
import { StoryLine } from "@/components/StoryLine";
import { parseAccountingPeriods } from "@/lib/accounting-periods";

const inputStyle = { border: "1px solid var(--line)", background: "var(--surface)" } as const;
const PERIOD_COLUMNS: SimpleColumn[] = [
  { id: "period", header: "الفترة" },
  { id: "status", header: "الحالة", kind: "status" },
  { id: "note", header: "ملاحظة" },
  { id: "lockedAt", header: "تاريخ الإقفال" },
  { id: "reopenedAt", header: "تاريخ إعادة الفتح" },
];

export default async function FinancePeriodsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const member = await requireRole(["owner", "accountant"]);
  const params = await searchParams;
  const sb = await createClient();
  const result = await sb
    .from("accounting_periods")
    .select("id, org_id, period_start, period_end, status, note, locked_at, reopened_at")
    .eq("org_id", member.orgId)
    .order("period_start", { ascending: false });
  if (result.error) throw result.error;
  const register = parseAccountingPeriods(result.data ?? [], member.orgId);
  const isOwner = member.role === "owner";
  const latestLocked = register.locked[0] ?? null;
  const periodRows: SimpleRow[] = register.periods.map((period) => ({
    id: period.id,
    period: `${fmtDate(period.periodStart)} — ${fmtDate(period.periodEnd)}`,
    status: period.status === "locked" ? "مقفلة" : "مفتوحة",
    note: period.note || "—",
    lockedAt: fmtDate(period.lockedAt),
    reopenedAt: period.reopenedAt ? fmtDate(period.reopenedAt) : "—",
  }));
  const lead = latestLocked
    ? `آخر فترة محمية من ${fmtDate(latestLocked.periodStart)} إلى ${fmtDate(latestLocked.periodEnd)}؛ لا يمكن ترحيل قيد جديد داخلها.`
    : "لا توجد فترة مقفلة؛ أي قيد جديد صحيح الصلاحية قد يغيّر الأرقام التاريخية.";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4" data-testid="accounting-periods">
      <PageHeader
        title="الفترات المحاسبية"
        subtitle="سجل حماية الفترات المعتمدة من القيود الجديدة؛ إعادة الفتح للمالك فقط."
        metadata={<StatusPill status={latestLocked ? "done" : "draft"}>{latestLocked ? "توجد حماية" : "لا توجد حماية"}</StatusPill>}
        actions={<div className="no-print flex flex-wrap gap-2"><PrintButton label="طباعة الفترات" /><ExportButton rows={periodRows} columns={PERIOD_COLUMNS} filename="accounting-periods" /><Link href="/finance/close" className="fos-btn fos-btn--primary fos-btn--md">ابدأ إقفال الشهر</Link></div>}
      />

      <StoryLine lead={lead} notes={["الإقفال لا يغيّر أي قيد قائم؛ يمنع فقط ترحيل قيد جديد بتاريخ داخل الفترة."]} />

      {params.ok ? <ActionNotice title="تم" message={params.ok} /> : null}
      {params.error ? <ActionNotice title="تعذّر التنفيذ" message={params.error} danger /> : null}

      <section aria-label="ملخص الفترات" className="grid border-y sm:grid-cols-3" style={{ borderColor: "var(--line)" }}>
        <Metric label="كل الفترات" value={num(register.periods.length)} icon={<CalendarRange size={16} aria-hidden />} />
        <Metric label="مقفلة" value={num(register.locked.length)} icon={<LockKeyhole size={16} aria-hidden />} />
        <Metric label="أعيد فتحها" value={num(register.open.length)} icon={<LockOpen size={16} aria-hidden />} />
      </section>

      <section className="no-print border-y py-4" style={{ borderColor: "var(--line)" }} aria-labelledby="new-period-title">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2"><div><h2 id="new-period-title" className="text-base font-bold">إقفال فترة جديدة</h2><p className="text-xs" style={{ color: "var(--ink-muted)" }}>استخدم قائمة إقفال الشهر أولًا لمعالجة البنود التي تمنع الاعتماد.</p></div><Link href="/finance/close" className="text-sm font-bold underline underline-offset-4" style={{ color: "var(--brand)" }}>راجع قائمة الإقفال</Link></div>
        <form action={closePeriod} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.4fr_auto]">
          <label className="flex flex-col gap-1 text-sm font-semibold">من تاريخ<input name="period_start" type="date" required className="rounded-md px-3 py-2" style={inputStyle} /></label>
          <label className="flex flex-col gap-1 text-sm font-semibold">إلى تاريخ<input name="period_end" type="date" required className="rounded-md px-3 py-2" style={inputStyle} /></label>
          <label className="flex flex-col gap-1 text-sm font-semibold">ملاحظة (اختياري)<input name="note" type="text" className="rounded-md px-3 py-2" style={inputStyle} placeholder="مثال: إقفال مارس ٢٠٢٦" /></label>
          <div className="flex items-end"><button type="submit" className="fos-btn fos-btn--primary fos-btn--md">إقفال الفترة</button></div>
        </form>
      </section>

      <section aria-labelledby="period-register-title">
        <div className="mb-2 flex items-end justify-between gap-2"><div><h2 id="period-register-title" className="text-base font-bold">سجل الفترات</h2><p className="text-xs" style={{ color: "var(--ink-muted)" }}>{num(register.periods.length)} فترة مرتبة من الأحدث.</p></div></div>
        {register.periods.length ? <div className="border-y" style={{ borderColor: "var(--line)" }}>{register.periods.map((period) => <div key={period.id} className="grid min-h-16 gap-2 border-b py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center" style={{ borderColor: "var(--line)" }}><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong>{fmtDate(period.periodStart)} — {fmtDate(period.periodEnd)}</strong><StatusPill status={period.status === "locked" ? "done" : "draft"}>{period.status === "locked" ? "مقفلة" : "مفتوحة"}</StatusPill></div><p className="mt-1 break-words text-xs leading-5" style={{ color: "var(--ink-muted)" }}>{period.note || "بلا ملاحظة"} · أقفلت {fmtDate(period.lockedAt)}{period.reopenedAt ? ` · أعيد فتحها ${fmtDate(period.reopenedAt)}` : ""}</p></div>{isOwner && period.status === "locked" ? <form action={reopenPeriod} className="no-print"><input type="hidden" name="period_id" value={period.id} /><button type="submit" className="fos-btn fos-btn--secondary fos-btn--sm">إعادة الفتح</button></form> : <span />}</div>)}</div> : <p className="border-y py-5 text-sm" style={{ borderColor: "var(--line)", color: "var(--ink-muted)" }}>لا توجد فترات مسجلة بعد.</p>}
      </section>

      <div className="no-print"><FinanceStatementsNav current="periods" /></div>
    </div>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return <div className="min-w-0 border-b py-3 last:border-b-0 sm:border-b-0 sm:px-4 sm:first:ps-0 sm:[&:not(:first-child)]:border-s" style={{ borderColor: "var(--line)" }}><div className="flex items-center gap-2 text-xs" style={{ color: "var(--ink-muted)" }}>{icon}{label}</div><strong className="mt-1 block text-lg tabular-nums">{value}</strong></div>;
}

function ActionNotice({ title, message, danger = false }: { title: string; message: string; danger?: boolean }) {
  return <section className="no-print border-y py-3" style={{ borderColor: danger ? "var(--danger, #b23b3b)" : "var(--line)" }}><strong style={danger ? { color: "var(--danger, #b23b3b)" } : undefined}>{title}</strong><p className="mt-1 text-sm">{message}</p></section>;
}
