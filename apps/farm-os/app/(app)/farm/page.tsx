import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { KpiCard, Card } from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { num } from "@/lib/money";

export default async function FarmStructurePage() {
  await requireMembership();
  const sb = await createClient();

  const { data: sectors } = await sb
    .from("sectors")
    .select("id, name, code, crop, hawshat(id, palm_count_barhi, palm_count_male)")
    .order("code");

  const columns: SimpleColumn[] = [
    { id: "name", header: "القطاع" },
    { id: "code", header: "الرمز" },
    { id: "hawshat", header: "عدد الحوشات", numeric: true },
    { id: "barhi", header: "نخيل برحي", numeric: true },
    { id: "male", header: "ذكور", numeric: true },
  ];

  let totalBarhi = 0;
  let totalMale = 0;
  let totalHawshat = 0;
  const rows = (sectors ?? []).map((s) => {
    const hawshat = (s.hawshat ?? []) as { palm_count_barhi?: number; palm_count_male?: number }[];
    const barhi = hawshat.reduce((sum, h) => sum + Number(h.palm_count_barhi ?? 0), 0);
    const male = hawshat.reduce((sum, h) => sum + Number(h.palm_count_male ?? 0), 0);
    totalBarhi += barhi;
    totalMale += male;
    totalHawshat += hawshat.length;
    return {
      id: s.id,
      href: `/farm/sector/${s.id}`,
      name: s.name,
      code: s.code,
      hawshat: num(hawshat.length),
      barhi: num(barhi),
      male: num(male),
    };
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold">هيكل المزرعة</h1>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="القطاعات" value={num((sectors ?? []).length)} />
        <KpiCard label="الحوشات" value={num(totalHawshat)} />
        <KpiCard label="نخيل برحي" value={num(totalBarhi)} />
        <KpiCard label="ذكور" value={num(totalMale)} />
      </section>

      <Card title="القطاعات">
        <SimpleTable columns={columns} rows={rows} empty="لا توجد قطاعات" />
      </Card>
    </div>
  );
}
