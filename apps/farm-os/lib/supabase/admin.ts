// Compile-time guard: importing this RLS-bypassing module into a Client Component
// makes the build FAIL (stronger than the runtime window check below, and it no
// longer relies on every importer remembering to mark itself server-only). Mirrors
// lib/seed-auth.ts. The service-role key must never reach the browser bundle.
import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types.ext";

/**
 * Service-role Supabase client — SERVER ONLY. Bypasses RLS, so it must never
 * be imported into client code. It reads SUPABASE_SERVICE_ROLE_KEY (no
 * NEXT_PUBLIC_ prefix), so Next never inlines it into the client bundle; the
 * `server-only` import (above) fails the build on a client import, and the
 * window guard is a belt-and-braces runtime check.
 */
export function createAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error("createAdminClient must never run in the browser");
  }
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
