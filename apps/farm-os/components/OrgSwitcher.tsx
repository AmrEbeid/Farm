"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui";
import { setActiveOrg } from "@/lib/org-actions";

/**
 * Active-org switcher (Stage 1). Renders only for users who belong to more than one org —
 * so it is invisible for the single-org pilot. Selecting an org calls the membership-validated
 * setActiveOrg server action, which itself (lib/org-actions.ts) already calls
 * `sb.auth.refreshSession()` (re-mints the JWT's active_org_id claim server-side, so
 * public.user_org_ids() narrows RLS to the new org on the NEXT server read) and
 * `revalidatePath("/", "layout")`. This app has no persistent client-side Supabase session —
 * every read is a Server Component that re-reads cookies fresh per request (see
 * lib/supabase/server.ts, app/(app)/layout.tsx) — so a `router.refresh()` RSC re-fetch, which
 * sends the already-updated session cookie, is sufficient to pick up the new org everywhere;
 * a full document reload is not required here.
 */
export function OrgSwitcher({
  orgs,
  activeOrgId,
}: {
  orgs: { id: string; name: string }[];
  activeOrgId: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();
  if (orgs.length < 2) return null;

  return (
    <select
      aria-label="تبديل المزرعة"
      className="rounded-md border px-2 py-1 text-sm"
      style={{ borderColor: "var(--line)" }}
      value={activeOrgId ?? ""}
      disabled={pending}
      onChange={(e) => {
        const id = e.target.value;
        if (!id || id === activeOrgId) return;
        startTransition(async () => {
          const r = await setActiveOrg(id);
          if (r.ok) {
            const name = orgs.find((o) => o.id === id)?.name;
            toast.ok(name ? `تم التبديل إلى ${name}` : "تم تبديل المزرعة بنجاح");
            router.refresh();
          }
        });
      }}
    >
      {activeOrgId === null && <option value="">اختر مزرعة…</option>}
      {orgs.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}
