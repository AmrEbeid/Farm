import * as React from "react";
import { SidebarNav } from "./SidebarNav";
import type { NavItemData } from "./NavItem";
import { useOverlay } from "./useOverlay";

const MOBILE_DRAWER_QUERY = "(max-width: 48rem)";

function useMobileDrawerViewport(): boolean {
  const [matches, setMatches] = React.useState(false);
  React.useEffect(() => {
    const media = window.matchMedia(MOBILE_DRAWER_QUERY);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return matches;
}

export interface AppShellProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Nav entries for the generated sidebar (filtered by role). Ignored when `sidebar` is supplied. */ navItems?: NavItemData[];
  /** Active nav item id → aria-current="page". */ activeNavId?: string;
  /** Current role; filters navItems via NavItemData.roles. */ role?: string;
  /** Accessible name for the sidebar <nav>. */ navAriaLabel: string;
  /** Bubbled up from sidebar item activation. */ onNavSelect?: (id: string) => void;
  /** Real sidebar content. When supplied it replaces the generated SidebarNav inside the aside. */ sidebar?: React.ReactNode;
  /** Brand / logo slot. */ brand?: React.ReactNode;
  /** Topbar content (search, role switcher, user menu…). */ topbar?: React.ReactNode;
  /** Controlled mobile-drawer open state. Uncontrolled if omitted. */ sidebarOpen?: boolean;
  /** Notified when the drawer toggles (hamburger / overlay / Esc / navigation). */ onSidebarOpenChange?: (open: boolean) => void;
  /** Accessible label for the hamburger toggle. */ menuButtonLabel: string;
  /** Glyph/icon for the hamburger toggle. Falls back to a plain ☰ when omitted. */ menuIcon?: React.ReactNode;
  /** Main content. */ children: React.ReactNode;
}

/**
 * Application frame: a fixed topbar (banner) + an inline-start sidebar (primary nav) + a main region.
 * RTL-first: the sidebar anchors to the inline-start edge via logical grid columns; under dir="rtl"
 * that is the right edge, under dir="ltr" the left — no code change. On narrow viewports the sidebar
 * collapses to an off-canvas drawer toggled from the topbar hamburger (overlay click / Esc closes it).
 *
 * The aside accepts either consumer-owned `sidebar` content or, by default, a `navItems`-driven
 * SidebarNav. Both close the drawer on navigation.
 */
export function AppShell({
  navItems = [],
  activeNavId,
  role,
  navAriaLabel,
  onNavSelect,
  sidebar,
  brand,
  topbar,
  sidebarOpen,
  onSidebarOpenChange,
  menuButtonLabel,
  menuIcon,
  children,
  className = "",
  ...rest
}: AppShellProps) {
  const isControlled = sidebarOpen !== undefined;
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = isControlled ? (sidebarOpen as boolean) : internalOpen;
  const sidebarId = React.useId();
  const mobileDrawerViewport = useMobileDrawerViewport();
  // An empty generated aside is a supported legacy integration: some consumers currently render
  // their navigation beside it and use only the shell's open class. Do not inert their <main> until
  // they adopt the real sidebar slot.
  const hasGeneratedSidebarContent = navItems.some((item) => !role || !item.roles || item.roles.includes(role));
  const hasSidebarContent = sidebar != null || hasGeneratedSidebarContent;
  const drawerActive = open && mobileDrawerViewport && hasSidebarContent;
  // React 18's type package predates the standard inert attribute; spreading keeps the emitted
  // boolean attribute correct while consumers on React 19 receive native browser behavior.
  const inertBackgroundProps = drawerActive ? { inert: true } : {};

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalOpen(next);
      onSidebarOpenChange?.(next);
    },
    [isControlled, onSidebarOpenChange]
  );
  const { ref: sidebarPanelRef } = useOverlay({ open: drawerActive, onClose: () => setOpen(false) });

  /**
   * Consumer sidebars own their own markup, so parity with SidebarNav's close-on-select comes from
   * the click target: only real links close the drawer — buttons (workspace toggles) must not.
   */
  const onSidebarClick = React.useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      if (!open) return;
      if ((e.target as HTMLElement).closest?.("a[href]")) setOpen(false);
    },
    [open, setOpen]
  );

  return (
    <div
      className={`fos-appshell${open ? " fos-appshell--drawer-open" : ""} ${className}`.trim()}
      {...rest}
    >
      <header className="fos-appshell__topbar" role="banner" {...inertBackgroundProps}>
        <button
          type="button"
          className="fos-appshell__menu-btn"
          aria-label={menuButtonLabel}
          aria-expanded={open}
          aria-controls={sidebarId}
          onClick={() => setOpen(!open)}
        >
          <span className="fos-appshell__menu-icon" aria-hidden="true">{menuIcon ?? "☰"}</span>
        </button>
        {brand && <div className="fos-appshell__brand">{brand}</div>}
        <div className="fos-appshell__topbar-content">{topbar}</div>
      </header>

      <aside
        id={sidebarId}
        className="fos-appshell__sidebar"
        data-open={open || undefined}
        onClick={sidebar ? onSidebarClick : undefined}
      >
        <div
          ref={sidebarPanelRef}
          className="fos-appshell__sidebar-panel"
          tabIndex={-1}
          role={drawerActive ? "dialog" : undefined}
          aria-modal={drawerActive || undefined}
          aria-label={drawerActive ? navAriaLabel : undefined}
        >
          {sidebar ?? (
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
          )}
        </div>
      </aside>

      {/* Overlay only matters at mobile widths (CSS hides it on desktop). */}
      <div
        className="fos-appshell__overlay"
        hidden={!open}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      <main className="fos-appshell__main" role="main" {...inertBackgroundProps}>{children}</main>
    </div>
  );
}
