import * as React from "react";

export type SkeletonShape = "text" | "rect" | "circle";

export interface SkeletonProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Visual shape. `text` supports multiple `lines`. */
  shape?: SkeletonShape;
  /** Explicit width (number → px). */
  width?: string | number;
  /** Explicit height (number → px). */
  height?: string | number;
  /** Number of stacked bars when `shape="text"`. */
  lines?: number;
}

function len(v: string | number | undefined): string | undefined {
  return typeof v === "number" ? `${v}px` : v;
}

/** Token-driven shimmer placeholder (decorative; `aria-hidden`). Shimmer uses color-mix over --neutral-bg. */
export function Skeleton({
  shape = "text", width, height, lines = 1, className = "", style, ...rest
}: SkeletonProps) {
  if (shape === "text" && lines > 1) {
    return (
      <span className={`fos-skeleton-group ${className}`.trim()} aria-hidden="true" {...rest}>
        {Array.from({ length: lines }, (_, i) => (
          <span
            key={i}
            className="fos-skeleton fos-skeleton--text fos-skeleton__line"
            style={{ width: i === lines - 1 ? "70%" : len(width) ?? "100%" }}
          />
        ))}
      </span>
    );
  }
  return (
    <span
      className={`fos-skeleton fos-skeleton--${shape} ${className}`.trim()}
      aria-hidden="true"
      style={{ width: len(width), height: len(height), ...style }}
      {...rest}
    />
  );
}
