import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { SITE_CONTENT_DEFAULTS, type SiteContent } from "@/lib/site-content";

// Server-side read of the OS-editable marketing content for the PUBLIC site.
//
// Read path is service-role (server-only) — the public page NEVER reads site_content as anon, so
// the "anon reads nothing" invariant stays intact. Every failure mode falls back to the typed
// defaults, so the page always renders and the build never breaks:
//   * env not configured (local build)   → defaults (no connection attempt)
//   * table not yet created (pre-apply)   → defaults (migrate-first: this code ships safe)
//   * empty table (owner hasn't saved)    → defaults
//
// TYPES: site_content is added by migration 20260701420000; database.types.ext.ts regenerates only
// AFTER the Owner applies it (A1). Until then the table/rpc names are cast. Remove the casts once
// types are regenerated.

export async function loadSiteContent(): Promise<SiteContent> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return SITE_CONTENT_DEFAULTS;
  }
  try {
    const sb = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- site_content untyped until post-apply regen (A1)
    const { data, error } = await (sb.from("site_content" as any) as any)
      .select("content")
      .limit(1)
      .maybeSingle();
    if (error || !data?.content || typeof data.content !== "object") {
      return SITE_CONTENT_DEFAULTS;
    }
    // The editor always persists the FULL SiteContent, so a shallow top-level merge over defaults
    // is enough to keep every field defined even if a key is ever missing.
    return { ...SITE_CONTENT_DEFAULTS, ...(data.content as Partial<SiteContent>) };
  } catch {
    return SITE_CONTENT_DEFAULTS;
  }
}
