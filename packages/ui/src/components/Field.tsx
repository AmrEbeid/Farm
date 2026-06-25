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
  const errorId = `${id}-err`;

  // When an error is present, the error wiring (aria-invalid + aria-describedby) must land on
  // the actual control. The default <input> sets these directly; for custom children
  // (Input/Select/Textarea/etc.) we clone the element to inject them, preserving any values
  // the consumer already passed (an existing aria-describedby is appended, not overwritten).
  let control: React.ReactNode = children;
  if (children != null && React.isValidElement(children) && error) {
    const childProps = children.props as {
      "aria-invalid"?: React.AriaAttributes["aria-invalid"];
      "aria-describedby"?: string;
    };
    control = React.cloneElement(children as React.ReactElement, {
      "aria-invalid": childProps["aria-invalid"] ?? true,
      "aria-describedby": childProps["aria-describedby"]
        ? `${childProps["aria-describedby"]} ${errorId}`
        : errorId,
    });
  }

  return (
    <div className="fos-field">
      <label className="fos-field__label" htmlFor={id}>{label}</label>
      {control ?? (
        <input
          id={id}
          className="fos-field__control"
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
      )}
      {error && <div className="fos-field__error" id={errorId}>{error}</div>}
    </div>
  );
}
