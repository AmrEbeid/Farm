import * as React from "react";

export interface SwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "type"> {
  /** Accessible name for the switch. */
  label: string;
  /** Controlled on/off state. */
  checked?: boolean;
  /** Uncontrolled initial state. */
  defaultChecked?: boolean;
  /** Called with the next state on toggle. */
  onCheckedChange?: (checked: boolean) => void;
}

/** Toggle switch as `role="switch"`. Keyboard: Space/Enter (native button) toggles. */
export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { label, checked, defaultChecked, onCheckedChange, disabled, className = "", ...rest },
  ref
) {
  const isControlled = checked !== undefined;
  const [inner, setInner] = React.useState(defaultChecked ?? false);
  const on = isControlled ? (checked as boolean) : inner;

  const toggle = () => {
    const next = !on;
    if (!isControlled) setInner(next);
    onCheckedChange?.(next);
  };

  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`fos-switch ${className}`.trim()}
      data-checked={on || undefined}
      disabled={disabled}
      onClick={toggle}
      {...rest}
    >
      <span className="fos-switch__thumb" aria-hidden="true" />
    </button>
  );
});
