import * as React from "react";

let uid = 0;

export interface RadioOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps {
  /** Shared radio `name` (groups the inputs). */
  name: string;
  /** The options to render. */
  options: RadioOption[];
  /** Controlled selected value. */
  value?: string;
  /** Uncontrolled initial value. */
  defaultValue?: string;
  /** Called with the newly selected value. */
  onValueChange?: (value: string) => void;
  /** Group label (rendered as the fieldset legend). */
  legend: React.ReactNode;
  /** Marks the group invalid; sets `aria-invalid` on the fieldset. */
  invalid?: boolean;
  /** Disables the whole group. */
  disabled?: boolean;
  className?: string;
}

/** Radio group as a `<fieldset>` + `<legend>` wrapping native radios. Controlled-first. */
export function RadioGroup({
  name, options, value, defaultValue, onValueChange, legend, invalid, disabled, className = "",
}: RadioGroupProps) {
  const isControlled = value !== undefined;
  const [inner, setInner] = React.useState(defaultValue ?? "");
  const current = isControlled ? value : inner;
  const groupId = React.useMemo(() => `fos-radio-${++uid}`, []);

  const onChange = (next: string) => {
    if (!isControlled) setInner(next);
    onValueChange?.(next);
  };

  return (
    <fieldset
      className={`fos-radiogroup ${className}`.trim()}
      aria-invalid={invalid || undefined}
      disabled={disabled}
    >
      <legend className="fos-radiogroup__legend">{legend}</legend>
      {options.map((o, i) => {
        const optId = `${groupId}-${i}`;
        return (
          <label key={o.value} className="fos-radio" data-disabled={o.disabled || undefined} htmlFor={optId}>
            <input
              type="radio"
              id={optId}
              name={name}
              className="fos-radio__input"
              value={o.value}
              checked={current === o.value}
              disabled={o.disabled}
              onChange={() => onChange(o.value)}
            />
            <span className="fos-radio__dot" aria-hidden="true" />
            <span className="fos-radio__label">{o.label}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
