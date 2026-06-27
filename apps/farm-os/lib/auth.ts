import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role =
  | "owner"
  | "farm_manager"
  | "agri_engineer"
  | "accountant"
  | "supervisor"
  | "storekeeper";

export interface Membership {
  userId: string;
  orgId: string;
  role: Role;
  personId: string | null;
  name: string | null;
}

export const ROLE_LABEL_AR: Record<Role, string> = {
  owner: "المالك",
  farm_manager: "مدير المزرعة",
  agri_engineer: "مهندس زراعي",
  accountant: "محاسب",
  supervisor: "مشرف ميداني",
  storekeeper: "أمين مخزن",
};

/**
 * The active org membership for the signed-in user (the pilot is single-org).
 * Reads through the RLS-scoped session client. Returns null when unauthenticated
 * or not a member of any org.
 *
 * Wrapped in React `cache()` so the (app) layout and the page it renders share a
 * single result per request (this used to run twice per navigation), and the two
 * independent reads (organization_member + people) run in parallel after getUser.
 */
/**
 * The active org id carried in the session JWT, injected at token mint by the
 * `custom_access_token` hook (migration 0085). This is the SAME value RLS narrows on
 * (public.user_org_ids()), so the app's notion of "active org" always matches the data
 * it can actually see. Returns null when the claim is absent (e.g. the hook is not yet
 * enabled on the project) — callers then fall back to any membership (legacy behaviour).
 */
async function readActiveOrgId(
  sb: Awaited<ReturnType<typeof createClient>>,
): Promise<string | null> {
  const {
    data: { session },
  } = await sb.auth.getSession();
  const token = session?.access_token;
  if (!token) return null;
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as {
      active_org_id?: string;
    };
    return claims.active_org_id ?? null;
  } catch {
    return null;
  }
}

export const getActiveMembership = cache(
  async (): Promise<Membership | null> => {
    const sb = await createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return null;

    const activeOrgId = await readActiveOrgId(sb);
    const memberSel = sb
      .from("organization_member")
      .select("org_id, role")
      .eq("user_id", user.id);

    const [{ data: member }, { data: person }] = await Promise.all([
      (activeOrgId
        ? memberSel.eq("org_id", activeOrgId)
        : memberSel.limit(1)
      ).maybeSingle(),
      sb
        .from("people")
        .select("id, name")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle(),
    ]);

    // If the active-org claim doesn't resolve to a readable membership (stale claim or
    // membership removed), fall back to any membership the user still has.
    let chosen = member;
    if (!chosen && activeOrgId) {
      const { data: fallback } = await sb
        .from("organization_member")
        .select("org_id, role")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();
      chosen = fallback;
    }
    if (!chosen) return null;

    return {
      userId: user.id,
      orgId: chosen.org_id as string,
      role: chosen.role as Role,
      personId: person?.id ?? null,
      name: person?.name ?? null,
    };
  },
);

/**
 * Every org the signed-in user belongs to (for the org switcher). The organization read
 * policy uses the FULL membership set (user_member_org_ids), so this lists all of them
 * even while tenant data is narrowed to the active org.
 */
export const getUserOrgs = cache(
  async (): Promise<{ id: string; name: string }[]> => {
    const sb = await createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return [];
    const { data } = await sb
      .from("organization")
      .select("id, name")
      .order("name");
    return (data ?? []) as { id: string; name: string }[];
  },
);

/** Require a session; redirect to /login otherwise. Returns the membership. */
export const requireMembership = cache(
  async (): Promise<Membership> => {
    const m = await getActiveMembership();
    if (!m) redirect("/login");
    return m;
  },
);

/** Require one of the given roles; redirect to /dashboard if the role is wrong. */
export async function requireRole(roles: Role[]): Promise<Membership> {
  const m = await requireMembership();
  if (!roles.includes(m.role)) redirect("/dashboard");
  return m;
}
