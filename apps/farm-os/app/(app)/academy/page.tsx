import { requireMembership } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AcademyList } from "@/components/AcademyList";
import { authoritativeness, type AcademyContent } from "@/lib/academy";

/**
 * Care Academy (Stage 10 / SPEC-0008). Agronomy guidance as editable templates — ADVISORY until a named
 * agronomist signs off + (for chemicals) confirms a current Egyptian pesticide registration (#4). The
 * authoritativeness gate (lib/academy.ts) decides the badge from the row's sign-off fields; owner/
 * agri_engineer can author + sign off (the DB re-enforces the gate).
 */
export default async function AcademyPage() {
  const m = await requireMembership();
  const sb = await createClient();
  const { data, error } = await sb
    .from("academy_content")
    .select(
      "id, title, body, category, has_chemical, agronomist_name, signed_at, pesticide_reg_valid_until",
    )
    .eq("archived", false)
    .order("category");
  if (error) {
    throw new Error("academy_content query failed");
  }

  const canEdit = m.role === "owner" || m.role === "agri_engineer";
  const asOf = new Date().toISOString();

  const items = (data ?? []).map((c) => {
    const content: AcademyContent = {
      id: c.id,
      title: c.title,
      hasChemical: c.has_chemical,
      signOff:
        c.agronomist_name && c.signed_at
          ? {
              agronomistName: c.agronomist_name,
              signedAt: c.signed_at,
              pesticideRegValidUntil: c.pesticide_reg_valid_until,
            }
          : null,
    };
    return {
      id: c.id,
      title: c.title,
      body: c.body,
      category: c.category,
      hasChemical: c.has_chemical,
      agronomistName: c.agronomist_name,
      signedAt: c.signed_at,
      pesticideRegValidUntil: c.pesticide_reg_valid_until,
      authoritative: authoritativeness(content, asOf) === "authoritative",
    };
  });

  return (
    <div className="mx-auto max-w-3xl p-4">
      <h1 className="mb-1 text-xl font-bold">أكاديمية الرعاية</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        إرشادات زراعية كقوالب قابلة للتعديل — لا تُعدّ وصفة معتمدة إلا بعد توقيع مهندس زراعي مرخّص
        وتأكيد تسجيل المبيد المصري الساري.
      </p>
      <AcademyList items={items} orgId={m.orgId} canEdit={canEdit} />
    </div>
  );
}
