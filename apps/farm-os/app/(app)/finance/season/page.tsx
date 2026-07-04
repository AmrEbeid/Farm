import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { KpiCard } from "@/components/ui";
import { FilterableTable } from "@/components/FilterableTable";
import { type SimpleColumn, type SimpleRow } from "@/components/SimpleTable";
import { StoryLine } from "@/components/StoryLine";
import { fmtDate } from "@/lib/dates";
import { egp, num, pct } from "@/lib/money";

// SPEC-0027 H-3 — لوحة الموسم: the harvest cockpit. One page answers the Owner's daily season
// questions from Cairo: كم طنًا سلّمنا؟ لمن؟ كم بلا سعر؟ كم حُصِّل؟ وأي حوش يُنتج أكثر لكل فدان؟
// Story-first (§2c); every row links onward (pending → the pricing wizard). Honest nulls (#1):
// pending deliveries are counted in tonnage but NEVER valued.

export const dynamic = "force-dynamic";

const DELIVERY_COLUMNS: SimpleColumn[] = [
  { id: "note", header: "بون", kind: "code" },
  { id: "date", header: "التاريخ" },
  { id: "crop", header: "المحصول" },
  { id: "buyer", header: "التاجر", kind: "link" },
  { id: "qty", header: "الكمية (كجم)", numeric: true },
  { id: "total", header: "القيمة (ج.م)", kind: "money", numeric: true },
  { id: "status", header: "الحالة", kind: "status" },
];

const CENTER_COLUMNS: SimpleColumn[] = [
  { id: "center", header: "المركز", kind: "link" },
  { id: "qty", header: "كجم مسلَّمة", numeric: true },
  { id: "perFeddan", header: "كجم/فدان", numeric: true },
  { id: "value", header: "قيمة مؤكدة (ج.م)", kind: "money", numeric: true },
];

