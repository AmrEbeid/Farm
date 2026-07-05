import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card } from "@/components/ui";
import { StoryLine } from "@/components/StoryLine";
import { egp, num } from "@/lib/money";
import { isSaleOnOrAfterReportDate, summarizeAgedReceivables } from "@/lib/month-close";

// R-7 — «إقفال الشهر»: the accountant's generated to-do. The month is "closed" when this page says
// so — no memorized checklist. Every item is a LIVE count with one tap to its fixing surface, scoped
// to the live-entry era (from the 1 July 2026 cutover; the imported archive is deliberately excluded).
// Rule-based, honest counts (#1) — an empty list is the goal state, said plainly.

export const dynamic = "force-dynamic";

const CUTOVER = "2026-07-01"; // live-entry era start (Stage-M archive before this is closed history)

interface CloseItem {
  label: string;
  count: number;
  amount?: number;
  href: string;
  cta: string;
  tone: "act" | "watch";
}

export default async function MonthClosePage() {
  await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const today = new Date();
  const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
  const thirtyAgo = new Date(today.getTime() - 30 * 86400000).toISOString().slice(0, 10);

  const [pendingSalesRes, unroutedRes, unclassifiedRes, unallocatedRes, agingRes, collectionsRes] =
    await Promise.all([
      // sale_date is NULLABLE (delivery-before-price flow); a pending sale has no sale_date, and even a
      // finalized sale isn't forced to carry one. Filtering on sale_date silently drops those rows → a false
      // "clean" close. Filter on created_at (NOT NULL) and derive the business date in JS via report_date =
      // coalesce(sale_date, delivery_date, created_at) — matching the revenue report — so nothing is hidden.
      sb
        .from("sales")
        .select("id, total, qty, sale_date, delivery_date, created_at")
        .eq("price_status", "pending")
        .gte("created_at", CUTOVER),
      sb.from("expenses").select("id, total").is("payment_status", null).gte("date", CUTOVER),
      sb.from("expenses").select("id, total").is("account_id", null).gte("date", CUTOVER),
      sb.from("expenses").select("id, total").is("cost_center_id", null).gte("date", CUTOVER),
      sb
        .from("sales")
        .select("id, total, sale_date, delivery_date, created_at")
        .eq("price_status", "finalized")
        .neq("payment_status", "collected")
        .gte("created_at", CUTOVER),
      sb.from("sale_collections").select("sale_id, amount"),
    ]);

  const pendingSales = (pendingSalesRes.data ?? []).filter((sale) => isSaleOnOrAfterReportDate(sale, CUTOVER));
  const agedReceivables = summarizeAgedReceivables(agingRes.data ?? [], collectionsRes.data ?? [], thirtyAgo, CUTOVER);

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
      href: "/expenses",
      cta: "وجّهها",
      tone: "act",
    },
    {
      label: "مصروفات بلا حساب محاسبي",
      count: (unclassifiedRes.data ?? []).length,
      amount: sum(unclassifiedRes.data),
      href: "/expenses",
      cta: "صنّفها",
      tone: "watch",
    },
    {
      label: "مصروفات بلا مركز تكلفة",
      count: (unallocatedRes.data ?? []).length,
      amount: sum(unallocatedRes.data),
      href: "/expenses",
      cta: "وزّعها",
      tone: "watch",
    },
    {
      label: "ذمم تجاوزت ٣٠ يومًا",
      count: agedReceivables.count,
      amount: agedReceivables.amount,
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

  return (
    <div className="flex flex-col gap-4 p-6">
      <header>
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>إقفال الشهر</h1>
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          قائمة مولَّدة من الدفاتر الحية (منذ قطع {CUTOVER}) — الشهر يُقفل عندما تفرغ. شهر الفحص الحالي يبدأ {monthStart}.
        </p>
      </header>

      <StoryLine lead={lead} />

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
    </div>
  );
}
