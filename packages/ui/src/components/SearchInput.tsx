import * as React from "react";

export interface SearchInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  /** Accessible label for the field (consumer-supplied; visually hidden). */ label: string;
  /** Controlled value. */ value: string;
  /** Change handler (controlled-first). */ onValueChange: (value: string) => void;
  /** Leading icon (decorative). */ icon?: React.ReactNode;
  /** Fired on Enter with the current value. */ onSubmitSearch?: (value: string) => void;
}

let uid = 0;

/** Search field. role="search" wrapper + a labeled <input type="search">. */
export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { label, value, onValueChange, icon, onSubmitSearch, className = "", id, onKeyDown, ...rest },
  ref
) {
  const reactId = React.useId?.() ?? `fos-search-${++uid}`;
  const inputId = id ?? reactId;
  return (
    <div className={`fos-search ${className}`.trim()} role="search">
      <label className="fos-search__label" htmlFor={inputId}>{label}</label>
      {icon && <span className="fos-search__icon" aria-hidden="true">{icon}</span>}
      <input
        ref={ref}
        id={inputId}
        type="search"
        className="fos-search__input"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (e.key === "Enter" && !e.defaultPrevented) onSubmitSearch?.(value);
        }}
        {...rest}
      />
    </div>
  );
});
