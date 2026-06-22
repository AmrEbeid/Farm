import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for Client Components. Anon key only — never reference the
 * service-role key in code that can reach the browser bundle.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
