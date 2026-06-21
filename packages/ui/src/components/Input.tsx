import * as React from "react";

export type InputSize = "md" | "sm";

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** Control size (named `inputSize` so it does not collide with the native `size` attribute). */
  inputSize?: InputSize;
  /** Marks the field invalid; sets `aria-invalid` and the error border. */
  invalid?: boolean;
}

/** Single-line text control. Controlled-first; compose with `FormRow` for label/help/error. */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { inputSize = "md", invalid, className = "", type = "text", ...rest },
  ref
) {
  return (
    <input
      ref={ref}
      type={type}
      className={`fos-input fos-input--${inputSize} ${className}`.trim()}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});
