import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { num } from "@/lib/money";
import { KpiCard } from "@/components/ui";
import { type SimpleColumn } from "@/components/SimpleTable";
import { MasterTable, type MasterField } from "@/components/MasterTable";
import { DashboardKpiLink } from "@/components/DashboardKpiLink";
import { createSupplierFromForm } from "@/app/(app)/suppliers/actions";

// Roles that pass authorize('inventory.write') — the same gate the suppliers RLS WITH CHECK enforces.
const WRITE_ROLES = ["owner", "farm_manager", "storekeeper"];

type SupplierFilter = "all" | "open";

export default async function SuppliersListPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const m = await requireMembership();
  const sb = await createClient();
  const filter: SupplierFilter = (await searchParams).filter === "open" ? "open" : "all";

  const [{ data: suppliers, error }, { data: openLines, error: openError }] = await Promise.all([
    sb.from("suppliers").select("id, name, phone, terms, lead_time_days").order("name"),
    // Live orders per supplier: lines on PRs still awaiting stock. Price intelligence
    // (last price per item per supplier) deliberately absent — actual price paid is not
    // captured at receipt yet (INVENTORY-360 gap #4, needs the fn_post_receipt change).
    sb
      .from("purchase_request_items")
      .select("supplier_id, purchase_requests!inner(status)")
      .in("purchase_requests.status", ["approved", "partially_received"]),
  ]);
  if (error) throw error;
  if (openError) throw openError;

  const openBySupplier = new Map<string, number>();
  for (const line of openLines ?? []) {
    if (!line.supplier_id) continue;
    openBySupplier.set(line.supplier_id, (openBySupplier.get(line.supplier_id) ?? 0) + 1);
  }

  const kpis: { key: SupplierFilter; label: string; value: number }[] = [
    { key: "all", label: "كل الموردين", value: (suppliers ?? []).length },
    { key: "open", label: "لديهم أوامر شراء جارية", value: openBySupplier.size },
  ];

  const columns: SimpleColumn[] = [
    { id: "name", header: "المورّد" },
    { id: "phone", header: "الهاتف", kind: "code" },
    { id: "terms", header: "الشروط" },
    { id: "lead_time", header: "مدة التوريد (يوم)", numeric: true },
    { id: "open_lines", header: "بنود جارية", numeric: true },
  ];

  const rows = (suppliers ?? [])
    .filter((s) => (filter === "open" ? openBySupplier.has(s.id) : true))
    .map((s) => ({
      id: s.id,
      href: `/suppliers/${s.id}`,
      name: s.name,
      phone: s.phone ?? "—",
      terms: s.terms ?? "—",
      lead_time: s.lead_time_days != null ? num(s.lead_time_days) : "—",
      open_lines: num(openBySupplier.get(s.id) ?? 0),
    }));

  // SPEC-0017: the whole screen is one MasterTable declaration — list + search + CSV export + a
  // role-gated inline create form, writing through the gated createSupplier server action (keys match).
  const fields: MasterField[] = [
    { key: "name", label: "اسم المورّد", required: true, maxLength: 120 },
    { key: "phone", label: "الهاتف", maxLength: 40 },
    { key: "terms", label: "شروط التعامل", maxLength: 200 },
    { key: "leadTimeDays", label: "مدة التوريد (أيام)", type: "number" },
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        {kpis.map((chip) => (
          <DashboardKpiLink
            key={chip.key}
            href={chip.key === "all" ? "/suppliers" : `/suppliers?filter=${chip.key}`}
            active={filter === chip.key}
          >
            <KpiCard label={chip.label} value={num(chip.value)} deltaDirection="none" />
          </DashboardKpiLink>
        ))}
      </div>
      <MasterTable
        title="الموردون"
        description="موردو المزرعة المستخدمون في طلبات الشراء"
        columns={columns}
        rows={rows}
        fields={fields}
        canWrite={WRITE_ROLES.includes(m.role)}
        onCreate={createSupplierFromForm}
        addLabel="+ إضافة مورّد"
        searchColumns={["name", "phone"]}
        placeholder="ابحث عن مورّد…"
        exportFilename="suppliers"
        empty={filter === "open" ? "لا موردين لديهم أوامر جارية" : "لا يوجد موردون بعد"}
      />
    </div>
  );
}
