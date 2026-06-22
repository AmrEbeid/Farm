import * as React from "react";

export interface DescriptionItem {
  /** Stable key. */ id: string;
  /** Term (label). */ term: React.ReactNode;
  /** Description (value). */ description: React.ReactNode;
  /** Numeric value — applies tabular-nums. */ numeric?: boolean;
}

export interface DescriptionListProps extends React.HTMLAttributes<HTMLDListElement> {
  /** Term/description pairs. */
  items: DescriptionItem[];
  /** `stacked` (term above value) or `inline` (term beside value). */
  layout?: "stacked" | "inline";
}

/** Semantic key/value list (`<dl>`). Use for record metadata; numeric values are tabular-nums. */
export function DescriptionList({ items, layout = "stacked", className = "", ...rest }: DescriptionListProps) {
  return (
    <dl className={`fos-dl fos-dl--${layout} ${className}`.trim()} {...rest}>
      {items.map((item) => (
        <div className="fos-dl__row" key={item.id}>
          <dt className="fos-dl__dt">{item.term}</dt>
          <dd className={`fos-dl__dd${item.numeric ? " fos-dl__dd--num" : ""}`}>{item.description}</dd>
        </div>
      ))}
    </dl>
  );
}
