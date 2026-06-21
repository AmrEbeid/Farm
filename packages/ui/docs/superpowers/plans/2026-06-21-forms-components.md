# Forms Components Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full Forms component group from spec §4 — `IconButton`, `Input`, `Textarea`, `NumberField`, `Select`, `Combobox`, `Checkbox`, `Radio`, `Switch`, `DateField`, and `FormRow` (with `Label`/`Help`/`Error` subparts) — each controlled-first, `forwardRef`-able, density-aware, token-pure, a11y-clean (axe), and documented in Storybook with Arabic copy.

**Architecture:** Each component is a presentational React function (or `forwardRef`) that renders semantic HTML carrying `fos-` BEM classes and references **only** Tier-2 role tokens + numeric primitives (no hardcoded color). Controls size via `--control-h` so density flips them automatically. Error/help wiring uses `aria-invalid` + `aria-describedby`. `Combobox` implements an ARIA listbox/option pattern with arrow-key navigation; `Switch` is `role="switch"`. `FormRow` standardizes the label + help + error layout that the bare controls (and the existing `Field`) compose into. Styling is pure CSS-variable cascade; theming (light/dark × density × radius × brand) comes for free from the Theming Foundation plan already in place.

**Tech Stack:** React 18, TypeScript (strict), tsup, Storybook 8 (react-vite), Vitest + @testing-library/react + @testing-library/user-event + jsdom, jest-axe, plain CSS (custom properties).

## Global Constraints
- React `>=18`; TypeScript `strict: true`; no `any` in public API.
- **Components reference only Tier-2 role tokens + numeric scales — zero hardcoded color/hex/rgb/px-color values.** (Enforced by `scripts/token-purity.mjs`; tints via `color-mix()` over role tokens.)
- RTL-first: use logical CSS properties (`margin-inline`, `inset-inline-start`, `padding-inline`) — never physical (`left`/`right`).
- Library is **presentational**: no user-facing strings, no i18n inside components. Stories/tests use Arabic text.
- Class prefix `fos-`; BEM-ish: `fos-<block>`, `fos-<block>--<modifier>`, `fos-<block>__<element>`.
- Components: `import * as React from "react"`; declare `function Name(props)`; use `React.forwardRef` when a DOM ref is needed (inputs, buttons). Props interface extends the native element props; defaults in destructuring; merge className as `` `fos-x fos-x--${variant} ${className}`.trim() ``.
- Controlled-first; semantic `variant`/`tone`/`size` props; sizes density-aware via `--control-h`.
- A11y baseline: real semantics, ARIA roles/labels, full keyboard paths, visible focus via `--focus-ring`.
- A component is done only when: strict `tsc` clean, Vitest behavior passes, axe reports **zero violations**, `tokens:purity` clean, and a CSF3 story (Arabic + a `Gallery`) exists.
- Commit after every task; end commit bodies with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure
- `src/components/IconButton.tsx` · `.stories.tsx` · `.test.tsx` — **create**
- `src/components/Input.tsx` · `.stories.tsx` · `.test.tsx` — **create**
- `src/components/Textarea.tsx` · `.stories.tsx` · `.test.tsx` — **create**
- `src/components/NumberField.tsx` · `.stories.tsx` · `.test.tsx` — **create**
- `src/components/Select.tsx` · `.stories.tsx` · `.test.tsx` — **create**
- `src/components/Combobox.tsx` · `.stories.tsx` · `.test.tsx` — **create**
- `src/components/Checkbox.tsx` · `.stories.tsx` · `.test.tsx` — **create**
- `src/components/Radio.tsx` · `.stories.tsx` · `.test.tsx` — **create**
- `src/components/Switch.tsx` · `.stories.tsx` · `.test.tsx` — **create**
- `src/components/DateField.tsx` · `.stories.tsx` · `.test.tsx` — **create**
- `src/components/FormRow.tsx` · `.stories.tsx` · `.test.tsx` — **create**
- `src/styles/components.css` — **modify** (append one CSS block per component)
- `src/index.ts` — **modify** (named + type exports per component)

---

### Task 1: IconButton

**Files:**
- Create: `src/components/IconButton.tsx`, `src/components/IconButton.stories.tsx`, `src/components/IconButton.test.tsx`
- Modify: `src/styles/components.css`, `src/index.ts`

**Interfaces:**
- Produces:
  - `type IconButtonVariant = "primary" | "ghost" | "danger"`; `type IconButtonSize = "md" | "sm"`.
  - `interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { label: string; variant?: IconButtonVariant; size?: IconButtonSize; loading?: boolean; children: React.ReactNode }`.
  - `const IconButton: React.ForwardRefExoticComponent<IconButtonProps & React.RefAttributes<HTMLButtonElement>>`.

- [ ] **Step 1: Write the failing test**

Create `src/components/IconButton.test.tsx`:
```tsx
import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { IconButton } from "./IconButton";

describe("IconButton", () => {
  it("exposes an accessible name via label", () => {
    render(<IconButton label="حذف">🗑</IconButton>);
    expect(screen.getByRole("button", { name: "حذف" })).toBeInTheDocument();
  });
  it("fires onClick", async () => {
    let clicks = 0;
    render(<IconButton label="تعديل" onClick={() => { clicks++; }}>✎</IconButton>);
    await userEvent.click(screen.getByRole("button", { name: "تعديل" }));
    expect(clicks).toBe(1);
  });
  it("disables while loading", () => {
    render(<IconButton label="حفظ" loading>💾</IconButton>);
    expect(screen.getByRole("button", { name: "حفظ" })).toBeDisabled();
  });
  it("has no axe violations", async () => {
    const { container } = render(<IconButton label="حذف">🗑</IconButton>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- IconButton`
Expected: FAIL — `Cannot find module './IconButton'`.

- [ ] **Step 3: Implement `src/components/IconButton.tsx`**

```tsx
import * as React from "react";

export type IconButtonVariant = "primary" | "ghost" | "danger";
export type IconButtonSize = "md" | "sm";

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name — required because the visible content is an icon only. */
  label: string;
  /** Visual style. */
  variant?: IconButtonVariant;
  /** Control size. */
  size?: IconButtonSize;
  /** Shows a spinner and disables interaction. */
  loading?: boolean;
  /** The icon (emoji or node). */
  children: React.ReactNode;
}

/** Square, icon-only button. `label` provides the accessible name (aria-label). */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = "ghost", size = "md", loading = false, disabled, children, className = "", ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      className={`fos-iconbtn fos-iconbtn--${variant} fos-iconbtn--${size} ${className}`.trim()}
      aria-label={label}
      title={label}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="fos-iconbtn__spinner" aria-hidden="true" /> : children}
    </button>
  );
});
```

- [ ] **Step 4: Append the CSS block to `src/styles/components.css`**

```css
/* ---- IconButton ---- */
.fos-iconbtn { display:inline-flex; align-items:center; justify-content:center; flex:none;
  border:none; border-radius:var(--radius-control); cursor:pointer; font-family:inherit;
  transition:background var(--dur-fast) var(--ease), opacity var(--dur-fast); }
.fos-iconbtn:focus-visible { outline:2px solid var(--focus-ring); outline-offset:2px; }
.fos-iconbtn--md { inline-size:var(--control-h); block-size:var(--control-h); font-size:var(--text-md); }
.fos-iconbtn--sm { inline-size:30px; block-size:30px; font-size:var(--text-sm); }
.fos-iconbtn--primary { background:var(--brand); color:var(--brand-contrast); }
.fos-iconbtn--primary:hover:not(:disabled) { background:var(--brand-hover); }
.fos-iconbtn--ghost { background:var(--surface); border:1px solid var(--line); color:var(--ink); }
.fos-iconbtn--ghost:hover:not(:disabled) { background:var(--surface-sunken); }
.fos-iconbtn--danger { background:var(--surface); border:1px solid color-mix(in srgb, var(--danger-fg) 35%, var(--surface)); color:var(--danger-fg); }
.fos-iconbtn--danger:hover:not(:disabled) { background:var(--danger-bg); }
.fos-iconbtn:disabled { opacity:.4; cursor:not-allowed; }
.fos-iconbtn__spinner { inline-size:13px; block-size:13px; border:2px solid currentColor; border-top-color:transparent; border-radius:50%; animation:fos-spin .7s linear infinite; }
```

- [ ] **Step 5: Export from `src/index.ts`**

Add:
```ts
export { IconButton } from "./components/IconButton";
export type { IconButtonProps, IconButtonVariant, IconButtonSize } from "./components/IconButton";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- IconButton`
Expected: 4 passed.

- [ ] **Step 7: Run token purity**

Run: `npm run tokens:purity`
Expected: `✓ token-purity: clean`.

- [ ] **Step 8: Add the story file**

