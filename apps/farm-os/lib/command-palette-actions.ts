"use server";

import { createClient } from "@/lib/supabase/server";

export interface PaletteEntityResult {
  kind: "purchase-request" | "inventory-item";
  id: string;
  label: string;
  sublabel: string;
  href: string;
}

const MAX_PER_TYPE = 5;
const MIN_QUERY_LENGTH = 2;

/** Escape PostgREST `ilike` pattern metacharacters so a literal `%`/`_` in the
 *  user's query isn't treated as a wildcard. */
function likePattern(q: string): string {
  return `%${q.replace(/[%_\\]/g, "\\$&")}%`;
}

/**
 * ⌘K entity lookup — first slice (SPEC command-palette): purchase requests (by code or
 * reason) and inventory items (by name). Both are cheap, low-cardinality tables where a
 * plain `ilike` is fine without a dedicated index.
 *
 * Uses the RLS-scoped session client (`lib/supabase/server`), never a service/admin
 * client — an unauthenticated caller or a query for another org's rows returns zero
 * results because RLS (FORCE RLS, org_id-scoped) denies by default, not because this
 * function special-cases it. Deliberately NOT gated by role: both source pages
 * (/purchase-requests, /inventory) have no `roles` restriction in lib/nav.ts, so every
 * role that can see those pages can already read this data.
 *
 * Palm lookup (~4,380 rows) is intentionally deferred — it likely needs a dedicated,
 * possibly indexed, search path rather than a simple ilike, per the reviewed follow-up.
 */
export async function searchPaletteEntities(query: string): Promise<PaletteEntityResult[]> {
  const q = query.trim();
  if (q.length < MIN_QUERY_LENGTH) return [];

  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return [];

  const pattern = likePattern(q);
  const [prRes, itemRes] = await Promise.all([
    sb
      .from("purchase_requests")
      .select("id, code, reason")
      .or(`code.ilike.${pattern},reason.ilike.${pattern}`)
      .order("code", { ascending: false })
      .limit(MAX_PER_TYPE),
    sb
      .from("inventory_items")
      .select("id, name, category")
      .ilike("name", pattern)
      .order("name")
      .limit(MAX_PER_TYPE),
  ]);

  const results: PaletteEntityResult[] = [];
  for (const pr of prRes.data ?? []) {
    results.push({
      kind: "purchase-request",
      id: pr.id as string,
      label: pr.code as string,
      sublabel: (pr.reason as string | null) ?? "طلب شراء",
      href: `/purchase-requests/${pr.id}`,
    });
  }
  for (const item of itemRes.data ?? []) {
    results.push({
      kind: "inventory-item",
      id: item.id as string,
      label: item.name as string,
      sublabel: (item.category as string | null) ?? "صنف مخزون",
      href: `/inventory/${item.id}`,
    });
  }
  return results;
}
