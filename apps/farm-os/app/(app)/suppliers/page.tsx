import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { num } from "@/lib/money";
import { type SimpleColumn } from "@/components/SimpleTable";
import { MasterTable, type MasterField } from "@/components/MasterTable";
import { createSupplierFromForm } from "@/app/(app)/suppliers/actions";

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
        empty="لا يوجد موردون بعد"
      />
    </div>
  );
}
