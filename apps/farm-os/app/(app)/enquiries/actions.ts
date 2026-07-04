"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { toArabicError } from "@/lib/errors";

// Mark an enquiry read / archived (or back to new). The owner gate (site.write) is enforced in the
// DB by fn_set_enquiry_status (SECURITY DEFINER + authorize); this keeps the request authenticated
// and revalidates the inbox. Client UPDATE on site_enquiries stays revoked.

const NO_PERM = "ليس لديك صلاحية لإدارة الطلبات (تتطلب صلاحية المالك)";

type Result = { ok: true } | { ok: false; error: string };

export async function setEnquiryStatus(id: string, status: "new" | "read" | "archived"): Promise<Result> {
  await requireMembership();
  const sb = await createClient();
  const { error } = await sb.rpc("fn_set_enquiry_status", { p_id: id, p_status: status });
  if (error) return { ok: false, error: toArabicError(error, { "42501": NO_PERM }) };
  revalidatePath("/enquiries");
  return { ok: true };
}
