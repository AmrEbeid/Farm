import { NextResponse } from "next/server";
import { ensureAllSeedUsers, SEED_USERS, SEED_PASSWORD } from "@/lib/seed-auth";

/**
 * Dev-only endpoint: makes the seeded Ebeid users sign-in-able with
 * email+password (see lib/seed-auth.ts). Idempotent. Used by the login screen's
 * "enable demo accounts" affordance and by the Playwright e2e setup.
 *
 * Guarded to local Supabase only (127.0.0.1 URL) so it can never run against a
 * real project even if the route ships.
 */
export const dynamic = "force-dynamic";

function isLocal() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return url.includes("127.0.0.1") || url.includes("localhost");
}

export async function POST() {
  if (!isLocal()) {
    return NextResponse.json({ ok: false, error: "disabled outside local" }, { status: 403 });
  }
  try {
    const map = await ensureAllSeedUsers();
    return NextResponse.json({
      ok: true,
      password: SEED_PASSWORD,
      users: SEED_USERS.map((u) => ({ role: u.role, email: u.email, id: map[u.email] })),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function GET() {
  return POST();
}
