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
// TYPES: site_content is declared in the database.types.ext.ts augmentation (STRUCT-1), so this
// query is fully typed.

export async function loadSiteContent(): Promise<SiteContent> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return SITE_CONTENT_DEFAULTS;
  }
  try {
    const sb = createAdminClient();
    const { data, error } = await sb
      .from("site_content")
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
