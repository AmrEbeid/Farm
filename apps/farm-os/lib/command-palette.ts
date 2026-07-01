// Pure, framework-free nav search for the ⌘K command palette
// (components/CommandPalette.tsx). Kept here so the matching logic is
// unit-testable under the node vitest env without a DOM, same pattern as
// lib/filter.ts's `filterRows`.

import { normalizeArabic } from "./filter";
import type { AppModule } from "./nav";

export interface PaletteNavResult {
  kind: "nav";
  /** Nav item id (matches AppNavItem.id — stable React key + active-state lookup). */
  id: string;
  label: string;
  icon: string;
  href: string;
  /** The owning module's label, shown as a breadcrumb/group hint. */
  moduleLabel: string;
}

/**
 * Nav results already role-filtered by the caller via `visibleModulesForRole` — this
 * function never re-applies role visibility, it only searches within what's passed in.
 * An empty/whitespace query returns every visible page (browsable quick-switcher), capped
 * at `limit`, in nav-registry order. A non-empty query substring-matches the page label
 * (Arabic-folded, case-insensitive — same folding as the list-page search boxes).
 */
export function searchNav(
  modules: AppModule[],
  query: string,
  limit = 20,
): PaletteNavResult[] {
  const needle = normalizeArabic(query.trim().toLowerCase());
  const results: PaletteNavResult[] = [];
  for (const appModule of modules) {
    for (const page of appModule.pages) {
      const matches = !needle || normalizeArabic(page.label.toLowerCase()).includes(needle);
      if (!matches) continue;
      results.push({
        kind: "nav",
        id: page.id,
        label: page.label,
        icon: page.icon,
        href: page.href,
        moduleLabel: appModule.label,
      });
      if (results.length >= limit) return results;
    }
  }
  return results;
}
