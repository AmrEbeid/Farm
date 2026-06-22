import * as React from "react";
import { SidebarNav } from "./SidebarNav";
import type { NavItemData } from "./NavItem";

export interface AppShellProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Nav entries (consumer-supplied; filtered by role). */ navItems: NavItemData[];
  /** Active nav item id → aria-current="page". */ activeNavId?: string;
  /** Current role; filters navItems via NavItemData.roles. */ role?: string;
  /** Accessible name for the sidebar <nav>. */ navAriaLabel: string;
  /** Bubbled up from sidebar item activation. */ onNavSelect?: (id: string) => void;
  /** Brand / logo slot. */ brand?: React.ReactNode;
  /** Topbar content (search, role switcher, user menu…). */ topbar?: React.ReactNode;
  /** Controlled mobile-drawer open state. Uncontrolled if omitted. */ sidebarOpen?: boolean;
  /** Notified when the drawer toggles (hamburger / overlay / Esc). */ onSidebarOpenChange?: (open: boolean) => void;
  /** Accessible label for the hamburger toggle. */ menuButtonLabel: string;
  /** Main content. */ children: React.ReactNode;
}

/**
 * Application frame: a fixed topbar (banner) + an inline-start sidebar (primary nav) + a main region.
 * RTL-first: the sidebar anchors to the inline-start edge via logical grid columns; under dir="rtl"
 * that is the right edge, under dir="ltr" the left — no code change. On narrow viewports the sidebar
 * collapses to an off-canvas drawer toggled from the topbar hamburger (overlay click / Esc closes it).
 */
export function AppShell({
  navItems,
  activeNavId,
  role,
  navAriaLabel,
  onNavSelect,
  brand,
  topbar,
  sidebarOpen,
  onSidebarOpenChange,
  menuButtonLabel,
  children,
  className = "",
  ...rest
}: AppShellProps) {
  const isControlled = sidebarOpen !== undefined;
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = isControlled ? (sidebarOpen as boolean) : internalOpen;

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalOpen(next);
      onSidebarOpenChange?.(next);
    },
    [isControlled, onSidebarOpenChange]
  );

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  return (
    <div
      className={`fos-appshell${open ? " fos-appshell--drawer-open" : ""} ${className}`.trim()}
      {...rest}
    >
      <header className="fos-appshell__topbar" role="banner">
        <button
          type="button"
          className="fos-appshell__menu-btn"
          aria-label={menuButtonLabel}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span aria-hidden="true">☰</span>
        </button>
        {brand && <div className="fos-appshell__brand">{brand}</div>}
        <div className="fos-appshell__topbar-content">{topbar}</div>
      </header>

      <aside className="fos-appshell__sidebar" data-open={open || undefined}>
        <SidebarNav
          items={navItems}
          activeId={activeNavId}
          role={role}
          ariaLabel={navAriaLabel}
          onSelect={(id) => {
            onNavSelect?.(id);
            setOpen(false); // close drawer after navigating on mobile
          }}
        />
      </aside>

      {/* Overlay only matters at mobile widths (CSS hides it on desktop). */}
      <div
        className="fos-appshell__overlay"
        hidden={!open}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      <main className="fos-appshell__main" role="main">{children}</main>
    </div>
  );
}
