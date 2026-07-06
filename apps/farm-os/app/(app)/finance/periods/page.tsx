// Accounting periods (الفترات المحاسبية / الإقفال) — close/reopen the period lock (SPEC-0004 §7.3).
// Closing a period blocks any NEW journal posting dated inside it (the fn_post_two_line_journal guard).
// Server Component; role enforced here AND in the RPCs (close = owner/accountant, reopen = owner-only).

import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card, KpiCard } from "@/components/ui";
import { ExportButton } from "@/components/ExportButton";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";
import { PrintButton } from "@/components/print-button";
import { SimpleTable, type SimpleColumn, type SimpleRow } from "@/components/SimpleTable";
import { closePeriod, reopenPeriod } from "./actions";
import { FinanceStatementsNav } from "@/components/FinanceStatementsNav";

const inputStyle = { border: "1px solid var(--line)", background: "var(--surface)" } as const;
const mutedStyle = { color: "var(--ink-muted)" } as const;

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
  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const params = await searchParams;

  const { data, error } = await sb
    .from("accounting_periods")
    .select("id, period_start, period_end, status, note, locked_at, reopened_at")
    .eq("org_id", m.orgId)
    .order("period_start", { ascending: false });
  if (error) throw error;

  const periods = data ?? [];
  const lockedCount = periods.filter((p) => p.status === "locked").length;
  const lockedPeriods = periods.filter((p) => p.status === "locked");
  const isOwner = m.role === "owner";
  const periodRows: SimpleRow[] = periods.map((p) => ({
    id: p.id,
    period: `${fmtDate(p.period_start)} — ${fmtDate(p.period_end)}`,
    status: p.status === "locked" ? "مقفلة" : "مفتوحة",
    note: p.note || "—",
    lockedAt: p.locked_at ? fmtDate(p.locked_at) : "—",
    reopenedAt: p.reopened_at ? fmtDate(p.reopened_at) : "—",
  }));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold">الفترات المحاسبية (الإقفال)</h1>
          <p style={mutedStyle}>
            إقفال فترة يمنع ترحيل أي قيد جديد بتاريخ داخلها — لحماية أرقام فترة مُعتمدة (كشهر أو موسم). إعادة الفتح
            للمالك فقط.
          </p>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <PrintButton label="طباعة الفترات" />
          <ExportButton rows={periodRows} columns={PERIOD_COLUMNS} filename="accounting-periods" />
        </div>
      </header>

      {params.ok ? (
        <Card title="تم" className="no-print">
          <p className="font-semibold">{params.ok}</p>
        </Card>
      ) : null}
      {params.error ? (
        <Card title="تعذّر التنفيذ" className="no-print">
          <p className="font-semibold">{params.error}</p>
        </Card>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label="إجمالي الفترات" value={num(periods.length)} icon="🗂️" />
        <KpiCard label="فترات مقفلة" value={num(lockedCount)} icon="🔒" />
        <KpiCard label="فترات مفتوحة (أُعيد فتحها)" value={num(periods.length - lockedCount)} icon="🔓" />
      </section>

      <Card title="إقفال فترة جديدة" subtitle="متاح للمالك والمحاسب" className="no-print">
        <form action={closePeriod} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1 text-sm font-semibold">
            من تاريخ
            <input name="period_start" type="date" required className="rounded-md px-3 py-2" style={inputStyle} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            إلى تاريخ
            <input name="period_end" type="date" required className="rounded-md px-3 py-2" style={inputStyle} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold sm:col-span-2 lg:col-span-1">
            ملاحظة (اختياري)
            <input name="note" type="text" className="rounded-md px-3 py-2" style={inputStyle} placeholder="مثال: إقفال مارس ٢٠٢٦" />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              className="rounded-md px-4 py-2 font-semibold"
              style={{ color: "white", background: "var(--brand)" }}
            >
              إقفال الفترة
            </button>
          </div>
        </form>
      </Card>

      <Card title={`الفترات (${num(periods.length)})`}>
        <SimpleTable
          columns={PERIOD_COLUMNS}
          rows={periodRows}
          ariaLabel="الفترات المحاسبية"
          empty="لا فترات مقفلة بعد"
        />
      </Card>

      {isOwner && lockedPeriods.length > 0 ? (
        <Card title="إعادة فتح فترة" subtitle="للمالك فقط" className="no-print">
          <div className="flex flex-col gap-2">
            {lockedPeriods.map((p) => (
              <form
                key={p.id}
                action={reopenPeriod}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md p-3"
                style={{ border: "1px solid var(--line)" }}
              >
                <input type="hidden" name="period_id" value={p.id} />
                <span className="font-semibold">
                  {fmtDate(p.period_start)} — {fmtDate(p.period_end)}
                </span>
                <button
                  type="submit"
                  className="rounded-md px-3 py-1 text-sm font-semibold"
                  style={{ border: "1px solid var(--line)", background: "var(--surface)" }}
                >
                  إعادة الفتح
                </button>
              </form>
            ))}
          </div>
        </Card>
      ) : null}

      <div className="no-print">
        <FinanceStatementsNav current="periods" />
      </div>
    </div>
  );
}
