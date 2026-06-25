export { BarChart, DoughnutChart, LineChart, useChartTokens } from './chunk-ZBNXAI57.js';
import * as React22 from 'react';
import { jsxs, jsx, Fragment } from 'react/jsx-runtime';
import { createPortal } from 'react-dom';

var Button = React22.forwardRef(function Button2({ variant = "primary", size = "md", loading = false, icon, disabled, children, className = "", ...rest }, ref) {
  return /* @__PURE__ */ jsxs(
    "button",
    {
      ref,
      className: `fos-btn fos-btn--${variant} fos-btn--${size} ${className}`.trim(),
      disabled: disabled || loading,
      "aria-busy": loading || void 0,
      ...rest,
      children: [
        loading && /* @__PURE__ */ jsx("span", { className: "fos-btn__spinner", "aria-hidden": "true" }),
        !loading && icon,
        children
      ]
    }
  );
});
function Tag({ tone = "neutral", children, className = "", ...rest }) {
  return /* @__PURE__ */ jsx("span", { className: `fos-tag fos-tag--${tone} ${className}`.trim(), ...rest, children });
}
function Card({ title, subtitle, children, className = "", ...rest }) {
  return /* @__PURE__ */ jsxs("div", { className: `fos-card ${className}`.trim(), ...rest, children: [
    title != null && /* @__PURE__ */ jsx("h3", { className: "fos-card__title", children: title }),
    subtitle != null && /* @__PURE__ */ jsx("p", { className: "fos-card__sub", children: subtitle }),
    children
  ] });
}
function KpiCard({
  label,
  value,
  unit,
  icon,
  delta,
  deltaDirection = "none",
  className = "",
  ...rest
}) {
  return /* @__PURE__ */ jsxs("div", { className: `fos-kpi ${className}`.trim(), ...rest, children: [
    /* @__PURE__ */ jsxs("div", { className: "fos-kpi__label", children: [
      icon != null && /* @__PURE__ */ jsx("span", { className: "fos-kpi__icon", "aria-hidden": "true", children: icon }),
      label
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "fos-kpi__value", children: [
      value,
      " ",
      unit != null && /* @__PURE__ */ jsx("small", { children: unit })
    ] }),
    delta != null && /* @__PURE__ */ jsx("div", { className: `fos-kpi__delta${deltaDirection !== "none" ? ` fos-kpi__delta--${deltaDirection}` : ""}`, children: delta })
  ] });
}
function Alert({ tone = "info", title, description, icon, className = "", ...rest }) {
  return /* @__PURE__ */ jsxs(
    "div",
    {
      role: tone === "danger" ? "alert" : "status",
      className: `fos-alert fos-alert--${tone} ${className}`.trim(),
      ...rest,
      children: [
        icon != null && /* @__PURE__ */ jsx("span", { className: "fos-alert__icon", "aria-hidden": "true", children: icon }),
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("div", { className: "fos-alert__title", children: title }),
          description != null && /* @__PURE__ */ jsx("div", { className: "fos-alert__desc", children: description })
        ] })
      ]
    }
  );
}
function Progress({ value, tone = "default", label, className = "", ...rest }) {
  const pct = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  return /* @__PURE__ */ jsx(
    "div",
    {
      className: `fos-progress${tone !== "default" ? ` fos-progress--${tone}` : ""} ${className}`.trim(),
      role: "progressbar",
      "aria-valuenow": pct,
      "aria-valuemin": 0,
      "aria-valuemax": 100,
      "aria-label": label,
      ...rest,
      children: /* @__PURE__ */ jsx("span", { className: "fos-progress__bar", style: { width: `${pct}%` } })
    }
  );
}
function Field({ label, id, error, children, placeholder }) {
  const errorId = `${id}-err`;
  let control = children;
  if (children != null && React22.isValidElement(children) && error) {
    const childProps = children.props;
    control = React22.cloneElement(children, {
      "aria-invalid": childProps["aria-invalid"] ?? true,
      "aria-describedby": childProps["aria-describedby"] ? `${childProps["aria-describedby"]} ${errorId}` : errorId
    });
  }
  return /* @__PURE__ */ jsxs("div", { className: "fos-field", children: [
    /* @__PURE__ */ jsx("label", { className: "fos-field__label", htmlFor: id, children: label }),
    control ?? /* @__PURE__ */ jsx(
      "input",
      {
        id,
        className: "fos-field__control",
        placeholder,
        "aria-invalid": error ? true : void 0,
        "aria-describedby": error ? errorId : void 0
      }
    ),
    error && /* @__PURE__ */ jsx("div", { className: "fos-field__error", id: errorId, children: error })
  ] });
}
var DEFAULT_ICON = { ok: "\u2705", warning: "\u26A0\uFE0F", danger: "\u26D4" };
function VerdictBanner({ tone = "ok", icon, children, className = "", ...rest }) {
  return /* @__PURE__ */ jsxs("div", { role: "status", className: `fos-verdict fos-verdict--${tone} ${className}`.trim(), ...rest, children: [
    /* @__PURE__ */ jsx("span", { "aria-hidden": "true", children: icon ?? DEFAULT_ICON[tone] }),
    /* @__PURE__ */ jsx("span", { children })
  ] });
}
function tabId(id) {
  return `fos-tab-${id}`;
}
function tabPanelId(id) {
  return `fos-tabpanel-${id}`;
}
function Tabs({ items, value, onChange, ariaLabel }) {
  const listRef = React22.useRef(null);
  const focusTabAt = (index) => {
    const tabs = listRef.current?.querySelectorAll('[role="tab"]');
    tabs?.[index]?.focus();
  };
  const onKeyDown = (e) => {
    const count = items.length;
    if (count === 0) return;
    const current = items.findIndex((it) => it.id === value);
    if (current < 0) return;
    const isRtl = typeof window !== "undefined" && listRef.current ? window.getComputedStyle(listRef.current).direction === "rtl" : false;
    const forwardKey = isRtl ? "ArrowLeft" : "ArrowRight";
    const backwardKey = isRtl ? "ArrowRight" : "ArrowLeft";
    let next = null;
    if (e.key === forwardKey) next = (current + 1) % count;
    else if (e.key === backwardKey) next = (current - 1 + count) % count;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = count - 1;
    if (next === null) return;
    e.preventDefault();
    const nextId = items[next].id;
    if (nextId !== value) onChange(nextId);
    focusTabAt(next);
  };
  return /* @__PURE__ */ jsx(
    "div",
    {
      ref: listRef,
      className: "fos-tabs",
      role: "tablist",
      "aria-label": ariaLabel,
      onKeyDown,
      children: items.map((it) => {
        const active = it.id === value;
        return /* @__PURE__ */ jsx(
          "button",
          {
            id: tabId(it.id),
            role: "tab",
            "aria-selected": active,
            "aria-controls": tabPanelId(it.id),
            tabIndex: active ? 0 : -1,
            className: `fos-tabs__tab${active ? " fos-tabs__tab--active" : ""}`,
            onClick: () => onChange(it.id),
            children: it.label
          },
          it.id
        );
      })
    }
  );
}
var IconButton = React22.forwardRef(function IconButton2({ label, variant = "ghost", size = "md", loading = false, disabled, children, className = "", ...rest }, ref) {
  return /* @__PURE__ */ jsx(
    "button",
    {
      ref,
      type: "button",
      className: `fos-iconbtn fos-iconbtn--${variant} fos-iconbtn--${size} ${className}`.trim(),
      "aria-label": label,
      title: label,
      disabled: disabled || loading,
      "aria-busy": loading || void 0,
      ...rest,
      children: loading ? /* @__PURE__ */ jsx("span", { className: "fos-iconbtn__spinner", "aria-hidden": "true" }) : children
    }
  );
});
var Input = React22.forwardRef(function Input2({ inputSize = "md", invalid, className = "", type = "text", ...rest }, ref) {
  return /* @__PURE__ */ jsx(
    "input",
    {
      ref,
      type,
      className: `fos-input fos-input--${inputSize} ${className}`.trim(),
      "aria-invalid": invalid || void 0,
      ...rest
    }
  );
});
var Textarea = React22.forwardRef(function Textarea2({ invalid, rows = 3, className = "", ...rest }, ref) {
  return /* @__PURE__ */ jsx(
    "textarea",
    {
      ref,
      rows,
      className: `fos-textarea ${className}`.trim(),
      "aria-invalid": invalid || void 0,
      ...rest
    }
  );
});
function clamp(n, min, max) {
  if (min != null && n < min) return min;
  if (max != null && n > max) return max;
  return n;
}
var NumberField = React22.forwardRef(function NumberField2({
  value,
  defaultValue,
  onValueChange,
  step = 1,
  min,
  max,
  invalid,
  decrementLabel,
  incrementLabel,
  disabled,
  className = "",
  ...rest
}, ref) {
  const isControlled = value !== void 0;
  const [inner, setInner] = React22.useState(defaultValue ?? "");
  const current = isControlled ? value : inner;
  const commit = (next) => {
    if (!isControlled) setInner(next);
    onValueChange?.(next);
  };
  const stepBy = (dir) => {
    const base = current === "" ? 0 : current;
    commit(clamp(base + dir * step, min, max));
  };
  const onInputChange = (e) => {
    const raw = e.target.value;
    if (raw === "") return commit("");
    const n = Number(raw);
    if (!Number.isNaN(n)) commit(n);
  };
  return /* @__PURE__ */ jsxs("div", { className: `fos-numfield ${className}`.trim(), "data-disabled": disabled || void 0, children: [
    /* @__PURE__ */ jsx(
      IconButton,
      {
        label: decrementLabel,
        size: "sm",
        onClick: () => stepBy(-1),
        disabled: disabled || min != null && current !== "" && current <= min,
        children: "\u2212"
      }
    ),
    /* @__PURE__ */ jsx(
      "input",
      {
        ref,
        type: "number",
        className: "fos-numfield__input",
        value: current,
        step,
        min,
        max,
        disabled,
        "aria-invalid": invalid || void 0,
        onChange: onInputChange,
        ...rest
      }
    ),
    /* @__PURE__ */ jsx(
      IconButton,
      {
        label: incrementLabel,
        size: "sm",
        onClick: () => stepBy(1),
        disabled: disabled || max != null && current !== "" && current >= max,
        children: "\uFF0B"
      }
    )
  ] });
});
var Select = React22.forwardRef(function Select2({ options, placeholder, selectSize = "md", invalid, className = "", defaultValue, value, ...rest }, ref) {
  return /* @__PURE__ */ jsxs(
    "select",
    {
      ref,
      className: `fos-select fos-select--${selectSize} ${className}`.trim(),
      "aria-invalid": invalid || void 0,
      value,
      defaultValue: value === void 0 && defaultValue === void 0 && placeholder ? "" : defaultValue,
      ...rest,
      children: [
        placeholder != null && /* @__PURE__ */ jsx("option", { value: "", disabled: true, children: placeholder }),
        options.map((o) => /* @__PURE__ */ jsx("option", { value: o.value, disabled: o.disabled, children: o.label }, o.value))
      ]
    }
  );
});
var uid = 0;
var Combobox = React22.forwardRef(function Combobox2({
  options,
  value,
  onValueChange,
  placeholder,
  invalid,
  id,
  disabled,
  className = "",
  ...aria
}, ref) {
  const isControlled = value !== void 0;
  const [inner, setInner] = React22.useState("");
  const text = isControlled ? value : inner;
  const [open, setOpen] = React22.useState(false);
  const [active, setActive] = React22.useState(-1);
  const baseId = React22.useMemo(() => id ?? `fos-combobox-${++uid}`, [id]);
  const listId = `${baseId}-listbox`;
  const filtered = React22.useMemo(
    () => options.filter((o) => o.label.includes(text.trim()) || text.trim() === ""),
    [options, text]
  );
  const commitText = (next) => {
    if (!isControlled) setInner(next);
    onValueChange?.(next);
  };
  const select = (opt) => {
    commitText(opt.label);
    setOpen(false);
    setActive(-1);
  };
  const onChange = (e) => {
    commitText(e.target.value);
    setOpen(true);
    setActive(-1);
  };
  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
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
  const activeId = open && active >= 0 && filtered[active] ? `${baseId}-opt-${active}` : void 0;
  return /* @__PURE__ */ jsxs("div", { className: `fos-combobox ${className}`.trim(), children: [
    /* @__PURE__ */ jsx(
      "input",
      {
        ref,
        type: "text",
        role: "combobox",
        className: "fos-combobox__input",
        value: text,
        placeholder,
        disabled,
        "aria-invalid": invalid || void 0,
        "aria-expanded": open,
        "aria-controls": listId,
        "aria-autocomplete": "list",
        "aria-activedescendant": activeId,
        onChange,
        onKeyDown,
        onFocus: () => setOpen(true),
        onBlur: () => {
          setOpen(false);
          setActive(-1);
        },
        ...aria
      }
    ),
    open && filtered.length > 0 && /* @__PURE__ */ jsx("ul", { className: "fos-combobox__list", role: "listbox", id: listId, children: filtered.map((o, i) => /* @__PURE__ */ jsx(
      "li",
      {
        id: `${baseId}-opt-${i}`,
        role: "option",
        "aria-selected": o.label === text,
        className: `fos-combobox__option${i === active ? " fos-combobox__option--active" : ""}`,
        onMouseDown: (e) => {
          e.preventDefault();
          select(o);
        },
        onMouseEnter: () => setActive(i),
        children: o.label
      },
      o.value
    )) })
  ] });
});
var uid2 = 0;
var Checkbox = React22.forwardRef(function Checkbox2({ label, invalid, id, disabled, className = "", ...rest }, ref) {
  const autoId = React22.useMemo(() => id ?? `fos-checkbox-${++uid2}`, [id]);
  return /* @__PURE__ */ jsxs("label", { className: `fos-checkbox ${className}`.trim(), "data-disabled": disabled || void 0, children: [
    /* @__PURE__ */ jsx(
      "input",
      {
        ref,
        type: "checkbox",
        id: autoId,
        className: "fos-checkbox__input",
        disabled,
        "aria-invalid": invalid || void 0,
        ...rest
      }
    ),
    /* @__PURE__ */ jsx("span", { className: "fos-checkbox__box", "aria-hidden": "true" }),
    /* @__PURE__ */ jsx("span", { className: "fos-checkbox__label", children: label })
  ] });
});
var uid3 = 0;
function RadioGroup({
  name,
  options,
  value,
  defaultValue,
  onValueChange,
  legend,
  invalid,
  disabled,
  className = ""
}) {
  const isControlled = value !== void 0;
  const [inner, setInner] = React22.useState(defaultValue ?? "");
  const current = isControlled ? value : inner;
  const groupId = React22.useMemo(() => `fos-radio-${++uid3}`, []);
  const onChange = (next) => {
    if (!isControlled) setInner(next);
    onValueChange?.(next);
  };
  return /* @__PURE__ */ jsxs(
    "fieldset",
    {
      className: `fos-radiogroup ${className}`.trim(),
      "aria-invalid": invalid || void 0,
      disabled,
      children: [
        /* @__PURE__ */ jsx("legend", { className: "fos-radiogroup__legend", children: legend }),
        options.map((o, i) => {
          const optId = `${groupId}-${i}`;
          return /* @__PURE__ */ jsxs("label", { className: "fos-radio", "data-disabled": o.disabled || void 0, htmlFor: optId, children: [
            /* @__PURE__ */ jsx(
              "input",
              {
                type: "radio",
                id: optId,
                name,
                className: "fos-radio__input",
                value: o.value,
                checked: current === o.value,
                disabled: o.disabled,
                onChange: () => onChange(o.value)
              }
            ),
            /* @__PURE__ */ jsx("span", { className: "fos-radio__dot", "aria-hidden": "true" }),
            /* @__PURE__ */ jsx("span", { className: "fos-radio__label", children: o.label })
          ] }, o.value);
        })
      ]
    }
  );
}
var Switch = React22.forwardRef(function Switch2({ label, checked, defaultChecked, onCheckedChange, disabled, className = "", ...rest }, ref) {
  const isControlled = checked !== void 0;
  const [inner, setInner] = React22.useState(defaultChecked ?? false);
  const on = isControlled ? checked : inner;
  const toggle = () => {
    const next = !on;
    if (!isControlled) setInner(next);
    onCheckedChange?.(next);
  };
  return /* @__PURE__ */ jsx(
    "button",
    {
      ref,
      type: "button",
      role: "switch",
      "aria-checked": on,
      "aria-label": label,
      className: `fos-switch ${className}`.trim(),
      "data-checked": on || void 0,
      disabled,
      onClick: toggle,
      ...rest,
      children: /* @__PURE__ */ jsx("span", { className: "fos-switch__thumb", "aria-hidden": "true" })
    }
  );
});
var DateField = React22.forwardRef(function DateField2({ fieldSize = "md", invalid, className = "", ...rest }, ref) {
  return /* @__PURE__ */ jsx(
    "input",
    {
      ref,
      type: "date",
      className: `fos-datefield fos-datefield--${fieldSize} ${className}`.trim(),
      "aria-invalid": invalid || void 0,
      ...rest
    }
  );
});
function Label({ required, children, className = "", ...rest }) {
  return /* @__PURE__ */ jsxs("label", { className: `fos-formrow__label ${className}`.trim(), ...rest, children: [
    children,
    required && /* @__PURE__ */ jsx("span", { className: "fos-formrow__req", "aria-hidden": "true", children: " *" })
  ] });
}
function Help({ children, className = "", ...rest }) {
  return /* @__PURE__ */ jsx("div", { className: `fos-formrow__help ${className}`.trim(), ...rest, children });
}
function FieldError({ children, className = "", ...rest }) {
  return /* @__PURE__ */ jsx("div", { className: `fos-formrow__error ${className}`.trim(), role: "alert", ...rest, children });
}
function FormRow({ id, label, help, error, required, children }) {
  const helpId = help != null ? `${id}-help` : void 0;
  const errorId = error != null ? `${id}-error` : void 0;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || void 0;
  const control = React22.cloneElement(children, {
    id,
    required: required || children.props.required,
    "aria-invalid": error != null ? true : children.props["aria-invalid"],
    "aria-describedby": [children.props["aria-describedby"], describedBy].filter(Boolean).join(" ") || void 0
  });
  return /* @__PURE__ */ jsxs("div", { className: "fos-formrow", children: [
    /* @__PURE__ */ jsx(Label, { htmlFor: id, required, children: label }),
    control,
    help != null && /* @__PURE__ */ jsx(Help, { id: helpId, children: help }),
    error != null && /* @__PURE__ */ jsx(FieldError, { id: errorId, children: error })
  ] });
}
function Stat({
  label,
  value,
  unit,
  help,
  trend = "flat",
  change,
  className = "",
  ...rest
}) {
  return /* @__PURE__ */ jsxs("div", { className: `fos-stat ${className}`.trim(), ...rest, children: [
    /* @__PURE__ */ jsx("div", { className: "fos-stat__label", children: label }),
    /* @__PURE__ */ jsxs("div", { className: "fos-stat__value", children: [
      value,
      unit != null && /* @__PURE__ */ jsx("small", { className: "fos-stat__unit", children: unit })
    ] }),
    change != null && /* @__PURE__ */ jsx("div", { className: `fos-stat__change fos-stat__change--${trend}`, children: change }),
    help != null && /* @__PURE__ */ jsx("div", { className: "fos-stat__help", children: help })
  ] });
}
var ARIA_SORT = {
  asc: "ascending",
  desc: "descending"
};
function DataTable({
  columns,
  rows,
  getRowId,
  caption,
  sort = null,
  onSortChange,
  stickyHeader = false,
  empty,
  className = "",
  ...rest
}) {
  function toggle(columnId) {
    if (!onSortChange) return;
    const next = sort && sort.columnId === columnId ? { columnId, direction: sort.direction === "asc" ? "desc" : "asc" } : { columnId, direction: "asc" };
    onSortChange(next);
  }
  return /* @__PURE__ */ jsx("div", { className: `fos-table-wrap${stickyHeader ? " fos-table-wrap--sticky" : ""} ${className}`.trim(), children: /* @__PURE__ */ jsxs("table", { className: "fos-table", ...rest, children: [
    caption != null && /* @__PURE__ */ jsx("caption", { className: "fos-table__caption", children: caption }),
    /* @__PURE__ */ jsx("thead", { className: "fos-table__head", children: /* @__PURE__ */ jsx("tr", { children: columns.map((col) => {
      const active = sort?.columnId === col.id;
      const align = col.align ?? (col.numeric ? "end" : "start");
      return /* @__PURE__ */ jsx(
        "th",
        {
          scope: "col",
          className: `fos-table__th fos-table__th--${align}`,
          style: col.width ? { width: col.width } : void 0,
          "aria-sort": col.sortable ? active ? ARIA_SORT[sort.direction] : "none" : void 0,
          children: col.sortable ? /* @__PURE__ */ jsxs(
            "button",
            {
              type: "button",
              className: "fos-table__sort",
              onClick: () => toggle(col.id),
              children: [
                col.header,
                /* @__PURE__ */ jsx("span", { className: "fos-table__sort-icon", "aria-hidden": "true", children: active ? sort.direction === "asc" ? "\u25B2" : "\u25BC" : "\u2195" })
              ]
            }
          ) : col.header
        },
        col.id
      );
    }) }) }),
    /* @__PURE__ */ jsx("tbody", { children: rows.length === 0 ? /* @__PURE__ */ jsx("tr", { children: /* @__PURE__ */ jsx("td", { className: "fos-table__empty", colSpan: columns.length, children: empty }) }) : rows.map((row) => /* @__PURE__ */ jsx("tr", { className: "fos-table__row", children: columns.map((col) => {
      const align = col.align ?? (col.numeric ? "end" : "start");
      return /* @__PURE__ */ jsx(
        "td",
        {
          className: `fos-table__td fos-table__td--${align}${col.numeric ? " fos-table__td--num" : ""}`,
          children: col.cell(row)
        },
        col.id
      );
    }) }, getRowId(row))) })
  ] }) });
}
function Timeline({ items, className = "", ...rest }) {
  return /* @__PURE__ */ jsx("ol", { className: `fos-timeline ${className}`.trim(), ...rest, children: items.map((item) => /* @__PURE__ */ jsxs("li", { className: "fos-timeline__item", children: [
    /* @__PURE__ */ jsx("span", { className: `fos-timeline__marker fos-timeline__marker--${item.tone ?? "default"}`, "aria-hidden": "true", children: item.icon }),
    /* @__PURE__ */ jsxs("div", { className: "fos-timeline__body", children: [
      /* @__PURE__ */ jsxs("div", { className: "fos-timeline__head", children: [
        /* @__PURE__ */ jsx("span", { className: "fos-timeline__title", children: item.title }),
        item.time != null && /* @__PURE__ */ jsx("span", { className: "fos-timeline__time", children: item.time })
      ] }),
      item.description != null && /* @__PURE__ */ jsx("div", { className: "fos-timeline__desc", children: item.description })
    ] })
  ] }, item.id)) });
}
function DescriptionList({ items, layout = "stacked", className = "", ...rest }) {
  return /* @__PURE__ */ jsx("dl", { className: `fos-dl fos-dl--${layout} ${className}`.trim(), ...rest, children: items.map((item) => /* @__PURE__ */ jsxs("div", { className: "fos-dl__row", children: [
    /* @__PURE__ */ jsx("dt", { className: "fos-dl__dt", children: item.term }),
    /* @__PURE__ */ jsx("dd", { className: `fos-dl__dd${item.numeric ? " fos-dl__dd--num" : ""}`, children: item.description })
  ] }, item.id)) });
}

