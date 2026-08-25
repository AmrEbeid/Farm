"use server";

import { revalidatePath } from "next/cache";
import { requireMembership, requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const CATEGORIES = ["bug", "edit", "development", "idea"] as const;
const URGENCIES = ["low", "normal", "high", "critical"] as const;
const STATUSES = ["new", "triaged", "in_progress", "done", "blocked", "rejected"] as const;

function text(formData: FormData, key: string, max: number): string {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

export async function createSystemTicket(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const membership = await requireMembership();
  const category = text(formData, "category", 20);
  const urgency = text(formData, "urgency", 20);
  const title = text(formData, "title", 160);
  const description = text(formData, "description", 5000);
  const pagePath = text(formData, "page_path", 500);
  const expectedResult = text(formData, "expected_result", 2000);
  const evidence = text(formData, "evidence", 2000);

  if (!CATEGORIES.includes(category as (typeof CATEGORIES)[number])) return { ok: false, error: "اختر نوع الطلب." };
  if (!URGENCIES.includes(urgency as (typeof URGENCIES)[number])) return { ok: false, error: "اختر درجة الأولوية." };
  if (title.length < 3) return { ok: false, error: "اكتب عنوانًا واضحًا للطلب." };
  if (description.length < 10) return { ok: false, error: "اشرح المطلوب أو المشكلة بمزيد من التفاصيل." };

  const sb = await createClient();
  const { error } = await sb.from("system_tickets").insert({
    org_id: membership.orgId,
    category: category as (typeof CATEGORIES)[number],
    urgency: urgency as (typeof URGENCIES)[number],
    title,
    description,
    page_path: pagePath || null,
    expected_result: expectedResult || null,
    evidence: evidence || null,
  });
  if (error) return { ok: false, error: "تعذّر إرسال الطلب. حاول مرة أخرى." };

  revalidatePath("/support");
  return { ok: true };
}

export async function updateSystemTicket(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const membership = await requireRole(["owner"]);
  const id = text(formData, "id", 64);
  const status = text(formData, "status", 30);
  const resolution = text(formData, "resolution", 3000);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "رقم الطلب غير صالح." };
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) return { ok: false, error: "حالة الطلب غير صالحة." };

  const sb = await createClient();
  const { data, error } = await sb
    .from("system_tickets")
    .update({
      status: status as (typeof STATUSES)[number],
      resolution: resolution || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("org_id", membership.orgId)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: "تعذّر تحديث الطلب." };
  if (!data) return { ok: false, error: "لم يتم العثور على الطلب." };

  revalidatePath("/support");
  return { ok: true };
}
