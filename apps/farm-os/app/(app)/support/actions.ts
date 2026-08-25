"use server";

import { revalidatePath } from "next/cache";
import { requireMembership, requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  SUPPORT_ATTACHMENT_TYPES,
  supportAttachmentMatchesSignature,
  type SupportAttachmentContentType,
} from "@/lib/support-attachment";

const CATEGORIES = ["bug", "edit", "development", "idea"] as const;
const URGENCIES = ["low", "normal", "high", "critical"] as const;
const STATUSES = ["new", "triaged", "in_progress", "done", "blocked", "rejected"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(formData: FormData, key: string, max: number): string {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

export async function createSystemTicket(formData: FormData): Promise<{ ok: boolean; data?: string; error?: string }> {
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
  const { data, error } = await sb
    .from("system_tickets")
    .insert({
      org_id: membership.orgId,
      category: category as (typeof CATEGORIES)[number],
      urgency: urgency as (typeof URGENCIES)[number],
      title,
      description,
      page_path: pagePath || null,
      expected_result: expectedResult || null,
      evidence: evidence || null,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: "تعذّر إرسال الطلب. حاول مرة أخرى." };

  revalidatePath("/support");
  return { ok: true, data: data.id };
}

export async function addSystemTicketAttachment(input: {
  ticketId: string;
  storagePath: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}): Promise<{ ok: boolean; data?: string; error?: string }> {
  const membership = await requireMembership();
  const fileName = input.fileName.trim().replace(/[\\/\u0000-\u001f\u007f]/g, " ").slice(0, 255);
  const expectedPrefix = `${membership.orgId}/${input.ticketId}/`;
  if (!UUID_RE.test(input.ticketId) || !input.storagePath.startsWith(expectedPrefix) || input.storagePath.includes("..")) {
    return { ok: false, error: "مسار المرفق غير صالح." };
  }
  if (!fileName) return { ok: false, error: "اسم المرفق غير صالح." };
  if (!SUPPORT_ATTACHMENT_TYPES.includes(input.contentType as SupportAttachmentContentType)) {
    return { ok: false, error: "نوع الملف غير مسموح." };
  }
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > 26214400) {
    return { ok: false, error: "حجم الملف غير مسموح." };
  }

  const sb = await createClient();
  const { data: visibleTicket, error: ticketError } = await sb
    .from("system_tickets")
    .select("id")
    .eq("id", input.ticketId)
    .eq("org_id", membership.orgId)
    .maybeSingle();
  if (ticketError || !visibleTicket) return { ok: false, error: "ليس لديك صلاحية لإضافة مرفق لهذا الطلب." };

  const contentType = input.contentType as SupportAttachmentContentType;
  const admin = createAdminClient();
  const { data: object, error: downloadError } = await admin.storage
    .from("support-attachments")
    .download(input.storagePath);
  if (downloadError || !object) {
    await sb.storage.from("support-attachments").remove([input.storagePath]);
    return { ok: false, error: "تعذّر التحقق من المرفق المرفوع." };
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.byteLength !== input.sizeBytes || !supportAttachmentMatchesSignature(contentType, bytes)) {
    await sb.storage.from("support-attachments").remove([input.storagePath]);
    return { ok: false, error: "محتوى الملف لا يطابق نوعه أو حجمه." };
  }

  const { data, error } = await sb
    .from("system_ticket_attachments")
    .insert({
      org_id: membership.orgId,
      ticket_id: input.ticketId,
      storage_path: input.storagePath,
      file_name: fileName,
      content_type: contentType,
      size_bytes: input.sizeBytes,
    })
    .select("id")
    .single();
  if (error) {
    await sb.storage.from("support-attachments").remove([input.storagePath]);
    return { ok: false, error: "تعذّر حفظ المرفق مع الطلب." };
  }

  revalidatePath("/support");
  return { ok: true, data: data.id };
}

export async function updateSystemTicket(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const membership = await requireRole(["owner"]);
  const id = text(formData, "id", 64);
  const status = text(formData, "status", 30);
  const resolution = text(formData, "resolution", 3000);
  if (!UUID_RE.test(id)) return { ok: false, error: "رقم الطلب غير صالح." };
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
