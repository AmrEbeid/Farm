import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { KpiCard } from "@/components/ui";
import { FilterableTable } from "@/components/FilterableTable";
import { type SimpleColumn, type SimpleRow } from "@/components/SimpleTable";
import { PrintButton } from "@/components/print-button";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";

// SPEC-0025 U-3 — «المعاملات»: ONE ledger of every money event (expenses, sales, collections, custody
// movements), merged and normalized, searchable/sortable/exportable via the S-8a table primitives.
// Kills the "which module holds my transaction?" hunt. Read-only — every row links to its home page.
// Honest nulls (#1): a pending-price sale shows «السعر معلّق», never 0.

export const dynamic = "force-dynamic";

type TxType = "expense" | "sale" | "collection" | "custody";
const TYPE_AR: Record<TxType, string> = {
  expense: "مصروف",
  sale: "بيع",
  collection: "تحصيل",
  custody: "حركة عهدة",
};

const COLUMNS: SimpleColumn[] = [
  { id: "date", header: "التاريخ" },
  { id: "type", header: "النوع", kind: "tag-warn" },
  { id: "label", header: "البيان" },
  { id: "party", header: "الطرف", kind: "link" },
  { id: "amount", header: "المبلغ (ج.م)", kind: "money", numeric: true },
  { id: "direction", header: "الاتجاه" },
];

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  await requireRole(["owner", "accountant"]);
  const { type } = await searchParams;
  const active = (["expense", "sale", "collection", "custody"] as TxType[]).includes(type as TxType)
    ? (type as TxType)
    : null;
  const sb = await createClient();

  const LIMIT = 400;
  const [expensesRes, salesRes, collectionsRes, custodyRes, buyersRes, suppliersRes, custodyAcctRes] =
    await Promise.all([
      sb
        .from("expenses")
        .select("id, date, category, description, total, kind, supplier_id, payment_status")
        .order("date", { ascending: false, nullsFirst: false })
        .limit(LIMIT),
      sb
        .from("sales")
        .select("id, sale_date, crop, qty, unit, total, price_status, buyer_id")
        .order("sale_date", { ascending: false, nullsFirst: false })
        .limit(LIMIT),
      sb
        .from("sale_collections")
        .select("id, sale_id, amount, occurred_at, collected_by")
        .order("occurred_at", { ascending: false })
        .limit(LIMIT),
      sb
        .from("custody_movements")
        .select("id, occurred_at, movement_type, amount_in, amount_out, custody_account_id, note")
        .order("occurred_at", { ascending: false })
        .limit(LIMIT),
      sb.from("buyers").select("id, name"),
      sb.from("suppliers").select("id, name"),
      sb.from("custody_accounts").select("id, holder_label"),
    ]);

  const buyerName = new Map((buyersRes.data ?? []).map((b) => [b.id, b.name]));
  const supplierName = new Map((suppliersRes.data ?? []).map((s) => [s.id, s.name]));
  const holderName = new Map((custodyAcctRes.data ?? []).map((c) => [c.id, c.holder_label]));

  interface Tx extends SimpleRow {
    sortDate: string;
  }
  const rows: Tx[] = [];

  for (const e of expensesRes.data ?? []) {
    rows.push({
      id: `e-${e.id}`,
      href: `/expenses/${e.id}`,
      sortDate: e.date ?? "",
      date: e.date ? fmtDate(e.date) : "—",
      type: TYPE_AR.expense,
      label: [e.category, e.description].filter(Boolean).join(" — ") || "مصروف",
      party: (e.supplier_id && supplierName.get(e.supplier_id)) || "—",
      amount: e.total ?? undefined,
      direction: "خارج",
      _t: "expense",
    });
  }
  for (const s of salesRes.data ?? []) {
    const pending = s.price_status === "pending";
    rows.push({
      id: `s-${s.id}`,
      href: "/finance/revenue-reports",
      sortDate: s.sale_date ?? "",
      date: s.sale_date ? fmtDate(s.sale_date) : "—",
      type: TYPE_AR.sale,
      label: `${s.crop}${s.qty ? ` — ${num(Number(s.qty))} ${s.unit ?? ""}` : ""}${pending ? " (السعر معلّق)" : ""}`,
      party: (s.buyer_id && buyerName.get(s.buyer_id)) || "—",
      party_href: s.buyer_id ? `/finance/buyers/${s.buyer_id}` : "",
      amount: pending ? undefined : (s.total ?? undefined),
      direction: "داخل",
      _t: "sale",
    });
  }
  for (const c of collectionsRes.data ?? []) {
    rows.push({
      id: `c-${c.id}`,
      href: "/finance/revenue-reports",
      sortDate: c.occurred_at ?? "",
      date: c.occurred_at ? fmtDate(c.occurred_at) : "—",
      type: TYPE_AR.collection,
      label: `تحصيل من عميل${c.collected_by ? ` (${c.collected_by})` : ""}`,
      party: "—",
      amount: c.amount ?? undefined,
      direction: "داخل",
      _t: "collection",
    });
  }
  for (const m of custodyRes.data ?? []) {
    const isIn = Number(m.amount_in ?? 0) > 0;
    rows.push({
      id: `m-${m.id}`,
      href: "/custody",
      sortDate: m.occurred_at ?? "",
      date: m.occurred_at ? fmtDate(m.occurred_at) : "—",
      type: TYPE_AR.custody,
      label: [m.movement_type, m.note].filter(Boolean).join(" — "),
      party: (m.custody_account_id && holderName.get(m.custody_account_id)) || "—",
      amount: isIn ? Number(m.amount_in) : Number(m.amount_out),
      direction: isIn ? "داخل" : "خارج",
      _t: "custody",
    });
  }

  const pendingPriceCount = (salesRes.data ?? []).filter((s) => s.price_status === "pending").length;
  rows.sort((a, b) => String(b.sortDate).localeCompare(String(a.sortDate)));
  const visible = active ? rows.filter((r) => r._t === active) : rows;
  const countOf = (t: TxType) => rows.filter((r) => r._t === t).length;

  const chips: { t: TxType | null; label: string; count: number }[] = [
    { t: null, label: "الكل", count: rows.length },
    { t: "expense", label: TYPE_AR.expense, count: countOf("expense") },
    { t: "sale", label: TYPE_AR.sale, count: countOf("sale") },
    { t: "collection", label: TYPE_AR.collection, count: countOf("collection") },
    { t: "custody", label: TYPE_AR.custody, count: countOf("custody") },
  ];

  return (
    <div className="flex flex-col gap-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>
            المعاملات
          </h1>
          <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
            كل حركات الفلوس في مكان واحد — آخر {num(LIMIT)} عملية من كل نوع.
          </p>
        </div>
        <div className="no-print flex flex-wrap items-center gap-3">
          <PrintButton label="طباعة المعاملات" />
          <Link href="/record" className="text-sm font-bold underline underline-offset-4" style={{ color: "var(--brand)" }}>
            + سجّل عملية جديدة
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {chips.map((c) => (
          <Link key={c.label} href={c.t ? `/transactions?type=${c.t}` : "/transactions"} className="block">
            <KpiCard
              label={c.label}
              value={num(c.count)}
              icon={active === c.t || (!active && c.t === null) ? "◉" : undefined}
            />
          </Link>
        ))}
      </div>

      <FilterableTable
        columns={COLUMNS}
        rows={visible}
        ariaLabel="سجل المعاملات الموحد"
        placeholder="ابحث في المعاملات…"
        exportFilename="transactions"
        empty="لا معاملات مطابقة"
      />

      {/* SPEC-0025 U-13: «التالي المقترح» — no dead ends; suggestions are data-driven, never fabricated. */}
      {pendingPriceCount > 0 && (
        <div className="no-print flex flex-wrap items-center gap-2 rounded-md px-3 py-2 text-sm" style={{ background: "var(--surface-raised, #fff)", border: "1px solid var(--line)" }}>
          <span className="font-bold" style={{ color: "var(--ink)" }}>التالي المقترح:</span>
          {/* Actionable "set prices" → the pricing wizard, not the read-only revenue report (SPEC-0030 flow audit B2). */}
          <Link href="/record/price" className="font-bold underline underline-offset-4" style={{ color: "var(--brand)" }}>
            حدّد أسعار {num(pendingPriceCount)} بيع معلّق ليدخل الدفاتر ←
          </Link>
        </div>
      )}
    </div>
  );
}
