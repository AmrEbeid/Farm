import * as React from "react";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Marks the field invalid; sets `aria-invalid` and the error border. */
  invalid?: boolean;
}

/** Multi-line text control. Controlled-first; compose with `FormRow` for label/help/error. */
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, rows = 3, className = "", ...rest },
  ref
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={`fos-textarea ${className}`.trim()}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});
