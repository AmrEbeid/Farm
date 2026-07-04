"use server";

import { createAdminClient } from "@/lib/supabase/admin";

// Public enquiry submission from the site's contact form. There is NO anon DB grant — this server
// action inserts via the service-role admin client, so the "anon writes nothing" invariant holds.
// Spam is handled here: a honeypot field + length caps + required name/message. The single-farm org
// is resolved from env (defaults to the seed/prod Ebeid org).

const CAP = { name: 200, company: 200, country: 120, volume: 120, message: 5000 };
const ORG_ID = process.env.NEXT_PUBLIC_SITE_ORG_ID || "00000000-0000-0000-0000-000000000001";

type Result = { ok: true } | { ok: false; error: string };

export async function submitEnquiry(formData: FormData): Promise<Result> {
  // Honeypot: a hidden field real users never see. If a bot filled it, pretend success and drop it.
  if (String(formData.get("company_website") ?? "").trim()) return { ok: true };

  const field = (key: string, cap: number) =>
    String(formData.get(key) ?? "").trim().slice(0, cap);

  const name = field("name", CAP.name);
  const message = field("message", CAP.message);
  if (name.length < 2 || message.length < 5) {
    return { ok: false, error: "يرجى إدخال الاسم والرسالة" };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("site_enquiries").insert({
    org_id: ORG_ID,
    name,
    message,
    company: field("company", CAP.company) || null,
    country: field("country", CAP.country) || null,
    volume: field("volume", CAP.volume) || null,
  });
  if (error) return { ok: false, error: "تعذّر إرسال الطلب، حاول مجددًا" };
  return { ok: true };
}
