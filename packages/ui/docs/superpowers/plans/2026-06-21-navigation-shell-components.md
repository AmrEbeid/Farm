# Navigation / Shell Components Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the navigation / shell slice of `@farm-os/ui` (spec §4 "Navigation / shell" row): `AppShell` (RTL sidebar + topbar, role-aware), `SidebarNav` + `NavItem`, `Breadcrumbs`, `RoleSwitcher`, and `SearchInput` — each token-pure, RTL-first, a11y-clean (real semantics + `aria-current`), keyboard-navigable, and documented in Storybook. `Tabs` already exists and is **not** re-created here; it is referenced where shell views compose sub-tabs.

**Architecture:** Presentational React components in `src/components/<Name>.tsx`, each exporting a typed props interface that extends the relevant native element. Consumers supply ALL strings, icons, and nav data — the library holds no user-facing copy. Components reference only Tier-2 role tokens + numeric primitives (`--brand`, `--surface`, `--surface-raised`, `--ink`, `--ink-muted`, `--line`, `--focus-ring`, `--neutral-bg/-fg`, `--accent-bg/-fg`, `--shadow-card`, `--control-h`, `--control-pad-x`, `--gap`, `--card-pad`, `--radius-control`, `--radius-card`, `--space-*`, `--text-*`, `--weight-*`, `--z-sticky`, `--z-drawer`, `--dur-*`, `--ease`). `AppShell` lays out a CSS grid (topbar row + sidebar/main columns) using logical properties so the sidebar anchors to the inline-start edge under both `dir="rtl"` and `dir="ltr"`; on mobile the sidebar collapses to a Drawer-style off-canvas panel toggled from the topbar. Role-awareness is pure data: `AppShell`/`SidebarNav` filter the consumer-supplied items by a `role` prop, the library never hardcodes roles.

**Tech Stack:** React 18, TypeScript (`strict`), Storybook 8 (react-vite, CSF3), Vitest + @testing-library/react + @testing-library/user-event + jsdom, jest-axe, plain CSS (custom properties, logical properties).

## Global Constraints
- React `>=18`; TypeScript `strict: true`; no `any` in public API.
- **Components reference only Tier-2 role tokens + numeric scales — zero hardcoded color/hex/rgb/px-color values.** (Enforced by `scripts/token-purity.mjs`; every CSS block added here must pass `npm run tokens:purity`.)
- RTL-first: use logical CSS properties (`margin-inline`, `inset-inline-start`, `padding-inline`, `border-inline-start`) — never physical (`left`/`right`). The sidebar anchors to the inline-start edge.
- Library is **presentational**: no user-facing strings, no i18n inside components. Consumers pass labels/icons; stories and tests use Arabic copy.
- Class prefix `fos-`; BEM-ish `fos-<block>` / `--modifier` / `__element`. `className` passthrough merged with the `` `...`.trim() `` pattern.
- API conventions: `import * as React from "react"`; `function Name(props)`; `forwardRef` when a DOM ref is needed; props extend the native element's props; defaults in destructuring; controlled-first.
- A11y: `SidebarNav` is a `<nav>` + list with `aria-current="page"` on the active `NavItem`; `Breadcrumbs` is a `<nav aria-label>` + ordered list with `aria-current="page"` on the last crumb; `SearchInput` is `role="search"` with an associated label; `RoleSwitcher` is an accessible native `<select>`; visible focus via `--focus-ring`; full keyboard paths.
- Each component ships five artifacts: `src/components/<Name>.tsx`, `<Name>.stories.tsx` (CSF3 Arabic + a `Gallery` story), `<Name>.test.tsx` (render + keyboard/`aria-current` behavior + jest-axe no-violations), a CSS block appended to `src/styles/components.css`, and an export line in `src/index.ts`.
- Commit after every task; end commit bodies with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure
- `src/components/NavItem.tsx` — **create** — single nav row (link/button), `aria-current` when active.
- `src/components/SidebarNav.tsx` — **create** — `<nav>` + list of `NavItem`s; role filtering.
- `src/components/AppShell.tsx` — **create** — grid shell (topbar + sidebar + main); responsive drawer collapse.
- `src/components/Breadcrumbs.tsx` — **create** — `<nav aria-label>` + ordered list.
- `src/components/RoleSwitcher.tsx` — **create** — accessible `<select>` of roles.
- `src/components/SearchInput.tsx` — **create** — `role="search"` labeled input.
- `src/components/SidebarNav.stories.tsx`, `AppShell.stories.tsx`, `Breadcrumbs.stories.tsx`, `RoleSwitcher.stories.tsx`, `SearchInput.stories.tsx` — **create** — CSF3 Arabic + Gallery.
- `src/components/SidebarNav.test.tsx`, `AppShell.test.tsx`, `Breadcrumbs.test.tsx`, `RoleSwitcher.test.tsx`, `SearchInput.test.tsx` — **create** — behavior + axe.
- `src/styles/components.css` — **modify** — append one CSS block per component (token-pure, logical properties).
- `src/index.ts` — **modify** — re-export each component + its types.

---

### Task 1: SidebarNav + NavItem

**Files:**
- Create: `src/components/NavItem.tsx`, `src/components/SidebarNav.tsx`, `src/components/SidebarNav.stories.tsx`, `src/components/SidebarNav.test.tsx`
- Modify: `src/styles/components.css`, `src/index.ts`

**Interfaces:**
```ts
// NavItem.tsx
export interface NavItemData {
  /** Stable key + used as default href fallback. */ id: string;
  /** Visible label (consumer-supplied; library holds no strings). */ label: React.ReactNode;
  /** Optional leading icon (emoji or node). */ icon?: React.ReactNode;
  /** Link target; when omitted the item renders as a <button>. */ href?: string;
  /** Roles allowed to see this item. Omitted = visible to all roles. */ roles?: string[];
}
export interface NavItemProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  item: NavItemData;
  /** Marks the active route → aria-current="page". */ active?: boolean;
  /** Called with the item id on click (for SPA routing). */ onSelect?: (id: string) => void;
}
export const NavItem: React.ForwardRefExoticComponent<NavItemProps & React.RefAttributes<HTMLAnchorElement>>;

// SidebarNav.tsx
export interface SidebarNavProps extends React.HTMLAttributes<HTMLElement> {
  items: NavItemData[];
  /** Currently active item id → that NavItem gets aria-current="page". */ activeId?: string;
  /** Filter items to those visible to this role (matches NavItemData.roles). */ role?: string;
  /** Accessible name for the <nav> landmark. */ ariaLabel: string;
  /** Bubbled up from NavItem clicks. */ onSelect?: (id: string) => void;
}
export function SidebarNav(props: SidebarNavProps): React.JSX.Element;
```

