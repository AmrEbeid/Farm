import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/database.types.ext";
import {
  ACCOUNTING_E2E_SERVER_READ_ONLY_ENV,
  accountingE2EGuardedServerFetch,
} from "@/lib/accounting e2e safety";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Supabase client for Server Components, Route Handlers, and Server Actions.
 * Uses the anon key and the request cookie session, so every query is
 * RLS-scoped to the signed-in user. Never use the service-role key here.
 */
export async function createClient() {
  const store = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const readOnlyE2EFetch = accountingE2EGuardedServerFetch(new URL(supabaseUrl).origin);
  return createServerClient<Database>(
    supabaseUrl,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (cookiesToSet: CookieToSet[]) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              store.set(name, value, options),
            );
          } catch {
            // Called from a Server Component where cookies are read-only.
            // Session refresh is handled by Proxy in later phases.
          }
        },
      },
      ...(process.env[ACCOUNTING_E2E_SERVER_READ_ONLY_ENV] === "1"
        ? { global: { fetch: readOnlyE2EFetch } }
        : {}),
    },
  );
}
