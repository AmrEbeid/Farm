import * as React from "react";

export type TimelineKind = "operation" | "issue" | "inspection" | "expense" | "photo";

export interface TimelineEvent {
  id: string;
  kind: TimelineKind;
  title: React.ReactNode;
  time: React.ReactNode;
  description?: React.ReactNode;
  glyph?: React.ReactNode;
}

export interface FileTimelineProps extends React.HTMLAttributes<HTMLOListElement> {
  events: TimelineEvent[];
  ariaLabel: string;
}

const KIND_CLASS: Record<TimelineKind, string> = {
  operation: "fos-tl--operation",
  issue: "fos-tl--issue",
  inspection: "fos-tl--inspection",
  expense: "fos-tl--expense",
  photo: "fos-tl--photo",
};

/**
 * Domain component: a vertical RTL timeline of farm events. Markers sit on the
 * inline-start edge, tone-coded by event kind. Titles/times are consumer-supplied.
 */
export function FileTimeline({ events, ariaLabel, className = "", ...rest }: FileTimelineProps) {
  return (
    <ol className={`fos-tl ${className}`.trim()} aria-label={ariaLabel} {...rest}>
      {events.map((ev) => (
        <li key={ev.id} className={`fos-tl__item ${KIND_CLASS[ev.kind]}`}>
          <span className="fos-tl__marker" aria-hidden="true">{ev.glyph}</span>
          <div className="fos-tl__body">
            <div className="fos-tl__head">
              <span className="fos-tl__title">{ev.title}</span>
              <time className="fos-tl__time">{ev.time}</time>
            </div>
            {ev.description != null && <div className="fos-tl__desc">{ev.description}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
