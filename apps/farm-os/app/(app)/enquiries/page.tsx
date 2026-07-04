import Link from "next/link";
import { requireMembership } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { EnquiriesList } from "@/components/EnquiriesList";

/**
 * Buyer enquiries submitted from the public website's contact form (SPEC public-website). OWNER-ONLY
 * — reads are RLS-gated to `site.write` = owner. The public form inserts via a server action +
 * service-role client (no client write path); the owner marks read/archived via fn_set_enquiry_status
 * (owner-gated). Default view shows active (new + read); an "archived" tab shows the rest.
 */
export default async function EnquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const m = await requireMembership();

  if (m.role !== "owner") {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <h1 className="mb-1 text-xl font-bold">طلبات العملاء</h1>
        <p className="text-sm text-muted-foreground">عرض طلبات الموقع متاح لصلاحية المالك فقط.</p>
      </div>
    );
  }

  const archived = (await searchParams).view === "archived";
  const sb = await createClient();
  const base = sb
    .from("site_enquiries")
    .select("id, name, company, country, volume, message, status, created_at")
    .order("created_at", { ascending: false });
  const { data, error } = archived
    ? await base.eq("status", "archived")
    : await base.neq("status", "archived");
  if (error) {
    throw new Error("site_enquiries query failed");
  }

  const tab = (href: string, label: string, active: boolean) => (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 text-sm ${active ? "bg-muted font-bold" : "text-muted-foreground"}`}
    >
      {label}
    </Link>
  );

  return (
    <div className="mx-auto max-w-3xl p-4">
      <h1 className="mb-1 text-xl font-bold">طلبات العملاء</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        الطلبات الواردة من نموذج التواصل في الموقع العام. تابع كل طلب مع العميل عبر واتساب أو البريد،
        وحدّده كمقروء أو أرشفه.
      </p>
      <div className="mb-4 flex gap-2">
        {tab("/enquiries", "الواردة", !archived)}
        {tab("/enquiries?view=archived", "المؤرشفة", archived)}
      </div>
      <EnquiriesList items={data ?? []} />
    </div>
  );
}
