import * as React from "react";
import { Progress } from "./Progress";

export type PhaseTone = "neutral" | "info" | "ok" | "warning" | "danger";

export interface PhaseMetaRow {
  label: React.ReactNode;
  value: React.ReactNode;
}

export interface PhaseCardProps extends React.HTMLAttributes<HTMLDivElement> {
  title: React.ReactNode;
  tone?: PhaseTone;
  status?: React.ReactNode;
  meta?: PhaseMetaRow[];
  progress?: number;
  progressLabel?: string;
}

const TONE_CLASS: Record<PhaseTone, string> = {
  neutral: "fos-phase--neutral",
  info: "fos-phase--info",
  ok: "fos-phase--ok",
  warning: "fos-phase--warning",
  danger: "fos-phase--danger",
};

/** Domain component: a card summarizing a plan phase/operation (title, status tone, meta rows, progress). */
export function PhaseCard({
  title, tone = "neutral", status, meta, progress, progressLabel, className = "", ...rest
}: PhaseCardProps) {
  return (
    <div className={`fos-phase ${TONE_CLASS[tone]} ${className}`.trim()} {...rest}>
      <div className="fos-phase__head">
        <span className="fos-phase__dot" aria-hidden="true" />
        <span className="fos-phase__title">{title}</span>
        {status != null && <span className="fos-phase__status">{status}</span>}
      </div>
      {meta != null && meta.length > 0 && (
        <dl className="fos-phase__meta">
          {meta.map((row, i) => (
            <div className="fos-phase__row" key={i}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {progress != null && (
        <div className="fos-phase__progress">
          <Progress value={progress} label={progressLabel} />
        </div>
      )}
    </div>
  );
}
