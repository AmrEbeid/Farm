"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { toArabicError } from "@/lib/errors";

/**
 * Server actions for the Care Academy (Stage 10 / SPEC-0008). Every mutation goes through a SECURITY
 * DEFINER RPC that enforces the role gate (academy.write = owner/agri_engineer) IN THE DATABASE, so
 * these only keep the request authenticated and map the DB error to an Arabic message. The DB also
 * enforces non-negotiable #4: editing content RESETS its sign-off, and chemical content cannot be
 * signed off without a current Egyptian pesticide registration — neither is bypassable from here.
 */

const NO_PERM = "ليس لديك صلاحية لتعديل محتوى الأكاديمية (تتطلب مالك أو مهندس زراعي)";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

export async function saveAcademyContent(input: {
  id?: string | null;
  orgId: string;
  title: string;
  body?: string;
  category?: string;
  hasChemical?: boolean;
}): Promise<Result<string>> {
  await requireMembership();
  const sb = await createClient();
  const { data, error } = await sb.rpc("fn_save_academy_content", {
    p_id: input.id ?? null,
    p_org: input.orgId,
    p_title: input.title,
    p_body: input.body ?? "",
    p_category: input.category ?? "general",
    p_has_chemical: input.hasChemical ?? false,
  });
  if (error) return { ok: false, error: toArabicError(error, { "42501": NO_PERM }) };
  revalidatePath("/academy");
  return { ok: true, data: (data as { id?: string } | null)?.id };
}

export async function signoffAcademyContent(input: {
  id: string;
  agronomistName: string;
  pesticideRegValidUntil?: string | null;
}): Promise<Result> {
  await requireMembership();
  const sb = await createClient();
  const { error } = await sb.rpc("fn_signoff_academy_content", {
    p_id: input.id,
    p_agronomist_name: input.agronomistName,
    p_pesticide_reg_valid_until: input.pesticideRegValidUntil ?? null,
  });
  if (error) return { ok: false, error: toArabicError(error, { "42501": NO_PERM }) };
  revalidatePath("/academy");
  return { ok: true };
}

export async function archiveAcademyContent(input: { id: string; archived?: boolean }): Promise<Result> {
  await requireMembership();
  const sb = await createClient();
  const { error } = await sb.rpc("fn_archive_academy_content", {
    p_id: input.id,
    p_archived: input.archived ?? true,
  });
  if (error) return { ok: false, error: toArabicError(error, { "42501": NO_PERM }) };
  revalidatePath("/academy");
  return { ok: true };
}
