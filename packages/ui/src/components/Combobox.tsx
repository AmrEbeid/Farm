import * as React from "react";

export interface ComboboxOption {
  value: string;
  label: string;
}

export interface ComboboxProps {
  /** Selectable options. */
  options: ComboboxOption[];
  /** Controlled text/selection value (matches an option label when selected). */
  value?: string;
  /** Called with the chosen option label (or the typed text on free edit). */
  onValueChange?: (value: string) => void;
  /** Placeholder for the editable input. */
  placeholder?: string;
  /** Marks the field invalid; sets `aria-invalid`. */
  invalid?: boolean;
  /** Stable id (used to wire listbox/option ids). */
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  disabled?: boolean;
  className?: string;
}

let uid = 0;

/** Editable autocomplete. ARIA combobox + listbox/option, arrow-key navigation, Enter/Escape. */
export const Combobox = React.forwardRef<HTMLInputElement, ComboboxProps>(function Combobox(
  {
    options, value, onValueChange, placeholder, invalid, id,
    disabled, className = "", ...aria
  },
  ref
) {
  const isControlled = value !== undefined;
  const [inner, setInner] = React.useState("");
  const text = isControlled ? (value as string) : inner;

  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const baseId = React.useMemo(() => id ?? `fos-combobox-${++uid}`, [id]);
  const listId = `${baseId}-listbox`;

  const filtered = React.useMemo(
    () => options.filter((o) => o.label.includes(text.trim()) || text.trim() === ""),
    [options, text]
  );

  const commitText = (next: string) => {
    if (!isControlled) setInner(next);
    onValueChange?.(next);
  };

  const select = (opt: ComboboxOption) => {
    commitText(opt.label);
    setOpen(false);
    setActive(-1);
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    commitText(e.target.value);
    setOpen(true);
    setActive(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setActive((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      if (open && active >= 0 && filtered[active]) {
        e.preventDefault();
        select(filtered[active]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  };

  const activeId = open && active >= 0 && filtered[active] ? `${baseId}-opt-${active}` : undefined;

  return (
    <div className={`fos-combobox ${className}`.trim()}>
      <input
        ref={ref}
        type="text"
        role="combobox"
        className="fos-combobox__input"
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onFocus={() => setOpen(true)}
        onBlur={() => { setOpen(false); setActive(-1); }}
        {...aria}
      />
      {open && filtered.length > 0 && (
        <ul className="fos-combobox__list" role="listbox" id={listId}>
          {filtered.map((o, i) => (
            <li
              key={o.value}
              id={`${baseId}-opt-${i}`}
              role="option"
              aria-selected={o.label === text}
              className={`fos-combobox__option${i === active ? " fos-combobox__option--active" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); select(o); }}
              onMouseEnter={() => setActive(i)}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
