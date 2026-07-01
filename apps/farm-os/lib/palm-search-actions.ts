"use server";

import { createClient } from "@/lib/supabase/server";

export interface PalmSearchResult {
  id: string;
  idTag: string;
  variety: string | null;
  status: string;
  statusAr: string;
  hawsha: string | null;
  sector: string | null;
  href: string;
}

const MIN_QUERY_LENGTH = 2;
const MAX_RESULTS = 20;

// assets.status — the closed set from migration 0003 (mirrors the map on
// app/(app)/farm/palm/[id]/page.tsx; kept local rather than shared since neither
// page currently imports a common label module for this set).
const STATUS_AR: Record<string, string> = {
  active: "سليمة",
  watch: "تحت المراقبة",
  sick: "مريضة",
  dead: "ميتة",
  removed: "مُزالة",
  replaced: "مُستبدلة",
};

/** Escape PostgREST `ilike` pattern metacharacters so a literal `%`/`_` in the
 *  user's query isn't treated as a wildcard (same guard as the command-palette
 *  entity search). */
function likePattern(q: string): string {
  return `%${q.replace(/[%_\\]/g, "\\$&")}%`;
}

function one<T>(rel: unknown): T | null {
  // PostgREST returns a to-one embed as an object or single-element array.
  return (Array.isArray(rel) ? rel[0] : rel) as T | null;
}

/**
 * Dedicated palm/structure search (SPEC follow-up to the command palette, #551,
 * which deliberately deferred palm lookup pending "a dedicated indexed search
 * path, not a plain ilike, given the scale"). At ~4,380 palms this table is
 * small by Postgres standards: a plain `ilike '%query%'` scoped to one org via
 * RLS is a fast sequential scan (no full-table fetch to the client, no new
 * index needed — see the migration-decision note in the PR description).
 *
 * Matches on `id_tag` (primary) and `variety` (secondary, cheap to include in
 * the same query). `status` is a coded enum (active/watch/sick/dead/removed/
 * replaced) rather than free text, so it is NOT a match target — matching an
 * Arabic query like "مريضة" against the English enum value would never hit;
 * status IS still returned for on-screen disambiguation.
 *
 * Uses the RLS-scoped session client — never a service/admin client. An
 * unauthenticated caller, or a query with no matching rows in the caller's
 * org, returns an empty array; RLS (FORCE RLS, org_id-scoped) denies by
 * default, not because this function special-cases it. Deliberately NOT
 * gated by role: /farm has no `roles` restriction in lib/nav.ts, so every
 * role that can see the farm-structure page can already read this data.
 */
export async function searchPalms(query: string): Promise<PalmSearchResult[]> {
  const q = query.trim();
  if (q.length < MIN_QUERY_LENGTH) return [];

  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return [];

  const pattern = likePattern(q);
  const { data, error } = await sb
    .from("assets")
    .select("id, id_tag, variety, status, hawshat(name), sectors(name)")
    .eq("type", "palm")
    .eq("archived", false)
    .or(`id_tag.ilike.${pattern},variety.ilike.${pattern}`)
    .order("id_tag")
    .limit(MAX_RESULTS);
  if (error) return [];

  return (data ?? []).map((a) => {
    const hawsha = one<{ name?: string }>(a.hawshat);
    const sector = one<{ name?: string }>(a.sectors);
    return {
      id: a.id,
      idTag: a.id_tag ?? a.id,
      variety: a.variety,
      status: a.status,
      statusAr: STATUS_AR[a.status] ?? "غير معروف",
      hawsha: hawsha?.name ?? null,
      sector: sector?.name ?? null,
      href: `/farm/palm/${a.id}`,
    };
  });
}
