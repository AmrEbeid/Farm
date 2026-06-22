import * as React from "react";

export interface NavItemData {
  /** Stable key. */ id: string;
  /** Visible label (consumer-supplied). */ label: React.ReactNode;
  /** Optional leading icon (emoji or node). */ icon?: React.ReactNode;
  /** Link target; when omitted the item renders as a <button>. */ href?: string;
  /** Roles allowed to see this item. Omitted = visible to all roles. */ roles?: string[];
}

export interface NavItemProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onSelect"> {
  /** The nav entry to render. */ item: NavItemData;
  /** Marks the active route → aria-current="page". */ active?: boolean;
  /** Called with the item id on activation (SPA routing). */ onSelect?: (id: string) => void;
}

/** A single sidebar entry. Renders an <a> (preferred for routing) carrying aria-current when active. */
export const NavItem = React.forwardRef<HTMLAnchorElement, NavItemProps>(function NavItem(
  { item, active = false, onSelect, className = "", onClick, ...rest },
  ref
) {
  return (
    <a
      ref={ref}
      href={item.href ?? "#"}
      className={`fos-navitem${active ? " fos-navitem--active" : ""} ${className}`.trim()}
      aria-current={active ? "page" : undefined}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) onSelect?.(item.id);
      }}
      {...rest}
    >
      {item.icon && <span className="fos-navitem__icon" aria-hidden="true">{item.icon}</span>}
      <span className="fos-navitem__label">{item.label}</span>
    </a>
  );
});
