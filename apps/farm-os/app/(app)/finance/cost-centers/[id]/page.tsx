import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Landmark, ReceiptText, Scale, Sprout } from "lucide-react";
import type { TabItem } from "@amrebeid/ui";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Breadcrumbs, EmptyState, StatusPill } from "@/components/ui";
import { FilterableTable } from "@/components/FilterableTable";
import { type SimpleColumn, type SimpleRow } from "@/components/SimpleTable";
import { Entity360Header } from "@/components/Entity360Header";
import { EntityTabs } from "@/components/EntityTabs";
import { StoryLine } from "@/components/StoryLine";
import { PrintButton } from "@/components/print-button";
import { tabId, tabPanelId } from "@/lib/tab-ids";
import { fmtDate } from "@/lib/dates";
import { PAYMENT_STATUS_AR, SALE_PAYMENT_STATUS_AR } from "@/lib/labels";
import { egp, egpSummary, num } from "@/lib/money";
import {
  DIRECT_DISPLAY_CAP,
  costCenterSaleExclusions,
  isDirectTableTruncated,
  parseCostCenterDirectSummary,
} from "@/lib/cost-center-summary";

// SPEC-0025 U-11 (§2c) — the cost-center 360: the destination that makes every center name a LINK.
// One page answers «ماذا يحدث على هذا النشاط؟»: subtree net from the ledger (v_cost_center_rollup),
// per-feddan, the expenses charged to it, and the sales it produced — leading with the story sentence.

export const dynamic = "force-dynamic";

const EXPENSE_COLUMNS: SimpleColumn[] = [
  { id: "date", header: "التاريخ" },
  { id: "category", header: "البند" },
  { id: "total", header: "المبلغ (ج.م)", kind: "money", numeric: true },
  { id: "status", header: "الحالة", kind: "status" },
];
const SALE_COLUMNS: SimpleColumn[] = [
  { id: "date", header: "التاريخ" },
  { id: "crop", header: "المحصول" },
  { id: "total", header: "الإجمالي (ج.م)", kind: "money", numeric: true },
  { id: "status", header: "الحالة", kind: "status" },
];

type CenterTab = "overview" | "expenses" | "sales";

