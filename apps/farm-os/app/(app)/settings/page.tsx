import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SettingsForm } from "@/components/SettingsForm";

/** Org settings (Stage 1). Owner-only; the setter (fn_update_org_settings) re-enforces this server-side. */
export default async function SettingsPage() {
  const m = await requireRole(["owner"]);
  const sb = await createClient();
  const { data: org } = await sb
    .from("organization")
    .select("id, name, locale, currency, area_unit, fiscal_year_start")
    .eq("id", m.orgId)
    .single();

  if (!org) {
    return <p className="p-4">تعذّر تحميل بيانات المزرعة.</p>;
  }

  return (
    <div className="mx-auto max-w-xl p-4">
      <h1 className="mb-4 text-xl font-bold">إعدادات المزرعة</h1>
      <SettingsForm
        org={{
          id: org.id,
          name: org.name,
          locale: org.locale,
          currency: org.currency,
          areaUnit: org.area_unit,
          fiscalYearStart: org.fiscal_year_start,
        }}
      />
    </div>
  );
}
