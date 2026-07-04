import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Alert, Card, KpiCard } from "@/components/ui";
import { FilterableTable } from "@/components/FilterableTable";
import { type SimpleColumn, type SimpleRow } from "@/components/SimpleTable";
import { StoryLine } from "@/components/StoryLine";
import { fmtDate } from "@/lib/dates";
import { egp, num } from "@/lib/money";

// SPEC-0025 U-11 (§2c) — the buyer 360: the destination that makes every buyer name in the app a LINK.
// One page answers "من هذا العميل وماذا علينا منه؟": his sales, what's finalized vs pending, what he paid,
// and what he still owes — leading with the story sentence. Honest nulls: pending prices show «معلّق».

export const dynamic = "force-dynamic";

const COLUMNS: SimpleColumn[] = [
  { id: "date", header: "التاريخ" },
  { id: "crop", header: "المحصول" },
  { id: "qty", header: "الكمية", numeric: true },
  { id: "total", header: "الإجمالي (ج.م)", kind: "money", numeric: true },
  { id: "status", header: "الحالة", kind: "status" },
];

export default async function BuyerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["owner", "accountant"]);
  const { id } = await params;
  const sb = await createClient();

  const [buyerRes, salesRes, collectionsRes] = await Promise.all([
    sb.from("buyers").select("id, name, buyer_type, phone, active").eq("id", id).maybeSingle(),
    sb
      .from("sales")
      .select("id, sale_date, crop, qty, unit, total, price_status, payment_status")
      .eq("buyer_id", id)
      .order("sale_date", { ascending: false }),
    sb.from("sale_collections").select("sale_id, amount"),
  ]);
  if (buyerRes.error) throw buyerRes.error;
  const buyer = buyerRes.data;
  if (!buyer) notFound();

  const sales = salesRes.data ?? [];
  const saleIds = new Set(sales.map((s) => s.id));
  let collectedTotal = 0;
  for (const c of collectionsRes.data ?? []) {
    if (saleIds.has(c.sale_id)) collectedTotal += Number(c.amount ?? 0);
  }
  const finalized = sales.filter((s) => s.price_status === "finalized");
  const finalizedTotal = finalized.reduce((t, s) => t + Number(s.total ?? 0), 0);
  const pendingCount = sales.length - finalized.length;
  const outstanding = finalizedTotal - collectedTotal;

  const rows: SimpleRow[] = sales.map((s) => ({
    id: s.id,
    date: s.sale_date ? fmtDate(s.sale_date) : "—",
    crop: `${s.crop}${s.qty ? "" : ""}`,
    qty: s.qty ?? undefined,
    total: s.price_status === "pending" ? undefined : (s.total ?? undefined),
    status: s.price_status === "pending" ? "السعر معلّق" : s.payment_status === "collected" ? "محصَّل" : "غير محصل",
  }));

  const lead =
    sales.length === 0
      ? `لا مبيعات مسجَّلة لـ«${buyer.name}» بعد.`
      : outstanding > 0
        ? `«${buyer.name}» اشترى بإجمالي ${egp(finalizedTotal)}، سدّد ${egp(collectedTotal)}، وما زال عليه ${egp(outstanding)}.`
        : `«${buyer.name}» اشترى بإجمالي ${egp(finalizedTotal)} وسدّد بالكامل — لا مستحقات.`;
  const notes: string[] = [];
  if (pendingCount > 0) notes.push(`${num(pendingCount)} بيع بسعر معلّق لا يدخل في الأرقام أعلاه حتى يُحدَّد سعره.`);

  return (
    <div className="flex flex-col gap-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>
            {buyer.name}
          </h1>
          <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
            {buyer.buyer_type === "trader" ? "تاجر" : buyer.buyer_type === "company" ? "شركة" : "عميل نقدي"}
            {buyer.phone ? ` · ${buyer.phone}` : ""}
            {buyer.active ? "" : " · غير نشط"}
          </p>
        </div>
        {outstanding > 0 && (
          <Link href="/record/collect" className="text-sm font-bold underline underline-offset-4" style={{ color: "var(--brand)" }}>
            + سجّل تحصيلًا منه
          </Link>
        )}
      </header>

      <StoryLine lead={lead} notes={notes} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="إجمالي المشتريات المؤكدة" value={egp(finalizedTotal)} />
        <KpiCard label="المحصَّل" value={egp(collectedTotal)} />
        <KpiCard label="المستحق علينا تحصيله" value={egp(outstanding)} deltaDirection={outstanding > 0 ? "down" : "none"} />
        <KpiCard label="عدد المبيعات" value={num(sales.length)} />
      </div>

      <Card>
        {rows.length === 0 ? (
          <Alert tone="info" title="لا مبيعات لهذا العميل بعد — سجّل أول تسليم من «سجّل ← سلّمت محصولًا»." />
        ) : (
          <FilterableTable
            columns={COLUMNS}
            rows={rows}
            ariaLabel={`مبيعات ${buyer.name}`}
            exportFilename={`buyer-${buyer.name}`}
            empty="لا مبيعات"
          />
        )}
      </Card>
    </div>
  );
}