export default async function CostCenterPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const m = await requireRole(["owner", "accountant"]);
  const { id } = await params;
  const { tab: requestedTab } = await searchParams;
  const tab = parseCenterTab(requestedTab);
  const sb = await createClient();

  const [rollupRes, summaryRes, expensesRes, salesRes] = await Promise.all([
    sb.from("v_cost_center_rollup").select("*").eq("org_id", m.orgId).eq("cost_center_id", id).maybeSingle(),
    sb.rpc("fn_cost_center_direct_summary", { p_org: m.orgId, p_cost_center: id }),
    sb
      .from("expenses")
      .select("id, date, category, description, total, payment_status")
      .eq("org_id", m.orgId)
      .eq("cost_center_id", id)
      .order("date", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(DIRECT_DISPLAY_CAP),
    sb
      .from("sales")
      .select("id, sale_date, crop, total, price_status, payment_status")
      .eq("org_id", m.orgId)
      .eq("cost_center_id", id)
      // A reconciliation-reversed sale keeps price_status='finalized' but its revenue journal is
      // reversed, so it must not inflate this centre's sales total. A historical_treasury sale IS
      // real revenue for the centre and deliberately still counts. (migration 20260726160000)
      .neq("payment_status", "historical_reversed")
      .order("sale_date", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(DIRECT_DISPLAY_CAP),
  ]);
  if (rollupRes.error) throw rollupRes.error;
  const center = rollupRes.data;
  if (!center) notFound();
  if (summaryRes.error) throw summaryRes.error;
  if (expensesRes.error) throw expensesRes.error;
  if (salesRes.error) throw salesRes.error;

  const expenses = expensesRes.data ?? [];
  const sales = salesRes.data ?? [];
  const summary = parseCostCenterDirectSummary(summaryRes.data);
  const saleExclusions = costCenterSaleExclusions(summary);
  const expenseTotal = summary.directExpenseTotal;
  const expenseDisplay = egpSummary({
    total: expenseTotal,
    unknownCount: summary.unknownExpenseCount,
    hasUnknown: summary.unknownExpenseCount > 0,
  });
  const salesTotal = summary.directSaleRevenue;
  const pendingSales = saleExclusions.pendingPrice;
  const expensesTruncated = isDirectTableTruncated(summary.expenseCount);
  const salesTruncated = isDirectTableTruncated(summary.saleCount);
  const area = center.area_feddan == null ? null : Number(center.area_feddan);

  const lead =
    summary.directExpenseCount === 0 && salesTotal === 0
      ? `لا مصروفات مباشرة غير ملغاة أو مبيعات مؤكدة مُرحّلة على «${center.name_ar}» بعد.`
      : `«${center.name_ar}» عليه ${expenseDisplay} مصروفات مباشرة` +
        (salesTotal > 0 ? ` وأدرّ ${egp(salesTotal)} مبيعات مؤكدة` : "") +
        (area && area > 0 ? ` — صافي دفتري ${egp(Number(center.net ?? 0))} (${egp(Number(center.net_per_feddan ?? 0))} للفدان على ${num(area)} فدان).` : ".");
  const notes: string[] = [];
  if (summary.unknownExpenseCount > 0) {
    notes.push(`${num(summary.unknownExpenseCount)} مصروف بلا مبلغ معروف لا يدخل في الإجمالي النقدي.`);
  }
  if (pendingSales > 0) notes.push(`${num(pendingSales)} بيع بسعر معلّق لا يدخل في الأرقام أعلاه.`);
  if (saleExclusions.finalizedWithoutPostedJournal > 0) notes.push(`${num(saleExclusions.finalizedWithoutPostedJournal)} بيع مسعّر بلا قيد إيراد مرحّل لا يدخل في الأرقام أعلاه.`);
  if (!center.active) notes.push("هذا المركز مؤرشف — يظهر للسجل فقط.");

  const expenseRows: SimpleRow[] = expenses.map((e) => ({
    id: e.id,
    href: `/expenses/${e.id}`,
    date: e.date ? fmtDate(e.date) : "—",
    category: [e.category, e.description].filter(Boolean).join(" — "),
    total: e.total ?? undefined,
    status: e.payment_status ? PAYMENT_STATUS_AR[e.payment_status] ?? e.payment_status : undefined,
  }));
  const saleRows: SimpleRow[] = sales.map((s) => ({
    id: s.id,
    date: s.sale_date ? fmtDate(s.sale_date) : "—",
    crop: s.crop,
    total: s.price_status === "pending" ? undefined : (s.total ?? undefined),
    status:
      s.price_status === "pending"
        ? "السعر معلّق"
        : SALE_PAYMENT_STATUS_AR[s.payment_status] ?? s.payment_status,
  }));

  const tabItems: TabItem[] = [
    { id: "overview", label: "ملخص" },
    { id: "expenses", label: `المصروفات (${num(summary.expenseCount)})` },
    { id: "sales", label: `المبيعات (${num(summary.saleCount)})` },
  ];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4" data-testid="cost-center-360" style={{ "--ink-muted": "#5f7066" } as CSSProperties}>
      <Breadcrumbs ariaLabel="المسار" items={[{ id: "reports", label: "تقارير مراكز التكلفة", href: "/finance/reports" }, { id: "center", label: center.name_ar }]} />
      <Entity360Header
        title={center.name_ar}
        subtitle={`${center.code}${center.enterprise ? ` · ${center.enterprise}` : ""}${area && area > 0 ? ` · ${num(area)} فدان` : ""}`}
        pills={[{ status: center.active ? "done" : "blocked", label: center.active ? "نشط" : "مؤرشف" }]}
        actions={<div className="no-print flex flex-wrap gap-2"><PrintButton label="طباعة المركز" /><Link href="/record/expense?payment=custody" className="fos-btn fos-btn--primary fos-btn--md">سجّل مصروفًا</Link></div>}
      />

      <section aria-label="ملخص اقتصاديات المركز" className="grid border-y sm:grid-cols-2 lg:grid-cols-4" style={{ borderColor: "var(--line)" }}>
        <Metric label="صافي الشجرة" value={egp(Number(center.net ?? 0))} icon={<Scale size={16} aria-hidden />} />
        <Metric label="إيراد مباشر مرحّل" value={egp(salesTotal)} icon={<Landmark size={16} aria-hidden />} />
        <Metric label="مصروف مباشر" value={expenseDisplay} icon={<ReceiptText size={16} aria-hidden />} />
        <Metric label="صافي للفدان" value={area && area > 0 ? egp(Number(center.net_per_feddan ?? 0)) : "غير متوفر"} icon={<Sprout size={16} aria-hidden />} />
      </section>

      <EntityTabs items={tabItems} value={tab} ariaLabel="أقسام مركز التكلفة" />

      {tab === "overview" && <div role="tabpanel" id={tabPanelId("overview")} aria-labelledby={tabId("overview")} tabIndex={0} className="flex flex-col gap-5">
        <StoryLine lead={lead} notes={notes} />
        <section aria-labelledby="reading-title" className="border-y py-4" style={{ borderColor: "var(--line)" }}>
          <h2 id="reading-title" className="text-base font-bold">كيف تقرأ الأرقام</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Definition title="مباشر" value={`${expenseDisplay} مصروفات · ${egp(salesTotal)} مبيعات`} detail="العمليات المسجلة على هذا المركز نفسه، دون الأبناء." />
            <Definition title="الشجرة" value={`${egp(Number(center.net ?? 0))} صافي`} detail="القيود المرحّلة على هذا المركز وكل المراكز التابعة له." />
          </div>
        </section>
        <nav aria-label="أعمال مركز التكلفة" className="no-print grid gap-2 sm:grid-cols-3">
          <WorkflowLink href="?tab=expenses" title="راجع المصروفات" detail={`${num(summary.expenseCount)} سجل`} />
          <WorkflowLink href="?tab=sales" title="راجع المبيعات" detail={`${num(summary.saleCount)} سجل`} />
          <WorkflowLink href={`/finance/reports?center=${encodeURIComponent(center.code)}`} title="اعرضه في التقرير" detail="مقارنة وتحليل سنوي" />
        </nav>
      </div>}

      {tab === "expenses" && <div role="tabpanel" id={tabPanelId("expenses")} aria-labelledby={tabId("expenses")} tabIndex={0}>
        <SectionHeading title="المصروفات المباشرة" detail="أحدث السجلات المسجلة على هذا المركز نفسه." />
        {expensesTruncated && (
          <p className="mb-2 text-sm" style={{ color: "var(--ink-muted)" }}>
            يظهر أحدث {num(DIRECT_DISPLAY_CAP)} صف من إجمالي {num(summary.expenseCount)}. الإجمالي أعلاه
            محسوب على السجل الكامل مع استبعاد الملغى والمعكوس.
          </p>
        )}
        {expenseRows.length === 0 ? (
          <EmptyState title="لا توجد مصروفات مباشرة" description="سجّل أول مصروف واختر هذا المركز في خطوة «على أي نشاط؟»." action={<Link href="/record/expense?payment=custody" className="fos-btn fos-btn--primary fos-btn--md">سجّل مصروفًا</Link>} />
        ) : (
          <FilterableTable columns={EXPENSE_COLUMNS} rows={expenseRows} ariaLabel={`مصروفات ${center.name_ar}`} exportFilename={`center-expenses-${center.code}`} empty="لا مصروفات" />
        )}
      </div>}

      {tab === "sales" && <div role="tabpanel" id={tabPanelId("sales")} aria-labelledby={tabId("sales")} tabIndex={0}>
        <SectionHeading title="المبيعات المباشرة" detail="الجدول يعرض كل المبيعات غير المعكوسة؛ رقم الإيراد أعلاه لا يشمل إلا البيع المسعّر الذي له قيد إيراد مرحّل." />
        {(saleExclusions.pendingPrice > 0 || saleExclusions.finalizedWithoutPostedJournal > 0) && <div className="mb-3 border-y py-3 text-sm" style={{ borderColor: "var(--line)" }}>
          <strong>لا تدخل في رقم الإيراد أعلاه:</strong> {num(saleExclusions.pendingPrice)} معلقة السعر · {num(saleExclusions.finalizedWithoutPostedJournal)} مسعرة بلا قيد مرحّل.
        </div>}
        {salesTruncated && (
          <p className="mb-2 text-sm" style={{ color: "var(--ink-muted)" }}>
            يظهر أحدث {num(DIRECT_DISPLAY_CAP)} صف من إجمالي {num(summary.saleCount)}. الإجمالي أعلاه
            محسوب على السجل الكامل للمبيعات المؤكدة ذات القيد المُرحّل فقط.
          </p>
        )}
        {saleRows.length === 0 ? (
          <EmptyState title="لا توجد مبيعات من هذا المركز بعد" />
        ) : (
          <FilterableTable columns={SALE_COLUMNS} rows={saleRows} ariaLabel={`مبيعات ${center.name_ar}`} exportFilename={`center-sales-${center.code}`} empty="لا مبيعات" />
        )}
      </div>}
    </div>
  );
}

