"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { toArabicError } from "@/lib/errors";

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
    // Field-safe Arabic mapping via the shared table (never leaks raw English). The two
    // context-specific overrides preserve the previous phrasing; any other SQLSTATE now gets
    // its DEFAULT_AR message (still field-safe) or the settings-specific fallback.
    return {
      ok: false,
      error: toArabicError(
        error,
        {
          "23514": "اسم المزرعة مطلوب",
          "42501": "غير مصرّح لك بتعديل إعدادات المزرعة",
        },
        "تعذّر حفظ الإعدادات",
      ),
    };
  }
  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { ok: true };
}
