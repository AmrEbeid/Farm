import * as React from "react";

export interface FieldProps {
  /** Field label (associated via htmlFor). */
  label: React.ReactNode;
  /** Stable id linking label → control. */
  id: string;
  /** Error message; sets aria-invalid and shows red text. */
  error?: string;
  /** The control. Defaults to a text input if children are omitted. */
  children?: React.ReactNode;
  /** Placeholder for the default input. */
  placeholder?: string;
}

/** Labelled form field wrapper. Pass a custom control as children, or use the default input. */
export function Field({ label, id, error, children, placeholder }: FieldProps) {
  return (
    <div className="fos-field">
      <label className="fos-field__label" htmlFor={id}>{label}</label>
      {children ?? (
        <input
          id={id}
          className="fos-field__control"
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
        />
      )}
      {error && <div className="fos-field__error" id={`${id}-err`}>{error}</div>}
    </div>
  );
}