- [ ] **Step 1: Write the failing test**

Create `src/components/SidebarNav.test.tsx`:
```tsx
import { it, expect, describe, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { SidebarNav } from "./SidebarNav";
import type { NavItemData } from "./NavItem";

const items: NavItemData[] = [
  { id: "dashboard", label: "لوحة التحكم", icon: "📊", href: "/" },
  { id: "inventory", label: "المخزون", icon: "📦", href: "/inventory" },
  { id: "settings", label: "الإعدادات", icon: "⚙️", href: "/settings", roles: ["owner"] },
];

describe("SidebarNav", () => {
  it("renders a labeled nav landmark with all items for an unrestricted role", () => {
    render(<SidebarNav items={items} ariaLabel="التنقل الرئيسي" />);
    const nav = screen.getByRole("navigation", { name: "التنقل الرئيسي" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByText("المخزون")).toBeInTheDocument();
    expect(screen.getByText("الإعدادات")).toBeInTheDocument();
  });

  it("marks only the active item with aria-current=page", () => {
    render(<SidebarNav items={items} activeId="inventory" ariaLabel="التنقل" />);
    expect(screen.getByText("المخزون").closest("a")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("لوحة التحكم").closest("a")).not.toHaveAttribute("aria-current");
  });

  it("filters items the role may not see", () => {
    render(<SidebarNav items={items} role="worker" ariaLabel="التنقل" />);
    expect(screen.queryByText("الإعدادات")).not.toBeInTheDocument();
    expect(screen.getByText("المخزون")).toBeInTheDocument();
  });

  it("calls onSelect with the item id and is keyboard reachable", async () => {
    const onSelect = vi.fn();
    render(<SidebarNav items={items} ariaLabel="التنقل" onSelect={onSelect} />);
    await userEvent.tab();
    expect(screen.getByText("لوحة التحكم").closest("a")).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("dashboard");
  });

  it("has no axe violations", async () => {
    const { container } = render(<SidebarNav items={items} activeId="inventory" ariaLabel="التنقل" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run the test to confirm it FAILS**

Run: `npm test -- SidebarNav`
Expected: FAIL (modules `./SidebarNav` / `./NavItem` not found).

- [ ] **Step 3: Implement `src/components/NavItem.tsx`**

```tsx
import * as React from "react";

export interface NavItemData {
  /** Stable key. */ id: string;
  /** Visible label (consumer-supplied). */ label: React.ReactNode;
  /** Optional leading icon (emoji or node). */ icon?: React.ReactNode;
  /** Link target; when omitted the item renders as a <button>. */ href?: string;
  /** Roles allowed to see this item. Omitted = visible to all roles. */ roles?: string[];
}

export interface NavItemProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  /** The nav entry to render. */ item: NavItemData;
  /** Marks the active route → aria-current="page". */ active?: boolean;
  /** Called with the item id on activation (SPA routing). */ onSelect?: (id: string) => void;
}

/** A single sidebar entry. Renders an <a> (preferred for routing) carrying aria-current when active. */
export const NavItem = React.forwardRef<HTMLAnchorElement, NavItemProps>(function NavItem(
  { item, active = false, onSelect, className = "", onClick, ...rest },
  ref
) {
  return (
    <a
      ref={ref}
      href={item.href ?? "#"}
      className={`fos-navitem${active ? " fos-navitem--active" : ""} ${className}`.trim()}
      aria-current={active ? "page" : undefined}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) onSelect?.(item.id);
      }}
      {...rest}
    >
      {item.icon && <span className="fos-navitem__icon" aria-hidden="true">{item.icon}</span>}
      <span className="fos-navitem__label">{item.label}</span>
    </a>
  );
});
```

- [ ] **Step 4: Implement `src/components/SidebarNav.tsx`**

```tsx
import * as React from "react";
import { NavItem, type NavItemData } from "./NavItem";

export interface SidebarNavProps extends React.HTMLAttributes<HTMLElement> {
  /** Nav entries (consumer-supplied). */ items: NavItemData[];
  /** Active item id → that NavItem gets aria-current="page". */ activeId?: string;
  /** Filter items to those visible to this role (matches NavItemData.roles). */ role?: string;
  /** Accessible name for the <nav> landmark. */ ariaLabel: string;
  /** Bubbled up from NavItem clicks. */ onSelect?: (id: string) => void;
}

/** Vertical primary navigation. A <nav> landmark + list; the active item carries aria-current. */
export function SidebarNav({
  items,
  activeId,
  role,
  ariaLabel,
  onSelect,
  className = "",
  ...rest
}: SidebarNavProps) {
  const visible = role
    ? items.filter((it) => !it.roles || it.roles.includes(role))
    : items;
  return (
    <nav className={`fos-sidebarnav ${className}`.trim()} aria-label={ariaLabel} {...rest}>
      <ul className="fos-sidebarnav__list">
        {visible.map((it) => (
          <li key={it.id} className="fos-sidebarnav__item">
            <NavItem item={it} active={it.id === activeId} onSelect={onSelect} />
          </li>
        ))}
      </ul>
    </nav>
  );
}
```

- [ ] **Step 5: Append the CSS block to `src/styles/components.css`**

```css
/* ---- SidebarNav / NavItem ---- */
.fos-sidebarnav { display:block; }
.fos-sidebarnav__list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--space-1); }
.fos-navitem { display:flex; align-items:center; gap:var(--space-2); padding:9px var(--space-3); border-radius:var(--radius-control);
  font-size:var(--text-sm); font-weight:var(--weight-semibold); color:var(--ink-muted); text-decoration:none;
  transition:background var(--dur-fast) var(--ease), color var(--dur-fast); }
.fos-navitem:hover { background:var(--surface-sunken); color:var(--ink); }
.fos-navitem:focus-visible { outline:2px solid var(--focus-ring); outline-offset:2px; }
.fos-navitem--active { background:color-mix(in srgb, var(--brand) 14%, var(--surface)); color:var(--brand-hover); font-weight:var(--weight-bold); }
.fos-navitem__icon { width:20px; display:inline-grid; place-items:center; font-size:15px; flex:none; }
.fos-navitem__label { flex:1 1 auto; }
```

- [ ] **Step 6: Export from `src/index.ts`**

Add:
```ts
export { NavItem } from "./components/NavItem";
export type { NavItemProps, NavItemData } from "./components/NavItem";
export { SidebarNav } from "./components/SidebarNav";
export type { SidebarNavProps } from "./components/SidebarNav";
```

- [ ] **Step 7: Run the test to confirm it PASSES**

Run: `npm test -- SidebarNav`
Expected: 5 passed. Then `npm run tokens:purity` → `✓ token-purity: clean`.

- [ ] **Step 8: Write the story**

Create `src/components/SidebarNav.stories.tsx`:
```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { SidebarNav } from "./SidebarNav";
import type { NavItemData } from "./NavItem";