function parseCenterTab(value: string | undefined): CenterTab {
  return value === "expenses" || value === "sales" ? value : "overview";
}

function Metric({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return <div className="min-w-0 border-b py-3 last:border-b-0 sm:border-b-0 sm:px-4 sm:first:ps-0 sm:[&:not(:first-child)]:border-s" style={{ borderColor: "var(--line)" }}><div className="flex items-center gap-2 text-xs" style={{ color: "var(--ink-muted)" }}>{icon}{label}</div><strong className="mt-1 block text-lg tabular-nums">{value}</strong></div>;
}

function Definition({ title, value, detail }: { title: string; value: string; detail: string }) {
  return <div><div className="flex items-center gap-2"><StatusPill status="active">{title}</StatusPill><strong className="text-sm tabular-nums">{value}</strong></div><p className="mt-2 text-xs" style={{ color: "var(--ink-muted)" }}>{detail}</p></div>;
}

function SectionHeading({ title, detail }: { title: string; detail: string }) {
  return <div className="mb-3 flex flex-wrap items-end justify-between gap-2"><div><h2 className="text-base font-bold">{title}</h2><p className="text-xs" style={{ color: "var(--ink-muted)" }}>{detail}</p></div></div>;
}

function WorkflowLink({ href, title, detail }: { href: string; title: string; detail: string }) {
  return <Link href={href} className="flex min-h-16 items-center justify-between gap-3 border-y px-1 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" style={{ borderColor: "var(--line)" }}><span><strong className="block text-sm">{title}</strong><span className="text-xs" style={{ color: "var(--ink-muted)" }}>{detail}</span></span><ArrowLeft size={17} aria-hidden style={{ color: "var(--brand)" }} /></Link>;
}
