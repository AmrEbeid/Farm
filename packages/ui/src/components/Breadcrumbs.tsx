import * as React from "react";

export interface Crumb {
  /** Stable key. */ id: string;
  /** Visible label (consumer-supplied). */ label: React.ReactNode;
  /** Link target; omit on the current page (rendered as plain text). */ href?: string;
}

export interface BreadcrumbsProps extends Omit<React.HTMLAttributes<HTMLElement>, "onSelect"> {
  /** Ordered trail; the last item is treated as the current page. */ items: Crumb[];
  /** Accessible name for the breadcrumb <nav>. */ ariaLabel: string;
  /** Separator between crumbs (decorative). */ separator?: React.ReactNode;
  /** Bubbled up from crumb link clicks. */ onSelect?: (id: string) => void;
}

/** Breadcrumb trail. <nav aria-label> + ordered list; the last crumb is aria-current="page" text. */
export function Breadcrumbs({
  items,
  ariaLabel,
  separator = "/",
  onSelect,
  className = "",
  ...rest
}: BreadcrumbsProps) {
  return (
    <nav className={`fos-breadcrumbs ${className}`.trim()} aria-label={ariaLabel} {...rest}>
      <ol className="fos-breadcrumbs__list">
        {items.map((c, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={c.id} className="fos-breadcrumbs__item">
              {isLast || !c.href ? (
                <span className="fos-breadcrumbs__current" aria-current={isLast ? "page" : undefined}>
                  {c.label}
                </span>
              ) : (
                <a
                  className="fos-breadcrumbs__link"
                  href={c.href}
                  onClick={(e) => {
                    if (!e.defaultPrevented) onSelect?.(c.id);
                  }}
                >
                  {c.label}
                </a>
              )}
              {!isLast && (
                <span className="fos-breadcrumbs__sep" aria-hidden="true">{separator}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
