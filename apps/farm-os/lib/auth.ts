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

/** The signed-in user, or null. */
export async function getSession() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  return user;
}

/**
 * The active org membership for the signed-in user (the pilot is single-org).
 * Reads through the RLS-scoped session client. Returns null when unauthenticated
 * or not a member of any org.
 *
 * Wrapped in React `cache()` so the (app) layout and the page it renders share a
 * single result per request (this used to run twice per navigation), and the two
 * independent reads (organization_member + people) run in parallel after getUser.
 */
export const getActiveMembership = cache(
  async (): Promise<Membership | null> => {
    const sb = await createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return null;

    const [{ data: member }, { data: person }] = await Promise.all([
      sb
        .from("organization_member")
        .select("org_id, role")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle(),
      sb
        .from("people")
        .select("id, name")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle(),
    ]);
    if (!member) return null;

    return {
      userId: user.id,
      orgId: member.org_id as string,
      role: member.role as Role,
      personId: person?.id ?? null,
      name: person?.name ?? null,
    };
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