const items: NavItemData[] = [
  { id: "dashboard", label: "لوحة التحكم", icon: "📊", href: "/" },
  { id: "palms", label: "النخيل", icon: "🌴", href: "/palms" },
  { id: "inventory", label: "المخزون", icon: "📦", href: "/inventory" },
  { id: "accounting", label: "المحاسبة", icon: "💰", href: "/accounting", roles: ["owner", "accountant"] },
  { id: "settings", label: "الإعدادات", icon: "⚙️", href: "/settings", roles: ["owner"] },
];

const meta: Meta<typeof SidebarNav> = {
  title: "Navigation/SidebarNav",
  component: SidebarNav,
  args: { items, activeId: "palms", ariaLabel: "التنقل الرئيسي" },
  argTypes: { role: { control: "inline-radio", options: [undefined, "owner", "accountant", "worker"] } },
};
export default meta;
type S = StoryObj<typeof SidebarNav>;

export const Default: S = {};
export const OwnerRole: S = { args: { role: "owner" } };
export const WorkerRole: S = { args: { role: "worker" } };
export const Gallery: S = {
  render: () => (
    <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
      <div style={{ width: 220 }}><SidebarNav items={items} activeId="dashboard" ariaLabel="مالك" role="owner" /></div>
      <div style={{ width: 220 }}><SidebarNav items={items} activeId="palms" ariaLabel="عامل" role="worker" /></div>
    </div>
  ),
};
```

- [ ] **Step 9: Commit**

```bash
git add src/components/NavItem.tsx src/components/SidebarNav.tsx src/components/SidebarNav.stories.tsx src/components/SidebarNav.test.tsx src/styles/components.css src/index.ts
git commit -m "$(cat <<'EOF'
feat(nav): SidebarNav + NavItem (role-filtered, aria-current, keyboard)

<nav> landmark + list with aria-current="page" on the active NavItem;
role prop filters consumer-supplied items; token-pure CSS, RTL logical
properties; render + keyboard + axe tests; CSF3 Arabic story.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Breadcrumbs

**Files:**
- Create: `src/components/Breadcrumbs.tsx`, `src/components/Breadcrumbs.stories.tsx`, `src/components/Breadcrumbs.test.tsx`
- Modify: `src/styles/components.css`, `src/index.ts`

**Interfaces:**
```ts
export interface Crumb {
  /** Stable key. */ id: string;
  /** Visible label (consumer-supplied). */ label: React.ReactNode;
  /** Link target; omit on the current page (rendered as plain text). */ href?: string;
}
export interface BreadcrumbsProps extends React.HTMLAttributes<HTMLElement> {
  items: Crumb[];
  /** Accessible name for the breadcrumb <nav>. */ ariaLabel: string;
  /** Separator between crumbs (decorative). Default "/". */ separator?: React.ReactNode;
  /** Bubbled up from crumb link clicks. */ onSelect?: (id: string) => void;
}
export function Breadcrumbs(props: BreadcrumbsProps): React.JSX.Element;
```

- [ ] **Step 1: Write the failing test**

Create `src/components/Breadcrumbs.test.tsx`:
```tsx
import { it, expect, describe, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { Breadcrumbs, type Crumb } from "./Breadcrumbs";

const items: Crumb[] = [
  { id: "home", label: "الرئيسية", href: "/" },
  { id: "palms", label: "النخيل", href: "/palms" },
  { id: "p-12", label: "نخلة ١٢" },
];

describe("Breadcrumbs", () => {
  it("renders a labeled nav with an ordered list", () => {
    const { container } = render(<Breadcrumbs items={items} ariaLabel="مسار التنقل" />);
    expect(screen.getByRole("navigation", { name: "مسار التنقل" })).toBeInTheDocument();
    expect(container.querySelector("ol")).toBeInTheDocument();
  });

  it("marks the last crumb as the current page and renders it as text (no link)", () => {
    render(<Breadcrumbs items={items} ariaLabel="مسار" />);
    const current = screen.getByText("نخلة ١٢");
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current.closest("a")).toBeNull();
    expect(screen.getByText("الرئيسية").closest("a")).toHaveAttribute("href", "/");
  });

  it("calls onSelect when a linked crumb is activated", async () => {
    const onSelect = vi.fn();
    render(<Breadcrumbs items={items} ariaLabel="مسار" onSelect={onSelect} />);
    await userEvent.click(screen.getByText("النخيل"));
    expect(onSelect).toHaveBeenCalledWith("palms");
  });

  it("has no axe violations", async () => {
    const { container } = render(<Breadcrumbs items={items} ariaLabel="مسار" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run the test to confirm it FAILS**

Run: `npm test -- Breadcrumbs`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/components/Breadcrumbs.tsx`**

```tsx
import * as React from "react";

export interface Crumb {
  /** Stable key. */ id: string;
  /** Visible label (consumer-supplied). */ label: React.ReactNode;
  /** Link target; omit on the current page (rendered as plain text). */ href?: string;
}

export interface BreadcrumbsProps extends React.HTMLAttributes<HTMLElement> {
  /** Ordered trail; the last item is treated as the current page. */ items: Crumb[];
  /** Accessible name for the breadcrumb <nav>. */ ariaLabel: string;
  /** Separator between crumbs (decorative). */ separator?: React.ReactNode;
  /** Bubbled up from crumb link clicks. */ onSelect?: (id: string) => void;
}

/** Breadcrumb trail. <nav aria-label> + ordered list; the last crumb is aria-current="page" text. */
export function Breadcrumbs({
  items,
  ariaLabel,
  separator = "/",
  onSelect,
  className = "",
  ...rest
}: BreadcrumbsProps) {
  return (
    <nav className={`fos-breadcrumbs ${className}`.trim()} aria-label={ariaLabel} {...rest}>
      <ol className="fos-breadcrumbs__list">
        {items.map((c, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={c.id} className="fos-breadcrumbs__item">
              {isLast || !c.href ? (
                <span className="fos-breadcrumbs__current" aria-current={isLast ? "page" : undefined}>
                  {c.label}
                </span>
              ) : (
                <a
                  className="fos-breadcrumbs__link"
                  href={c.href}
                  onClick={(e) => {
                    if (!e.defaultPrevented) onSelect?.(c.id);
                  }}
                >
                  {c.label}
                </a>
              )}
              {!isLast && (
                <span className="fos-breadcrumbs__sep" aria-hidden="true">{separator}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
```

