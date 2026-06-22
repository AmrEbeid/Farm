import * as React from "react";

export type LoopStepState = "pending" | "active" | "done" | "blocked";

export interface LoopStep {
  id: string;
  label: React.ReactNode;
  state?: LoopStepState;
}

export interface LoopStepperProps extends React.HTMLAttributes<HTMLOListElement> {
  steps: LoopStep[];
  ariaLabel: string;
}

const STATE_CLASS: Record<LoopStepState, string> = {
  pending: "fos-loopstep--pending",
  active: "fos-loopstep--active",
  done: "fos-loopstep--done",
  blocked: "fos-loopstep--blocked",
};

/**
 * Domain component: the planning-loop stepper (plan → check → approve → execute → file).
 * Horizontal, RTL-first, an ordered list; the active step carries aria-current="step".
 * Labels are consumer-supplied (no strings in the library).
 */
export function LoopStepper({ steps, ariaLabel, className = "", ...rest }: LoopStepperProps) {
  return (
    <ol className={`fos-loop ${className}`.trim()} aria-label={ariaLabel} {...rest}>
      {steps.map((step, i) => {
        const state = step.state ?? "pending";
        return (
          <li
            key={step.id}
            className={`fos-loopstep ${STATE_CLASS[state]}`}
            aria-current={state === "active" ? "step" : undefined}
          >
            <span className="fos-loopstep__marker" aria-hidden="true">
              {state === "done" ? "✓" : state === "blocked" ? "!" : i + 1}
            </span>
            <span className="fos-loopstep__label">{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
