import * as React from "react";

let uid = 0;

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Visible label, associated to the input. */
  label: React.ReactNode;
  /** Marks the field invalid; sets `aria-invalid`. */
  invalid?: boolean;
}

/** Labelled checkbox. Controlled via `checked`/`onChange`, or uncontrolled with `defaultChecked`. */
export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, invalid, id, disabled, className = "", ...rest },
  ref
) {
  const autoId = React.useMemo(() => id ?? `fos-checkbox-${++uid}`, [id]);
  return (
    <label className={`fos-checkbox ${className}`.trim()} data-disabled={disabled || undefined}>
      <input
        ref={ref}
        type="checkbox"
        id={autoId}
        className="fos-checkbox__input"
        disabled={disabled}
        aria-invalid={invalid || undefined}
        {...rest}
      />
      <span className="fos-checkbox__box" aria-hidden="true" />
      <span className="fos-checkbox__label">{label}</span>
    </label>
  );
});
