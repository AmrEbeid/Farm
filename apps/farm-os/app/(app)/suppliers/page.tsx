import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { num } from "@/lib/money";
import { type SimpleColumn } from "@/components/SimpleTable";
import { FilterableTable } from "@/components/FilterableTable";
import { AddSupplier } from "@/components/AddSupplier";

// Roles that pass authorize('inventory.write') — the same gate the suppliers RLS WITH CHECK enforces.
const WRITE_ROLES = ["owner", "farm_manager", "storekeeper"];

export default async function SuppliersListPage() {
  const m = await requireMembership();
  const sb = await createClient();

  const { data: suppliers, error } = await sb
    .from("suppliers")
    .select("id, name, phone, terms, lead_time_days")
    .order("name");
  if (error) throw error;

  const columns: SimpleColumn[] = [
    { id: "name", header: "المورّد" },
    { id: "phone", header: "الهاتف" },
    { id: "terms", header: "الشروط" },
    { id: "lead_time", header: "مدة التوريد (يوم)", numeric: true },
  ];

  const rows = (suppliers ?? []).map((s) => ({
    id: s.id,
    href: `/suppliers/${s.id}`,
    name: s.name,
    phone: s.phone ?? "—",
    terms: s.terms ?? "—",
    lead_time: s.lead_time_days != null ? num(s.lead_time_days) : "—",
  }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">الموردون</h1>
        <p style={{ color: "var(--ink-muted)" }}>
          موردو المزرعة المستخدمون في طلبات الشراء
        </p>
      </header>
      {WRITE_ROLES.includes(m.role) && <AddSupplier />}
      <FilterableTable
        columns={columns}
        rows={rows}
        empty="لا يوجد موردون بعد"
        searchColumns={["name", "phone"]}
        placeholder="ابحث عن مورّد…"
      />
    </div>
  );
}
