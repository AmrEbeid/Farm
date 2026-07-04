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

// SPEC-0025 U-11 (§2c) — the cost-center 360: the destination that makes every center name a LINK.
// One page answers «ماذا يحدث على هذا النشاط؟»: subtree net from the ledger (v_cost_center_rollup),
// per-feddan, the expenses charged to it, and the sales it produced — leading with the story sentence.

export const dynamic = "force-dynamic";

const EXPENSE_COLUMNS: SimpleColumn[] = [
  { id: "date", header: "التاريخ" },
  { id: "category", header: "البند" },
  { id: "total", header: "المبلغ (ج.م)", kind: "money", numeric: true },
];
const SALE_COLUMNS: SimpleColumn[] = [
  { id: "date", header: "التاريخ" },
  { id: "crop", header: "المحصول" },
  { id: "total", header: "الإجمالي (ج.م)", kind: "money", numeric: true },
  { id: "status", header: "الحالة", kind: "status" },
];

export default async function CostCenterPage({ params }: { params: Promise<{ id: string }> }) {
  const m = await requireRole(["owner", "accountant"]);
  const { id } = await params;
  const sb = await createClient();

  const [rollupRes, expensesRes, salesRes] = await Promise.all([
    sb.from("v_cost_center_rollup").select("*").eq("org_id", m.orgId).eq("cost_center_id", id).maybeSingle(),
    sb
      .from("expenses")
      .select("id, date, category, description, total")
      .eq("cost_center_id", id)
      .order("date", { ascending: false })
      .limit(200),
    sb
      .from("sales")
      .select("id, sale_date, crop, total, price_status, payment_status")
      .eq("cost_center_id", id)
      .order("sale_date", { ascending: false })
      .limit(200),
  ]);
  if (rollupRes.error) throw rollupRes.error;
  const center = rollupRes.data;
  if (!center) notFound();

  const expenses = expensesRes.data ?? [];
  const sales = salesRes.data ?? [];
  const expenseTotal = expenses.reduce((t, e) => t + Number(e.total ?? 0), 0);
  const finalizedSales = sales.filter((s) => s.price_status === "finalized");
  const salesTotal = finalizedSales.reduce((t, s) => t + Number(s.total ?? 0), 0);
  const pendingSales = sales.length - finalizedSales.length;
  const area = center.area_feddan == null ? null : Number(center.area_feddan);

  const lead =
    expenseTotal === 0 && salesTotal === 0
      ? `لا مصروفات أو مبيعات مسجَّلة على «${center.name_ar}» بعد.`
      : `«${center.name_ar}» عليه ${egp(expenseTotal)} مصروفات مباشرة` +
        (salesTotal > 0 ? ` وأدرّ ${egp(salesTotal)} مبيعات مؤكدة` : "") +
        (area && area > 0 ? ` — صافي دفتري ${egp(Number(center.net ?? 0))} (${egp(Number(center.net_per_feddan ?? 0))} للفدان على ${num(area)} فدان).` : ".");
  const notes: string[] = [];
  if (pendingSales > 0) notes.push(`${num(pendingSales)} بيع بسعر معلّق لا يدخل في الأرقام أعلاه.`);
  if (!center.active) notes.push("هذا المركز مؤرشف — يظهر للسجل فقط.");

  const expenseRows: SimpleRow[] = expenses.map((e) => ({
    id: e.id,
    href: `/expenses/${e.id}`,
    date: e.date ? fmtDate(e.date) : "—",
    category: [e.category, e.description].filter(Boolean).join(" — "),
    total: e.total ?? undefined,
  }));
  const saleRows: SimpleRow[] = sales.map((s) => ({
    id: s.id,
    date: s.sale_date ? fmtDate(s.sale_date) : "—",
    crop: s.crop,
    total: s.price_status === "pending" ? undefined : (s.total ?? undefined),
    status: s.price_status === "pending" ? "السعر معلّق" : s.payment_status === "collected" ? "محصَّل" : "غير محصل",
  }));

  return (
    <div className="flex flex-col gap-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>
            {center.name_ar}
          </h1>
          <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
            {center.code}
            {center.enterprise ? ` · ${center.enterprise}` : ""}
            {area && area > 0 ? ` · ${num(area)} فدان` : ""}
          </p>
        </div>
        <Link href="/record/expense" className="text-sm font-bold underline underline-offset-4" style={{ color: "var(--brand)" }}>
          + سجّل مصروفًا عليه
        </Link>
      </header>

      <StoryLine lead={lead} notes={notes} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="مصروفات مباشرة" value={egp(expenseTotal)} />
        <KpiCard label="مبيعات مؤكدة" value={egp(salesTotal)} />
        <KpiCard label="صافي دفتري (الشجرة)" value={egp(Number(center.net ?? 0))} deltaDirection={Number(center.net ?? 0) > 0 ? "down" : "none"} />
        <KpiCard label="للفدان" value={area && area > 0 ? egp(Number(center.net_per_feddan ?? 0)) : "غير متوفر"} />
      </div>

      <Card title="المصروفات على هذا المركز">
        {expenseRows.length === 0 ? (
          <Alert tone="info" title="لا مصروفات مباشرة بعد — سجّل أول مصروف واختر هذا المركز في خطوة «على أي نشاط؟»." />
        ) : (
          <FilterableTable columns={EXPENSE_COLUMNS} rows={expenseRows} ariaLabel={`مصروفات ${center.name_ar}`} exportFilename={`center-expenses-${center.code}`} empty="لا مصروفات" />
        )}
      </Card>

      <Card title="المبيعات من هذا المركز">
        {saleRows.length === 0 ? (
          <Alert tone="info" title="لا مبيعات من هذا المركز بعد." />
        ) : (
          <FilterableTable columns={SALE_COLUMNS} rows={saleRows} ariaLabel={`مبيعات ${center.name_ar}`} exportFilename={`center-sales-${center.code}`} empty="لا مبيعات" />
        )}
      </Card>
    </div>
  );
}