Create `src/components/IconButton.stories.tsx`:
```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { IconButton } from "./IconButton";

const meta: Meta<typeof IconButton> = {
  title: "Forms/IconButton",
  component: IconButton,
  args: { label: "تعديل", children: "✎", variant: "ghost", size: "md" },
  argTypes: {
    variant: { control: "inline-radio", options: ["primary", "ghost", "danger"] },
    size: { control: "inline-radio", options: ["md", "sm"] },
  },
};
export default meta;
type S = StoryObj<typeof IconButton>;

export const Ghost: S = { args: { label: "تعديل", children: "✎" } };
export const Primary: S = { args: { label: "إضافة", children: "＋", variant: "primary" } };
export const Danger: S = { args: { label: "حذف", children: "🗑", variant: "danger" } };
export const Small: S = { args: { label: "عرض", children: "👁", size: "sm" } };
export const Loading: S = { args: { label: "حفظ", children: "💾", loading: true } };
export const Disabled: S = { args: { label: "مقفل", children: "🔒", disabled: true } };
export const Gallery: S = {
  render: () => (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      <IconButton label="إضافة" variant="primary">＋</IconButton>
      <IconButton label="تعديل">✎</IconButton>
      <IconButton label="حذف" variant="danger">🗑</IconButton>
      <IconButton label="عرض" size="sm">👁</IconButton>
      <IconButton label="حفظ" loading>💾</IconButton>
    </div>
  ),
};
```

- [ ] **Step 9: Commit**

```bash
git add src/components/IconButton.tsx src/components/IconButton.test.tsx src/components/IconButton.stories.tsx src/styles/components.css src/index.ts
git commit -m "feat(forms): add IconButton (icon-only button with required aria-label)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Input

**Files:**
- Create: `src/components/Input.tsx`, `src/components/Input.stories.tsx`, `src/components/Input.test.tsx`
- Modify: `src/styles/components.css`, `src/index.ts`

**Interfaces:**
- Produces:
  - `type InputSize = "md" | "sm"`.
  - `interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> { inputSize?: InputSize; invalid?: boolean }`.
  - `const Input: React.ForwardRefExoticComponent<InputProps & React.RefAttributes<HTMLInputElement>>`.

- [ ] **Step 1: Write the failing test**

Create `src/components/Input.test.tsx`:
```tsx
import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { Input } from "./Input";

