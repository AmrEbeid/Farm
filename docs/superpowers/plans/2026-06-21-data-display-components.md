# Data Display Components Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the spec §4 "Data display" gap components — Stat, DataTable, Timeline, DescriptionList, Avatar, Tooltip, Pagination, EmptyState, Skeleton — each presentational, controlled-first, 100% token-driven (token-purity gate clean), strictly typed, a11y-clean (axe zero violations), RTL-first, and documented with a CSF3 story (Arabic copy + a Gallery story).

**Architecture:** Each component is a function component (`React.forwardRef` only when a DOM ref is needed) whose props extend the relevant native element props, defaults set in destructuring, `className` merged as `` `fos-x fos-x--${variant} ${className}`.trim() ``. Markup uses BEM-ish `fos-<block>` classes. Styling lives in a per-component block appended to `src/styles/components.css` that references ONLY Tier-2 role tokens (`--brand`, `--surface`, `--ink`, `--line`, `--focus-ring`, status pairs, `--control-h`, `--gap`, `--card-pad`, `--radius-control`, `--radius-card`, `--shadow-card`) + numeric-scale primitives (`--space-*`, `--text-*`, `--weight-*`, `--radius-*`, `--dur-*`, `--ease`, `--z-*`). DataTable is generic (column defs + rows via props, controlled sort state). Skeleton uses a token-driven shimmer built with `color-mix()` over `--neutral-bg`.

**Tech Stack:** React 18, TypeScript (strict), tsup, Storybook 8 (react-vite), Vitest + @testing-library/react + jsdom, @testing-library/user-event, jest-axe, plain CSS (custom properties).

## Global Constraints
- React `>=18`; TypeScript `strict: true`; no `any` in public API.
- **Components reference only Tier-2 role tokens + numeric scales — zero hardcoded color/hex/rgb/hsl values.** Use `color-mix(in srgb, var(--role) N%, …)` over role tokens for tints. (Enforced by `scripts/token-purity.mjs`, which is wired into `build`.)
- RTL-first: use logical CSS properties (`margin-inline`, `inset-inline-start`, `padding-inline`, `text-align: start`) — never physical (`left`/`right`).
- Finance/numeric cells use `font-variant-numeric: tabular-nums`.
- Library is **presentational**: no user-facing strings, no i18n inside components. Stories and tests use Arabic text.
- A11y baseline: real semantics, ARIA roles/labels, full keyboard paths, visible focus via `--focus-ring`. DataTable: proper `<table>`/`<th scope>`, `aria-sort` on sortable headers, keyboard-operable sort. Tooltip: `role="tooltip"`, hover + focus trigger, `Esc` to dismiss. Pagination: `<nav>` + `aria-current`.
- Class prefix `fos-`; controlled-first for any stateful component.
- Each new component delivers: `src/components/<Name>.tsx`, `src/components/<Name>.stories.tsx` (CSF3, Arabic, Gallery story), `src/components/<Name>.test.tsx` (render + key behavior + keyboard where relevant + axe no-violations), a CSS block in `src/styles/components.css`, and a named + type export from `src/index.ts`.
- Commit after every task; end commit bodies with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure
- `src/components/Stat.tsx` · `Stat.stories.tsx` · `Stat.test.tsx` — **create**
- `src/components/DataTable.tsx` · `DataTable.stories.tsx` · `DataTable.test.tsx` — **create**
- `src/components/Timeline.tsx` · `Timeline.stories.tsx` · `Timeline.test.tsx` — **create**
- `src/components/DescriptionList.tsx` · `DescriptionList.stories.tsx` · `DescriptionList.test.tsx` — **create**
- `src/components/Avatar.tsx` · `Avatar.stories.tsx` · `Avatar.test.tsx` — **create**
- `src/components/Tooltip.tsx` · `Tooltip.stories.tsx` · `Tooltip.test.tsx` — **create**
- `src/components/Pagination.tsx` · `Pagination.stories.tsx` · `Pagination.test.tsx` — **create**
- `src/components/EmptyState.tsx` · `EmptyState.stories.tsx` · `EmptyState.test.tsx` — **create**
- `src/components/Skeleton.tsx` · `Skeleton.stories.tsx` · `Skeleton.test.tsx` — **create**
- `src/styles/components.css` — **modify** (append one block per component)
- `src/index.ts` — **modify** (add named + type exports per component)

---

### Task 1: Stat

**Files:**
- Create: `src/components/Stat.tsx`, `src/components/Stat.stories.tsx`, `src/components/Stat.test.tsx`
- Modify: `src/styles/components.css`, `src/index.ts`

**Interfaces:**
- Consumes: role tokens + numeric primitives.
- Produces:
  - `type StatTrend = "up" | "down" | "flat";`
  - `interface StatProps extends React.HTMLAttributes<HTMLDivElement> { label: React.ReactNode; value: React.ReactNode; unit?: React.ReactNode; help?: React.ReactNode; trend?: StatTrend; change?: React.ReactNode; }`
  - `function Stat(props: StatProps)` — semantic block with a tabular-nums value, an optional change line colored by `trend`, optional help caption.

- [ ] **Step 1: Write the failing test**

Create `src/components/Stat.test.tsx`:
```tsx
import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { Stat } from "./Stat";

describe("Stat", () => {
  it("renders label, value and unit", () => {
    render(<Stat label="إجمالي الإنتاج" value="12٬480" unit="كجم" />);
    expect(screen.getByText("إجمالي الإنتاج")).toBeInTheDocument();
    expect(screen.getByText("12٬480")).toBeInTheDocument();
    expect(screen.getByText("كجم")).toBeInTheDocument();
  });
  it("applies the trend modifier to the change line", () => {
    const { container } = render(<Stat label="الإيراد" value="٣٢٪" trend="down" change="-٤٪" />);
    expect(container.querySelector(".fos-stat__change--down")).toBeInTheDocument();
  });
  it("uses tabular-nums on the value", () => {
    const { container } = render(<Stat label="الرصيد" value="٧٫٢" />);
    expect(container.querySelector(".fos-stat__value")).toBeInTheDocument();
  });
  it("has no axe violations", async () => {
    const { container } = render(<Stat label="صافي الربح" value="2.71" unit="م ج.م" change="+٨٪" trend="up" help="مقارنة بالشهر السابق" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run the test (expect FAIL)**

Run: `npm test -- Stat`
Expected: FAIL — module `./Stat` not found.

- [ ] **Step 3: Implement `src/components/Stat.tsx`**

```tsx
import * as React from "react";

export type StatTrend = "up" | "down" | "flat";

export interface StatProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Metric label. */
  label: React.ReactNode;
  /** The main value (use the `unit` slot for the suffix). */
  value: React.ReactNode;
  /** Small unit/suffix shown after the value (e.g. "كجم"). */
  unit?: React.ReactNode;
  /** Optional caption shown under the value. */
  help?: React.ReactNode;
  /** Direction of the change — colors the change line. */
  trend?: StatTrend;
  /** Optional change line (e.g. "+٨٪"); colored by `trend`. */
  change?: React.ReactNode;
}