- [ ] **Step 4: Append the CSS block to `src/styles/components.css`**

```css
/* ---- Breadcrumbs ---- */
.fos-breadcrumbs__list { list-style:none; margin:0; padding:0; display:flex; flex-wrap:wrap; align-items:center; gap:var(--space-2); }
.fos-breadcrumbs__item { display:inline-flex; align-items:center; gap:var(--space-2); font-size:var(--text-xs); }
.fos-breadcrumbs__link { color:var(--ink-muted); text-decoration:none; font-weight:var(--weight-semibold); }
.fos-breadcrumbs__link:hover { color:var(--brand-hover); text-decoration:underline; }
.fos-breadcrumbs__link:focus-visible { outline:2px solid var(--focus-ring); outline-offset:2px; border-radius:var(--radius-control); }
.fos-breadcrumbs__current { color:var(--ink); font-weight:var(--weight-bold); }
.fos-breadcrumbs__sep { color:var(--ink-muted); }
```

- [ ] **Step 5: Export from `src/index.ts`**

Add:
```ts
export { Breadcrumbs } from "./components/Breadcrumbs";
export type { BreadcrumbsProps, Crumb } from "./components/Breadcrumbs";
```

- [ ] **Step 6: Run the test to confirm it PASSES**

Run: `npm test -- Breadcrumbs`
Expected: 4 passed. Then `npm run tokens:purity` → clean.

- [ ] **Step 7: Write the story**

Create `src/components/Breadcrumbs.stories.tsx`:
```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { Breadcrumbs, type Crumb } from "./Breadcrumbs";

const items: Crumb[] = [
  { id: "home", label: "الرئيسية", href: "/" },
  { id: "palms", label: "النخيل", href: "/palms" },
  { id: "p-12", label: "نخلة ١٢" },
];

const meta: Meta<typeof Breadcrumbs> = {
  title: "Navigation/Breadcrumbs",
  component: Breadcrumbs,
  args: { items, ariaLabel: "مسار التنقل" },
};
export default meta;
type S = StoryObj<typeof Breadcrumbs>;

export const Default: S = {};
export const TwoLevels: S = { args: { items: items.slice(0, 2).concat({ id: "x", label: "المخزون" }) } };
export const CustomSeparator: S = { args: { separator: "‹" } };
export const Gallery: S = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Breadcrumbs items={items} ariaLabel="مسار ١" />
      <Breadcrumbs items={items} ariaLabel="مسار ٢" separator="←" />
    </div>
  ),
};
```

- [ ] **Step 8: Commit**

```bash
git add src/components/Breadcrumbs.tsx src/components/Breadcrumbs.stories.tsx src/components/Breadcrumbs.test.tsx src/styles/components.css src/index.ts
git commit -m "$(cat <<'EOF'
feat(nav): Breadcrumbs (nav landmark, ordered list, aria-current)

<nav aria-label> + <ol>; the last crumb is plain text with
aria-current="page"; linked crumbs bubble onSelect. Token-pure CSS,
RTL logical layout; render + onSelect + axe tests; CSF3 Arabic story.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: SearchInput

**Files:**
- Create: `src/components/SearchInput.tsx`, `src/components/SearchInput.stories.tsx`, `src/components/SearchInput.test.tsx`
- Modify: `src/styles/components.css`, `src/index.ts`

**Interfaces:**
```ts
export interface SearchInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  /** Accessible label for the field (consumer-supplied; visually hidden). */ label: string;
  /** Controlled value. */ value: string;
  /** Change handler (controlled-first). */ onValueChange: (value: string) => void;
  /** Leading icon (decorative). */ icon?: React.ReactNode;
  /** Fired on Enter with the current value. */ onSubmitSearch?: (value: string) => void;
}
export const SearchInput: React.ForwardRefExoticComponent<
  SearchInputProps & React.RefAttributes<HTMLInputElement>
>;
```

- [ ] **Step 1: Write the failing test**

Create `src/components/SearchInput.test.tsx`:
```tsx
import { it, expect, describe, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { SearchInput } from "./SearchInput";

describe("SearchInput", () => {
  it("exposes a search role and an accessible label", () => {
    render(<SearchInput label="بحث في المزرعة" value="" onValueChange={() => {}} />);
    expect(screen.getByRole("search")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "بحث في المزرعة" })).toBeInTheDocument();
  });

  it("is controlled — calls onValueChange on input", async () => {
    const onValueChange = vi.fn();
    render(<SearchInput label="بحث" value="" onValueChange={onValueChange} />);
    await userEvent.type(screen.getByRole("searchbox"), "نخ");
    expect(onValueChange).toHaveBeenCalled();
    expect(onValueChange).toHaveBeenLastCalledWith("خ");
  });

  it("fires onSubmitSearch with the value on Enter", async () => {
    const onSubmitSearch = vi.fn();
    render(<SearchInput label="بحث" value="نخيل" onValueChange={() => {}} onSubmitSearch={onSubmitSearch} />);
    const box = screen.getByRole("searchbox");
    box.focus();
    await userEvent.keyboard("{Enter}");
    expect(onSubmitSearch).toHaveBeenCalledWith("نخيل");
  });

  it("has no axe violations", async () => {
    const { container } = render(<SearchInput label="بحث" value="" onValueChange={() => {}} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run the test to confirm it FAILS**

Run: `npm test -- SearchInput`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/components/SearchInput.tsx`**

```tsx
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
```

> Note: `.fos-search__label` is visually hidden in CSS (Step 4) but stays in the a11y tree, so axe and screen readers see the name while the field reads as icon-only.

- [ ] **Step 4: Append the CSS block to `src/styles/components.css`**

```css
/* ---- SearchInput ---- */
.fos-search { display:inline-flex; align-items:center; gap:var(--space-2); position:relative;
  border:1px solid var(--line); border-radius:var(--radius-control); background:var(--surface);
  padding-inline:var(--control-pad-x); min-height:var(--control-h); }
.fos-search:focus-within { outline:2px solid var(--focus-ring); outline-offset:1px; border-color:var(--brand); }
.fos-search__label { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; border:0; }
.fos-search__icon { color:var(--ink-muted); font-size:15px; flex:none; }
.fos-search__input { flex:1 1 auto; border:none; outline:none; background:transparent; color:var(--ink);
  font-family:inherit; font-size:var(--text-sm); min-width:0; padding-block:7px; }
.fos-search__input::placeholder { color:var(--ink-muted); }
```

- [ ] **Step 5: Export from `src/index.ts`**

Add:
```ts
export { SearchInput } from "./components/SearchInput";
export type { SearchInputProps } from "./components/SearchInput";
```

- [ ] **Step 6: Run the test to confirm it PASSES**

Run: `npm test -- SearchInput`
Expected: 4 passed. Then `npm run tokens:purity` → clean.

- [ ] **Step 7: Write the story**

Create `src/components/SearchInput.stories.tsx`:
```tsx
import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";
import { SearchInput } from "./SearchInput";

const meta: Meta<typeof SearchInput> = {
  title: "Navigation/SearchInput",
  component: SearchInput,
  args: { label: "بحث في المزرعة", icon: "🔍", placeholder: "ابحث عن نخلة، صنف، أو طلب…" },
};
export default meta;
type S = StoryObj<typeof SearchInput>;

function Controlled(props: React.ComponentProps<typeof SearchInput>) {
  const [v, setV] = React.useState(props.value ?? "");
  return <SearchInput {...props} value={v} onValueChange={setV} />;
}

export const Default: S = { render: (args) => <Controlled {...args} /> };
export const Prefilled: S = { render: (args) => <Controlled {...args} value="نخيل المجدول" /> };
export const NoIcon: S = { render: (args) => <Controlled {...args} icon={undefined} /> };
export const Gallery: S = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 360 }}>
      <Controlled label="بحث" icon="🔍" placeholder="بحث سريع" value="" onValueChange={() => {}} />
      <Controlled label="بحث المخزون" icon="📦" placeholder="ابحث في المخزون" value="سماد" onValueChange={() => {}} />
    </div>
  ),
};
```

- [ ] **Step 8: Commit**

```bash
git add src/components/SearchInput.tsx src/components/SearchInput.stories.tsx src/components/SearchInput.test.tsx src/styles/components.css src/index.ts
git commit -m "$(cat <<'EOF'
feat(nav): SearchInput (role=search, labeled input, Enter-to-submit)

