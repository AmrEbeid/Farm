"use client";

// Global ⌘K / Ctrl+K command palette (nav search + first-slice entity lookup).
//
// Mounted exactly ONCE, from AppChrome — which is rendered by app/(app)/layout.tsx and
// therefore persists across client-side navigations within the authenticated app (Next.js
// keeps a layout's component instance mounted while its route segment stays active; it does
// NOT remount per page). That single mount point is what keeps the `keydown` listener
// registered exactly once: if this component were instead rendered from an individual page,
// every navigation between pages would unmount the old listener and mount a new one — safe on
// its own, but a common source of duplicate-registration bugs the moment two page instances
// briefly coexist (e.g. a shared child re-rendering under React Strict Mode, or the component
// getting hoisted into more than one place by a future refactor). Keeping it at the shell level
// means there is only ever one place that can register it.
//
// Self-contained: owns its own open state and the trigger button, same shape as HelpDrawer.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Button, Modal, SearchInput, EmptyState, Skeleton } from "@/components/ui";
import type { AppModule } from "@/lib/nav";
import { searchNav, type PaletteNavResult } from "@/lib/command-palette";
import { searchPaletteEntities, type PaletteEntityResult } from "@/lib/command-palette-actions";

type PaletteResult = PaletteNavResult | PaletteEntityResult;

const ENTITY_KIND_LABEL: Record<PaletteEntityResult["kind"], string> = {
  "purchase-request": "طلب شراء",
  "inventory-item": "صنف مخزون",
};

const DEBOUNCE_MS = 250;
const MIN_ENTITY_QUERY = 2;

// Platform-specific shortcut hint via `useSyncExternalStore`, the sanctioned way to read a
// browser-only global (`navigator`) without a hydration mismatch: the server snapshot always
// returns the Ctrl label, the client snapshot reads the real platform, and React reconciles the
// difference after hydration — no effect/setState round-trip needed.
function subscribeNever() {
  return () => {};
}
function getShortcutLabel() {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
  return mac ? "⌘K" : "Ctrl K";
}
function getServerShortcutLabel() {
  return "Ctrl K";
}

function PaletteGroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pb-1 pt-3 text-xs font-bold" style={{ color: "var(--ink-muted)" }}>
      {children}
    </div>
  );
}

function PaletteRow({
  result,
  active,
  onSelect,
  onHover,
  id,
}: {
  result: PaletteResult;
  active: boolean;
  onSelect: () => void;
  onHover: () => void;
  id: string;
}) {
  const label = result.label;
  const sublabel = result.kind === "nav"
    ? result.moduleLabel
    : `${ENTITY_KIND_LABEL[result.kind]} · ${result.sublabel}`;
  const icon = result.kind === "nav" ? result.icon : result.kind === "purchase-request" ? "🧾" : "📦";
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      onMouseDown={(e) => {
        e.preventDefault();
        onSelect();
      }}
      onMouseEnter={onHover}
      className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm"
      style={{
        background: active ? "color-mix(in srgb, var(--brand) 14%, var(--surface))" : undefined,
      }}
    >
      <span aria-hidden="true">{icon}</span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-semibold">{label}</span>
        <span className="truncate text-xs" style={{ color: "var(--ink-muted)" }}>
          {sublabel}
        </span>
      </span>
    </div>
  );
}

