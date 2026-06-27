import { requireMembership, getUserOrgs, ROLE_LABEL_AR } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui";

/**
 * Profile / account page (SPEC-0012 S3). Read-only: shows the signed-in user's
 * identity, role, and active org. Self-service edits (name/preferences) and
 * member/role administration are SPEC-0012 S2 (separate, access-control-gated).
 */
export default async function ProfilePage() {
  const m = await requireMembership();
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  const orgs = await getUserOrgs();
  const activeOrg = orgs.find((o) => o.id === m.orgId);

  return (
    <div className="mx-auto max-w-xl p-4">
      <h1 className="mb-4 text-xl font-bold">الملف الشخصي</h1>
      <Card>
        <dl className="flex flex-col gap-3">
          <Row label="الاسم" value={m.name ?? "—"} />
          <Row label="البريد الإلكتروني" value={user?.email ?? "—"} />
          <Row label="الدور" value={ROLE_LABEL_AR[m.role]} />
          <Row label="المزرعة" value={activeOrg?.name ?? "—"} />
          {orgs.length > 1 && <Row label="عدد المزارع" value={String(orgs.length)} />}
        </dl>
      </Card>
      <p className="mt-4 text-sm" style={{ color: "var(--ink-muted)" }}>
        لتعديل دورك أو إدارة أعضاء المزرعة، تواصل مع مالك المزرعة. (إدارة الأعضاء قيد الإعداد — SPEC-0012.)
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-black/10 pb-2 last:border-0 last:pb-0">
      <dt style={{ color: "var(--ink-muted)" }}>{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
