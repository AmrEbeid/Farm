import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { KpiCard } from "@/components/ui";
import { FilterableTable } from "@/components/FilterableTable";
import { type SimpleColumn, type SimpleRow } from "@/components/SimpleTable";
import { PrintButton } from "@/components/print-button";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";
import {
  TX_ROW_LIMIT,
  EXPENSE_VISIBLE_LIFECYCLE_FILTER,
  SALE_HIDDEN_PAYMENT_STATUS,
  compareTxByDateThenId,
  dedupeReferencedIds,
  isAnySourceTruncated,
  isTypeTruncated,
  requireExactCount,
  requireLookupName,
} from "@/lib/transactions-ledger";

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
  const m = await requireRole(["owner", "accountant"]);
  const { type } = await searchParams;
  const active = (["expense", "sale", "collection", "custody"] as TxType[]).includes(type as TxType)
    ? (type as TxType)
    : null;
  const sb = await createClient();

  const [expensesRes, salesRes, collectionsRes, custodyRes, pendingPriceRes] = await Promise.all([
    sb
      .from("expenses")
      .select("id, date, category, description, total, kind, supplier_id, payment_status", { count: "exact" })
      .eq("org_id", m.orgId)
      // Honest ledger (CLAUDE.md #1): a cancelled or reversed-out expense never moved real money, so
      // it is excluded here — while a not-yet-routed (null payment_status) expense stays visible.
      .or(EXPENSE_VISIBLE_LIFECYCLE_FILTER)
      .order("date", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(TX_ROW_LIMIT),
    sb
      .from("sales")
      .select("id, sale_date, crop, qty, unit, total, price_status, buyer_id, payment_status", { count: "exact" })
      .eq("org_id", m.orgId)
      // A reconciliation-reversed sale's revenue journal is reversed, so listing it as a positive
      // incoming row double-counts it against its replacement. (migration 20260726160000)
      .neq("payment_status", SALE_HIDDEN_PAYMENT_STATUS)
      .order("sale_date", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(TX_ROW_LIMIT),
    sb
      .from("sale_collections")
      .select("id, sale_id, amount, occurred_at, collected_by", { count: "exact" })
      .eq("org_id", m.orgId)
      .order("occurred_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(TX_ROW_LIMIT),
    sb
      .from("custody_movements")
      .select("id, occurred_at, movement_type, amount_in, amount_out, custody_account_id, note", { count: "exact" })
      .eq("org_id", m.orgId)
      .order("occurred_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(TX_ROW_LIMIT),
    // Exact pending-price sale count, org-scoped, over the same visible-sale lifecycle filter as the
    // sales row query above — a cheap head request (no rows), never the length of the bounded page.
    sb
      .from("sales")
      .select("id", { count: "exact", head: true })
      .eq("org_id", m.orgId)
      .eq("price_status", "pending")
      .neq("payment_status", SALE_HIDDEN_PAYMENT_STATUS),
  ]);

  // Fail closed (CLAUDE.md #1): any query error must stop the page, never silently render a partial
  // or empty ledger as if it were complete.
  if (expensesRes.error) throw expensesRes.error;
  if (salesRes.error) throw salesRes.error;
  if (collectionsRes.error) throw collectionsRes.error;
  if (custodyRes.error) throw custodyRes.error;
  if (pendingPriceRes.error) throw pendingPriceRes.error;

  const expenseCount = requireExactCount(expensesRes, "expenses");
  const saleCount = requireExactCount(salesRes, "sales");
  const collectionCount = requireExactCount(collectionsRes, "sale_collections");
  const custodyCount = requireExactCount(custodyRes, "custody_movements");
  const pendingPriceCount = requireExactCount(pendingPriceRes, "sales pending price");
  const allCount = expenseCount + saleCount + collectionCount + custodyCount;

  // Lookups are bounded to the ids actually referenced by the displayed (already-capped) rows —
  // never the whole org's buyers/suppliers/custody_accounts table — so party names stay cheap
  // regardless of how large those tables grow.
  const buyerIds = dedupeReferencedIds((salesRes.data ?? []).map((s) => s.buyer_id));
  const supplierIds = dedupeReferencedIds((expensesRes.data ?? []).map((e) => e.supplier_id));
  const custodyAccountIds = dedupeReferencedIds((custodyRes.data ?? []).map((mv) => mv.custody_account_id));

  const [buyersRes, suppliersRes, custodyAcctRes] = await Promise.all([
    buyerIds.length > 0
      ? sb.from("buyers").select("id, name").eq("org_id", m.orgId).in("id", buyerIds)
      : Promise.resolve({ data: [], error: null }),
    supplierIds.length > 0
      ? sb.from("suppliers").select("id, name").eq("org_id", m.orgId).in("id", supplierIds)
      : Promise.resolve({ data: [], error: null }),
    custodyAccountIds.length > 0
      ? sb.from("custody_accounts").select("id, holder_label").eq("org_id", m.orgId).in("id", custodyAccountIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (buyersRes.error) throw buyersRes.error;
  if (suppliersRes.error) throw suppliersRes.error;
  if (custodyAcctRes.error) throw custodyAcctRes.error;

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
      party: requireLookupName(e.supplier_id, supplierName, "supplier"),
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
      party: requireLookupName(s.buyer_id, buyerName, "buyer"),
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
  for (const mv of custodyRes.data ?? []) {
    const isIn = Number(mv.amount_in ?? 0) > 0;
    rows.push({
      id: `m-${mv.id}`,
      href: "/custody",
      sortDate: mv.occurred_at ?? "",
      date: mv.occurred_at ? fmtDate(mv.occurred_at) : "—",
      type: TYPE_AR.custody,
      label: [mv.movement_type, mv.note].filter(Boolean).join(" — "),
      party: requireLookupName(mv.custody_account_id, holderName, "custody account"),
      amount: isIn ? Number(mv.amount_in) : Number(mv.amount_out),
      direction: isIn ? "داخل" : "خارج",
      _t: "custody",
    });
  }

  rows.sort(compareTxByDateThenId);
  const visible = active ? rows.filter((r) => r._t === active) : rows;

  const countOf: Record<TxType, number> = {
    expense: expenseCount,
    sale: saleCount,
    collection: collectionCount,
    custody: custodyCount,
  };

  const chips: { t: TxType | null; label: string; count: number }[] = [
    { t: null, label: "الكل", count: allCount },
    { t: "expense", label: TYPE_AR.expense, count: expenseCount },
    { t: "sale", label: TYPE_AR.sale, count: saleCount },
    { t: "collection", label: TYPE_AR.collection, count: collectionCount },
    { t: "custody", label: TYPE_AR.custody, count: custodyCount },
  ];

  // Truncation gates CSV export and the search-scope note: a specific type is truncated once its own
  // exact count exceeds the bounded page; «الكل» is truncated if ANY merged source is.
  const isTruncated = active
    ? isTypeTruncated(countOf[active])
    : isAnySourceTruncated([expenseCount, saleCount, collectionCount, custodyCount]);
  const activeExactCount = active ? countOf[active] : allCount;

  // For a selected type, "latest N of exact total" is accurate — one source, one capped query. The
  // merged «الكل» view is NOT that: each of the four sources is capped independently, so the shown
  // rows are never "the N globally latest" — they're up to TX_ROW_LIMIT latest per type, merged. The
  // notice must say so explicitly instead of implying a single global ranking.
  const searchExportNote =
    "البحث أدناه يقتصر على الصفوف المعروضة فقط، وتصدير CSV غير متاح هنا لتفادي ملف يبدو كاملاً بينما هو جزء من السجل.";
  const truncationNotice = !isTruncated
    ? null
    : active
      ? `يظهر أحدث ${num(visible.length)} من إجمالي ${num(activeExactCount)} عملية ${TYPE_AR[active]} مطابقة — الجدول غير مكتمل. الشرائح أعلاه محسوبة على السجل الكامل. ${searchExportNote}`
      : `تعرض هذه الصفحة حتى ${num(TX_ROW_LIMIT)} من أحدث كل نوع من العمليات على حدة (مصروف، بيع، تحصيل، حركة عهدة) — وليس أحدث ${num(visible.length)} عملية إجمالاً. المعروض الآن ${num(visible.length)} عملية من إجمالي ${num(activeExactCount)} عملية مطابقة عبر كل الأنواع — الجدول غير مكتمل. الشرائح أعلاه محسوبة على السجل الكامل. ${searchExportNote}`;

  return (
    <div className="flex flex-col gap-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>
            المعاملات
          </h1>
          <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
            كل حركات الفلوس في مكان واحد — آخر {num(TX_ROW_LIMIT)} عملية من كل نوع.
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

      {truncationNotice && (
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          {truncationNotice}
        </p>
      )}

      <FilterableTable
        columns={COLUMNS}
        rows={visible}
        ariaLabel="سجل المعاملات الموحد"
        placeholder={isTruncated ? "ابحث ضمن أحدث الصفوف المعروضة…" : "ابحث في المعاملات…"}
        exportFilename={isTruncated ? undefined : "transactions"}
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