export function CommandPalette({ modules }: { modules: AppModule[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [entityResults, setEntityResults] = useState<PaletteEntityResult[]>([]);
  const [entityLoading, setEntityLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const requestIdRef = useRef(0);
  const shortcutLabel = useSyncExternalStore(subscribeNever, getShortcutLabel, getServerShortcutLabel);

  const trimmed = query.trim();
  const navResults = searchNav(modules, query);
  // Derived, not stored: once the query shrinks below the entity-search threshold (or the
  // palette closes), the last fetched entity rows simply stop being displayed — no effect is
  // needed to "clear" them, they just fall out of the rendered list.
  const showEntities = open && trimmed.length >= MIN_ENTITY_QUERY;
  const displayedEntityResults = showEntities ? entityResults : [];
  const displayedEntityLoading = showEntities && entityLoading;
  const results: PaletteResult[] = [...navResults, ...displayedEntityResults];

  // Adjust activeIndex when the query changes, during render rather than in an effect (the
  // React-endorsed pattern for "reset state when an input changes" — see
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  const [prevQuery, setPrevQuery] = useState(query);
  if (query !== prevQuery) {
    setPrevQuery(query);
    setActiveIndex(0);
  }

  const closePalette = useCallback(() => {
    setOpen(false);
    setQuery("");
    setEntityResults([]);
    setEntityLoading(false);
    setActiveIndex(0);
  }, []);

  // Ref mirror of `open`, kept in sync in its own effect (a ref write is not state, so this
  // never causes a re-render). The global keydown listener reads it instead of closing over a
  // stale `open` from the render it was registered in.
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    function onGlobalKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (openRef.current) closePalette();
        else setOpen(true);
      }
    }
    document.addEventListener("keydown", onGlobalKeyDown);
    return () => document.removeEventListener("keydown", onGlobalKeyDown);
  }, [closePalette]);

  // Debounced entity search. Nothing here runs synchronously in the effect body — the guard
  // is a plain early `return` (no state to reset, since the display is derived above) and every
  // `setState` call lives inside the `setTimeout` callback, after the debounce delay.
  // `requestIdRef` discards a stale response that resolves after a newer one (out-of-order
  // network replies), so a slow first keystroke can't clobber the latest keystroke's results.
  useEffect(() => {
    if (!open || trimmed.length < MIN_ENTITY_QUERY) return;
    const requestId = ++requestIdRef.current;
    const timer = setTimeout(() => {
      setEntityLoading(true);
      searchPaletteEntities(trimmed)
        .then((rows) => {
          if (requestIdRef.current === requestId) setEntityResults(rows);
        })
        .catch(() => {
          if (requestIdRef.current === requestId) setEntityResults([]);
        })
        .finally(() => {
          if (requestIdRef.current === requestId) setEntityLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, trimmed]);

  const go = useCallback(
    (result: PaletteResult) => {
      closePalette();
      router.push(result.href);
    },
    [closePalette, router],
  );

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      const chosen = results[activeIndex];
      if (chosen) {
        e.preventDefault();
        go(chosen);
      }
    }
  }

  const showEmpty = trimmed.length > 0 && !displayedEntityLoading && results.length === 0;

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label="فتح البحث"
        className="flex items-center gap-2"
      >
        <span aria-hidden="true">🔍</span>
        <span className="hidden sm:inline">بحث</span>
        <kbd
          className="hidden rounded px-1.5 py-0.5 text-xs sm:inline"
          style={{ border: "1px solid var(--line)", color: "var(--ink-muted)" }}
        >
          {shortcutLabel}
        </kbd>
      </Button>
      <Modal open={open} onClose={closePalette} size="lg" closeLabel="إغلاق">
        <div dir="rtl" className="flex flex-col gap-2">
          <SearchInput
            autoFocus
            label="البحث في النظام"
            placeholder="ابحث عن صفحة، أو طلب شراء، أو صنف مخزون…"
            value={query}
            onValueChange={setQuery}
            onKeyDown={onKeyDown}
            aria-controls="command-palette-listbox"
            aria-activedescendant={results[activeIndex] ? `command-palette-option-${activeIndex}` : undefined}
          />
          <div
            id="command-palette-listbox"
            role="listbox"
            aria-label="نتائج البحث"
            className="flex max-h-96 flex-col gap-0.5 overflow-auto"
          >
            {navResults.length > 0 && <PaletteGroupLabel>الصفحات</PaletteGroupLabel>}
            {results.map((r, i) => {
              const boundary = i === navResults.length && displayedEntityResults.length > 0;
              return (
                <div key={`${r.kind}-${r.id}`}>
                  {boundary && <PaletteGroupLabel>النتائج</PaletteGroupLabel>}
                  <PaletteRow
                    id={`command-palette-option-${i}`}
                    result={r}
                    active={i === activeIndex}
                    onSelect={() => go(r)}
                    onHover={() => setActiveIndex(i)}
                  />
                </div>
              );
            })}
            {displayedEntityLoading && (
              <div className="flex flex-col gap-2 px-3 py-2" aria-live="polite" aria-label="جارٍ البحث">
                <Skeleton shape="text" width="60%" />
                <Skeleton shape="text" width="40%" />
              </div>
            )}
            {showEmpty && (
              <EmptyState title="لا توجد نتائج" description={`لا يوجد ما يطابق "${trimmed}"`} />
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}
