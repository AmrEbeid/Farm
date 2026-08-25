import { requireMembership } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SupportTickets, type SupportTicket } from "@/components/SupportTickets";

export default async function SupportPage() {
  const membership = await requireMembership();
  const sb = await createClient();
  const { data: tickets, error } = await sb
    .from("system_tickets")
    .select("id, created_by, category, title, description, page_path, expected_result, evidence, urgency, status, resolution, created_at")
    .eq("org_id", membership.orgId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error("system_tickets query failed");

  const creatorIds = [...new Set((tickets ?? []).map((ticket) => ticket.created_by).filter((id): id is string => !!id))];
  const { data: people, error: peopleError } = membership.role === "owner" && creatorIds.length > 0
    ? await sb.from("people").select("user_id, name").eq("org_id", membership.orgId).in("user_id", creatorIds)
    : { data: [], error: null };
  if (peopleError) throw new Error("ticket creator query failed");
  const names = new Map((people ?? []).map((person) => [person.user_id, person.name]));
  const items: SupportTicket[] = (tickets ?? []).map((ticket) => ({
    ...ticket,
    creator_name: names.get(ticket.created_by) ?? (ticket.created_by === membership.userId ? membership.name ?? "أنت" : "مستخدم النظام"),
  }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">الدعم وطلبات التطوير</h1>
        <p style={{ color: "var(--ink-muted)" }}>
          أرسل مشكلة أو تعديلًا أو تطويرًا مطلوبًا، وتابع حالة التنفيذ من نفس الصفحة.
        </p>
      </header>
      <SupportTickets tickets={items} isOwner={membership.role === "owner"} />
    </div>
  );
}
