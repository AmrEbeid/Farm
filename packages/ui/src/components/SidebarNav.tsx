import * as React from "react";
import { NavItem, type NavItemData } from "./NavItem";

export interface SidebarNavProps extends React.HTMLAttributes<HTMLElement> {
  /** Nav entries (consumer-supplied). */ items: NavItemData[];
  /** Active item id → that NavItem gets aria-current="page". */ activeId?: string;
  /** Filter items to those visible to this role (matches NavItemData.roles). */ role?: string;
  /** Accessible name for the <nav> landmark. */ ariaLabel: string;
  /** Bubbled up from NavItem clicks. */ onSelect?: (id: string) => void;
}

/** Vertical primary navigation. A <nav> landmark + list; the active item carries aria-current. */
export function SidebarNav({
  items,
  activeId,
  role,
  ariaLabel,
  onSelect,
  className = "",
  ...rest
}: SidebarNavProps) {
  const visible = role
    ? items.filter((it) => !it.roles || it.roles.includes(role))
    : items;
  return (
    <nav className={`fos-sidebarnav ${className}`.trim()} aria-label={ariaLabel} {...rest}>
      <ul className="fos-sidebarnav__list">
        {visible.map((it) => (
          <li key={it.id} className="fos-sidebarnav__item">
            <NavItem item={it} active={it.id === activeId} onSelect={onSelect} />
          </li>
        ))}
      </ul>
    </nav>
  );
}