/** Inline metric: label, large tabular value + unit, optional trend change line and help caption. */
export function Stat({
  label, value, unit, help, trend = "flat", change, className = "", ...rest
}: StatProps) {
  return (
    <div className={`fos-stat ${className}`.trim()} {...rest}>
      <div className="fos-stat__label">{label}</div>
      <div className="fos-stat__value">
        {value}
        {unit != null && <small className="fos-stat__unit">{unit}</small>}
      </div>
      {change != null && (
        <div className={`fos-stat__change fos-stat__change--${trend}`}>{change}</div>
      )}
      {help != null && <div className="fos-stat__help">{help}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Append the CSS block to `src/styles/components.css`**

```css
/* ---- Stat ---- */
.fos-stat { display:flex; flex-direction:column; gap:var(--space-1); }
.fos-stat__label { color:var(--ink-muted); font-size:var(--text-xs); font-weight:var(--weight-semibold); }
.fos-stat__value { font-size:var(--text-2xl); font-weight:var(--weight-extrabold); color:var(--ink); font-variant-numeric:tabular-nums; line-height:1.1; }
.fos-stat__unit { font-size:var(--text-sm); color:var(--ink-muted); font-weight:var(--weight-semibold); margin-inline-start:var(--space-1); }
.fos-stat__change { font-size:var(--text-xs); font-weight:var(--weight-bold); font-variant-numeric:tabular-nums; }
.fos-stat__change--up { color:var(--success-fg); }
.fos-stat__change--down { color:var(--danger-fg); }
.fos-stat__change--flat { color:var(--ink-muted); }
.fos-stat__help { font-size:var(--text-xs); color:var(--ink-muted); }
```

- [ ] **Step 5: Run the test (expect PASS) and purity**

Run: `npm test -- Stat`
Expected: 4 passed.
Run: `npm run tokens:purity`
Expected: `✓ token-purity: clean`.

- [ ] **Step 6: Add the story `src/components/Stat.stories.tsx`**

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { Stat } from "./Stat";

const meta: Meta<typeof Stat> = {
  title: "Data display/Stat",
  component: Stat,
  args: { label: "إجمالي الإنتاج", value: "12٬480", unit: "كجم" },
  argTypes: {
    trend: { control: "inline-radio", options: ["up", "down", "flat"] },
  },
};
export default meta;
type S = StoryObj<typeof Stat>;

export const Default: S = {};
export const Up: S = { args: { label: "صافي الربح", value: "2.71", unit: "م ج.م", trend: "up", change: "+٨٪" } };
export const Down: S = { args: { label: "نسبة الفاقد", value: "٦٫٤", unit: "٪", trend: "down", change: "-٢٪" } };
export const WithHelp: S = { args: { label: "متوسط العائد", value: "١٬٢٠٠", unit: "ج.م/شجرة", help: "آخر ٣٠ يومًا" } };
export const Gallery: S = {
  render: () => (
    <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
      <Stat label="إجمالي الإنتاج" value="12٬480" unit="كجم" />
      <Stat label="صافي الربح" value="2.71" unit="م ج.م" trend="up" change="+٨٪" />
      <Stat label="نسبة الفاقد" value="٦٫٤" unit="٪" trend="down" change="-٢٪" />
      <Stat label="متوسط العائد" value="١٬٢٠٠" unit="ج.م/شجرة" help="آخر ٣٠ يومًا" />
    </div>
  ),
};
```

- [ ] **Step 7: Export from `src/index.ts`**

Add:
```ts
export { Stat } from "./components/Stat";
export type { StatProps, StatTrend } from "./components/Stat";
```

- [ ] **Step 8: Commit**

```bash
git add src/components/Stat.tsx src/components/Stat.stories.tsx src/components/Stat.test.tsx src/styles/components.css src/index.ts
git commit -m "feat(data): add Stat metric component

Token-pure, RTL-first, tabular-nums value with trend-colored change line.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: DataTable

**Files:**
- Create: `src/components/DataTable.tsx`, `src/components/DataTable.stories.tsx`, `src/components/DataTable.test.tsx`
- Modify: `src/styles/components.css`, `src/index.ts`

**Interfaces:**
- Consumes: role tokens + numeric primitives.
- Produces:
  - `type SortDirection = "asc" | "desc";`
  - `interface SortState { columnId: string; direction: SortDirection; }`
  - `interface DataTableColumn<Row> { id: string; header: React.ReactNode; cell: (row: Row) => React.ReactNode; sortable?: boolean; align?: "start" | "center" | "end"; numeric?: boolean; width?: string; }`
  - `interface DataTableProps<Row> extends Omit<React.TableHTMLAttributes<HTMLTableElement>, "children"> { columns: DataTableColumn<Row>[]; rows: Row[]; getRowId: (row: Row) => string; caption?: React.ReactNode; sort?: SortState | null; onSortChange?: (next: SortState) => void; stickyHeader?: boolean; empty?: React.ReactNode; }`
  - `function DataTable<Row>(props: DataTableProps<Row>)` — generic, controlled sort. Sortable headers carry `aria-sort` and a keyboard-operable `<button>` toggling asc⇄desc via `onSortChange`. When `rows` is empty, renders the `empty` slot in a full-width cell.

- [ ] **Step 1: Write the failing test**

Create `src/components/DataTable.test.tsx`:
```tsx
import { it, expect, describe, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { DataTable, type DataTableColumn } from "./DataTable";

interface Row { id: string; name: string; qty: number; }
const rows: Row[] = [
  { id: "a", name: "بلح سكري", qty: 120 },
  { id: "b", name: "بلح مجدول", qty: 80 },
];
const columns: DataTableColumn<Row>[] = [
  { id: "name", header: "الصنف", cell: (r) => r.name, sortable: true },
  { id: "qty", header: "الكمية", cell: (r) => r.qty, sortable: true, numeric: true, align: "end" },
];

describe("DataTable", () => {
  it("renders a table with headers and cells", () => {
    render(<DataTable columns={columns} rows={rows} getRowId={(r) => r.id} caption="مخزون" />);
    expect(screen.getByRole("table", { name: "مخزون" })).toBeInTheDocument();
    expect(screen.getByText("الصنف")).toBeInTheDocument();
    expect(screen.getByText("بلح سكري")).toBeInTheDocument();
  });
  it("marks the active sort column with aria-sort and fires onSortChange on click", async () => {
    const onSortChange = vi.fn();
    render(
      <DataTable columns={columns} rows={rows} getRowId={(r) => r.id}
        sort={{ columnId: "qty", direction: "asc" }} onSortChange={onSortChange} />
    );
    const qtyHeader = screen.getByRole("columnheader", { name: /الكمية/ });
    expect(qtyHeader).toHaveAttribute("aria-sort", "ascending");
    await userEvent.click(screen.getByRole("button", { name: /الكمية/ }));
    expect(onSortChange).toHaveBeenCalledWith({ columnId: "qty", direction: "desc" });
  });
  it("toggles to asc when a different column is activated by keyboard", async () => {
    const onSortChange = vi.fn();
    render(
      <DataTable columns={columns} rows={rows} getRowId={(r) => r.id}
        sort={{ columnId: "qty", direction: "asc" }} onSortChange={onSortChange} />
    );
    const nameBtn = screen.getByRole("button", { name: /الصنف/ });
    nameBtn.focus();
    await userEvent.keyboard("{Enter}");
    expect(onSortChange).toHaveBeenCalledWith({ columnId: "name", direction: "asc" });
  });
  it("renders the empty slot when there are no rows", () => {
    render(<DataTable columns={columns} rows={[]} getRowId={(r) => r.id} empty="لا توجد بيانات" />);
    expect(screen.getByText("لا توجد بيانات")).toBeInTheDocument();
  });
  it("has no axe violations", async () => {
    const { container } = render(
      <DataTable columns={columns} rows={rows} getRowId={(r) => r.id} caption="مخزون"
        sort={{ columnId: "qty", direction: "desc" }} onSortChange={() => {}} />
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run the test (expect FAIL)**

Run: `npm test -- DataTable`
Expected: FAIL — module `./DataTable` not found.

- [ ] **Step 3: Implement `src/components/DataTable.tsx`**

```tsx
import * as React from "react";

export type SortDirection = "asc" | "desc";

export interface SortState {
  /** Active sorted column id. */ columnId: string;
  /** Sort direction. */ direction: SortDirection;
}

export interface DataTableColumn<Row> {
  /** Stable column id (matches `SortState.columnId`). */
  id: string;
  /** Header content. */
  header: React.ReactNode;
  /** Cell renderer for a row. */
  cell: (row: Row) => React.ReactNode;
  /** Whether this column is sortable. */
  sortable?: boolean;
  /** Logical alignment of the cell content. */
  align?: "start" | "center" | "end";
  /** Numeric column — applies tabular-nums + end alignment by default. */
  numeric?: boolean;
  /** Optional fixed width (any CSS length). */
  width?: string;
}

export interface DataTableProps<Row>
  extends Omit<React.TableHTMLAttributes<HTMLTableElement>, "children"> {
  /** Column definitions. */
  columns: DataTableColumn<Row>[];
  /** Row data. */
  rows: Row[];
  /** Stable id per row (used as the React key). */
  getRowId: (row: Row) => string;
  /** Accessible caption / table name. */
  caption?: React.ReactNode;
  /** Controlled sort state (or null for unsorted). */
  sort?: SortState | null;
  /** Called with the next sort state when a sortable header is activated. */
  onSortChange?: (next: SortState) => void;
  /** Sticky header on vertical scroll. */
  stickyHeader?: boolean;
  /** Content shown (spanning all columns) when `rows` is empty. */
  empty?: React.ReactNode;
}

const ARIA_SORT: Record<SortDirection, "ascending" | "descending"> = {
  asc: "ascending",
  desc: "descending",
};

/**
 * Generic, controlled-sort data table. RTL-first, sticky header optional,
 * numeric columns are tabular-nums. Sortable headers are keyboard-operable
 * buttons carrying `aria-sort`.
 */
export function DataTable<Row>({
  columns, rows, getRowId, caption, sort = null, onSortChange,
  stickyHeader = false, empty, className = "", ...rest
}: DataTableProps<Row>) {
  function toggle(columnId: string) {
    if (!onSortChange) return;
    const next: SortState =
      sort && sort.columnId === columnId
        ? { columnId, direction: sort.direction === "asc" ? "desc" : "asc" }
        : { columnId, direction: "asc" };
    onSortChange(next);
  }

  return (
    <div className={`fos-table-wrap${stickyHeader ? " fos-table-wrap--sticky" : ""} ${className}`.trim()}>
      <table className="fos-table" {...rest}>
        {caption != null && <caption className="fos-table__caption">{caption}</caption>}
        <thead className="fos-table__head">
          <tr>
            {columns.map((col) => {
              const active = sort?.columnId === col.id;
              const align = col.align ?? (col.numeric ? "end" : "start");
              return (
                <th
                  key={col.id}
                  scope="col"
                  className={`fos-table__th fos-table__th--${align}`}
                  style={col.width ? { width: col.width } : undefined}
                  aria-sort={col.sortable ? (active ? ARIA_SORT[sort!.direction] : "none") : undefined}
                >
                  {col.sortable ? (
                    <button
                      type="button"
                      className="fos-table__sort"
                      onClick={() => toggle(col.id)}
                    >
                      {col.header}
                      <span className="fos-table__sort-icon" aria-hidden="true">
                        {active ? (sort!.direction === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="fos-table__empty" colSpan={columns.length}>{empty}</td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={getRowId(row)} className="fos-table__row">
                {columns.map((col) => {
                  const align = col.align ?? (col.numeric ? "end" : "start");
                  return (
                    <td
                      key={col.id}
                      className={`fos-table__td fos-table__td--${align}${col.numeric ? " fos-table__td--num" : ""}`}
                    >
                      {col.cell(row)}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Append the CSS block to `src/styles/components.css`**

```css
/* ---- DataTable ---- */
.fos-table-wrap { width:100%; overflow:auto; border:1px solid var(--line); border-radius:var(--radius-card); background:var(--surface); }
.fos-table-wrap--sticky { max-height:420px; }
.fos-table { width:100%; border-collapse:collapse; font-size:var(--text-sm); color:var(--ink); }
.fos-table__caption { text-align:start; padding:var(--space-3) var(--space-4); font-weight:var(--weight-bold); color:var(--ink); }
.fos-table__head { background:var(--surface-sunken); }
.fos-table-wrap--sticky .fos-table__head th { position:sticky; inset-block-start:0; z-index:var(--z-sticky); background:var(--surface-sunken); }
.fos-table__th { text-align:start; font-size:var(--text-xs); font-weight:var(--weight-bold); color:var(--ink-muted); padding:var(--space-2) var(--space-3); border-block-end:1px solid var(--line); white-space:nowrap; }
.fos-table__th--center { text-align:center; }
.fos-table__th--end { text-align:end; }
.fos-table__sort { display:inline-flex; align-items:center; gap:var(--space-1); background:none; border:none; font:inherit; font-weight:var(--weight-bold); color:inherit; cursor:pointer; padding:0; }
.fos-table__sort:focus-visible { outline:2px solid var(--focus-ring); outline-offset:2px; border-radius:var(--radius-control); }
.fos-table__sort-icon { font-size:var(--text-xs); color:var(--ink-muted); }
.fos-table__td { padding:var(--space-2) var(--space-3); border-block-end:1px solid var(--line); text-align:start; }
.fos-table__td--center { text-align:center; }
.fos-table__td--end { text-align:end; }
.fos-table__td--num { font-variant-numeric:tabular-nums; }
.fos-table__row:hover { background:color-mix(in srgb, var(--brand) 6%, var(--surface)); }
.fos-table__empty { padding:var(--space-8) var(--space-4); text-align:center; color:var(--ink-muted); font-size:var(--text-sm); }
```

- [ ] **Step 5: Run the test (expect PASS) and purity**

Run: `npm test -- DataTable`
Expected: 5 passed.
Run: `npm run tokens:purity`
Expected: `✓ token-purity: clean`.

- [ ] **Step 6: Add the story `src/components/DataTable.stories.tsx`**

```tsx
import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { DataTable, type DataTableColumn, type SortState } from "./DataTable";

interface Row { id: string; variety: string; qty: number; price: number; }
const data: Row[] = [
  { id: "1", variety: "بلح سكري", qty: 120, price: 45 },
  { id: "2", variety: "بلح مجدول", qty: 80, price: 70 },
  { id: "3", variety: "بلح زغلول", qty: 200, price: 30 },
];
const columns: DataTableColumn<Row>[] = [
  { id: "variety", header: "الصنف", cell: (r) => r.variety, sortable: true },
  { id: "qty", header: "الكمية (كجم)", cell: (r) => r.qty, sortable: true, numeric: true },
  { id: "price", header: "السعر (ج.م)", cell: (r) => r.price, sortable: true, numeric: true },
];

function sortRows(rows: Row[], sort: SortState | null): Row[] {
  if (!sort) return rows;
  const dir = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[sort.columnId as keyof Row];
    const bv = b[sort.columnId as keyof Row];
    return av < bv ? -dir : av > bv ? dir : 0;
  });
}

const meta: Meta<typeof DataTable<Row>> = {
  title: "Data display/DataTable",
  component: DataTable,
};
export default meta;
type S = StoryObj<typeof DataTable<Row>>;

export const Sortable: S = {
  render: () => {
    const [sort, setSort] = React.useState<SortState | null>({ columnId: "qty", direction: "desc" });
    return (
      <DataTable
        caption="مخزون الأصناف"
        columns={columns}
        rows={sortRows(data, sort)}
        getRowId={(r) => r.id}
        sort={sort}
        onSortChange={setSort}
      />
    );
  },
};

export const StickyHeader: S = {
  render: () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: String(i), variety: `صنف ${i + 1}`, qty: (i * 13) % 300, price: 20 + (i % 9) * 5,
    }));
    const [sort, setSort] = React.useState<SortState | null>(null);
    return (
      <DataTable
        caption="جدول طويل (رأس ثابت)"
        columns={columns}
        rows={sortRows(many, sort)}
        getRowId={(r) => r.id}
        sort={sort}
        onSortChange={setSort}
        stickyHeader
      />
    );
  },
};

export const Empty: S = {
  render: () => (
    <DataTable
      caption="مخزون الأصناف"
      columns={columns}
      rows={[]}
      getRowId={(r) => r.id}
      empty="لا توجد أصناف مسجلة بعد"
    />
  ),
};

export const Gallery: S = {
  render: () => (
    <div style={{ display: "grid", gap: 24 }}>
      <DataTable caption="جدول مرتّب" columns={columns} rows={data} getRowId={(r) => r.id}
        sort={{ columnId: "price", direction: "asc" }} onSortChange={() => {}} />
      <DataTable caption="جدول فارغ" columns={columns} rows={[]} getRowId={(r) => r.id} empty="لا توجد بيانات" />
    </div>
  ),
};
```

- [ ] **Step 7: Export from `src/index.ts`**

Add:
```ts
export { DataTable } from "./components/DataTable";
export type { DataTableProps, DataTableColumn, SortState, SortDirection } from "./components/DataTable";
```

- [ ] **Step 8: Commit**

```bash
git add src/components/DataTable.tsx src/components/DataTable.stories.tsx src/components/DataTable.test.tsx src/styles/components.css src/index.ts
git commit -m "feat(data): add generic sortable DataTable

Controlled sort state, aria-sort + keyboard-operable headers, sticky header,
RTL-first, tabular-nums numeric columns, empty slot. Token-pure.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Timeline

**Files:**
- Create: `src/components/Timeline.tsx`, `src/components/Timeline.stories.tsx`, `src/components/Timeline.test.tsx`
- Modify: `src/styles/components.css`, `src/index.ts`

**Interfaces:**
- Consumes: role tokens + numeric primitives.
- Produces:
  - `type TimelineTone = "default" | "success" | "warning" | "danger" | "info";`
  - `interface TimelineItem { id: string; title: React.ReactNode; time?: React.ReactNode; description?: React.ReactNode; tone?: TimelineTone; icon?: React.ReactNode; }`
  - `interface TimelineProps extends React.HTMLAttributes<HTMLOListElement> { items: TimelineItem[]; }`
  - `function Timeline(props: TimelineProps)` — ordered list of dotted events with a connecting rail.

- [ ] **Step 1: Write the failing test**

Create `src/components/Timeline.test.tsx`:
```tsx
import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { Timeline, type TimelineItem } from "./Timeline";

const items: TimelineItem[] = [
  { id: "1", title: "تم إنشاء الخطة", time: "٠٩:٠٠", tone: "info" },
  { id: "2", title: "اعتماد المالك", time: "١٠:٣٠", tone: "success", description: "اعتمد عمر الطلب" },
  { id: "3", title: "حُفظ المستند", time: "١١:١٥" },
];

describe("Timeline", () => {
  it("renders an ordered list with all items", () => {
    render(<Timeline items={items} aria-label="سجل العمليات" />);
    expect(screen.getByRole("list", { name: "سجل العمليات" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("اعتماد المالك")).toBeInTheDocument();
  });
  it("applies the tone modifier to the marker", () => {
    const { container } = render(<Timeline items={items} />);
    expect(container.querySelector(".fos-timeline__marker--success")).toBeInTheDocument();
  });
  it("has no axe violations", async () => {
    const { container } = render(<Timeline items={items} aria-label="سجل العمليات" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run the test (expect FAIL)**

Run: `npm test -- Timeline`
Expected: FAIL — module `./Timeline` not found.

- [ ] **Step 3: Implement `src/components/Timeline.tsx`**

```tsx
import * as React from "react";

export type TimelineTone = "default" | "success" | "warning" | "danger" | "info";

export interface TimelineItem {
  /** Stable key. */ id: string;
  /** Event title. */ title: React.ReactNode;
  /** Optional timestamp/label. */ time?: React.ReactNode;
  /** Optional detail line. */ description?: React.ReactNode;
  /** Marker tone. */ tone?: TimelineTone;
  /** Optional icon shown inside the marker. */ icon?: React.ReactNode;
}

export interface TimelineProps extends React.HTMLAttributes<HTMLOListElement> {
  /** Ordered events, newest-first or oldest-first (consumer's choice). */
  items: TimelineItem[];
}

/** Vertical event timeline. Renders an ordered list with a connecting rail and toned markers. */
export function Timeline({ items, className = "", ...rest }: TimelineProps) {
  return (
    <ol className={`fos-timeline ${className}`.trim()} {...rest}>
      {items.map((item) => (
        <li key={item.id} className="fos-timeline__item">
          <span className={`fos-timeline__marker fos-timeline__marker--${item.tone ?? "default"}`} aria-hidden="true">
            {item.icon}
          </span>
          <div className="fos-timeline__body">
            <div className="fos-timeline__head">
              <span className="fos-timeline__title">{item.title}</span>
              {item.time != null && <span className="fos-timeline__time">{item.time}</span>}
            </div>
            {item.description != null && <div className="fos-timeline__desc">{item.description}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 4: Append the CSS block to `src/styles/components.css`**

```css
/* ---- Timeline ---- */
.fos-timeline { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; }
.fos-timeline__item { position:relative; display:flex; gap:var(--space-3); padding-block-end:var(--space-4); padding-inline-start:var(--space-1); }
.fos-timeline__item::before { content:""; position:absolute; inset-block-start:var(--space-4); inset-block-end:0; inset-inline-start:11px; width:2px; background:var(--line); }
.fos-timeline__item:last-child::before { display:none; }
.fos-timeline__marker { position:relative; z-index:var(--z-base); flex:none; width:24px; height:24px; border-radius:var(--radius-pill); display:grid; place-items:center; font-size:var(--text-xs); background:var(--neutral-bg); color:var(--neutral-fg); border:2px solid var(--surface); }
.fos-timeline__marker--success { background:var(--success-bg); color:var(--success-fg); }
.fos-timeline__marker--warning { background:var(--warning-bg); color:var(--warning-fg); }
.fos-timeline__marker--danger { background:var(--danger-bg); color:var(--danger-fg); }
.fos-timeline__marker--info { background:var(--info-bg); color:var(--info-fg); }
.fos-timeline__body { flex:1; min-width:0; }
.fos-timeline__head { display:flex; align-items:baseline; gap:var(--space-2); justify-content:space-between; }
.fos-timeline__title { font-size:var(--text-sm); font-weight:var(--weight-bold); color:var(--ink); }
.fos-timeline__time { font-size:var(--text-xs); color:var(--ink-muted); font-variant-numeric:tabular-nums; white-space:nowrap; }
.fos-timeline__desc { font-size:var(--text-xs); color:var(--ink-muted); margin-block-start:var(--space-1); }
```

- [ ] **Step 5: Run the test (expect PASS) and purity**

Run: `npm test -- Timeline`
Expected: 3 passed.
Run: `npm run tokens:purity`
Expected: `✓ token-purity: clean`.

- [ ] **Step 6: Add the story `src/components/Timeline.stories.tsx`**

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { Timeline, type TimelineItem } from "./Timeline";

const items: TimelineItem[] = [
  { id: "1", title: "تم إنشاء الخطة", time: "٠٩:٠٠", tone: "info", icon: "📝" },
  { id: "2", title: "اعتماد المالك", time: "١٠:٣٠", tone: "success", icon: "✓", description: "اعتمد عمر الطلب بالكامل" },
  { id: "3", title: "تحذير مخزون", time: "١٠:٤٥", tone: "warning", icon: "!", description: "انخفاض في صنف السكري" },
  { id: "4", title: "حُفظ المستند النهائي", time: "١١:١٥", icon: "📁" },
];

const meta: Meta<typeof Timeline> = {
  title: "Data display/Timeline",
  component: Timeline,
  args: { items, "aria-label": "سجل العمليات" },
};
export default meta;
type S = StoryObj<typeof Timeline>;

export const Default: S = {};
export const Gallery: S = {
  render: () => (
    <div style={{ maxWidth: 420 }}>
      <Timeline items={items} aria-label="سجل العمليات" />
    </div>
  ),
};
```

- [ ] **Step 7: Export from `src/index.ts`**

Add:
```ts
export { Timeline } from "./components/Timeline";
export type { TimelineProps, TimelineItem, TimelineTone } from "./components/Timeline";
```

- [ ] **Step 8: Commit**

```bash
git add src/components/Timeline.tsx src/components/Timeline.stories.tsx src/components/Timeline.test.tsx src/styles/components.css src/index.ts
git commit -m "feat(data): add Timeline event list

Ordered-list semantics, connecting rail, toned markers. RTL-first, token-pure.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: DescriptionList

**Files:**
- Create: `src/components/DescriptionList.tsx`, `src/components/DescriptionList.stories.tsx`, `src/components/DescriptionList.test.tsx`
- Modify: `src/styles/components.css`, `src/index.ts`

**Interfaces:**
- Consumes: role tokens + numeric primitives.
- Produces:
  - `interface DescriptionItem { id: string; term: React.ReactNode; description: React.ReactNode; numeric?: boolean; }`
  - `interface DescriptionListProps extends React.HTMLAttributes<HTMLDListElement> { items: DescriptionItem[]; layout?: "stacked" | "inline"; }`
  - `function DescriptionList(props: DescriptionListProps)` — semantic `<dl>` with `<dt>`/`<dd>` pairs; `numeric` descriptions get tabular-nums.

- [ ] **Step 1: Write the failing test**

Create `src/components/DescriptionList.test.tsx`:
```tsx
import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { DescriptionList, type DescriptionItem } from "./DescriptionList";

const items: DescriptionItem[] = [
  { id: "owner", term: "المالك", description: "عمر عبيد" },
  { id: "area", term: "المساحة", description: "١٢ فدان", numeric: true },
  { id: "trees", term: "عدد الأشجار", description: "٤٨٠", numeric: true },
];

describe("DescriptionList", () => {
  it("renders term/description pairs", () => {
    render(<DescriptionList items={items} />);
    expect(screen.getByText("المالك")).toBeInTheDocument();
    expect(screen.getByText("عمر عبيد")).toBeInTheDocument();
  });
  it("applies the inline layout modifier", () => {
    const { container } = render(<DescriptionList items={items} layout="inline" />);
    expect(container.querySelector(".fos-dl--inline")).toBeInTheDocument();
  });
  it("marks numeric descriptions", () => {
    const { container } = render(<DescriptionList items={items} />);
    expect(container.querySelector(".fos-dl__dd--num")).toBeInTheDocument();
  });
  it("has no axe violations", async () => {
    const { container } = render(<DescriptionList items={items} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run the test (expect FAIL)**

Run: `npm test -- DescriptionList`
Expected: FAIL — module `./DescriptionList` not found.

- [ ] **Step 3: Implement `src/components/DescriptionList.tsx`**

```tsx
import * as React from "react";

export interface DescriptionItem {
  /** Stable key. */ id: string;
  /** Term (label). */ term: React.ReactNode;
  /** Description (value). */ description: React.ReactNode;
  /** Numeric value — applies tabular-nums. */ numeric?: boolean;
}

export interface DescriptionListProps extends React.HTMLAttributes<HTMLDListElement> {
  /** Term/description pairs. */
  items: DescriptionItem[];
  /** `stacked` (term above value) or `inline` (term beside value). */
  layout?: "stacked" | "inline";
}

/** Semantic key/value list (`<dl>`). Use for record metadata; numeric values are tabular-nums. */
export function DescriptionList({ items, layout = "stacked", className = "", ...rest }: DescriptionListProps) {
  return (
    <dl className={`fos-dl fos-dl--${layout} ${className}`.trim()} {...rest}>
      {items.map((item) => (
        <div className="fos-dl__row" key={item.id}>
          <dt className="fos-dl__dt">{item.term}</dt>
          <dd className={`fos-dl__dd${item.numeric ? " fos-dl__dd--num" : ""}`}>{item.description}</dd>
        </div>
      ))}
    </dl>
  );
}
```

- [ ] **Step 4: Append the CSS block to `src/styles/components.css`**

```css
/* ---- DescriptionList ---- */
.fos-dl { margin:0; padding:0; display:grid; gap:var(--space-3); }
.fos-dl__row { display:flex; flex-direction:column; gap:var(--space-1); }
.fos-dl--inline .fos-dl__row { flex-direction:row; align-items:baseline; gap:var(--space-3); justify-content:space-between; }
.fos-dl__dt { font-size:var(--text-xs); font-weight:var(--weight-semibold); color:var(--ink-muted); }
.fos-dl__dd { margin:0; font-size:var(--text-sm); font-weight:var(--weight-semibold); color:var(--ink); }
.fos-dl__dd--num { font-variant-numeric:tabular-nums; }
.fos-dl--inline .fos-dl__dd { text-align:end; }
```

- [ ] **Step 5: Run the test (expect PASS) and purity**

Run: `npm test -- DescriptionList`
Expected: 4 passed.
Run: `npm run tokens:purity`
Expected: `✓ token-purity: clean`.

- [ ] **Step 6: Add the story `src/components/DescriptionList.stories.tsx`**

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { DescriptionList, type DescriptionItem } from "./DescriptionList";

const items: DescriptionItem[] = [
  { id: "owner", term: "المالك", description: "عمر عبيد" },
  { id: "region", term: "المنطقة", description: "الوادي الجديد" },
  { id: "area", term: "المساحة", description: "١٢ فدان", numeric: true },
  { id: "trees", term: "عدد الأشجار", description: "٤٨٠", numeric: true },
];

const meta: Meta<typeof DescriptionList> = {
  title: "Data display/DescriptionList",
  component: DescriptionList,
  args: { items },
  argTypes: { layout: { control: "inline-radio", options: ["stacked", "inline"] } },
};
export default meta;
type S = StoryObj<typeof DescriptionList>;

export const Stacked: S = { args: { layout: "stacked" } };
export const Inline: S = { args: { layout: "inline" } };
export const Gallery: S = {
  render: () => (
    <div style={{ display: "flex", gap: 40, flexWrap: "wrap", maxWidth: 640 }}>
      <DescriptionList items={items} layout="stacked" />
      <DescriptionList items={items} layout="inline" />
    </div>
  ),
};
```

- [ ] **Step 7: Export from `src/index.ts`**

Add:
```ts
export { DescriptionList } from "./components/DescriptionList";
export type { DescriptionListProps, DescriptionItem } from "./components/DescriptionList";
```

- [ ] **Step 8: Commit**

```bash
git add src/components/DescriptionList.tsx src/components/DescriptionList.stories.tsx src/components/DescriptionList.test.tsx src/styles/components.css src/index.ts
git commit -m "feat(data): add DescriptionList key/value component

Semantic <dl>, stacked + inline layouts, tabular-nums numeric values. Token-pure, RTL-first.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Avatar

**Files:**
- Create: `src/components/Avatar.tsx`, `src/components/Avatar.stories.tsx`, `src/components/Avatar.test.tsx`
- Modify: `src/styles/components.css`, `src/index.ts`

**Interfaces:**
- Consumes: role tokens + numeric primitives.
- Produces:
  - `type AvatarSize = "sm" | "md" | "lg";`
  - `interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> { name: string; src?: string; size?: AvatarSize; }`
  - `function Avatar(props: AvatarProps)` — renders an `<img>` when `src` is set, else initials derived from `name`. `name` is the accessible label; decorative when no name? (always labeled). Uses `React.forwardRef` to a span.

- [ ] **Step 1: Write the failing test**

Create `src/components/Avatar.test.tsx`:
```tsx
import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { Avatar } from "./Avatar";

describe("Avatar", () => {
  it("renders initials from the name when no src", () => {
    render(<Avatar name="عمر عبيد" />);
    expect(screen.getByText("عع")).toBeInTheDocument();
  });
  it("exposes the name as an accessible label", () => {
    render(<Avatar name="عمر عبيد" />);
    expect(screen.getByLabelText("عمر عبيد")).toBeInTheDocument();
  });
  it("renders an image with alt when src is provided", () => {
    render(<Avatar name="عمر عبيد" src="/omar.jpg" />);
    expect(screen.getByRole("img", { name: "عمر عبيد" })).toBeInTheDocument();
  });
  it("applies the size modifier", () => {
    const { container } = render(<Avatar name="عمر" size="lg" />);
    expect(container.querySelector(".fos-avatar--lg")).toBeInTheDocument();
  });
  it("has no axe violations", async () => {
    const { container } = render(<Avatar name="عمر عبيد" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run the test (expect FAIL)**

Run: `npm test -- Avatar`
Expected: FAIL — module `./Avatar` not found.

- [ ] **Step 3: Implement `src/components/Avatar.tsx`**

```tsx
import * as React from "react";

export type AvatarSize = "sm" | "md" | "lg";

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Full name — used as the accessible label and to derive initials. */
  name: string;
  /** Optional image URL; falls back to initials. */
  src?: string;
  /** Visual size. */
  size?: AvatarSize;
}

/** Up to two leading initials from the (whitespace-split) name. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2);
  return (parts[0][0] ?? "") + (parts[parts.length - 1][0] ?? "");
}

/** User/entity avatar. Shows an image when `src` is set, otherwise initials. `name` labels it. */
export const Avatar = React.forwardRef<HTMLSpanElement, AvatarProps>(function Avatar(
  { name, src, size = "md", className = "", ...rest },
  ref
) {
  return (
    <span
      ref={ref}
      className={`fos-avatar fos-avatar--${size} ${className}`.trim()}
      role="img"
      aria-label={name}
      {...rest}
    >
      {src ? (
        <img className="fos-avatar__img" src={src} alt="" />
      ) : (
        <span className="fos-avatar__initials" aria-hidden="true">{initialsOf(name)}</span>
      )}
    </span>
  );
});
```

- [ ] **Step 4: Append the CSS block to `src/styles/components.css`**

```css
/* ---- Avatar ---- */
.fos-avatar { display:inline-grid; place-items:center; flex:none; border-radius:var(--radius-pill); overflow:hidden; background:color-mix(in srgb, var(--brand) 16%, var(--surface)); color:var(--brand-hover); font-weight:var(--weight-bold); text-transform:uppercase; user-select:none; }
.fos-avatar--sm { width:24px; height:24px; font-size:var(--text-xs); }
.fos-avatar--md { width:34px; height:34px; font-size:var(--text-sm); }
.fos-avatar--lg { width:48px; height:48px; font-size:var(--text-md); }
.fos-avatar__img { width:100%; height:100%; object-fit:cover; display:block; }
.fos-avatar__initials { line-height:1; }
```

- [ ] **Step 5: Run the test (expect PASS) and purity**

Run: `npm test -- Avatar`
Expected: 5 passed.
Run: `npm run tokens:purity`
Expected: `✓ token-purity: clean`.

- [ ] **Step 6: Add the story `src/components/Avatar.stories.tsx`**

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { Avatar } from "./Avatar";

const meta: Meta<typeof Avatar> = {
  title: "Data display/Avatar",
  component: Avatar,
  args: { name: "عمر عبيد", size: "md" },
  argTypes: { size: { control: "inline-radio", options: ["sm", "md", "lg"] } },
};
export default meta;
type S = StoryObj<typeof Avatar>;

export const Initials: S = {};
export const Image: S = { args: { src: "https://i.pravatar.cc/96?img=12" } };
export const Large: S = { args: { size: "lg", name: "فاطمة حسن" } };
export const Gallery: S = {
  render: () => (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <Avatar name="عمر عبيد" size="sm" />
      <Avatar name="فاطمة حسن" size="md" />
      <Avatar name="محمود علي" size="lg" />
      <Avatar name="عمر عبيد" size="lg" src="https://i.pravatar.cc/96?img=12" />
    </div>
  ),
};
```

- [ ] **Step 7: Export from `src/index.ts`**

Add:
```ts
export { Avatar } from "./components/Avatar";
export type { AvatarProps, AvatarSize } from "./components/Avatar";
```

- [ ] **Step 8: Commit**

```bash
git add src/components/Avatar.tsx src/components/Avatar.stories.tsx src/components/Avatar.test.tsx src/styles/components.css src/index.ts
git commit -m "feat(data): add Avatar component

Initials fallback, image mode, accessible label, sm/md/lg sizes. Token-pure.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Tooltip

**Files:**
- Create: `src/components/Tooltip.tsx`, `src/components/Tooltip.stories.tsx`, `src/components/Tooltip.test.tsx`
- Modify: `src/styles/components.css`, `src/index.ts`

**Interfaces:**
- Consumes: role tokens + numeric primitives.
- Produces:
  - `type TooltipPlacement = "top" | "bottom" | "start" | "end";`
  - `interface TooltipProps { label: React.ReactNode; placement?: TooltipPlacement; children: React.ReactElement; }`
  - `function Tooltip(props: TooltipProps)` — wraps a single focusable child, shows a `role="tooltip"` bubble on hover + focus, dismisses on `Esc`, links via `aria-describedby`.

- [ ] **Step 1: Write the failing test**

Create `src/components/Tooltip.test.tsx`:
```tsx
import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { Tooltip } from "./Tooltip";

describe("Tooltip", () => {
  it("shows the tooltip on focus and links it via aria-describedby", async () => {
    render(<Tooltip label="الكمية المتاحة في المخزن"><button>المخزون</button></Tooltip>);
    const btn = screen.getByRole("button", { name: "المخزون" });
    btn.focus();
    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent("الكمية المتاحة في المخزن");
    expect(btn).toHaveAttribute("aria-describedby", tip.id);
  });
  it("shows on hover and hides on Escape", async () => {
    render(<Tooltip label="تلميح"><button>زر</button></Tooltip>);
    const btn = screen.getByRole("button");
    await userEvent.hover(btn);
    expect(await screen.findByRole("tooltip")).toBeInTheDocument();
    btn.focus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
  it("has no axe violations", async () => {
    const { container } = render(<Tooltip label="تلميح"><button>زر</button></Tooltip>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run the test (expect FAIL)**

Run: `npm test -- Tooltip`
Expected: FAIL — module `./Tooltip` not found.

- [ ] **Step 3: Implement `src/components/Tooltip.tsx`**

```tsx
import * as React from "react";

export type TooltipPlacement = "top" | "bottom" | "start" | "end";

export interface TooltipProps {
  /** Tooltip text/content. */
  label: React.ReactNode;
  /** Logical placement relative to the trigger. */
  placement?: TooltipPlacement;
  /** A single focusable trigger element. */
  children: React.ReactElement;
}

let tooltipSeq = 0;

/**
 * Accessible tooltip. Wraps one focusable child; shows a `role="tooltip"` bubble on
 * hover + focus, links it via `aria-describedby`, dismisses on `Esc`.
 */
export function Tooltip({ label, placement = "top", children }: TooltipProps) {
  const [open, setOpen] = React.useState(false);
  const id = React.useMemo(() => `fos-tip-${++tooltipSeq}`, []);

  const show = () => setOpen(true);
  const hide = () => setOpen(false);

  const child = React.Children.only(children);
  const trigger = React.cloneElement(child, {
    "aria-describedby": open ? id : child.props["aria-describedby"],
    onMouseEnter: (e: React.MouseEvent) => { show(); child.props.onMouseEnter?.(e); },
    onMouseLeave: (e: React.MouseEvent) => { hide(); child.props.onMouseLeave?.(e); },
    onFocus: (e: React.FocusEvent) => { show(); child.props.onFocus?.(e); },
    onBlur: (e: React.FocusEvent) => { hide(); child.props.onBlur?.(e); },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Escape") hide();
      child.props.onKeyDown?.(e);
    },
  });

  return (
    <span className="fos-tooltip">
      {trigger}
      {open && (
        <span role="tooltip" id={id} className={`fos-tooltip__bubble fos-tooltip__bubble--${placement}`}>
          {label}
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 4: Append the CSS block to `src/styles/components.css`**

```css
/* ---- Tooltip ---- */
.fos-tooltip { position:relative; display:inline-flex; }
.fos-tooltip__bubble { position:absolute; z-index:var(--z-toast); max-width:240px; padding:var(--space-1) var(--space-2); border-radius:var(--radius-control); background:var(--ink); color:var(--surface); font-size:var(--text-xs); font-weight:var(--weight-semibold); line-height:1.4; white-space:normal; box-shadow:var(--shadow-card); pointer-events:none; }
.fos-tooltip__bubble--top { inset-block-end:calc(100% + var(--space-1)); inset-inline-start:50%; transform:translateX(-50%); }
.fos-tooltip__bubble--bottom { inset-block-start:calc(100% + var(--space-1)); inset-inline-start:50%; transform:translateX(-50%); }
.fos-tooltip__bubble--start { inset-inline-end:calc(100% + var(--space-1)); inset-block-start:50%; transform:translateY(-50%); }
.fos-tooltip__bubble--end { inset-inline-start:calc(100% + var(--space-1)); inset-block-start:50%; transform:translateY(-50%); }
```

- [ ] **Step 5: Run the test (expect PASS) and purity**

Run: `npm test -- Tooltip`
Expected: 3 passed.
Run: `npm run tokens:purity`
Expected: `✓ token-purity: clean`.

- [ ] **Step 6: Add the story `src/components/Tooltip.stories.tsx`**

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { Tooltip } from "./Tooltip";
import { Button } from "./Button";

const meta: Meta<typeof Tooltip> = {
  title: "Data display/Tooltip",
  component: Tooltip,
  args: { label: "الكمية المتاحة في المخزن", placement: "top" },
  argTypes: { placement: { control: "inline-radio", options: ["top", "bottom", "start", "end"] } },
};
export default meta;
type S = StoryObj<typeof Tooltip>;

export const Default: S = {
  render: (args) => (
    <div style={{ padding: 60 }}>
      <Tooltip {...args}><Button variant="ghost">المخزون</Button></Tooltip>
    </div>
  ),
};
export const Gallery: S = {
  render: () => (
    <div style={{ display: "flex", gap: 48, padding: 60, flexWrap: "wrap" }}>
      <Tooltip label="أعلى" placement="top"><Button variant="ghost">أعلى</Button></Tooltip>
      <Tooltip label="أسفل" placement="bottom"><Button variant="ghost">أسفل</Button></Tooltip>
      <Tooltip label="البداية" placement="start"><Button variant="ghost">بداية</Button></Tooltip>
      <Tooltip label="النهاية" placement="end"><Button variant="ghost">نهاية</Button></Tooltip>
    </div>
  ),
};
```

- [ ] **Step 7: Export from `src/index.ts`**

Add:
```ts
export { Tooltip } from "./components/Tooltip";
export type { TooltipProps, TooltipPlacement } from "./components/Tooltip";
```

- [ ] **Step 8: Commit**

```bash
git add src/components/Tooltip.tsx src/components/Tooltip.stories.tsx src/components/Tooltip.test.tsx src/styles/components.css src/index.ts
git commit -m "feat(data): add accessible Tooltip

role=tooltip, hover+focus trigger, Esc dismiss, aria-describedby link. Token-pure, RTL placements.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Pagination

**Files:**
- Create: `src/components/Pagination.tsx`, `src/components/Pagination.stories.tsx`, `src/components/Pagination.test.tsx`
- Modify: `src/styles/components.css`, `src/index.ts`

**Interfaces:**
- Consumes: role tokens + numeric primitives.
- Produces:
  - `interface PaginationProps extends Omit<React.HTMLAttributes<HTMLElement>, "onChange"> { page: number; pageCount: number; onChange: (page: number) => void; ariaLabel?: string; prevLabel?: React.ReactNode; nextLabel?: React.ReactNode; }`
  - `function Pagination(props: PaginationProps)` — controlled `<nav>` with prev/next + numbered page buttons; the current page uses `aria-current="page"`; out-of-range prev/next are disabled. Page numbers are 1-based.

- [ ] **Step 1: Write the failing test**

Create `src/components/Pagination.test.tsx`:
```tsx
import { it, expect, describe, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { Pagination } from "./Pagination";

describe("Pagination", () => {
  it("marks the current page with aria-current", () => {
    render(<Pagination page={2} pageCount={5} onChange={() => {}} ariaLabel="ترقيم الصفحات" prevLabel="السابق" nextLabel="التالي" />);
    expect(screen.getByRole("navigation", { name: "ترقيم الصفحات" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2" })).toHaveAttribute("aria-current", "page");
  });
  it("calls onChange with the chosen page", async () => {
    const onChange = vi.fn();
    render(<Pagination page={1} pageCount={5} onChange={onChange} prevLabel="السابق" nextLabel="التالي" />);
    await userEvent.click(screen.getByRole("button", { name: "3" }));
    expect(onChange).toHaveBeenCalledWith(3);
  });
  it("disables prev on the first page and next on the last", () => {
    const { rerender } = render(<Pagination page={1} pageCount={3} onChange={() => {}} prevLabel="السابق" nextLabel="التالي" />);
    expect(screen.getByRole("button", { name: "السابق" })).toBeDisabled();
    rerender(<Pagination page={3} pageCount={3} onChange={() => {}} prevLabel="السابق" nextLabel="التالي" />);
    expect(screen.getByRole("button", { name: "التالي" })).toBeDisabled();
  });
  it("next advances the page", async () => {
    const onChange = vi.fn();
    render(<Pagination page={1} pageCount={3} onChange={onChange} prevLabel="السابق" nextLabel="التالي" />);
    await userEvent.click(screen.getByRole("button", { name: "التالي" }));
    expect(onChange).toHaveBeenCalledWith(2);
  });
  it("has no axe violations", async () => {
    const { container } = render(<Pagination page={2} pageCount={5} onChange={() => {}} ariaLabel="ترقيم" prevLabel="السابق" nextLabel="التالي" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run the test (expect FAIL)**

Run: `npm test -- Pagination`
Expected: FAIL — module `./Pagination` not found.

- [ ] **Step 3: Implement `src/components/Pagination.tsx`**

```tsx
import * as React from "react";

export interface PaginationProps extends Omit<React.HTMLAttributes<HTMLElement>, "onChange"> {
  /** Current page (1-based). */
  page: number;
  /** Total number of pages. */
  pageCount: number;
  /** Called with the next page (1-based). */
  onChange: (page: number) => void;
  /** Accessible label for the nav region. */
  ariaLabel?: string;
  /** Previous-button content (consumer supplies the string). */
  prevLabel?: React.ReactNode;
  /** Next-button content (consumer supplies the string). */
  nextLabel?: React.ReactNode;
}

/** Controlled pagination. `<nav>` with prev/next + numbered pages; current page uses `aria-current`. */
export function Pagination({
  page, pageCount, onChange, ariaLabel, prevLabel, nextLabel, className = "", ...rest
}: PaginationProps) {
  const pages = React.useMemo(
    () => Array.from({ length: Math.max(0, pageCount) }, (_, i) => i + 1),
    [pageCount]
  );
  const go = (p: number) => {
    if (p >= 1 && p <= pageCount && p !== page) onChange(p);
  };

  return (
    <nav className={`fos-pagination ${className}`.trim()} aria-label={ariaLabel} {...rest}>
      <button
        type="button"
        className="fos-pagination__nav"
        onClick={() => go(page - 1)}
        disabled={page <= 1}
      >
        {prevLabel}
      </button>
      <ul className="fos-pagination__list">
        {pages.map((p) => (
          <li key={p}>
            <button
              type="button"
              className={`fos-pagination__page${p === page ? " fos-pagination__page--active" : ""}`}
              aria-current={p === page ? "page" : undefined}
              onClick={() => go(p)}
            >
              {p}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="fos-pagination__nav"
        onClick={() => go(page + 1)}
        disabled={page >= pageCount}
      >
        {nextLabel}
      </button>
    </nav>
  );
}
```

- [ ] **Step 4: Append the CSS block to `src/styles/components.css`**

```css
/* ---- Pagination ---- */
.fos-pagination { display:flex; align-items:center; gap:var(--space-2); }
.fos-pagination__list { display:flex; align-items:center; gap:var(--space-1); list-style:none; margin:0; padding:0; }
.fos-pagination__page, .fos-pagination__nav { min-width:var(--control-h); height:var(--control-h); padding-inline:var(--space-2); display:inline-flex; align-items:center; justify-content:center; border:1px solid var(--line); border-radius:var(--radius-control); background:var(--surface); color:var(--ink); font:inherit; font-size:var(--text-sm); font-weight:var(--weight-semibold); font-variant-numeric:tabular-nums; cursor:pointer; transition:background var(--dur-fast) var(--ease); }
.fos-pagination__page:hover:not(:disabled), .fos-pagination__nav:hover:not(:disabled) { background:var(--surface-sunken); }
.fos-pagination__page--active { background:var(--brand); color:var(--brand-contrast); border-color:var(--brand); }
.fos-pagination__page:focus-visible, .fos-pagination__nav:focus-visible { outline:2px solid var(--focus-ring); outline-offset:2px; }
.fos-pagination__nav:disabled { opacity:.4; cursor:not-allowed; }
```

- [ ] **Step 5: Run the test (expect PASS) and purity**

Run: `npm test -- Pagination`
Expected: 5 passed.
Run: `npm run tokens:purity`
Expected: `✓ token-purity: clean`.

- [ ] **Step 6: Add the story `src/components/Pagination.stories.tsx`**

```tsx
import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Pagination } from "./Pagination";

const meta: Meta<typeof Pagination> = {
  title: "Data display/Pagination",
  component: Pagination,
};
export default meta;
type S = StoryObj<typeof Pagination>;

export const Default: S = {
  render: () => {
    const [page, setPage] = React.useState(2);
    return <Pagination page={page} pageCount={6} onChange={setPage} ariaLabel="ترقيم الصفحات" prevLabel="السابق" nextLabel="التالي" />;
  },
};
export const FirstPage: S = {
  render: () => {
    const [page, setPage] = React.useState(1);
    return <Pagination page={page} pageCount={4} onChange={setPage} ariaLabel="ترقيم" prevLabel="السابق" nextLabel="التالي" />;
  },
};
export const Gallery: S = {
  render: () => {
    const [page, setPage] = React.useState(3);
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <Pagination page={page} pageCount={5} onChange={setPage} ariaLabel="ترقيم" prevLabel="السابق" nextLabel="التالي" />
      </div>
    );
  },
};
```

- [ ] **Step 7: Export from `src/index.ts`**

Add:
```ts
export { Pagination } from "./components/Pagination";
export type { PaginationProps } from "./components/Pagination";
```

- [ ] **Step 8: Commit**

```bash
git add src/components/Pagination.tsx src/components/Pagination.stories.tsx src/components/Pagination.test.tsx src/styles/components.css src/index.ts
git commit -m "feat(data): add controlled Pagination

nav landmark, aria-current on active page, disabled prev/next at bounds, tabular-nums. Token-pure.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: EmptyState

**Files:**
- Create: `src/components/EmptyState.tsx`, `src/components/EmptyState.stories.tsx`, `src/components/EmptyState.test.tsx`
- Modify: `src/styles/components.css`, `src/index.ts`

**Interfaces:**
- Consumes: role tokens + numeric primitives.
- Produces:
  - `interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> { title: React.ReactNode; description?: React.ReactNode; icon?: React.ReactNode; action?: React.ReactNode; }`
  - `function EmptyState(props: EmptyStateProps)` — centered placeholder block: optional icon, title, description, optional action slot.

- [ ] **Step 1: Write the failing test**

Create `src/components/EmptyState.test.tsx`:
```tsx
import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders the title and description", () => {
    render(<EmptyState title="لا توجد طلبات" description="ابدأ بإنشاء أول طلب صرف" />);
    expect(screen.getByText("لا توجد طلبات")).toBeInTheDocument();
    expect(screen.getByText("ابدأ بإنشاء أول طلب صرف")).toBeInTheDocument();
  });
  it("renders the action slot", () => {
    render(<EmptyState title="فارغ" action={<button>إنشاء</button>} />);
    expect(screen.getByRole("button", { name: "إنشاء" })).toBeInTheDocument();
  });
  it("has no axe violations", async () => {
    const { container } = render(
      <EmptyState icon="🌴" title="لا توجد أشجار مسجلة" description="أضف أول قطاع نخيل" action={<button>إضافة قطاع</button>} />
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run the test (expect FAIL)**

Run: `npm test -- EmptyState`
Expected: FAIL — module `./EmptyState` not found.

- [ ] **Step 3: Implement `src/components/EmptyState.tsx`**

```tsx
import * as React from "react";

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Headline (e.g. "لا توجد طلبات"). */
  title: React.ReactNode;
  /** Optional supporting line. */
  description?: React.ReactNode;
  /** Optional decorative icon. */
  icon?: React.ReactNode;
  /** Optional action slot (e.g. a Button). */
  action?: React.ReactNode;
}

/** Centered empty/zero-data placeholder: icon, title, description, optional action. */
export function EmptyState({ title, description, icon, action, className = "", ...rest }: EmptyStateProps) {
  return (
    <div className={`fos-empty ${className}`.trim()} {...rest}>
      {icon != null && <div className="fos-empty__icon" aria-hidden="true">{icon}</div>}
      <p className="fos-empty__title">{title}</p>
      {description != null && <p className="fos-empty__desc">{description}</p>}
      {action != null && <div className="fos-empty__action">{action}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Append the CSS block to `src/styles/components.css`**

```css
/* ---- EmptyState ---- */
.fos-empty { display:flex; flex-direction:column; align-items:center; text-align:center; gap:var(--space-2); padding:var(--space-10) var(--space-4); color:var(--ink); }
.fos-empty__icon { width:56px; height:56px; border-radius:var(--radius-pill); display:grid; place-items:center; font-size:var(--text-2xl); background:color-mix(in srgb, var(--brand) 12%, var(--surface)); color:var(--brand-hover); margin-block-end:var(--space-1); }
.fos-empty__title { margin:0; font-size:var(--text-md); font-weight:var(--weight-bold); color:var(--ink); }
.fos-empty__desc { margin:0; font-size:var(--text-sm); color:var(--ink-muted); max-width:42ch; }
.fos-empty__action { margin-block-start:var(--space-2); }
```

- [ ] **Step 5: Run the test (expect PASS) and purity**

Run: `npm test -- EmptyState`
Expected: 3 passed.
Run: `npm run tokens:purity`
Expected: `✓ token-purity: clean`.

- [ ] **Step 6: Add the story `src/components/EmptyState.stories.tsx`**

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { EmptyState } from "./EmptyState";
import { Button } from "./Button";

const meta: Meta<typeof EmptyState> = {
  title: "Data display/EmptyState",
  component: EmptyState,
  args: { title: "لا توجد طلبات صرف", description: "ابدأ بإنشاء أول طلب صرف للمخزن" },
};
export default meta;
type S = StoryObj<typeof EmptyState>;

export const Default: S = {};
export const WithIconAndAction: S = {
  args: {
    icon: "🌴",
    title: "لا توجد أشجار مسجلة",
    description: "أضف أول قطاع نخيل لتبدأ متابعة الإنتاج",
    action: <Button>إضافة قطاع</Button>,
  },
};
export const Gallery: S = {
  render: () => (
    <div style={{ display: "grid", gap: 24, maxWidth: 420 }}>
      <EmptyState title="لا توجد طلبات" description="القائمة فارغة حاليًا" />
      <EmptyState icon="🌴" title="لا توجد أشجار" description="أضف أول قطاع نخيل" action={<Button>إضافة قطاع</Button>} />
    </div>
  ),
};
```

- [ ] **Step 7: Export from `src/index.ts`**

Add:
```ts
export { EmptyState } from "./components/EmptyState";
export type { EmptyStateProps } from "./components/EmptyState";
```

- [ ] **Step 8: Commit**

```bash
git add src/components/EmptyState.tsx src/components/EmptyState.stories.tsx src/components/EmptyState.test.tsx src/styles/components.css src/index.ts
git commit -m "feat(data): add EmptyState placeholder

Icon + title + description + action slot, centered, RTL-first. Token-pure.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Skeleton

**Files:**
- Create: `src/components/Skeleton.tsx`, `src/components/Skeleton.stories.tsx`, `src/components/Skeleton.test.tsx`
- Modify: `src/styles/components.css`, `src/index.ts`

**Interfaces:**
- Consumes: role tokens + numeric primitives (shimmer via `color-mix()` over `--neutral-bg`).
- Produces:
  - `type SkeletonShape = "text" | "rect" | "circle";`
  - `interface SkeletonProps extends React.HTMLAttributes<HTMLSpanElement> { shape?: SkeletonShape; width?: string | number; height?: string | number; lines?: number; }`
  - `function Skeleton(props: SkeletonProps)` — token-driven shimmer placeholder; `text` with `lines > 1` renders stacked bars. Always `aria-hidden` (decorative), with `role` left to the wrapping region.

- [ ] **Step 1: Write the failing test**

Create `src/components/Skeleton.test.tsx`:
```tsx
import { it, expect, describe } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "jest-axe";
import { Skeleton } from "./Skeleton";

describe("Skeleton", () => {
  it("renders a single shimmer by default and is decorative", () => {
    const { container } = render(<Skeleton />);
    const el = container.querySelector(".fos-skeleton");
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute("aria-hidden", "true");
  });
  it("applies the shape modifier", () => {
    const { container } = render(<Skeleton shape="circle" width={40} height={40} />);
    expect(container.querySelector(".fos-skeleton--circle")).toBeInTheDocument();
  });
  it("renders multiple lines for text with lines > 1", () => {
    const { container } = render(<Skeleton shape="text" lines={3} />);
    expect(container.querySelectorAll(".fos-skeleton__line")).toHaveLength(3);
  });
  it("forwards width/height styles", () => {
    const { container } = render(<Skeleton shape="rect" width={120} height={16} />);
    const el = container.querySelector(".fos-skeleton") as HTMLElement;
    expect(el.style.width).toBe("120px");
    expect(el.style.height).toBe("16px");
  });
  it("has no axe violations", async () => {
    const { container } = render(<Skeleton shape="text" lines={2} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run the test (expect FAIL)**

Run: `npm test -- Skeleton`
Expected: FAIL — module `./Skeleton` not found.

- [ ] **Step 3: Implement `src/components/Skeleton.tsx`**

```tsx
import * as React from "react";

export type SkeletonShape = "text" | "rect" | "circle";

export interface SkeletonProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Visual shape. `text` supports multiple `lines`. */
  shape?: SkeletonShape;
  /** Explicit width (number → px). */
  width?: string | number;
  /** Explicit height (number → px). */
  height?: string | number;
  /** Number of stacked bars when `shape="text"`. */
  lines?: number;
}

function len(v: string | number | undefined): string | undefined {
  return typeof v === "number" ? `${v}px` : v;
}

/** Token-driven shimmer placeholder (decorative; `aria-hidden`). Shimmer uses color-mix over --neutral-bg. */
export function Skeleton({
  shape = "text", width, height, lines = 1, className = "", style, ...rest
}: SkeletonProps) {
  if (shape === "text" && lines > 1) {
    return (
      <span className={`fos-skeleton-group ${className}`.trim()} aria-hidden="true" {...rest}>
        {Array.from({ length: lines }, (_, i) => (
          <span
            key={i}
            className="fos-skeleton fos-skeleton--text fos-skeleton__line"
            style={{ width: i === lines - 1 ? "70%" : len(width) ?? "100%" }}
          />
        ))}
      </span>
    );
  }
  return (
    <span
      className={`fos-skeleton fos-skeleton--${shape} ${className}`.trim()}
      aria-hidden="true"
      style={{ width: len(width), height: len(height), ...style }}
      {...rest}
    />
  );
}
```

- [ ] **Step 4: Append the CSS block to `src/styles/components.css`**

```css
/* ---- Skeleton ---- */
.fos-skeleton-group { display:flex; flex-direction:column; gap:var(--space-2); }
.fos-skeleton { display:block; border-radius:var(--radius-control); background:linear-gradient(90deg, var(--neutral-bg) 0%, color-mix(in srgb, var(--neutral-bg) 60%, var(--surface)) 50%, var(--neutral-bg) 100%); background-size:200% 100%; animation:fos-shimmer 1.3s var(--ease) infinite; }
.fos-skeleton--text { height:var(--text-sm); width:100%; }
.fos-skeleton--rect { width:100%; height:var(--space-10); border-radius:var(--radius-card); }
.fos-skeleton--circle { border-radius:var(--radius-pill); width:var(--space-10); height:var(--space-10); }
.fos-skeleton__line { width:100%; }
@keyframes fos-shimmer { from { background-position:200% 0; } to { background-position:-200% 0; } }
@media (prefers-reduced-motion: reduce) { .fos-skeleton { animation:none; } }
```

- [ ] **Step 5: Run the test (expect PASS) and purity**

Run: `npm test -- Skeleton`
Expected: 5 passed.
Run: `npm run tokens:purity`
Expected: `✓ token-purity: clean`.

- [ ] **Step 6: Add the story `src/components/Skeleton.stories.tsx`**

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { Skeleton } from "./Skeleton";

const meta: Meta<typeof Skeleton> = {
  title: "Data display/Skeleton",
  component: Skeleton,
  argTypes: { shape: { control: "inline-radio", options: ["text", "rect", "circle"] } },
};
export default meta;
type S = StoryObj<typeof Skeleton>;

export const Text: S = { args: { shape: "text", width: 240 } };
export const Paragraph: S = { args: { shape: "text", lines: 3 } };
export const Rect: S = { args: { shape: "rect", width: 280, height: 120 } };
export const Circle: S = { args: { shape: "circle", width: 48, height: 48 } };
export const Gallery: S = {
  render: () => (
    <div style={{ display: "flex", gap: 16, alignItems: "center", maxWidth: 360, flexWrap: "wrap" }}>
      <Skeleton shape="circle" width={48} height={48} />
      <div style={{ flex: 1, minWidth: 200, display: "grid", gap: 8 }}>
        <Skeleton shape="text" width="60%" />
        <Skeleton shape="text" lines={2} />
      </div>
      <Skeleton shape="rect" width={320} height={120} />
    </div>
  ),
};
```

- [ ] **Step 7: Export from `src/index.ts`**

Add:
```ts
export { Skeleton } from "./components/Skeleton";
export type { SkeletonProps, SkeletonShape } from "./components/Skeleton";
```

- [ ] **Step 8: Commit**

```bash
git add src/components/Skeleton.tsx src/components/Skeleton.stories.tsx src/components/Skeleton.test.tsx src/styles/components.css src/index.ts
git commit -m "feat(data): add Skeleton shimmer placeholder

Text/rect/circle shapes, multi-line text, color-mix shimmer over --neutral-bg,
reduced-motion safe, aria-hidden. Token-pure.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: Group verification

**Files:** none (verification only)

- [ ] **Step 1: Full data-display test run**

Run: `npm test -- Stat DataTable Timeline DescriptionList Avatar Tooltip Pagination EmptyState Skeleton`
Expected: all suites pass.

- [ ] **Step 2: Full gate run**

Run:
```bash
npm run tokens:present && npm run tokens:purity && npm test && npm run build && npm run build-storybook
```
Expected: all exit 0. (`tokens:purity` confirms every new CSS block is role-token-only; `build` confirms `dist/styles.css` bundles; `build-storybook` confirms all stories compile.)

- [ ] **Step 3: Commit any incidental fixes**

```bash
git add -A && git commit -m "chore: data-display components group complete

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage (each task → spec §4 "Data display" row):**
- Stat → §4 "➕Stat" ✓ (Task 1).
- DataTable (sortable, sticky, RTL, tabular nums) → §4 "➕DataTable (sortable, sticky, RTL, tabular nums)" ✓ (Task 2: generic column defs + rows, controlled `sort`/`onSortChange`, `aria-sort`, keyboard-operable headers, `stickyHeader`, `empty` slot, numeric columns tabular-nums).
- Timeline → §4 "➕Timeline" ✓ (Task 3).
- DescriptionList → §4 "➕DescriptionList" ✓ (Task 4).
- Avatar → §4 "➕Avatar" ✓ (Task 5).
- Tooltip → §4 "➕Tooltip" ✓ (Task 6: `role="tooltip"`, hover + focus, `Esc`, `aria-describedby` — matches the §4/a11y mandate).
- Pagination → §4 "➕Pagination" ✓ (Task 7: `<nav>` + `aria-current`).
- EmptyState → §4 "➕EmptyState" ✓ (Task 8).
- Skeleton → §4 "➕Skeleton" ✓ (Task 9: token-driven shimmer via `color-mix()` over `--neutral-bg`, per the prompt's explicit instruction).
- Already-existing rows (Tag/Badge, KpiCard, Progress) are out of scope here — delivered in the theming-foundation phase.

**Placeholder scan:** every code step contains complete, runnable code — full `.tsx`, full CSS block, full CSF3 story, full test. No "TODO", no "similar to above", no elided bodies. Each task follows strict-TDD order: failing test → run (FAIL) → implement + CSS → run (PASS) + purity → story → export → commit.

**Type-consistency notes:**
- DataTable is generic (`<Row>`); `DataTableColumn<Row>`, `DataTableProps<Row>`, `SortState`, `SortDirection` are all consistent between definition (Task 2 impl), the test (`DataTableColumn<Row>` import), the story (`DataTable<Row>` meta/`StoryObj`), and the `src/index.ts` exports.
- Every component's prop/type names in its test and story match the implementation and the `index.ts` named + type exports exactly (e.g. `StatProps`/`StatTrend`, `TimelineItem`/`TimelineTone`, `AvatarSize`, `TooltipPlacement`, `SkeletonShape`).
- All components extend the correct native element props (`HTMLDivElement`, `HTMLSpanElement`, `HTMLOListElement`, `HTMLDListElement`, `TableHTMLAttributes`, `HTMLElement` for `<nav>`), with `Pagination` and `DataTable` using `Omit<…, "onChange">`/`Omit<…, "children">` to avoid colliding with their typed props.
- Token usage is consistent with the role tokens shipped in `src/styles/theme.css` (`--neutral-bg`/`--neutral-fg`, `--accent-*`, status pairs, `--surface*`, `--ink*`, `--brand*`, `--control-h`, `--radius-control`/`--radius-card`, `--shadow-card`) and the numeric primitives in `src/styles/primitives.css` — so `tokens:purity` passes without weakening the gate.
