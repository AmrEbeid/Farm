import type { ReactNode } from "react";
import Link from "next/link";
import { CircleAlert, ClipboardCheck, Download, ListTodo } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { StatusPill } from "@/components/ui";
import { StoryLine } from "@/components/StoryLine";
import { PrintButton } from "@/components/print-button";
import { num } from "@/lib/money";
import { egpExact } from "@/lib/decimal";
import { fmtDate } from "@/lib/dates";
import { monthCloseDates } from "@/lib/month-close";
import { buildMonthCloseItems, parseMonthCloseSummary } from "@/lib/month-close-summary";
import { closePeriod } from "../periods/actions";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

const CUTOVER = "2026-07-01";
const inputStyle = { border: "1px solid var(--line)", background: "var(--surface)" } as const;

export default async function MonthClosePage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const member = await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const params = await searchParams;
  const { monthStart, asOf: todayIso } = monthCloseDates();
  const summaryRes = await sb.rpc("fn_month_close_summary", {
    p_org: member.orgId,
    p_cutover: CUTOVER,
    p_as_of: todayIso,
  });
  if (summaryRes.error) throw summaryRes.error;
  const summary = parseMonthCloseSummary(summaryRes.data);
  const visibleItems = buildMonthCloseItems(summary).filter((item) => item.count > 0);
  const blockers = visibleItems.filter((i) => i.blocksClose);
  const followUps = visibleItems.filter((i) => !i.blocksClose);
  const ready = blockers.length === 0;
  const lead = ready
    ? followUps.length === 0
      ? "لقطة اليوم بلا معلّقات؛ راجع القوائم ثم اقفل الفترة المطابقة."
      : `لا معلّقات تمنع الإقفال؛ تبقى ${num(followUps.length)} متابعة لا تمنع القفل.`
    : `لا يمكن إقفال الفترة قبل معالجة ${num(blockers.length)} نوع من المعلّقات.`;
  const reviewLinks = [
    { href: `/finance/income-statement?start=${monthStart}&end=${todayIso}`, label: "قائمة الدخل", hint: `${fmtDate(monthStart)} — ${fmtDate(todayIso)}` },
    { href: `/finance/balance-sheet?asOf=${todayIso}`, label: "المركز المالي", hint: `حتى ${fmtDate(todayIso)}` },
    { href: "/finance/periods", label: "سجل الفترات", hint: "راجع الحماية وإعادة الفتح" },
  ];
  const statementPackageHref = `/api/finance/statements.pdf?start=${encodeURIComponent(monthStart)}&end=${encodeURIComponent(todayIso)}&asOf=${encodeURIComponent(todayIso)}`;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4" data-testid="month-close">
      <PageHeader
        title="إقفال الشهر"
        subtitle={`قائمة دقيقة من الدفاتر الحية حتى ${fmtDate(todayIso)} قبل حماية الفترة.`}
        metadata={<StatusPill status={ready ? "done" : "blocked"}>{ready ? "جاهزة للمراجعة" : "توجد معلّقات"}</StatusPill>}
        actions={<div className="no-print flex flex-wrap gap-2"><PrintButton label="طباعة إقفال الشهر" />{ready ? <a href={statementPackageHref} className="fos-btn fos-btn--secondary fos-btn--md"><Download aria-hidden size={16} /> حزمة القوائم</a> : null}</div>}
      />

      <StoryLine lead={lead} notes={[`الفحص يغطي الدفاتر الحية من ${fmtDate(CUTOVER)} إلى ${fmtDate(todayIso)}؛ الأرشيف الأقدم خارج هذه اللقطة.`]} />

      {params.ok ? <ActionNotice title="تم" message={params.ok} /> : null}
      {params.error ? <ActionNotice title="تعذّر التنفيذ" message={params.error} danger /> : null}

      <section aria-label="ملخص جاهزية الإقفال" className="grid border-y sm:grid-cols-3" style={{ borderColor: "var(--line)" }}>
        <Metric label="تمنع الإقفال" value={num(blockers.length)} icon={<CircleAlert size={16} aria-hidden />} />
        <Metric label="متابعة فقط" value={num(followUps.length)} icon={<ListTodo size={16} aria-hidden />} />
        <Metric label="حالة القفل" value={ready ? "جاهز بعد مراجعة القوائم" : "غير جاهز"} icon={<ClipboardCheck size={16} aria-hidden />} />
      </section>

      {visibleItems.length ? (
        <section aria-labelledby="close-items-title">
          <div className="mb-2"><h2 id="close-items-title" className="text-base font-bold">ما يحتاج عملًا</h2><p className="text-xs" style={{ color: "var(--ink-muted)" }}>ابدأ بالبند الأول الذي يمنع الإقفال.</p></div>
          <div className="border-y" style={{ borderColor: "var(--line)" }}>
            {visibleItems.map((item) => (
              <div key={item.key} className="grid min-h-16 gap-2 border-b py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" style={{ borderColor: "var(--line)" }}>
                <div className="min-w-0"><div className="flex flex-wrap items-baseline gap-2"><strong className="text-lg tabular-nums" style={{ color: item.blocksClose ? "var(--danger, #b23b3b)" : "var(--warning, #8a5b00)" }}>{num(item.count)}</strong><strong>{item.label}</strong><StatusPill status={item.blocksClose ? "blocked" : "draft"}>{item.blocksClose ? "يمنع الإقفال" : "لا تمنع إقفال الفترة"}</StatusPill></div>{item.amount != null && item.amount !== "0" ? <p className="mt-1 text-sm tabular-nums">المبالغ المعروفة: {egpExact(item.amount)}</p> : null}{item.unknownCount != null && item.unknownCount > 0 ? <p className="mt-1 text-xs font-semibold" style={{ color: "var(--danger, #b23b3b)" }}>{num(item.unknownCount)} مبالغها غير مسجلة؛ الإجمالي لا يشملها.</p> : null}</div>
                <Link href={item.href} className="no-print fos-btn fos-btn--secondary fos-btn--sm">{item.cta}</Link>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {ready ? (
        <section aria-labelledby="statement-review-title">
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2"><div><h2 id="statement-review-title" className="text-base font-bold">راجع قبل القفل</h2><p className="text-xs" style={{ color: "var(--ink-muted)" }}>نظافة القائمة لا تعني اعتماد الأرقام تلقائيًا.</p></div></div>
          <div className="grid border-y md:grid-cols-3" style={{ borderColor: "var(--line)" }}>{reviewLinks.map((link) => <Link key={link.href} href={link.href} className="min-w-0 border-b py-3 last:border-b-0 md:border-b-0 md:px-4 md:first:ps-0 md:[&:not(:first-child)]:border-s" style={{ borderColor: "var(--line)" }}><strong className="block" style={{ color: "var(--brand)" }}>{link.label}</strong><span className="mt-1 block text-xs" style={{ color: "var(--ink-muted)" }}>{link.hint}</span></Link>)}</div>
        </section>
      ) : null}

      <section className="no-print border-y py-4" style={{ borderColor: "var(--line)" }} aria-labelledby="lock-period-title">
        <div className="mb-3"><h2 id="lock-period-title" className="text-base font-bold">قفل الفترة المحاسبية</h2><p className="text-xs" style={{ color: "var(--ink-muted)" }}>{ready ? "بعد مراجعة القوائم واعتمادها، يمنع القفل أي قيد جديد بتاريخ داخل الفترة." : "عالج المعلّقات أعلاه؛ يعيد الخادم فحصها داخل نفس معاملة القفل."}</p></div>
        <form action={closePeriod} className="grid gap-3 md:grid-cols-[1fr_1fr_1.4fr_auto]">
          <input type="hidden" name="return_to" value="close" />
          <label className="flex flex-col gap-1 text-sm font-semibold">من تاريخ<input name="period_start" type="date" defaultValue={monthStart} required readOnly className="rounded-md px-3 py-2" style={inputStyle} /></label>
          <label className="flex flex-col gap-1 text-sm font-semibold">إلى تاريخ<input name="period_end" type="date" defaultValue={todayIso} required readOnly className="rounded-md px-3 py-2" style={inputStyle} /></label>
          <label className="flex flex-col gap-1 text-sm font-semibold">ملاحظة<input name="note" type="text" defaultValue={`إقفال يبدأ ${fmtDate(monthStart)}`} className="rounded-md px-3 py-2" style={inputStyle} /></label>
          <div className="flex items-end"><button type="submit" disabled={!ready} className="fos-btn fos-btn--primary fos-btn--md disabled:cursor-not-allowed disabled:opacity-60">{ready ? "إقفال الفترة" : "عالج المعلّقات"}</button></div>
        </form>
        <Link href="/finance/periods" className="mt-3 inline-block text-sm font-bold underline underline-offset-4" style={{ color: "var(--brand)" }}>عرض سجل الفترات</Link>
      </section>
    </div>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return <div className="min-w-0 border-b py-3 last:border-b-0 sm:border-b-0 sm:px-4 sm:first:ps-0 sm:[&:not(:first-child)]:border-s" style={{ borderColor: "var(--line)" }}><div className="flex items-center gap-2 text-xs" style={{ color: "var(--ink-muted)" }}>{icon}{label}</div><strong className="mt-1 block text-base tabular-nums">{value}</strong></div>;
}

function ActionNotice({ title, message, danger = false }: { title: string; message: string; danger?: boolean }) {
  return <section className="no-print border-y py-3" style={{ borderColor: danger ? "var(--danger, #b23b3b)" : "var(--line)" }}><strong style={danger ? { color: "var(--danger, #b23b3b)" } : undefined}>{title}</strong><p className="mt-1 text-sm">{message}</p></section>;
}