// src/components/safeHref.ts
var ALLOWED_SCHEMES = /* @__PURE__ */ new Set(["http", "https", "mailto", "tel"]);
function safeHref(href) {
  if (!href) return void 0;
  const cleaned = href.replace(/\s+/g, "");
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(cleaned);
  if (scheme && !ALLOWED_SCHEMES.has(scheme[1].toLowerCase())) return void 0;
  return href;
}
function safeImgSrc(src) {
  if (!src) return void 0;
  const cleaned = src.replace(/\s+/g, "");
  if (/^data:image\//i.test(cleaned)) return src;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(cleaned);
  if (scheme && scheme[1].toLowerCase() !== "http" && scheme[1].toLowerCase() !== "https") {
    return void 0;
  }
  return src;
}
function initialsOf(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2);
  return (parts[0][0] ?? "") + (parts[parts.length - 1][0] ?? "");
}
var Avatar = React22.forwardRef(function Avatar2({ name, src, size = "md", className = "", ...rest }, ref) {
  const safeSrc = safeImgSrc(src);
  const [failed, setFailed] = React22.useState(false);
  React22.useEffect(() => setFailed(false), [safeSrc]);
  const showImg = safeSrc != null && !failed;
  return /* @__PURE__ */ jsx(
    "span",
    {
      ref,
      className: `fos-avatar fos-avatar--${size} ${className}`.trim(),
      role: "img",
      "aria-label": name,
      ...rest,
      children: showImg ? /* @__PURE__ */ jsx("img", { className: "fos-avatar__img", src: safeSrc, alt: "", onError: () => setFailed(true) }) : /* @__PURE__ */ jsx("span", { className: "fos-avatar__initials", "aria-hidden": "true", children: initialsOf(name) })
    }
  );
});
var tooltipSeq = 0;
function Tooltip({ label, placement = "top", children }) {
  const [open, setOpen] = React22.useState(false);
  const id = React22.useMemo(() => `fos-tip-${++tooltipSeq}`, []);
  const show = () => setOpen(true);
  const hide = () => setOpen(false);
  const child = React22.Children.only(children);
  const trigger = React22.cloneElement(child, {
    "aria-describedby": open ? id : child.props["aria-describedby"],
    onMouseEnter: (e) => {
      show();
      child.props.onMouseEnter?.(e);
    },
    onMouseLeave: (e) => {
      hide();
      child.props.onMouseLeave?.(e);
    },
    onFocus: (e) => {
      show();
      child.props.onFocus?.(e);
    },
    onBlur: (e) => {
      hide();
      child.props.onBlur?.(e);
    },
    onKeyDown: (e) => {
      if (e.key === "Escape") hide();
      child.props.onKeyDown?.(e);
    }
  });
  return /* @__PURE__ */ jsxs("span", { className: "fos-tooltip", children: [
    trigger,
    open && /* @__PURE__ */ jsx("span", { role: "tooltip", id, className: `fos-tooltip__bubble fos-tooltip__bubble--${placement}`, children: label })
  ] });
}
function Pagination({
  page,
  pageCount,
  onChange,
  ariaLabel,
  prevLabel,
  nextLabel,
  className = "",
  ...rest
}) {
  const count = Number.isFinite(pageCount) ? Math.max(0, Math.floor(pageCount)) : 0;
  const pages = React22.useMemo(
    () => Array.from({ length: count }, (_, i) => i + 1),
    [count]
  );
  const go = (p) => {
    if (p >= 1 && p <= count && p !== page) onChange(p);
  };
  return /* @__PURE__ */ jsxs("nav", { className: `fos-pagination ${className}`.trim(), "aria-label": ariaLabel, ...rest, children: [
    /* @__PURE__ */ jsx(
      "button",
      {
        type: "button",
        className: "fos-pagination__nav",
        onClick: () => go(page - 1),
        disabled: page <= 1,
        "aria-label": prevLabel == null ? "Previous" : void 0,
        children: prevLabel
      }
    ),
    /* @__PURE__ */ jsx("ul", { className: "fos-pagination__list", children: pages.map((p) => /* @__PURE__ */ jsx("li", { children: /* @__PURE__ */ jsx(
      "button",
      {
        type: "button",
        className: `fos-pagination__page${p === page ? " fos-pagination__page--active" : ""}`,
        "aria-current": p === page ? "page" : void 0,
        onClick: () => go(p),
        children: p
      }
    ) }, p)) }),
    /* @__PURE__ */ jsx(
      "button",
      {
        type: "button",
        className: "fos-pagination__nav",
        onClick: () => go(page + 1),
        disabled: page >= count,
        "aria-label": nextLabel == null ? "Next" : void 0,
        children: nextLabel
      }
    )
  ] });
}
function EmptyState({ title, description, icon, action, className = "", ...rest }) {
  return /* @__PURE__ */ jsxs("div", { className: `fos-empty ${className}`.trim(), ...rest, children: [
    icon != null && /* @__PURE__ */ jsx("div", { className: "fos-empty__icon", "aria-hidden": "true", children: icon }),
    /* @__PURE__ */ jsx("p", { className: "fos-empty__title", children: title }),
    description != null && /* @__PURE__ */ jsx("p", { className: "fos-empty__desc", children: description }),
    action != null && /* @__PURE__ */ jsx("div", { className: "fos-empty__action", children: action })
  ] });
}
function len(v) {
  return typeof v === "number" ? `${v}px` : v;
}
function Skeleton({
  shape = "text",
  width,
  height,
  lines = 1,
  className = "",
  style,
  ...rest
}) {
  if (shape === "text" && lines > 1) {
    return /* @__PURE__ */ jsx("span", { className: `fos-skeleton-group ${className}`.trim(), "aria-hidden": "true", ...rest, children: Array.from({ length: lines }, (_, i) => /* @__PURE__ */ jsx(
      "span",
      {
        className: "fos-skeleton fos-skeleton--text fos-skeleton__line",
        style: { width: i === lines - 1 ? "70%" : len(width) ?? "100%" }
      },
      i
    )) });
  }
  return /* @__PURE__ */ jsx(
    "span",
    {
      className: `fos-skeleton fos-skeleton--${shape} ${className}`.trim(),
      "aria-hidden": "true",
      style: { width: len(width), height: len(height), ...style },
      ...rest
    }
  );
}