export default async function SeasonPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  await requireRole(["owner", "accountant"]);
  const { from } = await searchParams;
  const year = new Date().getFullYear();
  const seasonStart = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : `${year}-01-01`;
  const sb = await createClient();

  const [salesRes, collectionsRes, buyersRes, centersRes, pickedRes] = await Promise.all([
    sb
      .from("sales")
      .select("id, sale_date, crop, qty, unit, total, price_status, payment_status, buyer_id, cost_center_id, delivery_note_no, crates")
      .gte("sale_date", seasonStart)
      .order("sale_date", { ascending: false }),
    sb.from("sale_collections").select("sale_id, amount"),
    sb.from("buyers").select("id, name"),
    sb.from("cost_centers").select("id, name_ar, area_feddan"),
    sb.from("harvest_days").select("crates_picked, day").gte("day", seasonStart),
  ]);
  const sales = salesRes.data ?? [];
  const buyerName = new Map((buyersRes.data ?? []).map((b) => [b.id, b.name]));
  const centerById = new Map((centersRes.data ?? []).map((c) => [c.id, c]));
  const saleIds = new Set(sales.map((s) => s.id));
  let collected = 0;
  for (const c of collectionsRes.data ?? []) if (saleIds.has(c.sale_id)) collected += Number(c.amount ?? 0);

  const deliveries = sales.length;
  const tonnageKg = sales.reduce((t, s) => t + Number(s.qty ?? 0), 0);
  const pendingSales = sales.filter((s) => s.price_status === "pending");
  const pendingKg = pendingSales.reduce((t, s) => t + Number(s.qty ?? 0), 0);
  const finalizedTotal = sales.filter((s) => s.price_status === "finalized").reduce((t, s) => t + Number(s.total ?? 0), 0);
  const outstanding = finalizedTotal - collected;
  const traders = new Set(sales.map((s) => s.buyer_id).filter(Boolean)).size;
  const unnamed = sales.filter((s) => !s.buyer_id).length;

  const lead =
    deliveries === 0
      ? "لا تسليمات في هذا الموسم بعد — أول حمولة تمر على الميزان تظهر هنا فورًا."
      : `الموسم حتى اليوم: ${num(Math.round(tonnageKg / 1000))} طن في ${num(deliveries)} حمولة لـ${num(traders)} تاجر — ` +
        `${pendingKg > 0 ? `${num(Math.round(pendingKg / 1000))} طن بلا سعر بعد، و` : "كل الكميات مسعّرة، و"}` +
        `المحصَّل ${egp(collected)} من ${egp(finalizedTotal)}${finalizedTotal > 0 ? ` (${pct(Math.round((collected / finalizedTotal) * 100))})` : ""}.`;
  const notes: string[] = [];
  if (pendingSales.length > 0) notes.push(`${num(pendingSales.length)} تسليمًا ينتظر التسعير — كل يوم تأخير يؤخر القيد والتحصيل.`);
  if (outstanding > 0) notes.push(`ذمم على التجار: ${egp(outstanding)}.`);
  if (unnamed > 0) notes.push(`⚠ ${num(unnamed)} تسليمًا بلا اسم تاجر — قاعدة الموسم: كل حمولة باسم.`);
  const pickedCrates = (pickedRes.data ?? []).reduce((t, h) => t + Number(h.crates_picked ?? 0), 0);
  const deliveredCrates = sales.reduce((t, s2) => t + Number((s2 as { crates?: number | null }).crates ?? 0), 0);
  if (pickedCrates > 0 && deliveredCrates > 0 && pickedCrates !== deliveredCrates)
    notes.push(`🧺 مقطوف حقليًا ${num(pickedCrates)} عبوة مقابل ${num(deliveredCrates)} وصلت الميزان — فارق ${num(Math.abs(pickedCrates - deliveredCrates))} عبوة يستحق نظرة.`);

  const deliveryRows: SimpleRow[] = sales.map((s) => ({
    id: s.id,
    note: s.delivery_note_no != null ? String(s.delivery_note_no) : "—",
    date: s.sale_date ? fmtDate(s.sale_date) : "—",
    crop: s.crop,
    buyer: (s.buyer_id && buyerName.get(s.buyer_id)) || "بدون اسم",
    buyer_href: s.buyer_id ? `/finance/buyers/${s.buyer_id}` : "",
    qty: s.qty ?? undefined,
    total: s.price_status === "pending" ? undefined : (s.total ?? undefined),
    status: s.price_status === "pending" ? "السعر معلّق" : s.payment_status === "collected" ? "محصَّل" : "غير محصل",
  }));

  const byCenter = new Map<string, { qty: number; value: number }>();
  for (const s of sales) {
    if (!s.cost_center_id) continue;
    const cur = byCenter.get(s.cost_center_id) ?? { qty: 0, value: 0 };
    cur.qty += Number(s.qty ?? 0);
    if (s.price_status === "finalized") cur.value += Number(s.total ?? 0);
    byCenter.set(s.cost_center_id, cur);
  }
  const centerRows: SimpleRow[] = [...byCenter.entries()]
    .map(([id, v]) => {
      const c = centerById.get(id);
      const area = c?.area_feddan == null ? null : Number(c.area_feddan);
      return {
        id,
        center: c?.name_ar ?? "—",
        center_href: `/finance/cost-centers/${id}`,
        qty: Math.round(v.qty),
        perFeddan: area && area > 0 ? Math.round(v.qty / area) : undefined,
        value: v.value || undefined,
      };
    })
    .sort((a, b) => Number(b.qty ?? 0) - Number(a.qty ?? 0));

  return (
    <div className="flex flex-col gap-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>لوحة الموسم</h1>
          <p className="text-sm" style={{ color: "var(--ink-muted)" }}>من {fmtDate(seasonStart)} حتى اليوم — تتحدث مع كل حمولة تمر على الميزان.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm font-bold">
          <Link href="/record/scale" className="underline underline-offset-4" style={{ color: "var(--brand)" }}>⚖️ الميزان</Link>
          <Link href="/record/price" className="underline underline-offset-4" style={{ color: "var(--brand)" }}>🏷️ سعّر المعلّق</Link>
          <Link href="/record/collect" className="underline underline-offset-4" style={{ color: "var(--brand)" }}>💰 حصّل</Link>
        </div>
      </header>

      <StoryLine lead={lead} notes={notes} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="طن مسلَّم" value={num(Math.round(tonnageKg / 1000))} />
        <KpiCard label="حمولات (بونات)" value={num(deliveries)} />
        <KpiCard label="طن بلا سعر" value={num(Math.round(pendingKg / 1000))} deltaDirection={pendingKg > 0 ? "down" : "none"} />
        <KpiCard label="إيراد مُقيّد" value={egp(finalizedTotal)} />
        <KpiCard label="محصَّل" value={egp(collected)} />
        <KpiCard label="ذمم التجار" value={egp(outstanding)} deltaDirection={outstanding > 0 ? "down" : "none"} />
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-bold" style={{ color: "var(--ink)" }}>التسليمات</h2>
        <FilterableTable
          columns={DELIVERY_COLUMNS}
          rows={deliveryRows}
          ariaLabel="تسليمات الموسم"
          placeholder="ابحث ببون/تاجر/محصول…"
          exportFilename="season-deliveries"
          empty="لا تسليمات"
        />
      </section>

      {centerRows.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-bold" style={{ color: "var(--ink)" }}>الإنتاج لكل مركز (كجم/فدان)</h2>
          <FilterableTable
            columns={CENTER_COLUMNS}
            rows={centerRows}
            ariaLabel="إنتاج المراكز"
            exportFilename="season-by-center"
            empty="لا بيانات مراكز"
          />
        </section>
      )}
    </div>
  );
}
