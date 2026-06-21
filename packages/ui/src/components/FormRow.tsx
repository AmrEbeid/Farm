import * as React from "react";

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  /** Show the required marker. */
  required?: boolean;
}

/** Field label. Renders a required marker when `required`. */
export function Label({ required, children, className = "", ...rest }: LabelProps) {
  return (
    <label className={`fos-formrow__label ${className}`.trim()} {...rest}>
      {children}
      {required && <span className="fos-formrow__req" aria-hidden="true"> *</span>}
    </label>
  );
}

export interface HelpProps extends React.HTMLAttributes<HTMLDivElement> {}

/** Secondary help text under a control. */
export function Help({ children, className = "", ...rest }: HelpProps) {
  return (
    <div className={`fos-formrow__help ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}

export interface FieldErrorProps extends React.HTMLAttributes<HTMLDivElement> {}

/** Error message under a control. Announced via `role="alert"`. */
export function FieldError({ children, className = "", ...rest }: FieldErrorProps) {
  return (
    <div className={`fos-formrow__error ${className}`.trim()} role="alert" {...rest}>
      {children}
    </div>
  );
}

export interface FormRowProps {
  /** Stable id; the control gets `id`, help/error get `${id}-help` / `${id}-error`. */
  id: string;
  /** Field label. */
  label: React.ReactNode;
  /** Optional help text. */
  help?: React.ReactNode;
  /** Optional error message; presence sets `aria-invalid` on the control. */
  error?: React.ReactNode;
  /** Marks the field required (label marker + `required` on the control). */
  required?: boolean;
  /** The single control element (Input, Select, Combobox, …). */
  children: React.ReactElement;
}

/**
 * Standard label + help + error layout. Clones the child control to inject
 * `id`, `required`, `aria-invalid`, and `aria-describedby` (help and/or error).
 */
export function FormRow({ id, label, help, error, required, children }: FormRowProps) {
  const helpId = help != null ? `${id}-help` : undefined;
  const errorId = error != null ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;

  const control = React.cloneElement(children, {
    id,
    required: required || children.props.required,
    "aria-invalid": error != null ? true : children.props["aria-invalid"],
    "aria-describedby": [children.props["aria-describedby"], describedBy].filter(Boolean).join(" ") || undefined,
  });

  return (
    <div className="fos-formrow">
      <Label htmlFor={id} required={required}>{label}</Label>
      {control}
      {help != null && <Help id={helpId}>{help}</Help>}
      {error != null && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}
