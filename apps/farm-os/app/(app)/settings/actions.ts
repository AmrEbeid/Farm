"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface OrgSettingsInput {
  orgId: string;
  name: string;
  locale: string;
  currency: string;
  areaUnit: string;
  fiscalYearStart: string | null;
}

/** Owner-only org settings update (Stage 1, migration 0086). Server-enforced in fn_update_org_settings. */
export async function updateOrgSettings(
  input: OrgSettingsInput,
): Promise<{ ok: boolean; error?: string }> {
  const sb = await createClient();
  const { error } = await sb.rpc("fn_update_org_settings", {
    p_org: input.orgId,
    p_name: input.name,
    p_locale: input.locale,
    p_currency: input.currency,
    p_area_unit: input.areaUnit,
    p_fiscal_year_start: input.fiscalYearStart,
  });
  if (error) {
    if (error.code === "23514") return { ok: false, error: "اسم المزرعة مطلوب" };
    if (error.code === "42501")
      return { ok: false, error: "غير مصرّح لك بتعديل إعدادات المزرعة" };
    return { ok: false, error: "تعذّر حفظ الإعدادات" };
  }
  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { ok: true };
}
