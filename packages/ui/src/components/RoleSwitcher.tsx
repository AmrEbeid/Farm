import * as React from "react";

export interface RoleOption {
  /** Role key (e.g. "owner"). */ id: string;
  /** Visible label (consumer-supplied). */ label: React.ReactNode;
}

export interface RoleSwitcherProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange"> {
  /** Selectable roles. */ options: RoleOption[];
  /** Controlled active role id. */ value: string;
  /** Called with the newly selected role id. */ onRoleChange: (id: string) => void;
  /** Accessible label (consumer-supplied; visually hidden). */ label: string;
}

let uid = 0;

/** Role switcher — an accessible native <select> (combobox) of roles. */
export const RoleSwitcher = React.forwardRef<HTMLSelectElement, RoleSwitcherProps>(function RoleSwitcher(
  { options, value, onRoleChange, label, className = "", id, ...rest },
  ref
) {
  const reactId = React.useId?.() ?? `fos-role-${++uid}`;
  const selectId = id ?? reactId;
  return (
    <div className={`fos-roleswitcher ${className}`.trim()}>
      <label className="fos-roleswitcher__label" htmlFor={selectId}>{label}</label>
      <select
        ref={ref}
        id={selectId}
        className="fos-roleswitcher__select"
        value={value}
        onChange={(e) => onRoleChange(e.target.value)}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
    </div>
  );
});
