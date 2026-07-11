import * as React from "react";

export interface TabItem {
  /** Stable key. */ id: string;
  /** Visible label. */ label: React.ReactNode;
}
export interface TabsProps {
  items: TabItem[];
  /** Controlled active tab id. */ value: string;
  /** Called with the newly selected tab id. */ onChange: (id: string) => void;
  /** Accessible label for the tablist. */ ariaLabel?: string;
}

/** DOM id for a tab button, derived from the tab id. Stable so consumers can reference it. */
export function tabId(id: string): string {
  return `fos-tab-${id}`;
}
/**
 * DOM id for the panel a tab controls. Consumers rendering their own panels should set this
 * `id` plus `role="tabpanel"` and `aria-labelledby={tabId(id)}` on the panel element so the
 * `aria-controls` wired here resolves. See the component doc-comment for the full pattern.
 */
export function tabPanelId(id: string): string {
  return `fos-tabpanel-${id}`;
}

/**
 * Horizontal tab switcher (also used for accounting/inventory sub-views).
 *
 * Renders only the tab buttons; panels are rendered by the consumer. Implements the
 * WAI-ARIA tabs pattern: roving tabindex (only the active tab is in the tab order) and
 * ArrowLeft/ArrowRight/Home/End keyboard navigation that activates the focused tab.
 *
 * Each tab carries `id={tabId(it.id)}`; the *active* tab also carries
 * `aria-controls={tabPanelId(it.id)}`. Consumers render only the active panel, so inactive
 * tabs omit `aria-controls` to avoid pointing at an id not in the DOM. For the active tab's
 * `aria-controls` link to resolve, the consumer's panel should render:
 *
 * ```tsx
 * <div role="tabpanel" id={tabPanelId(id)} aria-labelledby={tabId(id)} tabIndex={0}>…</div>
 * ```
 *
 * RTL note: keyboard navigation is logical (ArrowRight = next tab in array order). Under a
 * `dir="rtl"` container the visual order is mirrored, so we detect the tablist's computed
 * direction and swap Arrow handling so ArrowRight moves to the *previous* tab (toward the
 * visual right), matching the WAI-ARIA RTL recommendation.
 */
export function Tabs({ items, value, onChange, ariaLabel }: TabsProps) {
  const listRef = React.useRef<HTMLDivElement>(null);

  const focusTabAt = (index: number) => {
    const tabs = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs?.[index]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const count = items.length;
    if (count === 0) return;
    const current = items.findIndex((it) => it.id === value);
    if (current < 0) return;

    // Detect RTL from the tablist's computed direction so ArrowRight follows the visual layout.
    const isRtl =
      typeof window !== "undefined" && listRef.current
        ? window.getComputedStyle(listRef.current).direction === "rtl"
        : false;
    const forwardKey = isRtl ? "ArrowLeft" : "ArrowRight";
    const backwardKey = isRtl ? "ArrowRight" : "ArrowLeft";

    let next: number | null = null;
    if (e.key === forwardKey) next = (current + 1) % count;
    else if (e.key === backwardKey) next = (current - 1 + count) % count;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = count - 1;

    if (next === null) return;
    e.preventDefault();
    const nextId = items[next].id;
    if (nextId !== value) onChange(nextId);
    focusTabAt(next);
  };

  return (
    <div
      ref={listRef}
      className="fos-tabs"
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
    >
      {items.map((it) => {
        const active = it.id === value;
        return (
          <button
            key={it.id}
            id={tabId(it.id)}
            role="tab"
            aria-selected={active}
            // Only the active tab's panel is rendered by consumers, so point
            // aria-controls at it only when active — otherwise it dangles at an
            // id that isn't in the DOM (#500). React drops the attr on undefined.
            aria-controls={active ? tabPanelId(it.id) : undefined}
            tabIndex={active ? 0 : -1}
            className={`fos-tabs__tab${active ? " fos-tabs__tab--active" : ""}`}
            onClick={() => onChange(it.id)}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
