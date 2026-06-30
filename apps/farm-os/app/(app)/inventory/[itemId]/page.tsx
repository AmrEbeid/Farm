import Link from "next/link";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import type { TabItem } from "@amrebeid/ui";
import { Alert, Card, DescriptionList, KpiCard } from "@/components/ui";
import { tabId, tabPanelId } from "@/lib/tab-ids";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { Entity360Header } from "@/components/Entity360Header";
import { EntityTabs } from "@/components/EntityTabs";
import { egp, num } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { MOVEMENT_TYPE_AR, PR_STATUS_AR } from "@/lib/labels";

const TAB_IDS = ["overview", "movements", "purchases"] as const;
type ItemTab = (typeof TAB_IDS)[number];

export default async function InventoryItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ itemId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { itemId } = await params;
  const { tab: rawTab } = await searchParams;
  const tab: ItemTab = (TAB_IDS as readonly string[]).includes(rawTab ?? "")
    ? (rawTab as ItemTab)
    : "overview";
  await requireMembership();
  const sb = await createClient();

  const [
    { data: item, error: itemError },
    { data: movements, error: movementsError },
    { data: prLines, error: prLinesError },
  ] = await Promise.all([
    sb
      .from("inventory_items")
      .select(
        "id, name, category, unit, pack_size, min_stock, max_stock, safety_stock, reorder_point, reorder_qty, lead_time_days, criticality, expiry_tracked, suppliers!inventory_items_preferred_supplier_id_fkey(name, lead_time_days), inventory_bin(location, on_hand, reserved, ordered, projected)",
      )
      .eq("id", itemId)
      .maybeSingle(),
    sb
      .from("inventory_movements")
      .select("id, type, qty, unit, unit_cost, location, occurred_at, batch_no, expiry_date")
      .eq("item_id", itemId)
      .order("occurred_at", { ascending: false })
      .limit(12),
    sb
      .from("purchase_request_items")
      .select("id, qty, unit, est_cost, received_qty, purchase_requests(id, code, status, needed_by, reason)")
      .eq("item_id", itemId)
      .order("id", { ascending: false })
      .limit(12),
  ]);
  if (itemError) throw itemError;
  if (movementsError) throw movementsError;
  if (prLinesError) throw prLinesError;

  if (!item) {
    return <div className="p-6">الصنف غير موجود.</div>;
  }

  const bin = (Array.isArray(item.inventory_bin) ? item.inventory_bin[0] : item.inventory_bin) as
    | { location?: string; on_hand?: number; reserved?: number; ordered?: number; projected?: number }
    | null;
  const supplier = (Array.isArray(item.suppliers) ? item.suppliers[0] : item.suppliers) as
    | { name?: string; lead_time_days?: number }
    | null;

  const unit = item.unit ?? "";
  const onHand = Number(bin?.on_hand ?? 0);
  const reserved = Number(bin?.reserved ?? 0);
  const ordered = Number(bin?.ordered ?? 0);
  const projected = Number(bin?.projected ?? onHand + ordered - reserved);
  const available = onHand - reserved;
  const threshold = Number(item.reorder_point ?? item.min_stock ?? 0);
  const needsReorder = threshold > 0 && available < threshold;

  const movementColumns: SimpleColumn[] = [
    { id: "type", header: "النوع", kind: "status" },
    { id: "qty", header: "الكمية", numeric: true },
    { id: "unit_cost", header: "تكلفة الوحدة", numeric: true },
    { id: "location", header: "الموقع" },
    { id: "occurred_at", header: "التاريخ" },
    { id: "batch", header: "التشغيلة" },
  ];
  const movementRows = (movements ?? []).map((m) => ({
    id: m.id,
    type: MOVEMENT_TYPE_AR[m.type] ?? "غير معروف",
    qty: `${num(Number(m.qty ?? 0))} ${m.unit ?? unit}`.trim(),
    unit_cost: m.unit_cost != null ? egp(Number(m.unit_cost)) : "—",
    location: m.location ?? "main",
    occurred_at: m.occurred_at ? fmtDate(m.occurred_at) : "—",
    batch: m.batch_no ?? "—",
  }));

  const prColumns: SimpleColumn[] = [
    { id: "code", header: "طلب الشراء" },
    { id: "reason", header: "السبب" },
    { id: "qty", header: "الكمية", numeric: true },
    { id: "received", header: "المستلم", numeric: true },
    { id: "cost", header: "التكلفة التقديرية", numeric: true },
    { id: "status", header: "الحالة", kind: "status" },
    { id: "needed_by", header: "مطلوب بحلول" },
  ];
  const prRows = (prLines ?? []).flatMap((line) => {
    const pr = Array.isArray(line.purchase_requests)
      ? line.purchase_requests[0]
      : line.purchase_requests;
    if (!pr?.id) return [];
    return {
      id: line.id,
      href: `/purchase-requests/${pr.id}`,
      code: pr.code ?? "—",
      reason: pr.reason ?? "—",
      qty: `${num(Number(line.qty ?? 0))} ${line.unit ?? unit}`.trim(),
      received: `${num(Number(line.received_qty ?? 0))} ${line.unit ?? unit}`.trim(),
      cost: line.est_cost != null ? egp(Number(line.est_cost)) : "—",
      status: PR_STATUS_AR[pr.status ?? ""] ?? "غير معروف",
      needed_by: pr.needed_by ? fmtDate(pr.needed_by) : "—",
    };
  });

  const tabItems: TabItem[] = [
    { id: "overview", label: "نظرة عامة" },
    { id: "movements", label: `الحركات (${num(movementRows.length)})` },
    { id: "purchases", label: `طلبات الشراء (${num(prRows.length)})` },
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      <Entity360Header
        title={item.name}
        subtitle={`${item.category ?? "صنف"} · ${unit || "—"}`}
        pills={[
          needsReorder
            ? { status: "warning", label: "إعادة الطلب" }
            : { status: "active", label: "سليم" },
        ]}
        actions={
          <>
            <HeaderLink href="/inventory">الأصناف</HeaderLink>
            <HeaderLink href={`/inventory/${itemId}/coverage`} primary>
              تغطية المخزون
            </HeaderLink>
          </>
        }
      />

      {needsReorder && (
        <Alert
          tone="warning"
          title="هذا الصنف بحاجة لإعادة الطلب"
          description={`المتاح ${num(available)} ${unit} أقل من حد إعادة الطلب ${num(threshold)} ${unit}.`.trim()}
        />
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="الموجود" value={num(onHand)} unit={unit} />
        <KpiCard label="المحجوز" value={num(reserved)} unit={unit} />
        <KpiCard
          label="المتاح"
          value={num(available)}
          unit={unit}
          delta={threshold > 0 ? `حد إعادة الطلب ${num(threshold)} ${unit}` : undefined}
          deltaDirection={needsReorder ? "down" : "none"}
        />
        <KpiCard label="قيد الطلب" value={num(ordered)} unit={unit} />
      </section>

      <EntityTabs items={tabItems} value={tab} />

      {tab === "overview" && (
        <div
          role="tabpanel"
          id={tabPanelId("overview")}
          aria-labelledby={tabId("overview")}
          tabIndex={0}
          className="grid gap-4 md:grid-cols-2"
        >
          <Card title="بيانات الصنف">
            <DescriptionList
              layout="inline"
              items={[
                { id: "category", term: "الفئة", description: item.category ?? "—" },
                { id: "unit", term: "الوحدة", description: item.unit ?? "—" },
                { id: "pack", term: "حجم العبوة", description: item.pack_size != null ? num(Number(item.pack_size)) : "—" },
                { id: "criticality", term: "الأهمية", description: item.criticality ?? "—" },
                { id: "expiry", term: "يتابع الصلاحية", description: item.expiry_tracked ? "نعم" : "لا" },
                { id: "location", term: "الموقع", description: bin?.location ?? "main" },
                { id: "projected", term: "الرصيد المتوقع", description: `${num(projected)} ${unit}`.trim() },
              ]}
            />
          </Card>
          <Card title="سياسة إعادة الطلب">
            <DescriptionList
              layout="inline"
              items={[
                { id: "min", term: "الحد الأدنى", description: `${num(Number(item.min_stock ?? 0))} ${unit}`.trim() },
                { id: "max", term: "الحد الأقصى", description: `${num(Number(item.max_stock ?? 0))} ${unit}`.trim() },
                { id: "safety", term: "مخزون الأمان", description: `${num(Number(item.safety_stock ?? 0))} ${unit}`.trim() },
                { id: "reorder", term: "نقطة إعادة الطلب", description: `${num(Number(item.reorder_point ?? 0))} ${unit}`.trim() },
                { id: "reorder_qty", term: "كمية إعادة الطلب", description: `${num(Number(item.reorder_qty ?? 0))} ${unit}`.trim() },
                { id: "lead", term: "مدة التوريد", description: item.lead_time_days != null ? `${num(item.lead_time_days)} يوم` : "—" },
                { id: "supplier", term: "المورد المفضل", description: supplier?.name ?? "—" },
                {
                  id: "supplier_lead",
                  term: "مدة توريد المورد",
                  description: supplier?.lead_time_days != null ? `${num(supplier.lead_time_days)} يوم` : "—",
                },
              ]}
            />
          </Card>
        </div>
      )}

      {tab === "movements" && (
        <div role="tabpanel" id={tabPanelId("movements")} aria-labelledby={tabId("movements")} tabIndex={0}>
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">آخر الحركات</h2>
              <Link
                href={`/inventory/${itemId}/coverage`}
                className="font-medium underline underline-offset-4"
                style={{ color: "var(--brand)" }}
              >
                عرض التغطية
              </Link>
            </div>
            <SimpleTable columns={movementColumns} rows={movementRows} empty="لا توجد حركات لهذا الصنف." />
          </section>
        </div>
      )}

      {tab === "purchases" && (
        <div role="tabpanel" id={tabPanelId("purchases")} aria-labelledby={tabId("purchases")} tabIndex={0}>
          <section>
            <h2 className="mb-3 text-lg font-semibold">طلبات الشراء المرتبطة</h2>
            <SimpleTable columns={prColumns} rows={prRows} empty="لا توجد طلبات شراء مرتبطة بهذا الصنف." />
          </section>
        </div>
      )}
    </div>
  );
}

function HeaderLink({
  href,
  primary = false,
  children,
}: {
  href: string;
  primary?: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-9 items-center justify-center rounded-md px-3 text-sm font-semibold"
      style={{
        color: primary ? "var(--brand-contrast)" : "var(--brand)",
        background: primary ? "var(--brand)" : "var(--surface)",
        border: "1px solid var(--line)",
      }}
    >
      {children}
    </Link>
  );
}
