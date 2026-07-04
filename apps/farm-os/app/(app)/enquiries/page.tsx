import { requireMembership } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtDate } from "@/lib/dates";

/**
 * Buyer enquiries submitted from the public website's contact form (SPEC public-website,
 * migration 20260701430000). OWNER-ONLY — reads are RLS-gated to `site.write` = owner; there is no
 * client write path (the public form inserts via a server action + service-role client). Read-only
 * list in this MVP (status management deferred). site_enquiries is declared in the STRUCT-1
 * augmentation, so the query is fully typed.
 */
export default async function EnquiriesPage() {
  const m = await requireMembership();

  if (m.role !== "owner") {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <h1 className="mb-1 text-xl font-bold">طلبات العملاء</h1>
        <p className="text-sm text-muted-foreground">عرض طلبات الموقع متاح لصلاحية المالك فقط.</p>
      </div>
    );
  }

  const sb = await createClient();
  const { data, error } = await sb
    .from("site_enquiries")
    .select("id, name, company, country, volume, message, status, created_at")
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error("site_enquiries query failed");
  }
  const items = data ?? [];

  return (
    <div className="mx-auto max-w-3xl p-4">
      <h1 className="mb-1 text-xl font-bold">طلبات العملاء</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        الطلبات الواردة من نموذج التواصل في الموقع العام. تابع كل طلب مع العميل عبر واتساب أو البريد.
      </p>

      {items.length === 0 ? (
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">لا توجد طلبات بعد.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((e) => (
            <li key={e.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-bold">{e.name}</span>
                <span className="text-xs text-muted-foreground">{fmtDate(e.created_at)}</span>
              </div>
              {(e.company || e.country || e.volume) && (
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {[e.company, e.country, e.volume].filter(Boolean).join(" · ")}
                </p>
              )}
              <p className="mt-2 whitespace-pre-wrap text-sm">{e.message}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
