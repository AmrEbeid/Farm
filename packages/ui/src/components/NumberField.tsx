import * as React from "react";
import { IconButton } from "./IconButton";

export interface NumberFieldProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "type" | "value" | "defaultValue" | "onChange" | "size"
  > {
  /** Controlled numeric value (`""` while the field is empty). */
  value?: number | "";
  /** Uncontrolled initial value. */
  defaultValue?: number;
  /** Called with the parsed value on every change/step. */
  onValueChange?: (value: number | "") => void;
  /** Step increment for the buttons and arrow keys. */
  step?: number;
  min?: number;
  max?: number;
  /** Marks the field invalid; sets `aria-invalid`. */
  invalid?: boolean;
  /** Accessible name for the decrement button. */
  decrementLabel: string;
  /** Accessible name for the increment button. */
  incrementLabel: string;
}

function clamp(n: number, min?: number, max?: number): number {
  if (min != null && n < min) return min;
  if (max != null && n > max) return max;
  return n;
}

/** Numeric input with stepper buttons. Controlled via `value`/`onValueChange`, or uncontrolled. */
export const NumberField = React.forwardRef<HTMLInputElement, NumberFieldProps>(function NumberField(
  {
    value, defaultValue, onValueChange, step = 1, min, max, invalid,
    decrementLabel, incrementLabel, disabled, className = "", ...rest
  },
  ref
) {
  const isControlled = value !== undefined;
  const [inner, setInner] = React.useState<number | "">(defaultValue ?? "");
  const current = isControlled ? (value as number | "") : inner;

  const commit = (next: number | "") => {
    if (!isControlled) setInner(next);
    onValueChange?.(next);
  };

  const stepBy = (dir: 1 | -1) => {
    const base = current === "" ? 0 : current;
    commit(clamp(base + dir * step, min, max));
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw === "") return commit("");
    const n = Number(raw);
    if (!Number.isNaN(n)) commit(n);
  };

  return (
    <div className={`fos-numfield ${className}`.trim()} data-disabled={disabled || undefined}>
      <IconButton
        label={decrementLabel}
        size="sm"
        onClick={() => stepBy(-1)}
        disabled={disabled || (min != null && current !== "" && current <= min)}
      >
        −
      </IconButton>
      <input
        ref={ref}
        type="number"
        className="fos-numfield__input"
        value={current}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={onInputChange}
        {...rest}
      />
      <IconButton
        label={incrementLabel}
        size="sm"
        onClick={() => stepBy(1)}
        disabled={disabled || (max != null && current !== "" && current >= max)}
      >
        ＋
      </IconButton>
    </div>
  );
});
