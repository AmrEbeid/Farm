import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client — SERVER ONLY. Bypasses RLS, so it must never
 * be imported into client code. It reads SUPABASE_SERVICE_ROLE_KEY (no
 * NEXT_PUBLIC_ prefix), so Next never inlines it into the client bundle; the
 * window guard is a belt-and-braces runtime check.
 */
export function createAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error("createAdminClient must never run in the browser");
  }
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
