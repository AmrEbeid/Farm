import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card } from "@/components/ui";
import { StoryLine } from "@/components/StoryLine";
import { egp, num } from "@/lib/money";
import { isAgedLiveReceivable, isSaleInLiveEra } from "@/lib/month-close";
import { closePeriod } from "../periods/actions";

// R-7 — «إقفال الشهر»: the accountant's generated to-do. The month is "closed" when this page says
// so — no memorized checklist. Every item is a LIVE count with one tap to its fixing surface, scoped
// to the live-entry era (from the 1 July 2026 cutover; the imported archive is deliberately excluded).
// Rule-based, honest counts (#1) — an empty list is the goal state, said plainly.

export const dynamic = "force-dynamic";

const CUTOVER = "2026-07-01"; // live-entry era start (Stage-M archive before this is closed history)
const inputStyle = { border: "1px solid var(--line)", background: "var(--surface)" } as const;

interface CloseItem {
  label: string;
  count: number;
  amount?: number;
  href: string;
  cta: string;
  tone: "act" | "watch";
}

export default async function MonthClosePage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const params = await searchParams;
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
  const monthLabel = monthStart.slice(0, 7);
  const thirtyAgo = new Date(today.getTime() - 30 * 86400000).toISOString().slice(0, 10);

  const [pendingSalesRes, unroutedRes, unclassifiedRes, unallocatedRes, agingRes, collectionsRes] =
    await Promise.all([
      // sale_date is NULLABLE (delivery-before-price flow); report_date =
      // coalesce(sale_date, delivery_date, created_at), matching revenue reports. The SQL OR narrows the scan,
      // then JS applies the exact business-date cutover so imported archive rows created after cutover stay out.
      sb
        .from("sales")
        .select("id, total, qty, sale_date, delivery_date, created_at")
        .eq("org_id", m.orgId)
        .eq("price_status", "pending")
        .or(`sale_date.gte.${CUTOVER},delivery_date.gte.${CUTOVER},created_at.gte.${CUTOVER}`),
      sb.from("expenses").select("id, total").eq("org_id", m.orgId).is("payment_status", null).gte("date", CUTOVER),
      sb.from("expenses").select("id, total").eq("org_id", m.orgId).is("account_id", null).gte("date", CUTOVER),
      sb.from("expenses").select("id, total").eq("org_id", m.orgId).is("cost_center_id", null).gte("date", CUTOVER),
      sb
        .from("sales")
        .select("id, total, sale_date, delivery_date, created_at")
        .eq("org_id", m.orgId)
        .eq("price_status", "finalized")
        .neq("payment_status", "collected")
        .or(`sale_date.gte.${CUTOVER},delivery_date.gte.${CUTOVER},created_at.gte.${CUTOVER}`),
      sb.from("sale_collections").select("sale_id, amount").eq("org_id", m.orgId),
    ]);

  const collectedBySale = new Map<string, number>();
  for (const c of collectionsRes.data ?? [])
    collectedBySale.set(c.sale_id, (collectedBySale.get(c.sale_id) ?? 0) + Number(c.amount ?? 0));
  const pendingSales = (pendingSalesRes.data ?? []).filter((s) => isSaleInLiveEra(s, CUTOVER));
  // aged >30 days by report_date = coalesce(sale_date, delivery_date, created_at) so a finalized receivable
  // with a null sale_date is still counted, but pre-cutover archive rows created later are excluded.
  const agedRows = (agingRes.data ?? []).filter((s) => isAgedLiveReceivable(s, CUTOVER, thirtyAgo));
  const agingOutstanding = agedRows.reduce(
    (t, s) => t + Math.max(0, Number(s.total ?? 0) - (collectedBySale.get(s.id) ?? 0)),
    0,
  );
  const agingCount = agedRows.filter(
    (s) => Number(s.total ?? 0) - (collectedBySale.get(s.id) ?? 0) > 0,
  ).length;

  const sum = (rows: { total: unknown }[] | null) => (rows ?? []).reduce((t, r) => t + Number(r.total ?? 0), 0);
  const items: CloseItem[] = [
    {
      label: "تسليمات بلا سعر",
      count: pendingSales.length,
      href: "/record/price",
      cta: "سعّرها",
      tone: "act",
    },
    {
      label: "مصروفات بلا توجيه دفع (عهدة/آجل/مالك)",
      count: (unroutedRes.data ?? []).length,
      amount: sum(unroutedRes.data),
      href: "/expenses?filter=unrouted",
      cta: "وجّهها",
      tone: "act",
    },
    {
      label: "مصروفات بلا حساب محاسبي",
      count: (unclassifiedRes.data ?? []).length,
      amount: sum(unclassifiedRes.data),
      href: "/expenses?filter=unclassified",
      cta: "صنّفها",
      tone: "watch",
    },
    {
      label: "مصروفات بلا مركز تكلفة",
      count: (unallocatedRes.data ?? []).length,
      amount: sum(unallocatedRes.data),
      href: "/expenses?filter=uncentered",
      cta: "وزّعها",
      tone: "watch",
    },
    {
      label: "ذمم تجاوزت ٣٠ يومًا",
      count: agingCount,
      amount: agingOutstanding,
      href: "/record/collect",
      cta: "حصّلها",
      tone: "act",
    },
  ];
  const open = items.filter((i) => i.count > 0);
  const lead =
    open.length === 0
      ? "الشهر نظيف ✓ — لا معلّقات منذ بداية التسجيل الحي. أقفل براحة بال."
      : `يفصلك عن الإقفال ${num(open.length)} بند: ${open.map((i) => `${num(i.count)} ${i.label}`).join("، ")}.`;
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

  return (
    <div className="flex flex-col gap-4 p-6">
      <header>
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>إقفال الشهر</h1>
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          قائمة مولَّدة من الدفاتر الحية (منذ قطع {CUTOVER}) — الشهر يُقفل عندما تفرغ. شهر الفحص الحالي يبدأ {monthStart}.
        </p>
      </header>

      <StoryLine lead={lead} />

      {params.ok ? (
        <Card title="تم">
          <p className="font-semibold">{params.ok}</p>
        </Card>
      ) : null}
      {params.error ? (
        <Card title="تعذّر التنفيذ">
          <p className="font-semibold">{params.error}</p>
        </Card>
      ) : null}

      {open.length > 0 && (
        <div className="flex flex-col gap-2">
          {open.map((i) => (
            <Card key={i.label}>
              <div className="flex flex-wrap items-center justify-between gap-2 p-1">
                <div>
                  <span className="text-lg font-black tabular-nums" style={{ color: i.tone === "act" ? "var(--danger, #b23b3b)" : "var(--warning, #b7791f)" }}>
                    {num(i.count)}
                  </span>{" "}
                  <span className="font-bold" style={{ color: "var(--ink)" }}>{i.label}</span>
                  {i.amount != null && i.amount > 0 && (
                    <span className="text-sm" style={{ color: "var(--ink-muted)" }}> — {egp(i.amount)}</span>
                  )}
                </div>
                <Link href={i.href} className="text-sm font-bold underline underline-offset-4" style={{ color: "var(--brand)" }}>
                  {i.cta} ←
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}

      {open.length === 0 ? (
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
        </Card>
      ) : null}

      <Card>
        <div className="flex flex-col gap-4 p-1">
          <div>
            <span className="font-bold" style={{ color: "var(--ink)" }}>قفل الفترة المحاسبية</span>
            <span className="text-sm" style={{ color: "var(--ink-muted)" }}>
              {" "}— {open.length === 0
                ? "القائمة فارغة — بعد اعتماد القوائم، اقفل الفترة لمنع ترحيل أي قيد جديد بتاريخها."
                : "أفرغ البنود أعلاه أولًا؛ بعدها يصبح زر الإقفال جاهزًا هنا."}
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
                disabled={open.length > 0}
                className="rounded-md px-4 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                style={{ color: "white", background: open.length === 0 ? "var(--brand)" : "var(--ink-muted)" }}
              >
                {open.length === 0 ? "إقفال الشهر الآن" : "أفرغ البنود أولًا"}
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
