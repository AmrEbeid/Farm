import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  SITE_CONTENT_DEFAULTS,
  SITE_CONTENT_PUBLIC_READ_FALLBACK,
  type SiteContent,
} from "@/lib/site-content";

// Server-side read of the OS-editable marketing content for the PUBLIC site.
//
// Read path is service-role (server-only) — the public page NEVER reads site_content as anon, so
// the "anon reads nothing" invariant stays intact. An empty table uses the approved typed defaults.
// Read/configuration failures keep the page available but hide certificate claims, because those
// defaults may have been superseded by an owner edit.
//
// TYPES: site_content is declared in the database.types.ext.ts augmentation (STRUCT-1), so this
// query is fully typed.

export async function loadSiteContent(): Promise<SiteContent> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return SITE_CONTENT_PUBLIC_READ_FALLBACK;
  }
  try {
    const sb = createAdminClient();
    // The read is service-role → RLS is BYPASSED, so pin the site org explicitly (mirrors
    // enquiry-actions.ts). Without it, a multi-org DB would render whichever org's row Postgres returns
    // first onto the PUBLIC page — a cross-tenant content leak. Same default as the enquiry write path.
    const siteOrgId = process.env.SITE_ORG_ID || "00000000-0000-0000-0000-000000000001";
    const { data, error } = await sb
      .from("site_content")
      .select("content")
      .eq("org_id", siteOrgId)
      .limit(1)
      .maybeSingle();
    if (error) return SITE_CONTENT_PUBLIC_READ_FALLBACK;
    if (!data?.content) return SITE_CONTENT_DEFAULTS;
    if (typeof data.content !== "object") {
      return SITE_CONTENT_PUBLIC_READ_FALLBACK;
    }
    // The editor always persists the FULL SiteContent, so a shallow top-level merge over defaults
    // is enough to keep every field defined even if a key is ever missing.
    return { ...SITE_CONTENT_DEFAULTS, ...(data.content as Partial<SiteContent>) };
  } catch {
    return SITE_CONTENT_PUBLIC_READ_FALLBACK;
  }
}
