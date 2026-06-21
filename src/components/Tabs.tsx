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

/** Horizontal tab switcher (also used for accounting/inventory sub-views). */
export function Tabs({ items, value, onChange, ariaLabel }: TabsProps) {
  return (
    <div className="fos-tabs" role="tablist" aria-label={ariaLabel}>
      {items.map((it) => (
        <button
          key={it.id}
          role="tab"
          aria-selected={it.id === value}
          className={`fos-tabs__tab${it.id === value ? " fos-tabs__tab--active" : ""}`}
          onClick={() => onChange(it.id)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
