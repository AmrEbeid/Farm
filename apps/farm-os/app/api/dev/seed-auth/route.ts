import { NextResponse } from "next/server";
import { ensureAllSeedUsers, SEED_USERS, SEED_PASSWORD } from "@/lib/seed-auth";

/**
 * Dev-only endpoint: makes the seeded Ebeid users sign-in-able with
 * email+password (see lib/seed-auth.ts). Idempotent. Used by the login screen's
 * "enable demo accounts" affordance and by the Playwright e2e setup.
 *
 * Guarded two ways (L2, issue #161): the Supabase URL must be local (127.0.0.1/
 * localhost) AND the deploy must not be the production Vercel env. Either gate alone
 * 403s the route, so it can never run against a real project even if it ships and even
 * if the URL check were bypassed. VERCEL_ENV is unset locally / in CI / e2e, so the dev
 * and test paths are unaffected.
 */
export const dynamic = "force-dynamic";

function isEnabled() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const local = url.includes("127.0.0.1") || url.includes("localhost");
  const isProd = process.env.VERCEL_ENV === "production";
  return local && !isProd;
}

export async function POST() {
  if (!isEnabled()) {
    return NextResponse.json({ ok: false, error: "disabled outside local dev" }, { status: 403 });
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
