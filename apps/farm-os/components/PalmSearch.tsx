"use client";

// Dedicated palm/structure search for the farm-structure landing page
// (app/(app)/farm/page.tsx). At ~4,380 palms across 28 حوش, the drill-down
// (farm → sector → line → hawsha → palm) is the only way to reach a specific
// palm's 360 page; this gives a direct deep link instead.
//
// Debounced server-action lookup (searchPalms, lib/palm-search-actions.ts) —
// never client-side filtering of all palms, which would require fetching the
// whole table up front. Same debounce/request-guard shape as CommandPalette's
// entity search: a `requestIdRef` discards a stale response that resolves
// after a newer one, so a slow first keystroke can't clobber the latest.

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { SearchInput, EmptyState, Skeleton } from "@/components/ui";
import { searchPalms, type PalmSearchResult } from "@/lib/palm-search-actions";

const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

export function PalmSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PalmSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);
  const resultsId = useId();

  const trimmed = query.trim();
  const searching = trimmed.length >= MIN_QUERY_LENGTH;
  // Derived, not stored: once the query shrinks below the search threshold, the
  // last fetched rows simply stop being displayed — no effect is needed to
  // "clear" them, they just fall out of the rendered list (same pattern as
  // CommandPalette's entity search).
  const displayedResults = searching ? results : [];
  const displayedLoading = searching && loading;

  // Debounced lookup. Nothing runs synchronously in the effect body — the guard
  // is a plain early `return` (no state to reset) and every `setState` call
  // lives inside the `setTimeout` callback, after the debounce delay.
  // `requestIdRef` discards a stale response that resolves after a newer one.
  useEffect(() => {
    if (!searching) return;
    const requestId = ++requestIdRef.current;
    const timer = setTimeout(() => {
      setLoading(true);
      searchPalms(trimmed)
        .then((rows) => {
          if (requestIdRef.current === requestId) setResults(rows);
        })
        .catch(() => {
          if (requestIdRef.current === requestId) setResults([]);
        })
        .finally(() => {
          if (requestIdRef.current === requestId) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searching, trimmed]);

  return (
    <div className="flex flex-col gap-3">
      <SearchInput
        label="بحث عن نخلة"
        placeholder="ابحث برقم النخلة أو الصنف…"
        value={query}
        onValueChange={setQuery}
        aria-controls={resultsId}
        className="w-full max-w-sm"
      />
      <div id={resultsId} aria-live="polite">
        {displayedLoading && (
          <div className="flex flex-col gap-2 py-2">
            <Skeleton shape="text" width="70%" />
            <Skeleton shape="text" width="50%" />
          </div>
        )}
        {!displayedLoading && searching && displayedResults.length === 0 && (
          <EmptyState title="لا توجد نتائج" description={`لا يوجد ما يطابق "${trimmed}"`} />
        )}
        {!displayedLoading && displayedResults.length > 0 && (
          <ul className="flex flex-col gap-1" role="listbox" aria-label="نتائج بحث النخيل">
            {displayedResults.map((r) => (
              <li key={r.id} role="option" aria-selected={false}>
                <Link
                  href={r.href}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2 text-sm hover:bg-[var(--surface-hover,rgba(0,0,0,0.03))]"
                  style={{ border: "1px solid var(--line)" }}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-semibold">{r.idTag}</span>
                    <span className="truncate text-xs" style={{ color: "var(--ink-muted)" }}>
                      {[r.variety, r.sector, r.hawsha].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs" style={{ color: "var(--ink-muted)" }}>
                    {r.statusAr}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
