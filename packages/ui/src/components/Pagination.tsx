import * as React from "react";

export interface PaginationProps extends Omit<React.HTMLAttributes<HTMLElement>, "onChange"> {
  /** Current page (1-based). */
  page: number;
  /** Total number of pages. */
  pageCount: number;
  /** Called with the next page (1-based). */
  onChange: (page: number) => void;
  /** Accessible label for the nav region. */
  ariaLabel?: string;
  /** Previous-button content (consumer supplies the string). */
  prevLabel?: React.ReactNode;
  /** Next-button content (consumer supplies the string). */
  nextLabel?: React.ReactNode;
}

/** Controlled pagination. `<nav>` with prev/next + numbered pages; current page uses `aria-current`. */
export function Pagination({
  page, pageCount, onChange, ariaLabel, prevLabel, nextLabel, className = "", ...rest
}: PaginationProps) {
  const pages = React.useMemo(
    () => Array.from({ length: Math.max(0, pageCount) }, (_, i) => i + 1),
    [pageCount]
  );
  const go = (p: number) => {
    if (p >= 1 && p <= pageCount && p !== page) onChange(p);
  };

  return (
    <nav className={`fos-pagination ${className}`.trim()} aria-label={ariaLabel} {...rest}>
      <button
        type="button"
        className="fos-pagination__nav"
        onClick={() => go(page - 1)}
        disabled={page <= 1}
      >
        {prevLabel}
      </button>
      <ul className="fos-pagination__list">
        {pages.map((p) => (
          <li key={p}>
            <button
              type="button"
              className={`fos-pagination__page${p === page ? " fos-pagination__page--active" : ""}`}
              aria-current={p === page ? "page" : undefined}
              onClick={() => go(p)}
            >
              {p}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="fos-pagination__nav"
        onClick={() => go(page + 1)}
        disabled={page >= pageCount}
      >
        {nextLabel}
      </button>
    </nav>
  );
}
