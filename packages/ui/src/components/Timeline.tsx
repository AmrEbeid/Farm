import * as React from "react";

export type TimelineTone = "default" | "success" | "warning" | "danger" | "info";

export interface TimelineItem {
  /** Stable key. */ id: string;
  /** Event title. */ title: React.ReactNode;
  /** Optional timestamp/label. */ time?: React.ReactNode;
  /** Optional detail line. */ description?: React.ReactNode;
  /** Marker tone. */ tone?: TimelineTone;
  /** Optional icon shown inside the marker. */ icon?: React.ReactNode;
}

export interface TimelineProps extends React.HTMLAttributes<HTMLOListElement> {
  /** Ordered events, newest-first or oldest-first (consumer's choice). */
  items: TimelineItem[];
}

/** Vertical event timeline. Renders an ordered list with a connecting rail and toned markers. */
export function Timeline({ items, className = "", ...rest }: TimelineProps) {
  return (
    <ol className={`fos-timeline ${className}`.trim()} {...rest}>
      {items.map((item) => (
        <li key={item.id} className="fos-timeline__item">
          <span className={`fos-timeline__marker fos-timeline__marker--${item.tone ?? "default"}`} aria-hidden="true">
            {item.icon}
          </span>
          <div className="fos-timeline__body">
            <div className="fos-timeline__head">
              <span className="fos-timeline__title">{item.title}</span>
              {item.time != null && <span className="fos-timeline__time">{item.time}</span>}
            </div>
            {item.description != null && <div className="fos-timeline__desc">{item.description}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