role="search" wrapper + visually-hidden <label> bound to a controlled
<input type="search">; Enter fires onSubmitSearch. Token-pure CSS with
logical padding; controlled + keyboard + axe tests; CSF3 Arabic story.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: RoleSwitcher

**Files:**
- Create: `src/components/RoleSwitcher.tsx`, `src/components/RoleSwitcher.stories.tsx`, `src/components/RoleSwitcher.test.tsx`
- Modify: `src/styles/components.css`, `src/index.ts`

**Interfaces:**
```ts
export interface RoleOption {
  /** Role key (e.g. "owner"). */ id: string;
  /** Visible label (consumer-supplied). */ label: React.ReactNode;
}
export interface RoleSwitcherProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange"> {
  options: RoleOption[];
  /** Controlled active role id. */ value: string;
  /** Called with the newly selected role id. */ onRoleChange: (id: string) => void;
  /** Accessible label for the select (consumer-supplied; visually hidden). */ label: string;
}
export const RoleSwitcher: React.ForwardRefExoticComponent<
  RoleSwitcherProps & React.RefAttributes<HTMLSelectElement>
>;
```

- [ ] **Step 1: Write the failing test**

Create `src/components/RoleSwitcher.test.tsx`:
```tsx
import { it, expect, describe, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { RoleSwitcher, type RoleOption } from "./RoleSwitcher";

const options: RoleOption[] = [
  { id: "owner", label: "المالك" },
  { id: "accountant", label: "المحاسب" },
  { id: "worker", label: "العامل" },
];

describe("RoleSwitcher", () => {
  it("renders an accessible, labeled combobox reflecting the controlled value", () => {
    render(<RoleSwitcher options={options} value="accountant" onRoleChange={() => {}} label="تبديل الدور" />);
    const select = screen.getByRole("combobox", { name: "تبديل الدور" }) as HTMLSelectElement;
    expect(select.value).toBe("accountant");
  });

  it("calls onRoleChange with the chosen role id", async () => {
    const onRoleChange = vi.fn();
    render(<RoleSwitcher options={options} value="owner" onRoleChange={onRoleChange} label="الدور" />);
    await userEvent.selectOptions(screen.getByRole("combobox"), "worker");
    expect(onRoleChange).toHaveBeenCalledWith("worker");
  });

  it("is keyboard focusable", async () => {
    render(<RoleSwitcher options={options} value="owner" onRoleChange={() => {}} label="الدور" />);
    await userEvent.tab();
    expect(screen.getByRole("combobox")).toHaveFocus();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <RoleSwitcher options={options} value="owner" onRoleChange={() => {}} label="الدور" />
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run the test to confirm it FAILS**

Run: `npm test -- RoleSwitcher`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/components/RoleSwitcher.tsx`**

```tsx
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
```

> Note: native `<option>` children must be strings for real browsers; the Arabic labels in stories/tests are strings, satisfying that. `React.ReactNode` on `RoleOption.label` keeps the type permissive for the common string case.

- [ ] **Step 4: Append the CSS block to `src/styles/components.css`**

```css
/* ---- RoleSwitcher ---- */
.fos-roleswitcher { display:inline-flex; align-items:center; }
.fos-roleswitcher__label { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; border:0; }
.fos-roleswitcher__select { appearance:none; border:1px solid var(--line); border-radius:var(--radius-control);
  background:var(--surface); color:var(--ink); font-family:inherit; font-size:var(--text-sm); font-weight:var(--weight-semibold);
  min-height:var(--control-h); padding-inline:var(--control-pad-x); cursor:pointer; }
.fos-roleswitcher__select:hover { border-color:var(--brand); }
.fos-roleswitcher__select:focus-visible { outline:2px solid var(--focus-ring); outline-offset:1px; border-color:var(--brand); }
```

- [ ] **Step 5: Export from `src/index.ts`**

Add:
```ts
export { RoleSwitcher } from "./components/RoleSwitcher";
export type { RoleSwitcherProps, RoleOption } from "./components/RoleSwitcher";
```

- [ ] **Step 6: Run the test to confirm it PASSES**

Run: `npm test -- RoleSwitcher`
Expected: 4 passed. Then `npm run tokens:purity` → clean.

- [ ] **Step 7: Write the story**

