import * as React from "react";

export interface SelectOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export type SelectSize = "md" | "sm";

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  /** The options to render. */
  options: SelectOption[];
  /** Optional disabled placeholder shown first. */
  placeholder?: string;
  /** Control size. */
  selectSize?: SelectSize;
  /** Marks the field invalid; sets `aria-invalid`. */
  invalid?: boolean;
}

/** Native single-select. Controlled-first; pass `options`; compose with `FormRow`. */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, placeholder, selectSize = "md", invalid, className = "", defaultValue, value, ...rest },
  ref
) {
  return (
    <select
      ref={ref}
      className={`fos-select fos-select--${selectSize} ${className}`.trim()}
      aria-invalid={invalid || undefined}
      value={value}
      defaultValue={value === undefined && defaultValue === undefined && placeholder ? "" : defaultValue}
      {...rest}
    >
      {placeholder != null && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
});
