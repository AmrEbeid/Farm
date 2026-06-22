import * as React from "react";

export type ApprovalState = "requested" | "pending" | "approved" | "rejected";

export interface ApprovalStep {
  id: string;
  state: ApprovalState;
  actor: React.ReactNode;
  note?: React.ReactNode;
}

export interface ApprovalChainProps extends React.HTMLAttributes<HTMLOListElement> {
  steps: ApprovalStep[];
  ariaLabel: string;
}

const STATE_CLASS: Record<ApprovalState, string> = {
  requested: "fos-approval--requested",
  pending: "fos-approval--pending",
  approved: "fos-approval--approved",
  rejected: "fos-approval--rejected",
};

const STATE_GLYPH: Record<ApprovalState, string> = {
  requested: "•",
  pending: "…",
  approved: "✓",
  rejected: "✕",
};

/**
 * Domain component: an approval sequence (requested → reviewer → approved/rejected)
 * as an ordered list. The pending (current reviewer) step carries aria-current="step".
 * Actor labels are consumer-supplied.
 */
export function ApprovalChain({ steps, ariaLabel, className = "", ...rest }: ApprovalChainProps) {
  return (
    <ol className={`fos-approval ${className}`.trim()} aria-label={ariaLabel} {...rest}>
      {steps.map((step) => (
        <li
          key={step.id}
          className={`fos-approval__step ${STATE_CLASS[step.state]}`}
          aria-current={step.state === "pending" ? "step" : undefined}
        >
          <span className="fos-approval__marker" aria-hidden="true">{STATE_GLYPH[step.state]}</span>
          <div className="fos-approval__body">
            <span className="fos-approval__actor">{step.actor}</span>
            {step.note != null && <span className="fos-approval__note">{step.note}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}