Create `src/components/RoleSwitcher.stories.tsx`:
```tsx
import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";
import { RoleSwitcher, type RoleOption } from "./RoleSwitcher";

const options: RoleOption[] = [
  { id: "owner", label: "المالك" },
  { id: "accountant", label: "المحاسب" },
  { id: "worker", label: "العامل" },
];

const meta: Meta<typeof RoleSwitcher> = {
  title: "Navigation/RoleSwitcher",
  component: RoleSwitcher,
  args: { options, value: "owner", label: "تبديل الدور" },
};
export default meta;
type S = StoryObj<typeof RoleSwitcher>;

function Controlled(props: React.ComponentProps<typeof RoleSwitcher>) {
  const [v, setV] = React.useState(props.value);
  return <RoleSwitcher {...props} value={v} onRoleChange={setV} />;
}

export const Default: S = { render: (args) => <Controlled {...args} /> };
export const AsWorker: S = { render: (args) => <Controlled {...args} value="worker" /> };
export const Gallery: S = {
  render: () => (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
      <Controlled options={options} value="owner" label="دور ١" onRoleChange={() => {}} />
      <Controlled options={options} value="accountant" label="دور ٢" onRoleChange={() => {}} />
    </div>
  ),
};
```

- [ ] **Step 8: Commit**

