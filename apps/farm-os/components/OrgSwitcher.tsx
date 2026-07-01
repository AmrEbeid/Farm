"use client";

import { useTransition } from "react";
import { setActiveOrg } from "@/lib/org-actions";

/**
 * Active-org switcher (Stage 1). Renders only for users who belong to more than one org —
 * so it is invisible for the single-org pilot. Selecting an org calls the membership-validated
 * setActiveOrg action, then reloads so all server components re-read under the re-minted token.
 */
export function OrgSwitcher({
  orgs,
  activeOrgId,
}: {
  orgs: { id: string; name: string }[];
  activeOrgId: string | null;
}) {
  const [pending, startTransition] = useTransition();
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
          if (r.ok) window.location.reload();
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
