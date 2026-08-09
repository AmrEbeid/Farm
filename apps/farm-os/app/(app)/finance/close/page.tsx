import Link from "next/link";
import { Download } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card } from "@/components/ui";
import { StoryLine } from "@/components/StoryLine";
import { PrintButton } from "@/components/print-button";
import { num } from "@/lib/money";
import { egpExact } from "@/lib/decimal";
import { monthCloseDates } from "@/lib/month-close";
import { buildMonthCloseItems, parseMonthCloseSummary } from "@/lib/month-close-summary";
import { closePeriod } from "../periods/actions";

// R-7 — «إقفال الشهر»: the accountant's generated, dated to-do. Every item is an exact live count
// with one tap to its fixing surface, scoped to the live-entry era (from the 1 July 2026 cutover;
// imported archive is deliberately excluded). An empty snapshot unlocks statement review and the
// matching period-lock form; it is not itself accountant acceptance.

export const dynamic = "force-dynamic";

const CUTOVER = "2026-07-01"; // live-entry era start (Stage-M archive before this is closed history)
const inputStyle = { border: "1px solid var(--line)", background: "var(--surface)" } as const;

export default async function MonthClosePage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const params = await searchParams;
  const { monthStart, asOf: todayIso } = monthCloseDates();
  const monthLabel = monthStart.slice(0, 7);
  const summaryRes = await sb.rpc("fn_month_close_summary", {
    p_org: m.orgId,
    p_cutover: CUTOVER,
    p_as_of: todayIso,
  });
  if (summaryRes.error) throw summaryRes.error;
  const summary = parseMonthCloseSummary(summaryRes.data);

  const items = buildMonthCloseItems(summary);
  const visibleItems = items.filter((i) => i.count > 0);
  const blockers = visibleItems.filter((i) => i.blocksClose);
  const followUps = visibleItems.filter((i) => !i.blocksClose);
  const lead =
    blockers.length === 0
      ? followUps.length === 0
        ? "لا معلّقات في لقطة اليوم ✓ — راجع القوائم، ثم اقفل الفترة المطابقة."
        : `لا معلّقات تمنع الإقفال ✓ — تبقى للمتابعة: ${followUps.map((i) => `${num(i.count)} ${i.label}`).join("، ")}.`
      : `يفصلك عن الإقفال ${num(blockers.length)} بند: ${blockers.map((i) => `${num(i.count)} ${i.label}`).join("، ")}.`;
  const reviewLinks = [
    {
      href: `/finance/income-statement?start=${monthStart}&end=${todayIso}`,
      label: "راجع قائمة الدخل",
      hint: `من ${monthStart} إلى ${todayIso}`,
    },
    {
      href: `/finance/balance-sheet?asOf=${todayIso}`,
      label: "راجع المركز المالي",
      hint: `حتى ${todayIso}`,
    },
    {
      href: "/finance/periods",
      label: "افتح سجل الفترات",
      hint: "اقفل الفترة بعد اعتماد القوائم",
    },
  ];
  const statementPackageHref = `/api/finance/statements.pdf?start=${encodeURIComponent(monthStart)}&end=${encodeURIComponent(todayIso)}&asOf=${encodeURIComponent(todayIso)}`;

  return (
    <div className="flex flex-col gap-4 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>إقفال الشهر</h1>
          <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
            لقطة دقيقة من الدفاتر الحية من {CUTOVER} إلى {todayIso}. فترة القفل المطابقة تبدأ {monthStart}.
          </p>
        </div>
        <PrintButton label="طباعة إقفال الشهر" />
      </header>

      <StoryLine lead={lead} />

      {params.ok ? (
        <div className="no-print">
          <Card title="تم">
            <p className="font-semibold">{params.ok}</p>
          </Card>
        </div>
      ) : null}
      {params.error ? (
        <div className="no-print">
          <Card title="تعذّر التنفيذ">
            <p className="font-semibold">{params.error}</p>
          </Card>
        </div>
      ) : null}

      {visibleItems.length > 0 && (
        <div className="flex flex-col gap-2">
          {visibleItems.map((i) => (
            <Card key={i.label}>
              <div className="flex flex-wrap items-center justify-between gap-2 p-1">
                <div>
                  <span className="text-lg font-black tabular-nums" style={{ color: i.tone === "act" ? "var(--danger, #b23b3b)" : "var(--warning, #b7791f)" }}>
                    {num(i.count)}
                  </span>{" "}
                  <span className="font-bold" style={{ color: "var(--ink)" }}>{i.label}</span>
                  {i.amount != null && i.amount !== "0" && (
                    <span className="text-sm" style={{ color: "var(--ink-muted)" }}> — {egpExact(i.amount)}</span>
                  )}
                  {i.unknownCount != null && i.unknownCount > 0 && (
                    <span className="block text-sm font-semibold" style={{ color: "var(--danger, #b23b3b)" }}>
                      {num(i.unknownCount)} مبالغها غير مسجلة — الإجمالي المعروض للمبالغ المعروفة فقط
                    </span>
                  )}
                  {!i.blocksClose && (
                    <span className="block text-sm font-semibold" style={{ color: "var(--ink-muted)" }}>
                      للمتابعة — لا تمنع إقفال الفترة
                    </span>
                  )}
                </div>
                <Link href={i.href} className="no-print text-sm font-bold underline underline-offset-4" style={{ color: "var(--brand)" }}>
                  {i.cta} ←
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}

      {blockers.length === 0 ? (
        <Card title="مراجعة القوائم قبل القفل">
          <div className="grid gap-3 md:grid-cols-3">
            {reviewLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-md p-3"
                style={{ border: "1px solid var(--line)", background: "var(--surface)" }}
              >
                <span className="block font-bold" style={{ color: "var(--brand)" }}>
                  {link.label} ←
                </span>
                <span className="block text-sm" style={{ color: "var(--ink-muted)" }}>
                  {link.hint}
                </span>
              </Link>
            ))}
          </div>
          <p className="mt-3 text-sm" style={{ color: "var(--ink-muted)" }}>
            لا يتم قفل الشهر تلقائيًا عند نظافة القائمة؛ راجع قائمة الدخل والمركز المالي، ثم اقفل الفترة المحاسبية.
          </p>
          <div className="no-print mt-3">
            <a
              href={statementPackageHref}
              className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold"
              style={{ border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" }}
            >
              <Download aria-hidden="true" size={16} />
              تنزيل حزمة القوائم PDF
            </a>
          </div>
        </Card>
      ) : null}

      <Card className="no-print">
        <div className="flex flex-col gap-4 p-1">
          <div>
            <span className="font-bold" style={{ color: "var(--ink)" }}>قفل الفترة المحاسبية</span>
            <span className="text-sm" style={{ color: "var(--ink-muted)" }}>
              {" "}— {blockers.length === 0
                ? "اكتملت متطلبات الإقفال الأساسية — بعد اعتماد القوائم، اقفل الفترة لمنع ترحيل أي قيد جديد بتاريخها."
                : "عالج البنود التي تمنع الإقفال أعلاه؛ بعدها يصبح زر الإقفال جاهزًا هنا."}
            </span>
          </div>
          <form action={closePeriod} className="grid gap-3 md:grid-cols-[1fr_1fr_1.4fr_auto]">
            <input type="hidden" name="return_to" value="close" />
            <label className="flex flex-col gap-1 text-sm font-semibold">
              من تاريخ
              <input
                name="period_start"
                type="date"
                defaultValue={monthStart}
                required
                readOnly
                className="rounded-md px-3 py-2"
                style={inputStyle}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              إلى تاريخ
              <input
                name="period_end"
                type="date"
                defaultValue={todayIso}
                required
                readOnly
                className="rounded-md px-3 py-2"
                style={inputStyle}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              ملاحظة
              <input
                name="note"
                type="text"
                defaultValue={`إقفال شهر ${monthLabel}`}
                className="rounded-md px-3 py-2"
                style={inputStyle}
              />
            </label>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={blockers.length > 0}
                className="rounded-md px-4 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                style={{ color: "white", background: blockers.length === 0 ? "var(--brand)" : "var(--ink-muted)" }}
              >
                {blockers.length === 0 ? "إقفال الشهر الآن" : "عالج المعلّقات أولًا"}
              </button>
            </div>
          </form>
          <Link
            href="/finance/periods"
            className="text-sm font-bold underline underline-offset-4"
            style={{ color: "var(--brand)" }}
          >
            عرض سجل الفترات المحاسبية ←
          </Link>
        </div>
      </Card>
    </div>
  );
}