describe("Input", () => {
  it("is controlled and reports typed value", async () => {
    let value = "";
    const { rerender } = render(
      <Input aria-label="الاسم" value={value} onChange={(e) => { value = e.target.value; }} />
    );
    await userEvent.type(screen.getByLabelText("الاسم"), "نخلة");
    rerender(<Input aria-label="الاسم" value={value} onChange={() => {}} />);
    expect((screen.getByLabelText("الاسم") as HTMLInputElement).value).toBe("نخلة");
  });
  it("reflects invalid via aria-invalid", () => {
    render(<Input aria-label="الكمية" invalid />);
    expect(screen.getByLabelText("الكمية")).toHaveAttribute("aria-invalid", "true");
  });
  it("forwards the ref to the input element", () => {
    let el: HTMLInputElement | null = null;
    render(<Input aria-label="حقل" ref={(n) => { el = n; }} />);
    expect(el).toBeInstanceOf(HTMLInputElement);
  });
  it("has no axe violations", async () => {
    const { container } = render(<Input aria-label="الاسم" defaultValue="نص" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- Input`
Expected: FAIL — `Cannot find module './Input'`.

- [ ] **Step 3: Implement `src/components/Input.tsx`**

```tsx
import * as React from "react";

export type InputSize = "md" | "sm";

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** Control size (named `inputSize` so it does not collide with the native `size` attribute). */
  inputSize?: InputSize;
  /** Marks the field invalid; sets `aria-invalid` and the error border. */
  invalid?: boolean;
}

/** Single-line text control. Controlled-first; compose with `FormRow` for label/help/error. */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { inputSize = "md", invalid, className = "", type = "text", ...rest },
  ref
) {
  return (
    <input
      ref={ref}
      type={type}
      className={`fos-input fos-input--${inputSize} ${className}`.trim()}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});
```

- [ ] **Step 4: Append the CSS block to `src/styles/components.css`**

```css
/* ---- Input ---- */
.fos-input { inline-size:100%; border:1px solid var(--line); border-radius:var(--radius-control);
  background:var(--surface); color:var(--ink); font-family:inherit; font-size:var(--text-sm);
  padding-inline:var(--control-pad-x); transition:border-color var(--dur-fast) var(--ease); }
.fos-input--md { block-size:var(--control-h); }
.fos-input--sm { block-size:30px; font-size:var(--text-xs); }
.fos-input::placeholder { color:var(--ink-muted); }
.fos-input:focus-visible { outline:2px solid var(--focus-ring); outline-offset:1px; border-color:var(--brand); }
.fos-input[aria-invalid="true"] { border-color:var(--danger-fg); }
.fos-input:disabled { opacity:.5; cursor:not-allowed; background:var(--surface-sunken); }
```

- [ ] **Step 5: Export from `src/index.ts`**

Add:
```ts
export { Input } from "./components/Input";
export type { InputProps, InputSize } from "./components/Input";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- Input`
Expected: 4 passed.

- [ ] **Step 7: Run token purity**

Run: `npm run tokens:purity`
Expected: `✓ token-purity: clean`.

- [ ] **Step 8: Add the story file**

Create `src/components/Input.stories.tsx`:
```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { Input } from "./Input";

const meta: Meta<typeof Input> = {
  title: "Forms/Input",
  component: Input,
  args: { placeholder: "اكتب هنا…", inputSize: "md" },
  argTypes: { inputSize: { control: "inline-radio", options: ["md", "sm"] } },
};
export default meta;
type S = StoryObj<typeof Input>;

export const Default: S = { args: { "aria-label": "الاسم", placeholder: "اسم المزرعة" } };
export const Small: S = { args: { "aria-label": "كود", inputSize: "sm", placeholder: "الكود" } };
export const Invalid: S = { args: { "aria-label": "البريد", invalid: true, defaultValue: "خطأ" } };
export const Disabled: S = { args: { "aria-label": "مقفل", disabled: true, defaultValue: "غير قابل للتعديل" } };
export const Gallery: S = {
  render: () => (
    <div style={{ display: "grid", gap: 10, maxWidth: 320 }}>
      <Input aria-label="عادي" placeholder="عادي" />
      <Input aria-label="صغير" inputSize="sm" placeholder="صغير" />
      <Input aria-label="خطأ" invalid defaultValue="قيمة غير صالحة" />
      <Input aria-label="معطل" disabled defaultValue="معطل" />
    </div>
  ),
};
```

- [ ] **Step 9: Commit**

```bash
git add src/components/Input.tsx src/components/Input.test.tsx src/components/Input.stories.tsx src/styles/components.css src/index.ts
git commit -m "feat(forms): add Input (controlled text control, density-aware)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Textarea

**Files:**
- Create: `src/components/Textarea.tsx`, `src/components/Textarea.stories.tsx`, `src/components/Textarea.test.tsx`
- Modify: `src/styles/components.css`, `src/index.ts`

**Interfaces:**
- Produces:
  - `interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> { invalid?: boolean }`.
  - `const Textarea: React.ForwardRefExoticComponent<TextareaProps & React.RefAttributes<HTMLTextAreaElement>>`.

- [ ] **Step 1: Write the failing test**

Create `src/components/Textarea.test.tsx`:
```tsx
import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { Textarea } from "./Textarea";

describe("Textarea", () => {
  it("accepts typed multi-line input (uncontrolled)", async () => {
    render(<Textarea aria-label="ملاحظات" />);
    const el = screen.getByLabelText("ملاحظات");
    await userEvent.type(el, "سطر");
    expect((el as HTMLTextAreaElement).value).toBe("سطر");
  });
  it("reflects invalid via aria-invalid", () => {
    render(<Textarea aria-label="ملاحظات" invalid />);
    expect(screen.getByLabelText("ملاحظات")).toHaveAttribute("aria-invalid", "true");
  });
  it("forwards the ref", () => {
    let el: HTMLTextAreaElement | null = null;
    render(<Textarea aria-label="ملاحظات" ref={(n) => { el = n; }} />);
    expect(el).toBeInstanceOf(HTMLTextAreaElement);
  });
  it("has no axe violations", async () => {
    const { container } = render(<Textarea aria-label="ملاحظات" defaultValue="نص" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- Textarea`
Expected: FAIL — `Cannot find module './Textarea'`.

- [ ] **Step 3: Implement `src/components/Textarea.tsx`**

```tsx
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
```

- [ ] **Step 4: Append the CSS block to `src/styles/components.css`**

```css
/* ---- Textarea ---- */
.fos-textarea { inline-size:100%; border:1px solid var(--line); border-radius:var(--radius-control);
  background:var(--surface); color:var(--ink); font-family:inherit; font-size:var(--text-sm);
  line-height:var(--leading); padding-block:var(--space-2); padding-inline:var(--control-pad-x);
  resize:vertical; min-block-size:var(--control-h); transition:border-color var(--dur-fast) var(--ease); }
.fos-textarea::placeholder { color:var(--ink-muted); }
.fos-textarea:focus-visible { outline:2px solid var(--focus-ring); outline-offset:1px; border-color:var(--brand); }
.fos-textarea[aria-invalid="true"] { border-color:var(--danger-fg); }
.fos-textarea:disabled { opacity:.5; cursor:not-allowed; background:var(--surface-sunken); }
```

- [ ] **Step 5: Export from `src/index.ts`**

Add:
```ts
export { Textarea } from "./components/Textarea";
export type { TextareaProps } from "./components/Textarea";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- Textarea`
Expected: 4 passed.

- [ ] **Step 7: Run token purity**

Run: `npm run tokens:purity`
Expected: `✓ token-purity: clean`.

- [ ] **Step 8: Add the story file**

Create `src/components/Textarea.stories.tsx`:
```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { Textarea } from "./Textarea";

const meta: Meta<typeof Textarea> = {
  title: "Forms/Textarea",
  component: Textarea,
  args: { placeholder: "اكتب ملاحظاتك…", rows: 3 },
};
export default meta;
type S = StoryObj<typeof Textarea>;

export const Default: S = { args: { "aria-label": "ملاحظات", placeholder: "ملاحظات الزيارة" } };
export const Invalid: S = { args: { "aria-label": "ملاحظات", invalid: true, defaultValue: "نص غير صالح" } };
export const Disabled: S = { args: { "aria-label": "مقفل", disabled: true, defaultValue: "للقراءة فقط" } };
export const Gallery: S = {
  render: () => (
    <div style={{ display: "grid", gap: 10, maxWidth: 360 }}>
      <Textarea aria-label="عادي" placeholder="اكتب هنا…" />
      <Textarea aria-label="خطأ" invalid defaultValue="غير صالح" />
      <Textarea aria-label="معطل" disabled defaultValue="معطل" />
    </div>
  ),
};
```

- [ ] **Step 9: Commit**

```bash
git add src/components/Textarea.tsx src/components/Textarea.test.tsx src/components/Textarea.stories.tsx src/styles/components.css src/index.ts
git commit -m "feat(forms): add Textarea (controlled multi-line control)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: NumberField

**Files:**
- Create: `src/components/NumberField.tsx`, `src/components/NumberField.stories.tsx`, `src/components/NumberField.test.tsx`
- Modify: `src/styles/components.css`, `src/index.ts`

**Interfaces:**
- Consumes: `IconButton` (Task 1) for the step buttons.
- Produces:
  - `interface NumberFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue" | "onChange" | "size"> { value?: number | ""; defaultValue?: number; onValueChange?: (value: number | "") => void; step?: number; min?: number; max?: number; invalid?: boolean; decrementLabel: string; incrementLabel: string }`.
  - `const NumberField: React.ForwardRefExoticComponent<NumberFieldProps & React.RefAttributes<HTMLInputElement>>`.

- [ ] **Step 1: Write the failing test**

Create `src/components/NumberField.test.tsx`:
```tsx
import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import * as React from "react";
import { NumberField } from "./NumberField";

function Controlled() {
  const [v, setV] = React.useState<number | "">(2);
  return (
    <NumberField
      aria-label="الكمية"
      value={v}
      onValueChange={setV}
      step={1}
      min={0}
      max={5}
      decrementLabel="إنقاص"
      incrementLabel="زيادة"
    />
  );
}

describe("NumberField", () => {
  it("increments via the step-up button, clamped to max", async () => {
    render(<Controlled />);
    const inc = screen.getByRole("button", { name: "زيادة" });
    const input = screen.getByLabelText("الكمية") as HTMLInputElement;
    expect(input.value).toBe("2");
    await userEvent.click(inc);
    expect(input.value).toBe("3");
  });
  it("decrements and clamps at min", async () => {
    render(<Controlled />);
    const dec = screen.getByRole("button", { name: "إنقاص" });
    await userEvent.click(dec);
    await userEvent.click(dec);
    await userEvent.click(dec); // would go below 0
    expect((screen.getByLabelText("الكمية") as HTMLInputElement).value).toBe("0");
  });
  it("reflects invalid via aria-invalid", () => {
    render(<NumberField aria-label="ك" invalid decrementLabel="-" incrementLabel="+" defaultValue={1} />);
    expect(screen.getByLabelText("ك")).toHaveAttribute("aria-invalid", "true");
  });
  it("has no axe violations", async () => {
    const { container } = render(
      <NumberField aria-label="الكمية" defaultValue={1} decrementLabel="إنقاص" incrementLabel="زيادة" />
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- NumberField`
Expected: FAIL — `Cannot find module './NumberField'`.

- [ ] **Step 3: Implement `src/components/NumberField.tsx`**

```tsx
import * as React from "react";
import { IconButton } from "./IconButton";

export interface NumberFieldProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "type" | "value" | "defaultValue" | "onChange" | "size"
  > {
  /** Controlled numeric value (`""` while the field is empty). */
  value?: number | "";
  /** Uncontrolled initial value. */
  defaultValue?: number;
  /** Called with the parsed value on every change/step. */
  onValueChange?: (value: number | "") => void;
  /** Step increment for the buttons and arrow keys. */
  step?: number;
  min?: number;
  max?: number;
  /** Marks the field invalid; sets `aria-invalid`. */
  invalid?: boolean;
  /** Accessible name for the decrement button. */
  decrementLabel: string;
  /** Accessible name for the increment button. */
  incrementLabel: string;
}

function clamp(n: number, min?: number, max?: number): number {
  if (min != null && n < min) return min;
  if (max != null && n > max) return max;
  return n;
}

/** Numeric input with stepper buttons. Controlled via `value`/`onValueChange`, or uncontrolled. */
export const NumberField = React.forwardRef<HTMLInputElement, NumberFieldProps>(function NumberField(
  {
    value, defaultValue, onValueChange, step = 1, min, max, invalid,
    decrementLabel, incrementLabel, disabled, className = "", ...rest
  },
  ref
) {
  const isControlled = value !== undefined;
  const [inner, setInner] = React.useState<number | "">(defaultValue ?? "");
  const current = isControlled ? (value as number | "") : inner;

  const commit = (next: number | "") => {
    if (!isControlled) setInner(next);
    onValueChange?.(next);
  };

  const stepBy = (dir: 1 | -1) => {
    const base = current === "" ? 0 : current;
    commit(clamp(base + dir * step, min, max));
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw === "") return commit("");
    const n = Number(raw);
    if (!Number.isNaN(n)) commit(n);
  };

  return (
    <div className={`fos-numfield ${className}`.trim()} data-disabled={disabled || undefined}>
      <IconButton
        label={decrementLabel}
        size="sm"
        onClick={() => stepBy(-1)}
        disabled={disabled || (min != null && current !== "" && current <= min)}
      >
        −
      </IconButton>
      <input
        ref={ref}
        type="number"
        className="fos-numfield__input"
        value={current}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={onInputChange}
        {...rest}
      />
      <IconButton
        label={incrementLabel}
        size="sm"
        onClick={() => stepBy(1)}
        disabled={disabled || (max != null && current !== "" && current >= max)}
      >
        ＋
      </IconButton>
    </div>
  );
});
```

- [ ] **Step 4: Append the CSS block to `src/styles/components.css`**

```css
/* ---- NumberField ---- */
.fos-numfield { display:inline-flex; align-items:center; gap:var(--space-1);
  border:1px solid var(--line); border-radius:var(--radius-control); background:var(--surface);
  padding-inline:var(--space-1); }
.fos-numfield:focus-within { outline:2px solid var(--focus-ring); outline-offset:1px; border-color:var(--brand); }
.fos-numfield[data-disabled] { opacity:.5; }
.fos-numfield__input { inline-size:5ch; border:none; background:transparent; color:var(--ink);
  font-family:inherit; font-size:var(--text-sm); text-align:center; font-variant-numeric:tabular-nums;
  block-size:var(--control-h); -moz-appearance:textfield; }
.fos-numfield__input::-webkit-outer-spin-button,
.fos-numfield__input::-webkit-inner-spin-button { -webkit-appearance:none; margin:0; }
.fos-numfield__input:focus-visible { outline:none; }
.fos-numfield[aria-invalid="true"], .fos-numfield:has(.fos-numfield__input[aria-invalid="true"]) { border-color:var(--danger-fg); }
```

- [ ] **Step 5: Export from `src/index.ts`**

Add:
```ts
export { NumberField } from "./components/NumberField";
export type { NumberFieldProps } from "./components/NumberField";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- NumberField`
Expected: 4 passed.

- [ ] **Step 7: Run token purity**

Run: `npm run tokens:purity`
Expected: `✓ token-purity: clean`.

- [ ] **Step 8: Add the story file**

Create `src/components/NumberField.stories.tsx`:
```tsx
import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";
import { NumberField } from "./NumberField";

const meta: Meta<typeof NumberField> = {
  title: "Forms/NumberField",
  component: NumberField,
  args: { decrementLabel: "إنقاص", incrementLabel: "زيادة", step: 1, min: 0, max: 20 },
};
export default meta;
type S = StoryObj<typeof NumberField>;

export const Uncontrolled: S = { args: { "aria-label": "عدد النخلات", defaultValue: 3 } };

export const Controlled: S = {
  render: (args) => {
    const [v, setV] = React.useState<number | "">(5);
    return (
      <div style={{ display: "grid", gap: 8 }}>
        <NumberField {...args} aria-label="الكمية" value={v} onValueChange={setV} />
        <span style={{ fontSize: 12 }}>القيمة: {String(v)}</span>
      </div>
    );
  },
};

export const Invalid: S = { args: { "aria-label": "كمية", invalid: true, defaultValue: 0 } };
export const Disabled: S = { args: { "aria-label": "كمية", disabled: true, defaultValue: 2 } };

export const Gallery: S = {
  render: () => (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      <NumberField aria-label="أ" defaultValue={1} decrementLabel="إنقاص" incrementLabel="زيادة" />
      <NumberField aria-label="ب" invalid defaultValue={0} decrementLabel="إنقاص" incrementLabel="زيادة" />
      <NumberField aria-label="ج" disabled defaultValue={2} decrementLabel="إنقاص" incrementLabel="زيادة" />
    </div>
  ),
};
```

- [ ] **Step 9: Commit**

```bash
git add src/components/NumberField.tsx src/components/NumberField.test.tsx src/components/NumberField.stories.tsx src/styles/components.css src/index.ts
git commit -m "feat(forms): add NumberField (stepper, controlled/uncontrolled, clamped)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Select

**Files:**
- Create: `src/components/Select.tsx`, `src/components/Select.stories.tsx`, `src/components/Select.test.tsx`
- Modify: `src/styles/components.css`, `src/index.ts`

**Interfaces:**
- Produces:
  - `interface SelectOption { value: string; label: React.ReactNode; disabled?: boolean }`.
  - `type SelectSize = "md" | "sm"`.
  - `interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> { options: SelectOption[]; placeholder?: string; selectSize?: SelectSize; invalid?: boolean }`.
  - `const Select: React.ForwardRefExoticComponent<SelectProps & React.RefAttributes<HTMLSelectElement>>`.

- [ ] **Step 1: Write the failing test**

Create `src/components/Select.test.tsx`:
```tsx
import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { Select } from "./Select";

const options = [
  { value: "ok", label: "سليمة" },
  { value: "low", label: "منخفضة" },
  { value: "crit", label: "حرجة", disabled: true },
];

describe("Select", () => {
  it("renders options and a placeholder", () => {
    render(<Select aria-label="الحالة" options={options} placeholder="اختر…" />);
    expect(screen.getByRole("option", { name: "اختر…" })).toBeDisabled();
    expect(screen.getByRole("option", { name: "سليمة" })).toBeInTheDocument();
  });
  it("supports controlled selection", async () => {
    let value = "ok";
    render(<Select aria-label="الحالة" options={options} value={value} onChange={(e) => { value = e.target.value; }} />);
    await userEvent.selectOptions(screen.getByLabelText("الحالة"), "low");
    expect(value).toBe("low");
  });
  it("reflects invalid via aria-invalid", () => {
    render(<Select aria-label="الحالة" options={options} invalid />);
    expect(screen.getByLabelText("الحالة")).toHaveAttribute("aria-invalid", "true");
  });
  it("has no axe violations", async () => {
    const { container } = render(<Select aria-label="الحالة" options={options} defaultValue="ok" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- Select`
Expected: FAIL — `Cannot find module './Select'`.

- [ ] **Step 3: Implement `src/components/Select.tsx`**

```tsx
import * as React from "react";

export interface SelectOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export type SelectSize = "md" | "sm";

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  /** The options to render. */
  options: SelectOption[];
  /** Optional disabled placeholder shown first. */
  placeholder?: string;
  /** Control size. */
  selectSize?: SelectSize;
  /** Marks the field invalid; sets `aria-invalid`. */
  invalid?: boolean;
}

/** Native single-select. Controlled-first; pass `options`; compose with `FormRow`. */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, placeholder, selectSize = "md", invalid, className = "", defaultValue, value, ...rest },
  ref
) {
  return (
    <select
      ref={ref}
      className={`fos-select fos-select--${selectSize} ${className}`.trim()}
      aria-invalid={invalid || undefined}
      value={value}
      defaultValue={value === undefined && defaultValue === undefined && placeholder ? "" : defaultValue}
      {...rest}
    >
      {placeholder != null && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
});
```

- [ ] **Step 4: Append the CSS block to `src/styles/components.css`**

```css
/* ---- Select ---- */
.fos-select { inline-size:100%; border:1px solid var(--line); border-radius:var(--radius-control);
  background:var(--surface); color:var(--ink); font-family:inherit; font-size:var(--text-sm);
  padding-inline:var(--control-pad-x); cursor:pointer;
  transition:border-color var(--dur-fast) var(--ease); }
.fos-select--md { block-size:var(--control-h); }
.fos-select--sm { block-size:30px; font-size:var(--text-xs); }
.fos-select:focus-visible { outline:2px solid var(--focus-ring); outline-offset:1px; border-color:var(--brand); }
.fos-select[aria-invalid="true"] { border-color:var(--danger-fg); }
.fos-select:disabled { opacity:.5; cursor:not-allowed; background:var(--surface-sunken); }
```

- [ ] **Step 5: Export from `src/index.ts`**

Add:
```ts
export { Select } from "./components/Select";
export type { SelectProps, SelectOption, SelectSize } from "./components/Select";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- Select`
Expected: 4 passed.

- [ ] **Step 7: Run token purity**

Run: `npm run tokens:purity`
Expected: `✓ token-purity: clean`.

- [ ] **Step 8: Add the story file**

Create `src/components/Select.stories.tsx`:
```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { Select } from "./Select";

const options = [
  { value: "ok", label: "سليمة" },
  { value: "low", label: "منخفضة" },
  { value: "crit", label: "حرجة" },
];

const meta: Meta<typeof Select> = {
  title: "Forms/Select",
  component: Select,
  args: { options, selectSize: "md" },
  argTypes: { selectSize: { control: "inline-radio", options: ["md", "sm"] } },
};
export default meta;
type S = StoryObj<typeof Select>;

export const Default: S = { args: { "aria-label": "الحالة", placeholder: "اختر الحالة…" } };
export const Small: S = { args: { "aria-label": "الحالة", selectSize: "sm", defaultValue: "ok" } };
export const Invalid: S = { args: { "aria-label": "الحالة", invalid: true, placeholder: "مطلوب" } };
export const Disabled: S = { args: { "aria-label": "الحالة", disabled: true, defaultValue: "ok" } };
export const Gallery: S = {
  render: () => (
    <div style={{ display: "grid", gap: 10, maxWidth: 280 }}>
      <Select aria-label="أ" options={options} placeholder="اختر…" />
      <Select aria-label="ب" options={options} selectSize="sm" defaultValue="low" />
      <Select aria-label="ج" options={options} invalid placeholder="مطلوب" />
      <Select aria-label="د" options={options} disabled defaultValue="ok" />
    </div>
  ),
};
```

- [ ] **Step 9: Commit**

```bash
git add src/components/Select.tsx src/components/Select.test.tsx src/components/Select.stories.tsx src/styles/components.css src/index.ts
git commit -m "feat(forms): add Select (native single-select with options + placeholder)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Combobox

**Files:**
- Create: `src/components/Combobox.tsx`, `src/components/Combobox.stories.tsx`, `src/components/Combobox.test.tsx`
- Modify: `src/styles/components.css`, `src/index.ts`

**Interfaces:**
- Produces:
  - `interface ComboboxOption { value: string; label: string }`.
  - `interface ComboboxProps { options: ComboboxOption[]; value?: string; onValueChange?: (value: string) => void; placeholder?: string; invalid?: boolean; id?: string; "aria-label"?: string; "aria-labelledby"?: string; "aria-describedby"?: string; disabled?: boolean; className?: string }`.
  - `const Combobox: React.ForwardRefExoticComponent<ComboboxProps & React.RefAttributes<HTMLInputElement>>`.
- Behavior: editable input filters `options` (substring on `label`); a `role="listbox"` of `role="option"` items opens on focus/typing; ArrowDown/ArrowUp move active option, Enter selects, Escape closes; `aria-expanded`, `aria-controls`, `aria-activedescendant`, `aria-selected` wired.

- [ ] **Step 1: Write the failing test**

Create `src/components/Combobox.test.tsx`:
```tsx
import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import * as React from "react";
import { Combobox } from "./Combobox";

const options = [
  { value: "khalas", label: "خلاص" },
  { value: "barhi", label: "برحي" },
  { value: "sukkari", label: "سكري" },
];

function Harness() {
  const [v, setV] = React.useState("");
  return <Combobox aria-label="الصنف" options={options} value={v} onValueChange={setV} placeholder="ابحث…" />;
}

describe("Combobox", () => {
  it("exposes a combobox role with listbox semantics", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox", { name: "الصنف" });
    expect(input).toHaveAttribute("aria-expanded", "false");
  });
  it("opens and filters options on typing", async () => {
    render(<Harness />);
    const input = screen.getByRole("combobox", { name: "الصنف" });
    await userEvent.type(input, "بر");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    const opts = screen.getAllByRole("option");
    expect(opts).toHaveLength(1);
    expect(opts[0]).toHaveTextContent("برحي");
  });
  it("navigates with arrows and selects with Enter", async () => {
    render(<Harness />);
    const input = screen.getByRole("combobox", { name: "الصنف" }) as HTMLInputElement;
    await userEvent.click(input);
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(input.value).toBe("برحي");
    expect(input).toHaveAttribute("aria-expanded", "false");
  });
  it("closes on Escape", async () => {
    render(<Harness />);
    const input = screen.getByRole("combobox", { name: "الصنف" });
    await userEvent.click(input);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
  it("has no axe violations", async () => {
    const { container } = render(<Harness />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- Combobox`
Expected: FAIL — `Cannot find module './Combobox'`.

- [ ] **Step 3: Implement `src/components/Combobox.tsx`**

```tsx
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
```

- [ ] **Step 4: Append the CSS block to `src/styles/components.css`**

```css
/* ---- Combobox ---- */
.fos-combobox { position:relative; inline-size:100%; }
.fos-combobox__input { inline-size:100%; border:1px solid var(--line); border-radius:var(--radius-control);
  background:var(--surface); color:var(--ink); font-family:inherit; font-size:var(--text-sm);
  block-size:var(--control-h); padding-inline:var(--control-pad-x);
  transition:border-color var(--dur-fast) var(--ease); }
.fos-combobox__input::placeholder { color:var(--ink-muted); }
.fos-combobox__input:focus-visible { outline:2px solid var(--focus-ring); outline-offset:1px; border-color:var(--brand); }
.fos-combobox__input[aria-invalid="true"] { border-color:var(--danger-fg); }
.fos-combobox__list { position:absolute; inset-inline:0; inset-block-start:calc(100% + var(--space-1));
  margin:0; padding:var(--space-1); list-style:none; z-index:var(--z-sticky);
  background:var(--surface-raised); border:1px solid var(--line); border-radius:var(--radius-control);
  box-shadow:var(--shadow-card); max-block-size:240px; overflow:auto; }
.fos-combobox__option { padding-block:var(--space-2); padding-inline:var(--space-3);
  border-radius:var(--radius-1); font-size:var(--text-sm); color:var(--ink); cursor:pointer; }
.fos-combobox__option--active { background:color-mix(in srgb, var(--brand) 14%, var(--surface)); }
.fos-combobox__option[aria-selected="true"] { font-weight:var(--weight-bold); color:var(--brand-hover); }
```

- [ ] **Step 5: Export from `src/index.ts`**

Add:
```ts
export { Combobox } from "./components/Combobox";
export type { ComboboxProps, ComboboxOption } from "./components/Combobox";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- Combobox`
Expected: 5 passed.

- [ ] **Step 7: Run token purity**

Run: `npm run tokens:purity`
Expected: `✓ token-purity: clean`.

- [ ] **Step 8: Add the story file**

Create `src/components/Combobox.stories.tsx`:
```tsx
import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";
import { Combobox } from "./Combobox";

const options = [
  { value: "khalas", label: "خلاص" },
  { value: "barhi", label: "برحي" },
  { value: "sukkari", label: "سكري" },
  { value: "ajwa", label: "عجوة" },
  { value: "medjool", label: "مجدول" },
];

const meta: Meta<typeof Combobox> = {
  title: "Forms/Combobox",
  component: Combobox,
  args: { options, placeholder: "ابحث عن الصنف…" },
};
export default meta;
type S = StoryObj<typeof Combobox>;

export const Default: S = {
  render: (args) => {
    const [v, setV] = React.useState("");
    return (
      <div style={{ maxWidth: 280 }}>
        <Combobox {...args} aria-label="الصنف" value={v} onValueChange={setV} />
      </div>
    );
  },
};

export const Invalid: S = {
  render: (args) => {
    const [v, setV] = React.useState("");
    return <div style={{ maxWidth: 280 }}><Combobox {...args} aria-label="الصنف" invalid value={v} onValueChange={setV} /></div>;
  },
};

export const Gallery: S = {
  render: () => {
    const [a, setA] = React.useState("");
    const [b, setB] = React.useState("خلاص");
    return (
      <div style={{ display: "grid", gap: 14, maxWidth: 280 }}>
        <Combobox aria-label="فارغ" options={options} value={a} onValueChange={setA} placeholder="ابحث…" />
        <Combobox aria-label="محدد" options={options} value={b} onValueChange={setB} />
      </div>
    );
  },
};
```

- [ ] **Step 9: Commit**

```bash
git add src/components/Combobox.tsx src/components/Combobox.test.tsx src/components/Combobox.stories.tsx src/styles/components.css src/index.ts
git commit -m "feat(forms): add Combobox (ARIA listbox autocomplete, arrow-key nav)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Checkbox

**Files:**
- Create: `src/components/Checkbox.tsx`, `src/components/Checkbox.stories.tsx`, `src/components/Checkbox.test.tsx`
- Modify: `src/styles/components.css`, `src/index.ts`

**Interfaces:**
- Produces:
  - `interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> { label: React.ReactNode; invalid?: boolean }`.
  - `const Checkbox: React.ForwardRefExoticComponent<CheckboxProps & React.RefAttributes<HTMLInputElement>>`.

- [ ] **Step 1: Write the failing test**

Create `src/components/Checkbox.test.tsx`:
```tsx
import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { Checkbox } from "./Checkbox";

describe("Checkbox", () => {
  it("associates the visible label with the input", () => {
    render(<Checkbox label="موافق على الشروط" />);
    expect(screen.getByRole("checkbox", { name: "موافق على الشروط" })).toBeInTheDocument();
  });
  it("toggles on label click", async () => {
    let checked = false;
    render(<Checkbox label="تأكيد" checked={checked} onChange={(e) => { checked = e.target.checked; }} />);
    await userEvent.click(screen.getByText("تأكيد"));
    expect(checked).toBe(true);
  });
  it("forwards the ref", () => {
    let el: HTMLInputElement | null = null;
    render(<Checkbox label="x" ref={(n) => { el = n; }} />);
    expect(el).toBeInstanceOf(HTMLInputElement);
  });
  it("has no axe violations", async () => {
    const { container } = render(<Checkbox label="موافق" defaultChecked />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- Checkbox`
Expected: FAIL — `Cannot find module './Checkbox'`.

- [ ] **Step 3: Implement `src/components/Checkbox.tsx`**

```tsx
import * as React from "react";

let uid = 0;

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Visible label, associated to the input. */
  label: React.ReactNode;
  /** Marks the field invalid; sets `aria-invalid`. */
  invalid?: boolean;
}

/** Labelled checkbox. Controlled via `checked`/`onChange`, or uncontrolled with `defaultChecked`. */
export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, invalid, id, disabled, className = "", ...rest },
  ref
) {
  const autoId = React.useMemo(() => id ?? `fos-checkbox-${++uid}`, [id]);
  return (
    <label className={`fos-checkbox ${className}`.trim()} data-disabled={disabled || undefined}>
      <input
        ref={ref}
        type="checkbox"
        id={autoId}
        className="fos-checkbox__input"
        disabled={disabled}
        aria-invalid={invalid || undefined}
        {...rest}
      />
      <span className="fos-checkbox__box" aria-hidden="true" />
      <span className="fos-checkbox__label">{label}</span>
    </label>
  );
});
```

- [ ] **Step 4: Append the CSS block to `src/styles/components.css`**

```css
/* ---- Checkbox ---- */
.fos-checkbox { display:inline-flex; align-items:center; gap:var(--space-2); cursor:pointer;
  font-size:var(--text-sm); color:var(--ink); }
.fos-checkbox[data-disabled] { opacity:.5; cursor:not-allowed; }
.fos-checkbox__input { position:absolute; opacity:0; inline-size:1px; block-size:1px; }
.fos-checkbox__box { inline-size:18px; block-size:18px; flex:none; border:1px solid var(--line);
  border-radius:var(--radius-1); background:var(--surface); display:grid; place-items:center;
  transition:background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease); }
.fos-checkbox__box::after { content:"✓"; font-size:13px; line-height:1; color:var(--brand-contrast);
  transform:scale(0); transition:transform var(--dur-fast) var(--ease); }
.fos-checkbox__input:checked + .fos-checkbox__box { background:var(--brand); border-color:var(--brand); }
.fos-checkbox__input:checked + .fos-checkbox__box::after { transform:scale(1); }
.fos-checkbox__input:focus-visible + .fos-checkbox__box { outline:2px solid var(--focus-ring); outline-offset:2px; }
.fos-checkbox__input[aria-invalid="true"] + .fos-checkbox__box { border-color:var(--danger-fg); }
```

- [ ] **Step 5: Export from `src/index.ts`**

Add:
```ts
export { Checkbox } from "./components/Checkbox";
export type { CheckboxProps } from "./components/Checkbox";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- Checkbox`
Expected: 4 passed.

- [ ] **Step 7: Run token purity**

Run: `npm run tokens:purity`
Expected: `✓ token-purity: clean`.

- [ ] **Step 8: Add the story file**

Create `src/components/Checkbox.stories.tsx`:
```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { Checkbox } from "./Checkbox";

const meta: Meta<typeof Checkbox> = {
  title: "Forms/Checkbox",
  component: Checkbox,
  args: { label: "موافق على الشروط" },
};
export default meta;
type S = StoryObj<typeof Checkbox>;

export const Default: S = { args: { label: "تفعيل التنبيهات" } };
export const Checked: S = { args: { label: "مكتمل", defaultChecked: true } };
export const Invalid: S = { args: { label: "إقرار مطلوب", invalid: true } };
export const Disabled: S = { args: { label: "غير متاح", disabled: true } };
export const Gallery: S = {
  render: () => (
    <div style={{ display: "grid", gap: 10 }}>
      <Checkbox label="خيار افتراضي" />
      <Checkbox label="مُحدد" defaultChecked />
      <Checkbox label="خطأ" invalid />
      <Checkbox label="معطل" disabled />
    </div>
  ),
};
```

- [ ] **Step 9: Commit**

```bash
git add src/components/Checkbox.tsx src/components/Checkbox.test.tsx src/components/Checkbox.stories.tsx src/styles/components.css src/index.ts
git commit -m "feat(forms): add Checkbox (labelled, controlled-first)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Radio

**Files:**
- Create: `src/components/Radio.tsx`, `src/components/Radio.stories.tsx`, `src/components/Radio.test.tsx`
- Modify: `src/styles/components.css`, `src/index.ts`

**Interfaces:**
- Produces:
  - `interface RadioOption { value: string; label: React.ReactNode; disabled?: boolean }`.
  - `interface RadioGroupProps { name: string; options: RadioOption[]; value?: string; defaultValue?: string; onValueChange?: (value: string) => void; legend: React.ReactNode; invalid?: boolean; disabled?: boolean; className?: string }`.
  - `function RadioGroup(props: RadioGroupProps): JSX.Element` (a `<fieldset>` + `<legend>` wrapping native radios — no ref needed; group semantics live on the fieldset).

- [ ] **Step 1: Write the failing test**

Create `src/components/Radio.test.tsx`:
```tsx
import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import * as React from "react";
import { RadioGroup } from "./Radio";

const options = [
  { value: "owner", label: "مالك" },
  { value: "manager", label: "مدير" },
  { value: "worker", label: "عامل" },
];

function Harness() {
  const [v, setV] = React.useState("owner");
  return <RadioGroup name="role" legend="الدور" options={options} value={v} onValueChange={setV} />;
}

describe("RadioGroup", () => {
  it("renders one radio per option grouped under the legend", () => {
    render(<Harness />);
    expect(screen.getByRole("group", { name: "الدور" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });
  it("selects on click", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("radio", { name: "مدير" }));
    expect((screen.getByRole("radio", { name: "مدير" }) as HTMLInputElement).checked).toBe(true);
  });
  it("has no axe violations", async () => {
    const { container } = render(<Harness />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- Radio`
Expected: FAIL — `Cannot find module './Radio'`.

- [ ] **Step 3: Implement `src/components/Radio.tsx`**

```tsx
import * as React from "react";

let uid = 0;

export interface RadioOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps {
  /** Shared radio `name` (groups the inputs). */
  name: string;
  /** The options to render. */
  options: RadioOption[];
  /** Controlled selected value. */
  value?: string;
  /** Uncontrolled initial value. */
  defaultValue?: string;
  /** Called with the newly selected value. */
  onValueChange?: (value: string) => void;
  /** Group label (rendered as the fieldset legend). */
  legend: React.ReactNode;
  /** Marks the group invalid; sets `aria-invalid` on the fieldset. */
  invalid?: boolean;
  /** Disables the whole group. */
  disabled?: boolean;
  className?: string;
}

/** Radio group as a `<fieldset>` + `<legend>` wrapping native radios. Controlled-first. */
export function RadioGroup({
  name, options, value, defaultValue, onValueChange, legend, invalid, disabled, className = "",
}: RadioGroupProps) {
  const isControlled = value !== undefined;
  const [inner, setInner] = React.useState(defaultValue ?? "");
  const current = isControlled ? value : inner;
  const groupId = React.useMemo(() => `fos-radio-${++uid}`, []);

  const onChange = (next: string) => {
    if (!isControlled) setInner(next);
    onValueChange?.(next);
  };

  return (
    <fieldset
      className={`fos-radiogroup ${className}`.trim()}
      aria-invalid={invalid || undefined}
      disabled={disabled}
    >
      <legend className="fos-radiogroup__legend">{legend}</legend>
      {options.map((o, i) => {
        const optId = `${groupId}-${i}`;
        return (
          <label key={o.value} className="fos-radio" data-disabled={o.disabled || undefined} htmlFor={optId}>
            <input
              type="radio"
              id={optId}
              name={name}
              className="fos-radio__input"
              value={o.value}
              checked={current === o.value}
              disabled={o.disabled}
              onChange={() => onChange(o.value)}
            />
            <span className="fos-radio__dot" aria-hidden="true" />
            <span className="fos-radio__label">{o.label}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
```

- [ ] **Step 4: Append the CSS block to `src/styles/components.css`**

```css
/* ---- Radio ---- */
.fos-radiogroup { border:none; margin:0; padding:0; display:grid; gap:var(--space-2); }
.fos-radiogroup__legend { font-size:var(--text-xs); font-weight:var(--weight-bold); color:var(--ink-muted); padding:0; margin-block-end:var(--space-1); }
.fos-radio { display:inline-flex; align-items:center; gap:var(--space-2); cursor:pointer; font-size:var(--text-sm); color:var(--ink); }
.fos-radio[data-disabled] { opacity:.5; cursor:not-allowed; }
.fos-radio__input { position:absolute; opacity:0; inline-size:1px; block-size:1px; }
.fos-radio__dot { inline-size:18px; block-size:18px; flex:none; border:1px solid var(--line);
  border-radius:var(--radius-pill); background:var(--surface); display:grid; place-items:center;
  transition:border-color var(--dur-fast) var(--ease); }
.fos-radio__dot::after { content:""; inline-size:9px; block-size:9px; border-radius:var(--radius-pill);
  background:var(--brand); transform:scale(0); transition:transform var(--dur-fast) var(--ease); }
.fos-radio__input:checked + .fos-radio__dot { border-color:var(--brand); }
.fos-radio__input:checked + .fos-radio__dot::after { transform:scale(1); }
.fos-radio__input:focus-visible + .fos-radio__dot { outline:2px solid var(--focus-ring); outline-offset:2px; }
```

- [ ] **Step 5: Export from `src/index.ts`**

Add:
```ts
export { RadioGroup } from "./components/Radio";
export type { RadioGroupProps, RadioOption } from "./components/Radio";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- Radio`
Expected: 3 passed.

- [ ] **Step 7: Run token purity**

Run: `npm run tokens:purity`
Expected: `✓ token-purity: clean`.

- [ ] **Step 8: Add the story file**

Create `src/components/Radio.stories.tsx`:
```tsx
import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";
import { RadioGroup } from "./Radio";

const options = [
  { value: "owner", label: "مالك" },
  { value: "manager", label: "مدير" },
  { value: "worker", label: "عامل" },
];

const meta: Meta<typeof RadioGroup> = {
  title: "Forms/RadioGroup",
  component: RadioGroup,
  args: { name: "role", legend: "الدور", options },
};
export default meta;
type S = StoryObj<typeof RadioGroup>;

export const Default: S = {
  render: (args) => {
    const [v, setV] = React.useState("owner");
    return <RadioGroup {...args} value={v} onValueChange={setV} />;
  },
};

export const Disabled: S = { args: { defaultValue: "manager", disabled: true } };

export const Gallery: S = {
  render: () => {
    const [v, setV] = React.useState("worker");
    return (
      <div style={{ display: "grid", gap: 20 }}>
        <RadioGroup name="r1" legend="الدور" options={options} value={v} onValueChange={setV} />
        <RadioGroup name="r2" legend="معطل" options={options} defaultValue="owner" disabled />
      </div>
    );
  },
};
```

- [ ] **Step 9: Commit**

```bash
git add src/components/Radio.tsx src/components/Radio.test.tsx src/components/Radio.stories.tsx src/styles/components.css src/index.ts
git commit -m "feat(forms): add RadioGroup (fieldset/legend, controlled-first)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Switch

**Files:**
- Create: `src/components/Switch.tsx`, `src/components/Switch.stories.tsx`, `src/components/Switch.test.tsx`
- Modify: `src/styles/components.css`, `src/index.ts`

**Interfaces:**
- Produces:
  - `interface SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "type"> { label: string; checked?: boolean; defaultChecked?: boolean; onCheckedChange?: (checked: boolean) => void }`.
  - `const Switch: React.ForwardRefExoticComponent<SwitchProps & React.RefAttributes<HTMLButtonElement>>` — a `<button role="switch" aria-checked>` toggled by click, Space, and Enter.

- [ ] **Step 1: Write the failing test**

Create `src/components/Switch.test.tsx`:
```tsx
import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import * as React from "react";
import { Switch } from "./Switch";

function Harness() {
  const [on, setOn] = React.useState(false);
  return <Switch label="الإشعارات" checked={on} onCheckedChange={setOn} />;
}

describe("Switch", () => {
  it("has switch role with an accessible name and initial state", () => {
    render(<Harness />);
    const sw = screen.getByRole("switch", { name: "الإشعارات" });
    expect(sw).toHaveAttribute("aria-checked", "false");
  });
  it("toggles on click", async () => {
    render(<Harness />);
    const sw = screen.getByRole("switch", { name: "الإشعارات" });
    await userEvent.click(sw);
    expect(sw).toHaveAttribute("aria-checked", "true");
  });
  it("toggles on Space key", async () => {
    render(<Harness />);
    const sw = screen.getByRole("switch", { name: "الإشعارات" });
    sw.focus();
    await userEvent.keyboard(" ");
    expect(sw).toHaveAttribute("aria-checked", "true");
  });
  it("has no axe violations", async () => {
    const { container } = render(<Switch label="الوضع الليلي" defaultChecked />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- Switch`
Expected: FAIL — `Cannot find module './Switch'`.

- [ ] **Step 3: Implement `src/components/Switch.tsx`**

```tsx
import * as React from "react";

export interface SwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "type"> {
  /** Accessible name for the switch. */
  label: string;
  /** Controlled on/off state. */
  checked?: boolean;
  /** Uncontrolled initial state. */
  defaultChecked?: boolean;
  /** Called with the next state on toggle. */
  onCheckedChange?: (checked: boolean) => void;
}

/** Toggle switch as `role="switch"`. Keyboard: Space/Enter (native button) toggles. */
export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { label, checked, defaultChecked, onCheckedChange, disabled, className = "", ...rest },
  ref
) {
  const isControlled = checked !== undefined;
  const [inner, setInner] = React.useState(defaultChecked ?? false);
  const on = isControlled ? (checked as boolean) : inner;

  const toggle = () => {
    const next = !on;
    if (!isControlled) setInner(next);
    onCheckedChange?.(next);
  };

  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`fos-switch ${className}`.trim()}
      data-checked={on || undefined}
      disabled={disabled}
      onClick={toggle}
      {...rest}
    >
      <span className="fos-switch__thumb" aria-hidden="true" />
    </button>
  );
});
```

- [ ] **Step 4: Append the CSS block to `src/styles/components.css`**

```css
/* ---- Switch ---- */
.fos-switch { inline-size:40px; block-size:23px; flex:none; border:1px solid var(--line);
  border-radius:var(--radius-pill); background:var(--surface-sunken); cursor:pointer; padding:2px;
  display:inline-flex; align-items:center; transition:background var(--dur-fast) var(--ease); }
.fos-switch__thumb { inline-size:17px; block-size:17px; border-radius:var(--radius-pill);
  background:var(--surface); box-shadow:var(--shadow-1);
  transition:transform var(--dur-fast) var(--ease); }
.fos-switch[data-checked] { background:var(--brand); border-color:var(--brand); }
.fos-switch[data-checked] .fos-switch__thumb { transform:translateX(calc(-1 * (40px - 17px - 6px))); }
.fos-switch:focus-visible { outline:2px solid var(--focus-ring); outline-offset:2px; }
.fos-switch:disabled { opacity:.5; cursor:not-allowed; }
```
> Note: the thumb translate is negative (RTL): the "on" state slides the thumb toward the inline-start. In an LTR scope, flip via `[dir="ltr"] .fos-switch[data-checked] .fos-switch__thumb { transform:translateX(calc(40px - 17px - 6px)); }` if needed during the a11y pass.

- [ ] **Step 5: Export from `src/index.ts`**

Add:
```ts
export { Switch } from "./components/Switch";
export type { SwitchProps } from "./components/Switch";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- Switch`
Expected: 4 passed.

- [ ] **Step 7: Run token purity**

Run: `npm run tokens:purity`
Expected: `✓ token-purity: clean`.

- [ ] **Step 8: Add the story file**

Create `src/components/Switch.stories.tsx`:
```tsx
import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";
import { Switch } from "./Switch";

const meta: Meta<typeof Switch> = {
  title: "Forms/Switch",
  component: Switch,
  args: { label: "الإشعارات" },
};
export default meta;
type S = StoryObj<typeof Switch>;

export const Off: S = { args: { label: "الإشعارات" } };
export const On: S = { args: { label: "الوضع الليلي", defaultChecked: true } };
export const Disabled: S = { args: { label: "غير متاح", disabled: true } };

export const Controlled: S = {
  render: () => {
    const [on, setOn] = React.useState(true);
    return (
      <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <Switch label="مزامنة" checked={on} onCheckedChange={setOn} />
        <span style={{ fontSize: 13 }}>{on ? "مفعّل" : "متوقف"}</span>
      </label>
    );
  },
};

export const Gallery: S = {
  render: () => (
    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
      <Switch label="إيقاف" />
      <Switch label="تشغيل" defaultChecked />
      <Switch label="معطل" disabled />
    </div>
  ),
};
```

- [ ] **Step 9: Commit**

```bash
git add src/components/Switch.tsx src/components/Switch.test.tsx src/components/Switch.stories.tsx src/styles/components.css src/index.ts
git commit -m "feat(forms): add Switch (role=switch toggle, controlled-first)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: DateField

**Files:**
- Create: `src/components/DateField.tsx`, `src/components/DateField.stories.tsx`, `src/components/DateField.test.tsx`
- Modify: `src/styles/components.css`, `src/index.ts`

**Interfaces:**
- Produces:
  - `type DateFieldSize = "md" | "sm"`.
  - `interface DateFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size"> { fieldSize?: DateFieldSize; invalid?: boolean }` — wraps a native `<input type="date">` (ISO `yyyy-mm-dd`; locale display is the browser's; the library stays string-only, no i18n).
  - `const DateField: React.ForwardRefExoticComponent<DateFieldProps & React.RefAttributes<HTMLInputElement>>`.

- [ ] **Step 1: Write the failing test**

Create `src/components/DateField.test.tsx`:
```tsx
import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { DateField } from "./DateField";

describe("DateField", () => {
  it("renders a native date input", () => {
    render(<DateField aria-label="تاريخ الزيارة" />);
    const el = screen.getByLabelText("تاريخ الزيارة") as HTMLInputElement;
    expect(el.type).toBe("date");
  });
  it("is controlled and updates value", async () => {
    let value = "";
    const { rerender } = render(
      <DateField aria-label="التاريخ" value={value} onChange={(e) => { value = e.target.value; }} />
    );
    await userEvent.type(screen.getByLabelText("التاريخ"), "2026-06-21");
    rerender(<DateField aria-label="التاريخ" value={value} onChange={() => {}} />);
    expect((screen.getByLabelText("التاريخ") as HTMLInputElement).value).toBe("2026-06-21");
  });
  it("reflects invalid via aria-invalid", () => {
    render(<DateField aria-label="التاريخ" invalid />);
    expect(screen.getByLabelText("التاريخ")).toHaveAttribute("aria-invalid", "true");
  });
  it("has no axe violations", async () => {
    const { container } = render(<DateField aria-label="التاريخ" defaultValue="2026-06-21" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- DateField`
Expected: FAIL — `Cannot find module './DateField'`.

- [ ] **Step 3: Implement `src/components/DateField.tsx`**

```tsx
import * as React from "react";

export type DateFieldSize = "md" | "sm";

export interface DateFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  /** Control size. */
  fieldSize?: DateFieldSize;
  /** Marks the field invalid; sets `aria-invalid`. */
  invalid?: boolean;
}

/**
 * Native date control (`<input type="date">`). Value is the ISO `yyyy-mm-dd` string;
 * the browser renders the locale display. Presentational only — no i18n in the library.
 */
export const DateField = React.forwardRef<HTMLInputElement, DateFieldProps>(function DateField(
  { fieldSize = "md", invalid, className = "", ...rest },
  ref
) {
  return (
    <input
      ref={ref}
      type="date"
      className={`fos-datefield fos-datefield--${fieldSize} ${className}`.trim()}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});
```

- [ ] **Step 4: Append the CSS block to `src/styles/components.css`**

```css
/* ---- DateField ---- */
.fos-datefield { inline-size:100%; border:1px solid var(--line); border-radius:var(--radius-control);
  background:var(--surface); color:var(--ink); font-family:inherit; font-size:var(--text-sm);
  padding-inline:var(--control-pad-x); transition:border-color var(--dur-fast) var(--ease); }
.fos-datefield--md { block-size:var(--control-h); }
.fos-datefield--sm { block-size:30px; font-size:var(--text-xs); }
.fos-datefield:focus-visible { outline:2px solid var(--focus-ring); outline-offset:1px; border-color:var(--brand); }
.fos-datefield[aria-invalid="true"] { border-color:var(--danger-fg); }
.fos-datefield:disabled { opacity:.5; cursor:not-allowed; background:var(--surface-sunken); }
.fos-datefield::-webkit-calendar-picker-indicator { cursor:pointer; opacity:.6; }
```

- [ ] **Step 5: Export from `src/index.ts`**

Add:
```ts
export { DateField } from "./components/DateField";
export type { DateFieldProps, DateFieldSize } from "./components/DateField";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- DateField`
Expected: 4 passed.

- [ ] **Step 7: Run token purity**

Run: `npm run tokens:purity`
Expected: `✓ token-purity: clean`.

- [ ] **Step 8: Add the story file**

Create `src/components/DateField.stories.tsx`:
```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { DateField } from "./DateField";

const meta: Meta<typeof DateField> = {
  title: "Forms/DateField",
  component: DateField,
  args: { fieldSize: "md" },
  argTypes: { fieldSize: { control: "inline-radio", options: ["md", "sm"] } },
};
export default meta;
type S = StoryObj<typeof DateField>;

export const Default: S = { args: { "aria-label": "تاريخ الزيارة" } };
export const WithValue: S = { args: { "aria-label": "التاريخ", defaultValue: "2026-06-21" } };
export const Small: S = { args: { "aria-label": "التاريخ", fieldSize: "sm", defaultValue: "2026-06-21" } };
export const Invalid: S = { args: { "aria-label": "التاريخ", invalid: true } };
export const Disabled: S = { args: { "aria-label": "التاريخ", disabled: true, defaultValue: "2026-06-21" } };
export const Gallery: S = {
  render: () => (
    <div style={{ display: "grid", gap: 10, maxWidth: 240 }}>
      <DateField aria-label="أ" defaultValue="2026-06-21" />
      <DateField aria-label="ب" fieldSize="sm" defaultValue="2026-06-21" />
      <DateField aria-label="ج" invalid />
      <DateField aria-label="د" disabled defaultValue="2026-06-21" />
    </div>
  ),
};
```

- [ ] **Step 9: Commit**

```bash
git add src/components/DateField.tsx src/components/DateField.test.tsx src/components/DateField.stories.tsx src/styles/components.css src/index.ts
git commit -m "feat(forms): add DateField (native date input, ISO value, density-aware)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: FormRow (with Label / Help / Error subparts)

**Files:**
- Create: `src/components/FormRow.tsx`, `src/components/FormRow.stories.tsx`, `src/components/FormRow.test.tsx`
- Modify: `src/styles/components.css`, `src/index.ts`

**Interfaces:**
- Consumes: `Input` (Task 2) and the other controls — `FormRow` is control-agnostic and renders whatever control you pass as `children`, cloning it to inject `id`, `aria-invalid`, and `aria-describedby`.
- Produces:
  - `interface FormRowProps { id: string; label: React.ReactNode; help?: React.ReactNode; error?: React.ReactNode; required?: boolean; children: React.ReactElement }`.
  - `function FormRow(props: FormRowProps): JSX.Element` — renders `<label htmlFor>` + the control + optional help/error, wiring `aria-describedby` to whichever of help/error exist and `aria-invalid` when `error` is present.
  - Subcomponents (also exported for advanced layouts): `function Label`, `function Help`, `function FieldError`.

- [ ] **Step 1: Write the failing test**

Create `src/components/FormRow.test.tsx`:
```tsx
import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { FormRow } from "./FormRow";
import { Input } from "./Input";

describe("FormRow", () => {
  it("associates label, help, and error with the control", () => {
    render(
      <FormRow id="qty" label="الكمية" help="بالكيلوجرام" error="قيمة غير صالحة">
        <Input />
      </FormRow>
    );
    const input = screen.getByLabelText("الكمية");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const describedby = input.getAttribute("aria-describedby") ?? "";
    expect(describedby).toContain("qty-help");
    expect(describedby).toContain("qty-error");
    expect(screen.getByText("بالكيلوجرام")).toHaveAttribute("id", "qty-help");
    expect(screen.getByText("قيمة غير صالحة")).toHaveAttribute("id", "qty-error");
  });
  it("omits error wiring when there is no error", () => {
    render(
      <FormRow id="name" label="الاسم" help="الاسم الكامل">
        <Input />
      </FormRow>
    );
    const input = screen.getByLabelText("الاسم");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input.getAttribute("aria-describedby")).toBe("name-help");
  });
  it("marks required fields", () => {
    render(<FormRow id="r" label="مطلوب" required><Input /></FormRow>);
    expect(screen.getByLabelText(/مطلوب/)).toBeRequired();
  });
  it("has no axe violations", async () => {
    const { container } = render(
      <FormRow id="a" label="الاسم" help="مساعدة"><Input /></FormRow>
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- FormRow`
Expected: FAIL — `Cannot find module './FormRow'`.

- [ ] **Step 3: Implement `src/components/FormRow.tsx`**

```tsx
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
```

- [ ] **Step 4: Append the CSS block to `src/styles/components.css`**

```css
/* ---- FormRow ---- */
.fos-formrow { display:grid; gap:var(--space-1); }
.fos-formrow__label { font-size:var(--text-xs); font-weight:var(--weight-bold); color:var(--ink-muted); }
.fos-formrow__req { color:var(--danger-fg); }
.fos-formrow__help { font-size:var(--text-xs); color:var(--ink-muted); }
.fos-formrow__error { font-size:var(--text-xs); color:var(--danger-fg); font-weight:var(--weight-semibold); }
```

- [ ] **Step 5: Export from `src/index.ts`**

Add:
```ts
export { FormRow, Label, Help, FieldError } from "./components/FormRow";
export type { FormRowProps, LabelProps, HelpProps, FieldErrorProps } from "./components/FormRow";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- FormRow`
Expected: 4 passed.

- [ ] **Step 7: Run token purity**

Run: `npm run tokens:purity`
Expected: `✓ token-purity: clean`.

- [ ] **Step 8: Add the story file**

Create `src/components/FormRow.stories.tsx`:
```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { FormRow } from "./FormRow";
import { Input } from "./Input";
import { Select } from "./Select";

const meta: Meta<typeof FormRow> = {
  title: "Forms/FormRow",
  component: FormRow,
};
export default meta;
type S = StoryObj<typeof FormRow>;

export const WithHelp: S = {
  render: () => (
    <div style={{ maxWidth: 320 }}>
      <FormRow id="name" label="اسم المزرعة" help="الاسم كما في السجل التجاري">
        <Input placeholder="مزرعة عبيد" />
      </FormRow>
    </div>
  ),
};

export const WithError: S = {
  render: () => (
    <div style={{ maxWidth: 320 }}>
      <FormRow id="qty" label="الكمية" help="بالكيلوجرام" error="القيمة يجب أن تكون أكبر من صفر">
        <Input defaultValue="0" />
      </FormRow>
    </div>
  ),
};

export const Required: S = {
  render: () => (
    <div style={{ maxWidth: 320 }}>
      <FormRow id="status" label="الحالة" required>
        <Select
          options={[
            { value: "ok", label: "سليمة" },
            { value: "low", label: "منخفضة" },
          ]}
          placeholder="اختر…"
        />
      </FormRow>
    </div>
  ),
};

export const Gallery: S = {
  render: () => (
    <div style={{ display: "grid", gap: 16, maxWidth: 320 }}>
      <FormRow id="g1" label="الاسم" help="الاسم الكامل"><Input placeholder="الاسم" /></FormRow>
      <FormRow id="g2" label="الكمية" required error="مطلوب"><Input /></FormRow>
    </div>
  ),
};
```

- [ ] **Step 9: Commit**

```bash
git add src/components/FormRow.tsx src/components/FormRow.test.tsx src/components/FormRow.stories.tsx src/styles/components.css src/index.ts
git commit -m "feat(forms): add FormRow + Label/Help/FieldError (a11y label+help+error wiring)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 12: Group verification

**Files:** none (verification only)

- [ ] **Step 1: Full gate run**

Run:
```bash
npm run tokens:present && npm run tokens:purity && npm test && npm run typecheck && npm run build && npm run build-storybook
```
Expected: all exit 0. The theme-matrix test (Theming Foundation) still passes; every Forms test passes; no axe violations; `dist/` and `storybook-static/` written.

- [ ] **Step 2: Confirm exports resolve**

Create a scratch check (delete after):
```bash
node -e "import('./dist/index.js').then(m => console.log(['IconButton','Input','Textarea','NumberField','Select','Combobox','Checkbox','RadioGroup','Switch','DateField','FormRow','Label','Help','FieldError'].every(k => k in m) ? 'all exports present' : 'MISSING'))"
```
Expected: `all exports present`.

- [ ] **Step 3: Commit any incidental fixes, then tag**

```bash
git add -A && git commit -m "chore: forms component group complete

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" || echo "nothing to commit"
git tag phase-2-forms
```

---

## Self-Review

**Spec coverage (spec §4 "Forms" row — `✅Button · ➕IconButton · ✅Field · ➕Input/Textarea/NumberField · ➕Select · ➕Combobox · ➕Checkbox · ➕Radio · ➕Switch · ➕DateField · ➕FormRow + Label/Help/Error`):**
- IconButton → Task 1 ✓
- Input → Task 2 ✓
- Textarea → Task 3 ✓
- NumberField → Task 4 ✓ (composes IconButton from Task 1)
- Select → Task 5 ✓
- Combobox → Task 6 ✓ (ARIA listbox/option + ArrowUp/Down/Enter/Escape per the brief)
- Checkbox → Task 7 ✓
- Radio (`RadioGroup`) → Task 8 ✓ (fieldset/legend group)
- Switch → Task 9 ✓ (`role="switch"` per the brief)
- DateField → Task 10 ✓
- FormRow + Label/Help/Error → Task 11 ✓ (standardizes label+help+error; clones the control to wire `aria-invalid`/`aria-describedby`, complementing the existing `Field`)
- `✅Button`/`✅Field` are pre-existing and untouched; Input/etc. **complement** Field (Field is a self-contained labelled wrapper; FormRow is the control-agnostic layout that wires any control, including the new ones). Density-awareness via `--control-h` holds for IconButton, Input, NumberField, Select, Combobox, DateField. Error/help wiring via `aria-invalid`/`aria-describedby` is present in Input/Textarea/Select/Combobox/DateField/NumberField and centralized in FormRow.

**Placeholder scan:** every code step contains complete, real code — full `.tsx`, full test, full CSS block, full CSF3 story. No `TODO`, no "similar to above", no "add validation". The Switch CSS note about LTR thumb direction is an operator note, not a placeholder (the RTL default is fully specified). No step defers implementation.

**Type consistency:**
- `forwardRef` element types match each component's root DOM node: `HTMLButtonElement` (IconButton, Switch), `HTMLInputElement` (Input, NumberField, Checkbox, DateField, Combobox), `HTMLTextAreaElement` (Textarea), `HTMLSelectElement` (Select). `RadioGroup`/`FormRow` are plain functions (no DOM ref needed — group/layout semantics live on `<fieldset>`/wrapper).
- `NumberField` consumes `IconButton`'s `label`/`size`/`disabled`/`onClick` props exactly as defined in Task 1.
- `FormRow` consumes any control via `React.cloneElement`, injecting `id`/`required`/`aria-invalid`/`aria-describedby` — all standard props on the native-element-extending interfaces of Tasks 2–10, so no type widening or `any`.
- Option-shaped props are consistent: `SelectOption` (value/label/disabled), `ComboboxOption` (value/label), `RadioOption` (value/label/disabled) — each exported alongside its component.
- Every component extends its native element props (`Omit<…, "size">` where a custom `*Size` prop is introduced to avoid clobbering the native `size` attribute), keeping `className`/`...rest` passthrough type-safe with no `any` in the public API.