// src/theme/brand.ts
function brandVars(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`brandVars: expected a 6-digit hex, got "${hex}"`);
  const n = parseInt(m[1], 16);
  const r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
  const hover = "#" + [r, g, b].map((c) => Math.max(0, Math.round(c * 0.82)).toString(16).padStart(2, "0")).join("");
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const contrast = lum > 0.6 ? "#0c1f12" : "#ffffff";
  return { "--brand": hex.toLowerCase(), "--brand-hover": hover, "--brand-contrast": contrast };
}
var ThemeContext = React22.createContext({ scheme: "light", density: "comfortable", radius: "default", brandStyle: {} });
var useTheme = () => React22.useContext(ThemeContext);
function ThemeProvider({
  scheme = "light",
  density = "comfortable",
  radius = "default",
  brand,
  className = "",
  children
}) {
  const style = React22.useMemo(() => {
    if (!brand) return {};
    try {
      return brandVars(brand);
    } catch {
      return {};
    }
  }, [brand]);
  const value = React22.useMemo(
    () => ({ scheme, density, radius, brand, brandStyle: style }),
    [scheme, density, radius, brand, style]
  );
  return /* @__PURE__ */ jsx(ThemeContext.Provider, { value, children: /* @__PURE__ */ jsx("div", { className: `fos ${className}`.trim(), "data-theme": scheme, "data-density": density, "data-radius": radius, style, children }) });
}
var FOCUSABLE = 'a[href],area[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
function isVisible(el) {
  if (el === document.activeElement) return true;
  if (el.hidden) return false;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (style && (style.display === "none" || style.visibility === "hidden")) return false;
  return true;
}
function focusable(root) {
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter(isVisible);
}
function useOverlay({ open, onClose, closeOnEsc = true }) {
  const ref = React22.useRef(null);
  const restoreRef = React22.useRef(null);
  const onCloseRef = React22.useRef(onClose);
  onCloseRef.current = onClose;
  React22.useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement;
    const panel = ref.current;
    const initial = panel ? focusable(panel)[0] ?? panel : null;
    initial?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(e) {
      if (e.key === "Escape" && closeOnEsc) {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = focusable(panel);
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      restoreRef.current?.focus();
    };
  }, [open, closeOnEsc]);
  return { ref };
}
function Modal({
  open,
  onClose,
  title,
  footer,
  size = "md",
  closeOnBackdrop = true,
  closeOnEsc = true,
  closeLabel,
  className = "",
  children,
  ...rest
}) {
  const theme = useTheme();
  const { ref } = useOverlay({ open, onClose, closeOnEsc });
  const titleId = React22.useId();
  if (!open) return null;
  return createPortal(
    /* @__PURE__ */ jsx("div", { className: "fos", "data-theme": theme.scheme, "data-density": theme.density, "data-radius": theme.radius, style: theme.brandStyle, children: /* @__PURE__ */ jsx(
      "div",
      {
        className: "fos-modal__backdrop",
        onMouseDown: (e) => {
          if (closeOnBackdrop && e.target === e.currentTarget) onClose();
        },
        children: /* @__PURE__ */ jsxs(
          "div",
          {
            ref,
            role: "dialog",
            "aria-modal": "true",
            "aria-labelledby": title != null ? titleId : void 0,
            tabIndex: -1,
            className: `fos-modal fos-modal--${size} ${className}`.trim(),
            ...rest,
            children: [
              (title != null || closeLabel != null) && /* @__PURE__ */ jsxs("div", { className: "fos-modal__header", children: [
                title != null && /* @__PURE__ */ jsx("h2", { id: titleId, className: "fos-modal__title", children: title }),
                closeLabel != null && /* @__PURE__ */ jsx("button", { type: "button", className: "fos-modal__close", "aria-label": closeLabel || "Close", onClick: onClose, children: "\u2715" })
              ] }),
              /* @__PURE__ */ jsx("div", { className: "fos-modal__body", children }),
              footer != null && /* @__PURE__ */ jsx("div", { className: "fos-modal__footer", children: footer })
            ]
          }
        )
      }
    ) }),
    document.body
  );
}
var Dialog = Modal;
function Drawer({
  open,
  onClose,
  side = "end",
  title,
  footer,
  closeOnBackdrop = true,
  closeOnEsc = true,
  closeLabel,
  className = "",
  children,
  ...rest
}) {
  const theme = useTheme();
  const { ref } = useOverlay({ open, onClose, closeOnEsc });
  const titleId = React22.useId();
  if (!open) return null;
  return createPortal(
    /* @__PURE__ */ jsx("div", { className: "fos", "data-theme": theme.scheme, "data-density": theme.density, "data-radius": theme.radius, style: theme.brandStyle, children: /* @__PURE__ */ jsx(
      "div",
      {
        className: "fos-drawer__backdrop",
        onMouseDown: (e) => {
          if (closeOnBackdrop && e.target === e.currentTarget) onClose();
        },
        children: /* @__PURE__ */ jsxs(
          "div",
          {
            ref,
            role: "dialog",
            "aria-modal": "true",
            "aria-labelledby": title != null ? titleId : void 0,
            tabIndex: -1,
            className: `fos-drawer fos-drawer--${side} ${className}`.trim(),
            ...rest,
            children: [
              (title != null || closeLabel != null) && /* @__PURE__ */ jsxs("div", { className: "fos-drawer__header", children: [
                title != null && /* @__PURE__ */ jsx("h2", { id: titleId, className: "fos-drawer__title", children: title }),
                closeLabel != null && /* @__PURE__ */ jsx("button", { type: "button", className: "fos-drawer__close", "aria-label": closeLabel || "Close", onClick: onClose, children: "\u2715" })
              ] }),
              /* @__PURE__ */ jsx("div", { className: "fos-drawer__body", children }),
              footer != null && /* @__PURE__ */ jsx("div", { className: "fos-drawer__footer", children: footer })
            ]
          }
        )
      }
    ) }),
    document.body
  );
}
var Sheet = Drawer;
function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = "primary",
  loading = false,
  size = "sm",
  closeOnBackdrop,
  closeOnEsc,
  closeLabel
}) {
  return /* @__PURE__ */ jsx(
    Modal,
    {
      open,
      onClose,
      title,
      size,
      closeOnBackdrop,
      closeOnEsc,
      closeLabel,
      footer: /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx(Button, { variant: "ghost", onClick: onClose, disabled: loading, children: cancelLabel }),
        /* @__PURE__ */ jsx(Button, { variant: tone === "danger" ? "danger" : "primary", loading, onClick: onConfirm, children: confirmLabel })
      ] }),
      children: description != null && /* @__PURE__ */ jsx("p", { className: "fos-confirm__desc", children: description })
    }
  );
}
function reducer(state, action) {
  switch (action.type) {
    case "add": {
      const next = [...state, action.toast];
      return next.length > action.max ? next.slice(next.length - action.max) : next;
    }
    case "remove":
      return state.filter((t) => t.id !== action.id);
    case "clear":
      return [];
  }
}
var ToastContext = React22.createContext(null);
var seq = 0;
function ToastProvider({ children, max = 4 }) {
  const [toasts, dispatch] = React22.useReducer(reducer, []);
  const api = React22.useMemo(() => {
    const push = (opts) => {
      const id = `fos-toast-${++seq}`;
      dispatch({ type: "add", toast: { duration: 4500, tone: "info", ...opts, id }, max });
      return id;
    };
    const shorthand = (tone) => (title, opts = {}) => push({ ...opts, title, tone });
    return {
      toast: push,
      dismiss: (id) => dispatch({ type: "remove", id }),
      clear: () => dispatch({ type: "clear" }),
      ok: shorthand("ok"),
      info: shorthand("info"),
      warning: shorthand("warning"),
      danger: shorthand("danger")
    };
  }, [max]);
  const value = React22.useMemo(() => ({ toasts, api }), [toasts, api]);
  return /* @__PURE__ */ jsxs(ToastContext.Provider, { value, children: [
    children,
    /* @__PURE__ */ jsx(Toaster, {})
  ] });
}
function useToast() {
  const ctx = React22.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a <ToastProvider>");
  return ctx.api;
}
function Toaster() {
  const ctx = React22.useContext(ToastContext);
  const theme = useTheme();
  if (!ctx || typeof document === "undefined") return null;
  const { toasts, api } = ctx;
  return createPortal(
    /* @__PURE__ */ jsx(
      "div",
      {
        className: "fos",
        "data-theme": theme.scheme,
        "data-density": theme.density,
        "data-radius": theme.radius,
        style: theme.brandStyle,
        children: /* @__PURE__ */ jsx("div", { className: "fos-toaster", role: "status", "aria-live": "polite", "aria-atomic": "false", children: toasts.map((t) => /* @__PURE__ */ jsx(ToastItem, { toast: t, onDismiss: () => api.dismiss(t.id) }, t.id)) })
      }
    ),
    document.body
  );
}
function ToastItem({ toast, onDismiss }) {
  const { tone = "info", duration = 4500 } = toast;
  const paused = React22.useRef(false);
  const elRef = React22.useRef(null);
  const dismissRef = React22.useRef(onDismiss);
  dismissRef.current = onDismiss;
  React22.useEffect(() => {
    if (duration <= 0) return;
    let remaining = duration;
    let start = Date.now();
    let timer;
    const run = () => {
      start = Date.now();
      timer = setTimeout(() => dismissRef.current(), remaining);
    };
    const pause = () => {
      paused.current = true;
      clearTimeout(timer);
      remaining -= Date.now() - start;
    };
    const resume = () => {
      if (!paused.current) return;
      paused.current = false;
      run();
    };
    run();
    const el = elRef.current;
    el?.addEventListener("mouseenter", pause);
    el?.addEventListener("mouseleave", resume);
    el?.addEventListener("focusin", pause);
    el?.addEventListener("focusout", resume);
    return () => {
      clearTimeout(timer);
      el?.removeEventListener("mouseenter", pause);
      el?.removeEventListener("mouseleave", resume);
      el?.removeEventListener("focusin", pause);
      el?.removeEventListener("focusout", resume);
    };
  }, [duration]);
  return /* @__PURE__ */ jsxs("div", { ref: elRef, className: `fos-toast fos-toast--${tone}`, children: [
    toast.icon != null && /* @__PURE__ */ jsx("span", { className: "fos-toast__icon", "aria-hidden": "true", children: toast.icon }),
    /* @__PURE__ */ jsxs("div", { className: "fos-toast__body", children: [
      /* @__PURE__ */ jsx("div", { className: "fos-toast__title", children: toast.title }),
      toast.description != null && /* @__PURE__ */ jsx("div", { className: "fos-toast__desc", children: toast.description })
    ] }),
    /* @__PURE__ */ jsx("button", { type: "button", className: "fos-toast__close", "aria-label": "\u2715", onClick: onDismiss, children: "\u2715" })
  ] });
}
var NavItem = React22.forwardRef(function NavItem2({ item, active = false, onSelect, className = "", onClick, ...rest }, ref) {
  return /* @__PURE__ */ jsxs(
    "a",
    {
      ref,
      href: safeHref(item.href) ?? "#",
      className: `fos-navitem${active ? " fos-navitem--active" : ""} ${className}`.trim(),
      "aria-current": active ? "page" : void 0,
      onClick: (e) => {
        onClick?.(e);
        if (!e.defaultPrevented) onSelect?.(item.id);
      },
      ...rest,
      children: [
        item.icon && /* @__PURE__ */ jsx("span", { className: "fos-navitem__icon", "aria-hidden": "true", children: item.icon }),
        /* @__PURE__ */ jsx("span", { className: "fos-navitem__label", children: item.label })
      ]
    }
  );
});
function SidebarNav({
  items,
  activeId,
  role,
  ariaLabel,
  onSelect,
  className = "",
  ...rest
}) {
  const visible = role ? items.filter((it) => !it.roles || it.roles.includes(role)) : items;
  return /* @__PURE__ */ jsx("nav", { className: `fos-sidebarnav ${className}`.trim(), "aria-label": ariaLabel, ...rest, children: /* @__PURE__ */ jsx("ul", { className: "fos-sidebarnav__list", children: visible.map((it) => /* @__PURE__ */ jsx("li", { className: "fos-sidebarnav__item", children: /* @__PURE__ */ jsx(NavItem, { item: it, active: it.id === activeId, onSelect }) }, it.id)) }) });
}
function Breadcrumbs({
  items,
  ariaLabel,
  separator = "/",
  onSelect,
  className = "",
  ...rest
}) {
  return /* @__PURE__ */ jsx("nav", { className: `fos-breadcrumbs ${className}`.trim(), "aria-label": ariaLabel, ...rest, children: /* @__PURE__ */ jsx("ol", { className: "fos-breadcrumbs__list", children: items.map((c, i) => {
    const isLast = i === items.length - 1;
    return /* @__PURE__ */ jsxs("li", { className: "fos-breadcrumbs__item", children: [
      isLast || !c.href ? /* @__PURE__ */ jsx("span", { className: "fos-breadcrumbs__current", "aria-current": isLast ? "page" : void 0, children: c.label }) : /* @__PURE__ */ jsx(
        "a",
        {
          className: "fos-breadcrumbs__link",
          href: safeHref(c.href),
          onClick: (e) => {
            if (!e.defaultPrevented) onSelect?.(c.id);
          },
          children: c.label
        }
      ),
      !isLast && /* @__PURE__ */ jsx("span", { className: "fos-breadcrumbs__sep", "aria-hidden": "true", children: separator })
    ] }, c.id);
  }) }) });
}
var uid4 = 0;
var SearchInput = React22.forwardRef(function SearchInput2({ label, value, onValueChange, icon, onSubmitSearch, className = "", id, onKeyDown, ...rest }, ref) {
  const reactId = React22.useId?.() ?? `fos-search-${++uid4}`;
  const inputId = id ?? reactId;
  return /* @__PURE__ */ jsxs("div", { className: `fos-search ${className}`.trim(), role: "search", children: [
    /* @__PURE__ */ jsx("label", { className: "fos-search__label", htmlFor: inputId, children: label }),
    icon && /* @__PURE__ */ jsx("span", { className: "fos-search__icon", "aria-hidden": "true", children: icon }),
    /* @__PURE__ */ jsx(
      "input",
      {
        ref,
        id: inputId,
        type: "search",
        className: "fos-search__input",
        value,
        onChange: (e) => onValueChange(e.target.value),
        onKeyDown: (e) => {
          onKeyDown?.(e);
          if (e.key === "Enter" && !e.defaultPrevented) onSubmitSearch?.(value);
        },
        ...rest
      }
    )
  ] });
});
var uid5 = 0;
var RoleSwitcher = React22.forwardRef(function RoleSwitcher2({ options, value, onRoleChange, label, className = "", id, ...rest }, ref) {
  const reactId = React22.useId?.() ?? `fos-role-${++uid5}`;
  const selectId = id ?? reactId;
  return /* @__PURE__ */ jsxs("div", { className: `fos-roleswitcher ${className}`.trim(), children: [
    /* @__PURE__ */ jsx("label", { className: "fos-roleswitcher__label", htmlFor: selectId, children: label }),
    /* @__PURE__ */ jsx(
      "select",
      {
        ref,
        id: selectId,
        className: "fos-roleswitcher__select",
        value,
        onChange: (e) => onRoleChange(e.target.value),
        ...rest,
        children: options.map((o) => /* @__PURE__ */ jsx("option", { value: o.id, children: o.label }, o.id))
      }
    )
  ] });
});
function AppShell({
  navItems,
  activeNavId,
  role,
  navAriaLabel,
  onNavSelect,
  brand,
  topbar,
  sidebarOpen,
  onSidebarOpenChange,
  menuButtonLabel,
  children,
  className = "",
  ...rest
}) {
  const isControlled = sidebarOpen !== void 0;
  const [internalOpen, setInternalOpen] = React22.useState(false);
  const open = isControlled ? sidebarOpen : internalOpen;
  const setOpen = React22.useCallback(
    (next) => {
      if (!isControlled) setInternalOpen(next);
      onSidebarOpenChange?.(next);
    },
    [isControlled, onSidebarOpenChange]
  );
  React22.useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setOpen]);
  return /* @__PURE__ */ jsxs(
    "div",
    {
      className: `fos-appshell${open ? " fos-appshell--drawer-open" : ""} ${className}`.trim(),
      ...rest,
      children: [
        /* @__PURE__ */ jsxs("header", { className: "fos-appshell__topbar", role: "banner", children: [
          /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              className: "fos-appshell__menu-btn",
              "aria-label": menuButtonLabel,
              "aria-expanded": open,
              onClick: () => setOpen(!open),
              children: /* @__PURE__ */ jsx("span", { "aria-hidden": "true", children: "\u2630" })
            }
          ),
          brand && /* @__PURE__ */ jsx("div", { className: "fos-appshell__brand", children: brand }),
          /* @__PURE__ */ jsx("div", { className: "fos-appshell__topbar-content", children: topbar })
        ] }),
        /* @__PURE__ */ jsx("aside", { className: "fos-appshell__sidebar", "data-open": open || void 0, children: /* @__PURE__ */ jsx(
          SidebarNav,
          {
            items: navItems,
            activeId: activeNavId,
            role,
            ariaLabel: navAriaLabel,
            onSelect: (id) => {
              onNavSelect?.(id);
              setOpen(false);
            }
          }
        ) }),
        /* @__PURE__ */ jsx(
          "div",
          {
            className: "fos-appshell__overlay",
            hidden: !open,
            onClick: () => setOpen(false),
            "aria-hidden": "true"
          }
        ),
        /* @__PURE__ */ jsx("main", { className: "fos-appshell__main", role: "main", children })
      ]
    }
  );
}
var STATE_CLASS = {
  pending: "fos-loopstep--pending",
  active: "fos-loopstep--active",
  done: "fos-loopstep--done",
  blocked: "fos-loopstep--blocked"
};
function LoopStepper({ steps, ariaLabel, className = "", ...rest }) {
  return /* @__PURE__ */ jsx("ol", { className: `fos-loop ${className}`.trim(), "aria-label": ariaLabel, ...rest, children: steps.map((step, i) => {
    const state = step.state ?? "pending";
    return /* @__PURE__ */ jsxs(
      "li",
      {
        className: `fos-loopstep ${STATE_CLASS[state]}`,
        "aria-current": state === "active" ? "step" : void 0,
        children: [
          /* @__PURE__ */ jsx("span", { className: "fos-loopstep__marker", "aria-hidden": "true", children: state === "done" ? "\u2713" : state === "blocked" ? "!" : i + 1 }),
          /* @__PURE__ */ jsx("span", { className: "fos-loopstep__label", children: step.label })
        ]
      },
      step.id
    );
  }) });
}
var TONE_CLASS = {
  neutral: "fos-phase--neutral",
  info: "fos-phase--info",
  ok: "fos-phase--ok",
  warning: "fos-phase--warning",
  danger: "fos-phase--danger"
};
function PhaseCard({
  title,
  tone = "neutral",
  status,
  meta,
  progress,
  progressLabel,
  className = "",
  ...rest
}) {
  return /* @__PURE__ */ jsxs("div", { className: `fos-phase ${TONE_CLASS[tone]} ${className}`.trim(), ...rest, children: [
    /* @__PURE__ */ jsxs("div", { className: "fos-phase__head", children: [
      /* @__PURE__ */ jsx("span", { className: "fos-phase__dot", "aria-hidden": "true" }),
      /* @__PURE__ */ jsx("span", { className: "fos-phase__title", children: title }),
      status != null && /* @__PURE__ */ jsx("span", { className: "fos-phase__status", children: status })
    ] }),
    meta != null && meta.length > 0 && /* @__PURE__ */ jsx("dl", { className: "fos-phase__meta", children: meta.map((row, i) => /* @__PURE__ */ jsxs("div", { className: "fos-phase__row", children: [
      /* @__PURE__ */ jsx("dt", { children: row.label }),
      /* @__PURE__ */ jsx("dd", { children: row.value })
    ] }, i)) }),
    progress != null && /* @__PURE__ */ jsx("div", { className: "fos-phase__progress", children: /* @__PURE__ */ jsx(Progress, { value: progress, label: progressLabel }) })
  ] });
}
var STATUS_CLASS = {
  draft: "fos-pill--draft",
  scheduled: "fos-pill--scheduled",
  active: "fos-pill--active",
  done: "fos-pill--done",
  warning: "fos-pill--warning",
  blocked: "fos-pill--blocked"
};
function StatusPill({ status, dot = true, children, className = "", ...rest }) {
  return /* @__PURE__ */ jsxs("span", { className: `fos-pill ${STATUS_CLASS[status]} ${className}`.trim(), ...rest, children: [
    dot && /* @__PURE__ */ jsx("span", { className: "fos-pill__dot", "aria-hidden": "true" }),
    children
  ] });
}
var STATUS_CLASS2 = {
  healthy: "fos-palm--healthy",
  watch: "fos-palm--watch",
  sick: "fos-palm--sick",
  dead: "fos-palm--dead",
  removed: "fos-palm--removed",
  male: "fos-palm--male"
};
function PalmCell({
  status,
  ariaLabel,
  glyph,
  selected = false,
  className = "",
  type = "button",
  ...rest
}) {
  return /* @__PURE__ */ jsx(
    "button",
    {
      type,
      className: `fos-palm ${STATUS_CLASS2[status]}${selected ? " fos-palm--selected" : ""} ${className}`.trim(),
      "aria-label": ariaLabel,
      "aria-pressed": selected || void 0,
      ...rest,
      children: glyph != null && /* @__PURE__ */ jsx("span", { "aria-hidden": "true", children: glyph })
    }
  );
}
function PalmGrid({ lines, ariaLabel, onCellActivate, className = "", ...rest }) {
  return /* @__PURE__ */ jsx("div", { className: `fos-palmgrid ${className}`.trim(), role: "group", "aria-label": ariaLabel, ...rest, children: /* @__PURE__ */ jsx("div", { className: "fos-palmgrid__scroll", children: lines.map((line) => /* @__PURE__ */ jsxs("div", { className: "fos-palmgrid__line", children: [
    /* @__PURE__ */ jsx("span", { className: "fos-palmgrid__line-label", children: line.label }),
    /* @__PURE__ */ jsx("div", { className: "fos-palmgrid__cells", children: line.cells.map((cell) => /* @__PURE__ */ jsx(
      PalmCell,
      {
        status: cell.status,
        ariaLabel: cell.ariaLabel,
        glyph: cell.glyph,
        selected: cell.selected,
        onClick: () => onCellActivate?.(cell.id, line.id)
      },
      cell.id
    )) })
  ] }, line.id)) }) });
}
var KIND_CLASS = {
  operation: "fos-tl--operation",
  issue: "fos-tl--issue",
  inspection: "fos-tl--inspection",
  expense: "fos-tl--expense",
  photo: "fos-tl--photo"
};
function FileTimeline({ events, ariaLabel, className = "", ...rest }) {
  return /* @__PURE__ */ jsx("ol", { className: `fos-tl ${className}`.trim(), "aria-label": ariaLabel, ...rest, children: events.map((ev) => /* @__PURE__ */ jsxs("li", { className: `fos-tl__item ${KIND_CLASS[ev.kind]}`, children: [
    /* @__PURE__ */ jsx("span", { className: "fos-tl__marker", "aria-hidden": "true", children: ev.glyph }),
    /* @__PURE__ */ jsxs("div", { className: "fos-tl__body", children: [
      /* @__PURE__ */ jsxs("div", { className: "fos-tl__head", children: [
        /* @__PURE__ */ jsx("span", { className: "fos-tl__title", children: ev.title }),
        /* @__PURE__ */ jsx("time", { className: "fos-tl__time", children: ev.time })
      ] }),
      ev.description != null && /* @__PURE__ */ jsx("div", { className: "fos-tl__desc", children: ev.description })
    ] })
  ] }, ev.id)) });
}
var STATE_CLASS2 = {
  requested: "fos-approval--requested",
  pending: "fos-approval--pending",
  approved: "fos-approval--approved",
  rejected: "fos-approval--rejected"
};
var STATE_GLYPH = {
  requested: "\u2022",
  pending: "\u2026",
  approved: "\u2713",
  rejected: "\u2715"
};
function ApprovalChain({ steps, ariaLabel, className = "", ...rest }) {
  return /* @__PURE__ */ jsx("ol", { className: `fos-approval ${className}`.trim(), "aria-label": ariaLabel, ...rest, children: steps.map((step) => /* @__PURE__ */ jsxs(
    "li",
    {
      className: `fos-approval__step ${STATE_CLASS2[step.state]}`,
      "aria-current": step.state === "pending" ? "step" : void 0,
      children: [
        /* @__PURE__ */ jsx("span", { className: "fos-approval__marker", "aria-hidden": "true", children: STATE_GLYPH[step.state] }),
        /* @__PURE__ */ jsxs("div", { className: "fos-approval__body", children: [
          /* @__PURE__ */ jsx("span", { className: "fos-approval__actor", children: step.actor }),
          step.note != null && /* @__PURE__ */ jsx("span", { className: "fos-approval__note", children: step.note })
        ] })
      ]
    },
    step.id
  )) });
}

export { Alert, AppShell, ApprovalChain, Avatar, Breadcrumbs, Button, Card, Checkbox, Combobox, ConfirmDialog, DataTable, DateField, DescriptionList, Dialog, Drawer, EmptyState, Field, FieldError, FileTimeline, FormRow, Help, IconButton, Input, KpiCard, Label, LoopStepper, Modal, NavItem, NumberField, Pagination, PalmCell, PalmGrid, PhaseCard, Progress, RadioGroup, RoleSwitcher, SearchInput, Select, Sheet, SidebarNav, Skeleton, Stat, StatusPill, Switch, Tabs, Tag, Textarea, ThemeProvider, Timeline, ToastProvider, Toaster, Tooltip, VerdictBanner, brandVars, tabId, tabPanelId, useTheme, useToast };
