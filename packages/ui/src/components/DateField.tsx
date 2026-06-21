import * as React from "react";

export type DateFieldSize = "md" | "sm";

export interface DateFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  /** Control size. */
  fieldSize?: DateFieldSize;
  /** Marks the field invalid; sets `aria-invalid`. */
  invalid?: boolean;
}

/**
 * Native date control (`<input type="date">`). Value is the ISO `yyyy-mm-dd` string;
 * the browser renders the locale display. Presentational only — no i18n in the library.
 */
export const DateField = React.forwardRef<HTMLInputElement, DateFieldProps>(function DateField(
  { fieldSize = "md", invalid, className = "", ...rest },
  ref
) {
  return (
    <input
      ref={ref}
      type="date"
      className={`fos-datefield fos-datefield--${fieldSize} ${className}`.trim()}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});
