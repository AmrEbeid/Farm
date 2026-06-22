import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Programmatic auth for the seeded Ebeid users.
 *
 * The Phase-B seed inserts rows straight into `auth.users` with NULL token
 * columns, which GoTrue's Go scanner cannot read back ("Database error loading
 * user"), so those rows cannot sign in. Rather than weaken the seed, we mint
 * real GoTrue users through the admin API (which sets up identities + non-null
 * token columns correctly) and re-link them to the existing tenant rows
 * (`people.user_id`, `organization_member.user_id`) by phone.
 *
 * The result is a working email+password sign-in path for each role. RLS is
 * unaffected: real requests run through the per-request anon/session client, the
 * service-role client is used ONLY here for the one-time auth setup.
 *
 * Idempotent: re-running finds the existing user by email and just relinks.
 */

export const SEED_PASSWORD = "farm-os-pilot";

export interface SeedUser {
  role:
    | "owner"
    | "farm_manager"
    | "agri_engineer"
    | "accountant"
    | "supervisor"
    | "storekeeper";
  email: string;
  phone: string;
  name: string;
}

export const SEED_USERS: SeedUser[] = [
  { role: "owner", email: "owner@ebeid.test", phone: "+201000000001", name: "عمرو عبيد" },
  { role: "farm_manager", email: "manager@ebeid.test", phone: "+201000000002", name: "عبد الجليل أسامة" },
  { role: "agri_engineer", email: "engineer@ebeid.test", phone: "+201000000003", name: "حسام زكي" },
  { role: "accountant", email: "accountant@ebeid.test", phone: "+201000000004", name: "أحمد ماهر" },
  { role: "supervisor", email: "supervisor@ebeid.test", phone: "+201000000005", name: "السيد أبو أحمد" },
  { role: "storekeeper", email: "storekeeper@ebeid.test", phone: "+201000000006", name: "أمين المخزن" },
];

async function findUserByEmail(admin: ReturnType<typeof createAdminClient>, email: string) {
  // listUsers is paginated; the pilot tenant has a handful of users.
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  return data?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
}

/** Ensure one seeded role has a sign-in-able auth user linked to its tenant rows. */
export async function ensureSeedUser(u: SeedUser): Promise<string> {
  const admin = createAdminClient();

  let userId: string;
  const existing = await findUserByEmail(admin, u.email);
  if (existing) {
    userId = existing.id;
    await admin.auth.admin.updateUserById(userId, { password: SEED_PASSWORD });
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: u.email,
      password: SEED_PASSWORD,
      email_confirm: true,
      user_metadata: { name: u.name, role: u.role },
    });
    if (error || !data.user) {
      throw new Error(`createUser failed for ${u.email}: ${error?.message}`);
    }
    userId = data.user.id;
  }

  // Re-link the tenant rows (matched by the seeded phone) to this auth user.
  // Uses the service-role client (bypasses RLS) — auth setup only.
  await admin
    .from("people")
    .update({ user_id: userId })
    .eq("phone", u.phone);

  // organization_member is keyed by the OLD seeded user_id; move it to the new
  // one. Delete any stale row for the old id, upsert the new membership.
  const { data: person } = await admin
    .from("people")
    .select("org_id")
    .eq("phone", u.phone)
    .single();
  if (person?.org_id) {
    await admin
      .from("organization_member")
      .delete()
      .eq("org_id", person.org_id)
      .eq("role", u.role);
    await admin
      .from("organization_member")
      .insert({ org_id: person.org_id, user_id: userId, role: u.role });
  }

  return userId;
}

/** Ensure ALL seeded roles are sign-in-able. Returns email→userId. */
export async function ensureAllSeedUsers(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const u of SEED_USERS) {
    out[u.email] = await ensureSeedUser(u);
  }
  return out;
}