```bash
git add src/components/RoleSwitcher.tsx src/components/RoleSwitcher.stories.tsx src/components/RoleSwitcher.test.tsx src/styles/components.css src/index.ts
git commit -m "$(cat <<'EOF'
feat(nav): RoleSwitcher (accessible native select of roles)

Controlled native <select> (combobox) bound to a visually-hidden label;
onRoleChange emits the selected role id. Token-pure CSS with logical
padding; controlled + keyboard + axe tests; CSF3 Arabic story.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: AppShell (RTL sidebar + topbar, role-aware, responsive drawer)

**Files:**
- Create: `src/components/AppShell.tsx`, `src/components/AppShell.stories.tsx`, `src/components/AppShell.test.tsx`
- Modify: `src/styles/components.css`, `src/index.ts`

**Interfaces:**
```ts
export interface AppShellProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Nav entries for the sidebar (consumer-supplied; filtered by role). */ navItems: NavItemData[];
  /** Active nav item id → aria-current="page". */ activeNavId?: string;
  /** Current role; filters navItems via NavItemData.roles. */ role?: string;
  /** Accessible name for the sidebar <nav>. */ navAriaLabel: string;
  /** Bubbled up from sidebar item activation. */ onNavSelect?: (id: string) => void;
  /** Brand / logo slot, rendered at the sidebar inline-start of the topbar. */ brand?: React.ReactNode;
  /** Topbar content (search, role switcher, user menu…). */ topbar?: React.ReactNode;
  /** Controlled mobile-drawer open state. Uncontrolled if omitted. */ sidebarOpen?: boolean;
  /** Notified when the user toggles the drawer (hamburger / overlay / Esc). */ onSidebarOpenChange?: (open: boolean) => void;
  /** Accessible label for the hamburger toggle (consumer-supplied). */ menuButtonLabel: string;
  /** Main content. */ children: React.ReactNode;
}
export function AppShell(props: AppShellProps): React.JSX.Element;
```

- [ ] **Step 1: Write the failing test**

Create `src/components/AppShell.test.tsx`:
```tsx
import { it, expect, describe, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { AppShell } from "./AppShell";
import type { NavItemData } from "./NavItem";

const navItems: NavItemData[] = [
  { id: "dashboard", label: "لوحة التحكم", icon: "📊", href: "/" },
  { id: "palms", label: "النخيل", icon: "🌴", href: "/palms" },
  { id: "settings", label: "الإعدادات", icon: "⚙️", href: "/settings", roles: ["owner"] },
];

function shell(extra?: Partial<React.ComponentProps<typeof AppShell>>) {
  return (
    <AppShell
      navItems={navItems}
      activeNavId="palms"
      navAriaLabel="التنقل الرئيسي"
      menuButtonLabel="فتح القائمة"
      brand={<span>مزرعة عبيد</span>}
      topbar={<span>الشريط العلوي</span>}
      {...extra}
    >
      <h1>المحتوى</h1>
    </AppShell>
  );
}

describe("AppShell", () => {
  it("renders banner, sidebar nav, and main landmarks", () => {
    render(shell());
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "التنقل الرئيسي" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("filters sidebar items by role and marks the active one", () => {
    render(shell({ role: "worker" }));
    expect(screen.queryByText("الإعدادات")).not.toBeInTheDocument();
    expect(screen.getByText("النخيل").closest("a")).toHaveAttribute("aria-current", "page");
  });

  it("toggles the mobile drawer via the menu button and reports state", async () => {
    const onSidebarOpenChange = vi.fn();
    render(shell({ onSidebarOpenChange }));
    const btn = screen.getByRole("button", { name: "فتح القائمة" });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(btn);
    expect(onSidebarOpenChange).toHaveBeenCalledWith(true);
    expect(btn).toHaveAttribute("aria-expanded", "true");
  });

  it("closes the drawer on Escape when open", async () => {
    const onSidebarOpenChange = vi.fn();
    render(shell({ sidebarOpen: true, onSidebarOpenChange }));
    await userEvent.keyboard("{Escape}");
    expect(onSidebarOpenChange).toHaveBeenCalledWith(false);
  });

  it("has no axe violations", async () => {
    const { container } = render(shell());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run the test to confirm it FAILS**

Run: `npm test -- AppShell`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/components/AppShell.tsx`**

```tsx
import * as React from "react";
import { SidebarNav } from "./SidebarNav";
import type { NavItemData } from "./NavItem";

export interface AppShellProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Nav entries (consumer-supplied; filtered by role). */ navItems: NavItemData[];
  /** Active nav item id → aria-current="page". */ activeNavId?: string;
  /** Current role; filters navItems via NavItemData.roles. */ role?: string;
  /** Accessible name for the sidebar <nav>. */ navAriaLabel: string;
  /** Bubbled up from sidebar item activation. */ onNavSelect?: (id: string) => void;
  /** Brand / logo slot. */ brand?: React.ReactNode;
  /** Topbar content (search, role switcher, user menu…). */ topbar?: React.ReactNode;
  /** Controlled mobile-drawer open state. Uncontrolled if omitted. */ sidebarOpen?: boolean;
  /** Notified when the drawer toggles (hamburger / overlay / Esc). */ onSidebarOpenChange?: (open: boolean) => void;
  /** Accessible label for the hamburger toggle. */ menuButtonLabel: string;
  /** Main content. */ children: React.ReactNode;
}

/**
 * Application frame: a fixed topbar (banner) + an inline-start sidebar (primary nav) + a main region.
 * RTL-first: the sidebar anchors to the inline-start edge via logical grid columns; under dir="rtl"
 * that is the right edge, under dir="ltr" the left — no code change. On narrow viewports the sidebar
 * collapses to an off-canvas drawer toggled from the topbar hamburger (overlay click / Esc closes it).
 */
export function AppShell({
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
}: AppShellProps) {
  const isControlled = sidebarOpen !== undefined;
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = isControlled ? (sidebarOpen as boolean) : internalOpen;

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalOpen(next);
      onSidebarOpenChange?.(next);
    },
    [isControlled, onSidebarOpenChange]
  );

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  return (
    <div
      className={`fos-appshell${open ? " fos-appshell--drawer-open" : ""} ${className}`.trim()}
      {...rest}
    >
      <header className="fos-appshell__topbar" role="banner">
        <button
          type="button"
          className="fos-appshell__menu-btn"
          aria-label={menuButtonLabel}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span aria-hidden="true">☰</span>
        </button>
        {brand && <div className="fos-appshell__brand">{brand}</div>}
        <div className="fos-appshell__topbar-content">{topbar}</div>
      </header>

      <aside className="fos-appshell__sidebar" data-open={open || undefined}>
        <SidebarNav
          items={navItems}
          activeId={activeNavId}
          role={role}
          ariaLabel={navAriaLabel}
          onSelect={(id) => {
            onNavSelect?.(id);
            setOpen(false); // close drawer after navigating on mobile
          }}
        />
      </aside>

      {/* Overlay only matters at mobile widths (CSS hides it on desktop). */}
      <div
        className="fos-appshell__overlay"
        hidden={!open}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      <main className="fos-appshell__main" role="main">{children}</main>
    </div>
  );
}
```

- [ ] **Step 4: Append the CSS block to `src/styles/components.css`**

Full responsive layout — grid with logical properties; sidebar anchors inline-start; collapses to an off-canvas drawer under `48rem`:
```css
/* ---- AppShell ---- */
.fos-appshell { display:grid; min-height:100vh; background:var(--surface-sunken); color:var(--ink);
  grid-template-columns:240px 1fr; grid-template-rows:auto 1fr;
  grid-template-areas:"topbar topbar" "sidebar main"; }
.fos-appshell__topbar { grid-area:topbar; position:sticky; inset-block-start:0; z-index:var(--z-sticky);
  display:flex; align-items:center; gap:var(--space-3); padding-inline:var(--space-4); padding-block:var(--space-2);
  min-height:var(--control-h); background:var(--surface-raised); border-block-end:1px solid var(--line); box-shadow:var(--shadow-1); }
.fos-appshell__menu-btn { display:none; align-items:center; justify-content:center; min-width:var(--control-h); min-height:var(--control-h);
  border:1px solid var(--line); border-radius:var(--radius-control); background:var(--surface); color:var(--ink); font-size:16px; cursor:pointer; }
.fos-appshell__menu-btn:focus-visible { outline:2px solid var(--focus-ring); outline-offset:2px; }
.fos-appshell__brand { font-weight:var(--weight-extrabold); font-size:var(--text-md); display:flex; align-items:center; gap:var(--space-2); }
.fos-appshell__topbar-content { margin-inline-start:auto; display:flex; align-items:center; gap:var(--space-3); }
.fos-appshell__sidebar { grid-area:sidebar; background:var(--surface-raised); border-inline-end:1px solid var(--line);
  padding:var(--card-pad); overflow-y:auto; }
.fos-appshell__overlay { grid-area:1 / 1 / -1 / -1; background:color-mix(in srgb, var(--ink) 45%, transparent); z-index:var(--z-drawer); }
.fos-appshell__overlay[hidden] { display:none; }
.fos-appshell__main { grid-area:main; padding:var(--space-6); overflow:auto; }

/* Mobile: sidebar becomes an off-canvas drawer on the inline-start edge. */
@media (max-width:48rem) {
  .fos-appshell { grid-template-columns:1fr; grid-template-areas:"topbar" "main"; }
  .fos-appshell__menu-btn { display:inline-flex; }
  .fos-appshell__sidebar { position:fixed; inset-block:0; inset-inline-start:0; inline-size:min(80vw,300px);
    z-index:var(--z-drawer); transform:translateX(-100%); transition:transform var(--dur) var(--ease); }
  .fos-appshell__sidebar[data-open] { transform:translateX(0); }
  /* RTL: the drawer slides in from the inline-start (right) edge. */
  [dir="rtl"] .fos-appshell__sidebar { inset-inline-start:auto; inset-inline-end:0; transform:translateX(100%); }
  [dir="rtl"] .fos-appshell__sidebar[data-open] { transform:translateX(0); }
}
@media (min-width:48.01rem) {
  /* Overlay is a no-op on desktop even if state is "open". */
  .fos-appshell__overlay { display:none; }
}
```

> Note on the transform: at mobile widths the off-canvas slide uses `translateX` with an explicit `[dir="rtl"]` override so the drawer enters from the correct (inline-start) edge in both directions; everything else (anchoring, borders, padding) uses logical properties so the desktop layout needs no per-direction code. `48rem` is a layout breakpoint, not a color, so it passes the token-purity check (which only flags hardcoded colors).

- [ ] **Step 5: Export from `src/index.ts`**

Add:
```ts
export { AppShell } from "./components/AppShell";
export type { AppShellProps } from "./components/AppShell";
```

- [ ] **Step 6: Run the test to confirm it PASSES**

Run: `npm test -- AppShell`
Expected: 5 passed. Then `npm run tokens:purity` → clean.

- [ ] **Step 7: Write the story**

Create `src/components/AppShell.stories.tsx`:
```tsx
import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";
import { AppShell } from "./AppShell";
import type { NavItemData } from "./NavItem";
import { SearchInput } from "./SearchInput";
import { RoleSwitcher } from "./RoleSwitcher";

const navItems: NavItemData[] = [
  { id: "dashboard", label: "لوحة التحكم", icon: "📊", href: "/" },
  { id: "palms", label: "النخيل", icon: "🌴", href: "/palms" },
  { id: "inventory", label: "المخزون", icon: "📦", href: "/inventory" },
  { id: "accounting", label: "المحاسبة", icon: "💰", href: "/accounting", roles: ["owner", "accountant"] },
  { id: "settings", label: "الإعدادات", icon: "⚙️", href: "/settings", roles: ["owner"] },
];

const meta: Meta<typeof AppShell> = {
  title: "Navigation/AppShell",
  component: AppShell,
  parameters: { layout: "fullscreen" },
  argTypes: { role: { control: "inline-radio", options: [undefined, "owner", "accountant", "worker"] } },
  args: {
    navItems,
    activeNavId: "palms",
    navAriaLabel: "التنقل الرئيسي",
    menuButtonLabel: "فتح القائمة",
  },
};
export default meta;
type S = StoryObj<typeof AppShell>;

function Topbar() {
  const [q, setQ] = React.useState("");
  const [role, setRole] = React.useState("owner");
  return (
    <>
      <SearchInput label="بحث" icon="🔍" placeholder="ابحث…" value={q} onValueChange={setQ} />
      <RoleSwitcher
        label="الدور"
        value={role}
        onRoleChange={setRole}
        options={[
          { id: "owner", label: "المالك" },
          { id: "accountant", label: "المحاسب" },
          { id: "worker", label: "العامل" },
        ]}
      />
    </>
  );
}

export const Default: S = {
  render: (args) => (
    <AppShell {...args} brand={<span>🌴 مزرعة عبيد</span>} topbar={<Topbar />}>
      <h1 style={{ marginTop: 0 }}>النخيل</h1>
      <p>محتوى الصفحة هنا. غيّر عرض النافذة لرؤية القائمة الجانبية تنطوي إلى درج.</p>
    </AppShell>
  ),
};

export const WorkerRole: S = {
  args: { role: "worker" },
  render: (args) => (
    <AppShell {...args} brand={<span>🌴 مزرعة عبيد</span>} topbar={<Topbar />}>
      <h1 style={{ marginTop: 0 }}>عرض العامل</h1>
      <p>عناصر المحاسبة والإعدادات مخفية لهذا الدور.</p>
    </AppShell>
  ),
};

export const Gallery: S = {
  render: () => (
    <AppShell
      navItems={navItems}
      activeNavId="inventory"
      role="accountant"
      navAriaLabel="التنقل"
      menuButtonLabel="فتح القائمة"
      brand={<span>🌴 مزرعة عبيد</span>}
      topbar={<Topbar />}
    >
      <h1 style={{ marginTop: 0 }}>المخزون</h1>
    </AppShell>
  ),
};
```

- [ ] **Step 8: Commit**

```bash
git add src/components/AppShell.tsx src/components/AppShell.stories.tsx src/components/AppShell.test.tsx src/styles/components.css src/index.ts
git commit -m "$(cat <<'EOF'
feat(nav): AppShell (RTL grid sidebar + topbar, role-aware, drawer)

banner topbar + inline-start sidebar (SidebarNav) + main region on a CSS
grid with logical properties; role prop filters nav items; below 48rem
the sidebar collapses to an off-canvas drawer (hamburger toggle, overlay
click + Esc to close, controlled/uncontrolled open state). Token-pure
CSS; landmark + role-filter + drawer-toggle + Esc + axe tests; CSF3
Arabic story composing SearchInput + RoleSwitcher.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Slice verification

**Files:** none (verification only)

- [ ] **Step 1: Full gate run**

Run:
```bash
npm run tokens:present && npm run tokens:purity && npm test && npm run typecheck && npm run build && npm run build-storybook
```
Expected: all exit 0. `npm test` includes every new `*.test.tsx` (SidebarNav, Breadcrumbs, SearchInput, RoleSwitcher, AppShell) plus the existing `theme-matrix` suite; `tokens:purity` confirms all five appended CSS blocks are token-pure.

- [ ] **Step 2: Commit any incidental fixes**

```bash
git add -A && git commit -m "chore(nav): navigation/shell slice complete" || echo "nothing to commit"
```

- [ ] **Step 3: Re-sync to Claude Design (manual, needs login)**

Note for the operator (NOT automated — requires `/design-login` in a login-capable session): after this slice merges, re-run the Claude Design sync so the project reflects the expanded catalog (per spec §5/§8):
```bash
node .ds-sync/package-build.mjs --config .design-sync/config.json --node-modules ./node_modules --entry dist/index.js --out ./ds-bundle
# then the design-sync skill's upload step pushes the re-themed bundle to the existing project
```

---

## Self-Review

**Spec coverage — §4 "Navigation / shell" row** (`AppShell · SidebarNav/NavItem · Tabs · Breadcrumbs · RoleSwitcher · SearchInput`):
- `AppShell` (RTL sidebar + topbar, role-aware) → Task 5 ✓ (grid + logical properties; `role` prop filters consumer items; responsive drawer with hamburger/overlay/Esc).
- `SidebarNav` + `NavItem` → Task 1 ✓ (one coupled task; `<nav>` + list + `aria-current="page"` on active item; role filtering).
- `Tabs` → **pre-existing, not re-created** (referenced in Architecture; `src/components/Tabs.tsx` already shipped) ✓.
- `Breadcrumbs` → Task 2 ✓ (`<nav aria-label>` + `<ol>` + `aria-current="page"` on the last crumb).
- `RoleSwitcher` → Task 4 ✓ (accessible native `<select>`/combobox).
- `SearchInput` → Task 3 ✓ (`role="search"` + associated label).
- A11y baseline (spec §4/§6): every component has a render + keyboard/`aria-current` behavior test and a jest-axe **no-violations** test; visible focus via `--focus-ring`; AppShell exposes `banner`/`navigation`/`main` landmarks. Token-purity (§3/§6) is re-checked after each CSS block and in the slice gate (Task 6). Presentational-only (§4 boundaries): no user-facing strings — all labels/icons are consumer props; stories/tests use Arabic.

**Placeholder scan:** no placeholders. Every `.tsx`, `.test.tsx`, `.stories.tsx`, and CSS block is complete, runnable code — including AppShell's full responsive grid layout (logical-property columns/areas) and the off-canvas drawer collapse with its `[dir="rtl"]` transform override. The only non-literal step is the slice gate (Task 6), which runs concrete commands.

**Type consistency:** `NavItemData` is defined once in `NavItem.tsx` and re-used by `SidebarNav` (Task 1) and `AppShell` (Task 5) — both import it, no duplication. Each component's props interface extends the correct native element (`AnchorHTMLAttributes` for NavItem, `HTMLAttributes<HTMLElement>` for SidebarNav/Breadcrumbs, `InputHTMLAttributes` minus `type`/`size` for SearchInput, `SelectHTMLAttributes` minus `value`/`onChange` for RoleSwitcher, `HTMLAttributes<HTMLDivElement>` for AppShell). Controlled-first handlers use distinct, non-colliding names (`onValueChange`, `onRoleChange`, `onSelect`, `onNavSelect`, `onSidebarOpenChange`, `onSubmitSearch`) so they never clash with the native `onChange`/`onSelect` that the extended props also carry. Every component is exported with its types from `src/index.ts`; no `any` in any public signature.
