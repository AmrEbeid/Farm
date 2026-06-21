# Domain Components Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the six Farm OS domain components from spec §4 "Domain — Farm OS" — `LoopStepper`, `PhaseCard`, `PalmGrid` + `PalmCell`, `FileTimeline`, `ApprovalChain`, `StatusPill` — each token-pure, RTL-first, a11y-clean (real semantics + jest-axe), typed, story-documented, and exported. These join the already-shipped `VerdictBanner` to complete the domain group.

**Architecture:** Each component is a presentational React function reading **only** Tier-2 role tokens + numeric primitives (the engine from `2026-06-21-theming-foundation.md`). Domain status sets (palm health, timeline event kind, step state, approval state) map to the existing role-token pairs (`--success-*`, `--warning-*`, `--danger-*`, `--info-*`, `--neutral-*`, `--accent-*`, `--ink-muted`) via a typed `Record` in each component — never hardcoded color. Steppers and chains are ordered lists (`<ol>`) with `aria-current`; `PalmGrid` cells are `<button>`s with consumer-supplied accessible labels; `FileTimeline` is an `<ol>` with tone-coded markers on the inline-start edge. All text/labels are consumer props (no Arabic in components); stories/tests supply Arabic samples.

**Tech Stack:** React 18, TypeScript (strict), Vitest + @testing-library/react + jsdom, jest-axe, @testing-library/user-event, Storybook 8 (CSF3), plain CSS custom properties. Class prefix `fos-`, BEM-ish `fos-<block>`/`__element`/`--modifier`.

## Global Constraints
- React `>=18`; TypeScript `strict: true`; no `any` in public API.
- **Components reference only Tier-2 role tokens + numeric scales — zero hardcoded color/hex/rgb/hsl/px-color values.** (Enforced by `scripts/token-purity.mjs` over `src/styles/components.css`; `color-mix(in srgb, var(--token) N%, …)` for tints is allowed.)
- RTL-first: use logical CSS properties (`margin-inline`, `inset-inline-start`, `padding-inline`, `border-inline-start`) — never physical (`left`/`right`).
- Library is **presentational**: no user-facing strings, no i18n inside components. All labels/status text arrive as props.
- A11y baseline: ordered lists for steppers/chains/timeline; `aria-current="step"` on the active step; `PalmGrid` cells are focusable `<button>`s carrying a consumer-supplied accessible label (status + position); visible focus ring via `--focus-ring`; jest-axe zero violations per component.
- Conventions: `import * as React from "react"`; `function Name(props)`; props extend the native element's props where sensible; defaults in destructuring; `className` merge via the `` `… ${className}`.trim() `` pattern.
- Each component ships five artifacts: `src/components/<Name>.tsx`, `src/components/<Name>.stories.tsx` (CSF3 Arabic + a `Gallery`), `src/components/<Name>.test.tsx` (render + status→token mapping/keyboard + jest-axe), a CSS block appended to `src/styles/components.css`, and an export added to `src/index.ts`.
- Commit after every task; end commit bodies with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure
- `src/components/LoopStepper.tsx` — **create** — Task 1.
- `src/components/LoopStepper.stories.tsx` / `.test.tsx` — **create** — Task 1.
- `src/components/PhaseCard.tsx` (+ stories/test) — **create** — Task 2.
- `src/components/StatusPill.tsx` (+ stories/test) — **create** — Task 3.
- `src/components/PalmCell.tsx`, `src/components/PalmGrid.tsx` (+ stories/test) — **create** — Task 4 (one coupled task).
- `src/components/FileTimeline.tsx` (+ stories/test) — **create** — Task 5.
- `src/components/ApprovalChain.tsx` (+ stories/test) — **create** — Task 6.
- `src/styles/components.css` — **modify** — append one block per component (each task).
- `src/index.ts` — **modify** — re-export each component + its types (each task).
- Task 7 — verification only (no new files).

---

### Task 1: LoopStepper

A horizontal/RTL ordered stepper for the planning loop (plan → check → approve → execute → file). Each step carries a `state` and a consumer-supplied label; the active step gets `aria-current="step"`.

**Files:**
- Create: `src/components/LoopStepper.tsx`, `src/components/LoopStepper.stories.tsx`, `src/components/LoopStepper.test.tsx`
- Modify: `src/styles/components.css`, `src/index.ts`

**Interfaces:**
```ts
export type LoopStepState = "pending" | "active" | "done" | "blocked";

export interface LoopStep {
  /** Stable id used as React key. */
  id: string;
  /** Consumer-supplied step label (RTL Arabic in the app). */
  label: React.ReactNode;
  /** Lifecycle state. Defaults to "pending" when omitted. */
  state?: LoopStepState;
}

export interface LoopStepperProps extends React.HTMLAttributes<HTMLOListElement> {
  /** Ordered loop steps (plan → check → approve → execute → file). */
  steps: LoopStep[];
  /** Accessible name for the whole stepper (consumer-supplied). */
  ariaLabel: string;
}
```
State → role-token map (drives the `--modifier` class CSS, NOT inline color):
```ts
// state → BEM modifier (CSS maps each to a role-token pair)
const STATE_CLASS: Record<LoopStepState, string> = {
  pending: "fos-loopstep--pending", // --ink-muted on --surface-sunken
  active:  "fos-loopstep--active",  // --brand / --brand-contrast
  done:    "fos-loopstep--done",    // --success-fg / --success-bg
  blocked: "fos-loopstep--blocked", // --danger-fg / --danger-bg
};
```

- [ ] **Step 1: Write the failing test**

Create `src/components/LoopStepper.test.tsx`:
```tsx
import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { LoopStepper, type LoopStep } from "./LoopStepper";

const steps: LoopStep[] = [
  { id: "plan", label: "تخطيط", state: "done" },
  { id: "check", label: "فحص", state: "done" },
  { id: "approve", label: "اعتماد", state: "active" },
  { id: "execute", label: "تنفيذ", state: "pending" },
  { id: "file", label: "أرشفة", state: "blocked" },
];

describe("LoopStepper", () => {
  it("renders an ordered list of all steps", () => {
    render(<LoopStepper steps={steps} ariaLabel="حلقة التخطيط" />);
    expect(screen.getByRole("list", { name: "حلقة التخطيط" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByText("اعتماد")).toBeInTheDocument();
  });
  it("marks the active step with aria-current and the right state class", () => {
    const { container } = render(<LoopStepper steps={steps} ariaLabel="حلقة" />);
    const current = container.querySelector('[aria-current="step"]');
    expect(current).not.toBeNull();
    expect(current).toHaveClass("fos-loopstep--active");
    expect(container.querySelector(".fos-loopstep--blocked")).not.toBeNull();
    expect(container.querySelectorAll(".fos-loopstep--done")).toHaveLength(2);
  });
  it("defaults missing state to pending", () => {
    const { container } = render(
      <LoopStepper steps={[{ id: "x", label: "خطوة" }]} ariaLabel="حلقة" />,
    );
    expect(container.querySelector(".fos-loopstep--pending")).not.toBeNull();
  });
  it("has no axe violations", async () => {
    const { container } = render(<LoopStepper steps={steps} ariaLabel="حلقة التخطيط" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- LoopStepper`
Expected: FAIL — `Cannot find module "./LoopStepper"`.

- [ ] **Step 3: Implement `src/components/LoopStepper.tsx`**

```tsx
import * as React from "react";

export type LoopStepState = "pending" | "active" | "done" | "blocked";

export interface LoopStep {
  id: string;
  label: React.ReactNode;
  state?: LoopStepState;
}

export interface LoopStepperProps extends React.HTMLAttributes<HTMLOListElement> {
  steps: LoopStep[];
  ariaLabel: string;
}

const STATE_CLASS: Record<LoopStepState, string> = {
  pending: "fos-loopstep--pending",
  active: "fos-loopstep--active",
  done: "fos-loopstep--done",
  blocked: "fos-loopstep--blocked",
};

/**
 * Domain component: the planning-loop stepper (plan → check → approve → execute → file).
 * Horizontal, RTL-first, an ordered list; the active step carries aria-current="step".
 * Labels are consumer-supplied (no strings in the library).
 */
export function LoopStepper({ steps, ariaLabel, className = "", ...rest }: LoopStepperProps) {
  return (
    <ol className={`fos-loop ${className}`.trim()} aria-label={ariaLabel} {...rest}>
      {steps.map((step, i) => {
        const state = step.state ?? "pending";
        return (
          <li
            key={step.id}
            className={`fos-loopstep ${STATE_CLASS[state]}`}
            aria-current={state === "active" ? "step" : undefined}
          >
            <span className="fos-loopstep__marker" aria-hidden="true">
              {state === "done" ? "✓" : state === "blocked" ? "!" : i + 1}
            </span>
            <span className="fos-loopstep__label">{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 4: Append the CSS block to `src/styles/components.css`** (token-only)

```css
/* ---- LoopStepper (domain — planning loop plan→check→approve→execute→file) ---- */
.fos-loop { display:flex; flex-wrap:wrap; gap:var(--space-2); list-style:none; margin:0; padding:0; }
.fos-loopstep { display:inline-flex; align-items:center; gap:var(--space-2); padding-block:6px;
  padding-inline:var(--space-3); border-radius:var(--radius-pill); font-size:var(--text-xs);
  font-weight:var(--weight-bold); border:1px solid var(--line); white-space:nowrap; }
.fos-loopstep__marker { width:18px; height:18px; flex:none; border-radius:50%; display:grid;
  place-items:center; font-size:var(--text-xs); background:color-mix(in srgb, currentColor 16%, var(--surface)); }
.fos-loopstep--pending { background:var(--surface-sunken); color:var(--ink-muted); }
.fos-loopstep--active { background:var(--brand); color:var(--brand-contrast); border-color:var(--brand); }
.fos-loopstep--done { background:var(--success-bg); color:var(--success-fg);
  border-color:color-mix(in srgb, var(--success-fg) 30%, var(--surface)); }
.fos-loopstep--blocked { background:var(--danger-bg); color:var(--danger-fg);
  border-color:color-mix(in srgb, var(--danger-fg) 30%, var(--surface)); }
```

- [ ] **Step 5: Export from `src/index.ts`**

Add:
```ts
export { LoopStepper } from "./components/LoopStepper";
export type { LoopStepperProps, LoopStep, LoopStepState } from "./components/LoopStepper";
```

- [ ] **Step 6: Run test + purity to verify PASS**

Run: `npm test -- LoopStepper && npm run tokens:purity`
Expected: 4 passed; `✓ token-purity: clean`.

- [ ] **Step 7: Create the story** `src/components/LoopStepper.stories.tsx`

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { LoopStepper, type LoopStep } from "./LoopStepper";

const steps: LoopStep[] = [
  { id: "plan", label: "تخطيط", state: "done" },
  { id: "check", label: "فحص", state: "done" },
  { id: "approve", label: "اعتماد", state: "active" },
  { id: "execute", label: "تنفيذ", state: "pending" },
  { id: "file", label: "أرشفة", state: "pending" },
];

const meta: Meta<typeof LoopStepper> = {
  title: "Domain/LoopStepper",
  component: LoopStepper,
  args: { steps, ariaLabel: "حلقة التخطيط" },
};
export default meta;
type S = StoryObj<typeof LoopStepper>;

export const Default: S = {};
export const WithBlocked: S = {
  args: { steps: [...steps.slice(0, 3), { id: "execute", label: "تنفيذ", state: "blocked" }, steps[4]] },
};
export const Gallery: S = {
  render: () => (
    <div style={{ display: "grid", gap: 16 }}>
      <LoopStepper ariaLabel="بداية" steps={steps.map((s, i) => ({ ...s, state: i === 0 ? "active" : "pending" }))} />
      <LoopStepper ariaLabel="منتصف" steps={steps} />
      <LoopStepper ariaLabel="اكتمال" steps={steps.map((s) => ({ ...s, state: "done" }))} />
    </div>
  ),
};
```

- [ ] **Step 8: Commit**

```bash
git add src/components/LoopStepper.tsx src/components/LoopStepper.stories.tsx src/components/LoopStepper.test.tsx src/styles/components.css src/index.ts
git commit -m "feat(domain): LoopStepper — RTL planning-loop stepper (token-pure, a11y)"
```
Body ends with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 2: PhaseCard

A card summarizing a plan phase/operation: title, status tone, optional meta rows, optional progress. Reuses the existing `.fos-card` surface conventions and the shipped `Progress` bar.

**Files:**
- Create: `src/components/PhaseCard.tsx`, `src/components/PhaseCard.stories.tsx`, `src/components/PhaseCard.test.tsx`
- Modify: `src/styles/components.css`, `src/index.ts`

**Interfaces:**
```ts
export type PhaseTone = "neutral" | "info" | "ok" | "warning" | "danger";

export interface PhaseMetaRow {
  /** Row label (consumer-supplied). */
  label: React.ReactNode;
  /** Row value (consumer-supplied). */
  value: React.ReactNode;
}

export interface PhaseCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Phase / operation title. */
  title: React.ReactNode;
  /** Status tone — colors the left accent + status dot. */
  tone?: PhaseTone;
  /** Consumer-supplied status text shown as a pill (optional). */
  status?: React.ReactNode;
  /** Optional meta rows (e.g. الموعد / المسؤول). */
  meta?: PhaseMetaRow[];
  /** Optional completion percent 0–100 → renders a progress bar. */
  progress?: number;
  /** Accessible label for the progress bar when `progress` is set. */
  progressLabel?: string;
}
```
Tone → role-token map (drives the `--modifier` accent class):
```ts
const TONE_CLASS: Record<PhaseTone, string> = {
  neutral: "fos-phase--neutral", // --neutral-fg accent
  info:    "fos-phase--info",    // --info-fg
  ok:      "fos-phase--ok",      // --success-fg
  warning: "fos-phase--warning", // --warning-fg
  danger:  "fos-phase--danger",  // --danger-fg
};
```

- [ ] **Step 1: Write the failing test**

Create `src/components/PhaseCard.test.tsx`:
```tsx
import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { PhaseCard } from "./PhaseCard";

describe("PhaseCard", () => {
  it("renders title, status and meta rows", () => {
    render(
      <PhaseCard
        title="تقليم النخيل"
        tone="warning"
        status="قيد التنفيذ"
        meta={[
          { label: "الموعد", value: "١٢ يونيو" },
          { label: "المسؤول", value: "خالد" },
        ]}
      />,
    );
    expect(screen.getByText("تقليم النخيل")).toBeInTheDocument();
    expect(screen.getByText("قيد التنفيذ")).toBeInTheDocument();
    expect(screen.getByText("الموعد")).toBeInTheDocument();
    expect(screen.getByText("خالد")).toBeInTheDocument();
  });
  it("applies the tone modifier class", () => {
    const { container } = render(<PhaseCard title="مرحلة" tone="danger" />);
    expect(container.querySelector(".fos-phase--danger")).not.toBeNull();
  });
  it("renders a progressbar when progress is provided", () => {
    render(<PhaseCard title="مرحلة" progress={60} progressLabel="نسبة الإنجاز" />);
    const bar = screen.getByRole("progressbar", { name: "نسبة الإنجاز" });
    expect(bar).toHaveAttribute("aria-valuenow", "60");
  });
  it("has no axe violations", async () => {
    const { container } = render(
      <PhaseCard title="تسميد" tone="ok" status="مكتملة" progress={100} progressLabel="الإنجاز" />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- PhaseCard`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/components/PhaseCard.tsx`**

```tsx
import * as React from "react";
import { Progress } from "./Progress";

export type PhaseTone = "neutral" | "info" | "ok" | "warning" | "danger";

export interface PhaseMetaRow {
  label: React.ReactNode;
  value: React.ReactNode;
}

export interface PhaseCardProps extends React.HTMLAttributes<HTMLDivElement> {
  title: React.ReactNode;
  tone?: PhaseTone;
  status?: React.ReactNode;
  meta?: PhaseMetaRow[];
  progress?: number;
  progressLabel?: string;
}

const TONE_CLASS: Record<PhaseTone, string> = {
  neutral: "fos-phase--neutral",
  info: "fos-phase--info",
  ok: "fos-phase--ok",
  warning: "fos-phase--warning",
  danger: "fos-phase--danger",
};

/** Domain component: a card summarizing a plan phase/operation (title, status tone, meta rows, progress). */
export function PhaseCard({
  title, tone = "neutral", status, meta, progress, progressLabel, className = "", ...rest
}: PhaseCardProps) {
  return (
    <div className={`fos-phase ${TONE_CLASS[tone]} ${className}`.trim()} {...rest}>
      <div className="fos-phase__head">
        <span className="fos-phase__dot" aria-hidden="true" />
        <span className="fos-phase__title">{title}</span>
        {status != null && <span className="fos-phase__status">{status}</span>}
      </div>
      {meta != null && meta.length > 0 && (
        <dl className="fos-phase__meta">
          {meta.map((row, i) => (
            <div className="fos-phase__row" key={i}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {progress != null && (
        <div className="fos-phase__progress">
          <Progress value={progress} label={progressLabel} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Append the CSS block to `src/styles/components.css`**

```css
/* ---- PhaseCard (domain — plan phase / operation summary) ---- */
.fos-phase { background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card);
  box-shadow:var(--shadow-card); padding:var(--card-pad); border-inline-start:3px solid var(--line); }
.fos-phase__head { display:flex; align-items:center; gap:var(--space-2); }
.fos-phase__dot { width:9px; height:9px; flex:none; border-radius:50%; background:var(--ink-muted); }
.fos-phase__title { font-size:var(--text-md); font-weight:var(--weight-bold); flex:1; }
.fos-phase__status { font-size:var(--text-xs); font-weight:var(--weight-bold); padding:2px 9px;
  border-radius:var(--radius-pill); background:var(--surface-sunken); color:var(--ink-muted); }
.fos-phase__meta { margin:var(--space-3) 0 0; display:grid; gap:var(--space-1); }
.fos-phase__row { display:flex; justify-content:space-between; gap:var(--space-3); font-size:var(--text-xs); }
.fos-phase__row dt { color:var(--ink-muted); margin:0; }
.fos-phase__row dd { margin:0; font-weight:var(--weight-semibold); }
.fos-phase__progress { margin-top:var(--space-3); }
.fos-phase--neutral { border-inline-start-color:var(--neutral-fg); } .fos-phase--neutral .fos-phase__dot { background:var(--neutral-fg); }
.fos-phase--info { border-inline-start-color:var(--info-fg); } .fos-phase--info .fos-phase__dot { background:var(--info-fg); } .fos-phase--info .fos-phase__status { background:var(--info-bg); color:var(--info-fg); }
.fos-phase--ok { border-inline-start-color:var(--success-fg); } .fos-phase--ok .fos-phase__dot { background:var(--success-fg); } .fos-phase--ok .fos-phase__status { background:var(--success-bg); color:var(--success-fg); }
.fos-phase--warning { border-inline-start-color:var(--warning-fg); } .fos-phase--warning .fos-phase__dot { background:var(--warning-fg); } .fos-phase--warning .fos-phase__status { background:var(--warning-bg); color:var(--warning-fg); }
.fos-phase--danger { border-inline-start-color:var(--danger-fg); } .fos-phase--danger .fos-phase__dot { background:var(--danger-fg); } .fos-phase--danger .fos-phase__status { background:var(--danger-bg); color:var(--danger-fg); }
```

- [ ] **Step 5: Export from `src/index.ts`**

```ts
export { PhaseCard } from "./components/PhaseCard";
export type { PhaseCardProps, PhaseTone, PhaseMetaRow } from "./components/PhaseCard";
```

- [ ] **Step 6: Run test + purity to verify PASS**

Run: `npm test -- PhaseCard && npm run tokens:purity`
Expected: 4 passed; `✓ token-purity: clean`.

- [ ] **Step 7: Create the story** `src/components/PhaseCard.stories.tsx`

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { PhaseCard } from "./PhaseCard";

const meta: Meta<typeof PhaseCard> = {
  title: "Domain/PhaseCard",
  component: PhaseCard,
  args: {
    title: "تقليم النخيل",
    tone: "warning",
    status: "قيد التنفيذ",
    meta: [
      { label: "الموعد", value: "١٢ يونيو" },
      { label: "المسؤول", value: "خالد" },
    ],
    progress: 45,
    progressLabel: "نسبة الإنجاز",
  },
  argTypes: { tone: { control: "inline-radio", options: ["neutral", "info", "ok", "warning", "danger"] } },
};
export default meta;
type S = StoryObj<typeof PhaseCard>;

export const Default: S = {};
export const Completed: S = { args: { tone: "ok", status: "مكتملة", progress: 100 } };
export const Blocked: S = { args: { tone: "danger", status: "متوقفة", progress: 20 } };
export const Gallery: S = {
  render: () => (
    <div style={{ display: "grid", gap: 12, maxWidth: 360 }}>
      <PhaseCard title="ري" tone="info" status="مجدولة" meta={[{ label: "الموعد", value: "غدًا" }]} />
      <PhaseCard title="تسميد" tone="ok" status="مكتملة" progress={100} progressLabel="الإنجاز" />
      <PhaseCard title="مكافحة آفات" tone="danger" status="متوقفة" progress={10} progressLabel="الإنجاز" />
    </div>
  ),
};
```

- [ ] **Step 8: Commit**

```bash
git add src/components/PhaseCard.tsx src/components/PhaseCard.stories.tsx src/components/PhaseCard.test.tsx src/styles/components.css src/index.ts
git commit -m "feat(domain): PhaseCard — plan-phase summary card (tone accent, progress)"
```
Body ends with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 3: StatusPill

A small domain-specific status indicator (the Tag idea, with a Farm-OS status set). Tone-coded via role tokens; renders an optional status dot + consumer-supplied label.

**Files:**
- Create: `src/components/StatusPill.tsx`, `src/components/StatusPill.stories.tsx`, `src/components/StatusPill.test.tsx`
- Modify: `src/styles/components.css`, `src/index.ts`

**Interfaces:**
```ts
/** Domain status set (maps 1:1 to a role-token pair). */
export type PillStatus =
  | "draft"      // مسودة      → neutral
  | "scheduled"  // مجدولة     → info
  | "active"     // قيد التنفيذ → brand/accent
  | "done"       // مكتملة     → success
  | "warning"    // تحذير      → warning
  | "blocked";   // متوقفة     → danger

export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Domain status — selects the role-token pair. */
  status: PillStatus;
  /** Show a leading status dot. Defaults to true. */
  dot?: boolean;
}
```
Status → role-token pair (drives the `--modifier` class):
```ts
const STATUS_CLASS: Record<PillStatus, string> = {
  draft: "fos-pill--draft",         // --neutral-bg / --neutral-fg
  scheduled: "fos-pill--scheduled", // --info-bg / --info-fg
  active: "fos-pill--active",       // --accent-bg / --accent-fg
  done: "fos-pill--done",           // --success-bg / --success-fg
  warning: "fos-pill--warning",     // --warning-bg / --warning-fg
  blocked: "fos-pill--blocked",     // --danger-bg / --danger-fg
};
```

- [ ] **Step 1: Write the failing test**

Create `src/components/StatusPill.test.tsx`:
```tsx
import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { StatusPill, type PillStatus } from "./StatusPill";

const cases: [PillStatus, string][] = [
  ["draft", "fos-pill--draft"],
  ["scheduled", "fos-pill--scheduled"],
  ["active", "fos-pill--active"],
  ["done", "fos-pill--done"],
  ["warning", "fos-pill--warning"],
  ["blocked", "fos-pill--blocked"],
];

describe("StatusPill", () => {
  it("maps every status to its role-token modifier class", () => {
    for (const [status, cls] of cases) {
      const { container, unmount } = render(<StatusPill status={status}>نص</StatusPill>);
      expect(container.querySelector(`.${cls}`)).not.toBeNull();
      unmount();
    }
  });
  it("renders the consumer label and a dot by default", () => {
    const { container } = render(<StatusPill status="done">مكتملة</StatusPill>);
    expect(screen.getByText("مكتملة")).toBeInTheDocument();
    expect(container.querySelector(".fos-pill__dot")).not.toBeNull();
  });
  it("hides the dot when dot={false}", () => {
    const { container } = render(<StatusPill status="done" dot={false}>مكتملة</StatusPill>);
    expect(container.querySelector(".fos-pill__dot")).toBeNull();
  });
  it("has no axe violations", async () => {
    const { container } = render(<StatusPill status="blocked">متوقفة</StatusPill>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- StatusPill`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/components/StatusPill.tsx`**

```tsx
import * as React from "react";

export type PillStatus = "draft" | "scheduled" | "active" | "done" | "warning" | "blocked";

export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: PillStatus;
  dot?: boolean;
}

const STATUS_CLASS: Record<PillStatus, string> = {
  draft: "fos-pill--draft",
  scheduled: "fos-pill--scheduled",
  active: "fos-pill--active",
  done: "fos-pill--done",
  warning: "fos-pill--warning",
  blocked: "fos-pill--blocked",
};

/**
 * Domain status indicator (Farm-OS status set). Tone is semantic, never decorative —
 * the consumer-supplied label must carry the meaning too.
 */
export function StatusPill({ status, dot = true, children, className = "", ...rest }: StatusPillProps) {
  return (
    <span className={`fos-pill ${STATUS_CLASS[status]} ${className}`.trim()} {...rest}>
      {dot && <span className="fos-pill__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
```

- [ ] **Step 4: Append the CSS block to `src/styles/components.css`**

```css
/* ---- StatusPill (domain — Farm-OS status set) ---- */
.fos-pill { display:inline-flex; align-items:center; gap:var(--space-1); font-size:var(--text-xs);
  font-weight:var(--weight-bold); padding-block:3px; padding-inline:9px; border-radius:var(--radius-pill);
  white-space:nowrap; }
.fos-pill__dot { width:7px; height:7px; flex:none; border-radius:50%; background:currentColor; }
.fos-pill--draft { background:var(--neutral-bg); color:var(--neutral-fg); }
.fos-pill--scheduled { background:var(--info-bg); color:var(--info-fg); }
.fos-pill--active { background:var(--accent-bg); color:var(--accent-fg); }
.fos-pill--done { background:var(--success-bg); color:var(--success-fg); }
.fos-pill--warning { background:var(--warning-bg); color:var(--warning-fg); }
.fos-pill--blocked { background:var(--danger-bg); color:var(--danger-fg); }
```

- [ ] **Step 5: Export from `src/index.ts`**

```ts
export { StatusPill } from "./components/StatusPill";
export type { StatusPillProps, PillStatus } from "./components/StatusPill";
```

- [ ] **Step 6: Run test + purity to verify PASS**

Run: `npm test -- StatusPill && npm run tokens:purity`
Expected: 4 passed; `✓ token-purity: clean`.

- [ ] **Step 7: Create the story** `src/components/StatusPill.stories.tsx`

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { StatusPill } from "./StatusPill";

const meta: Meta<typeof StatusPill> = {
  title: "Domain/StatusPill",
  component: StatusPill,
  args: { status: "active", children: "قيد التنفيذ", dot: true },
  argTypes: {
    status: { control: "inline-radio", options: ["draft", "scheduled", "active", "done", "warning", "blocked"] },
  },
};
export default meta;
type S = StoryObj<typeof StatusPill>;

export const Active: S = {};
export const Done: S = { args: { status: "done", children: "مكتملة" } };
export const Blocked: S = { args: { status: "blocked", children: "متوقفة" } };
export const Gallery: S = {
  render: () => (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <StatusPill status="draft">مسودة</StatusPill>
      <StatusPill status="scheduled">مجدولة</StatusPill>
      <StatusPill status="active">قيد التنفيذ</StatusPill>
      <StatusPill status="done">مكتملة</StatusPill>
      <StatusPill status="warning">تحذير</StatusPill>
      <StatusPill status="blocked">متوقفة</StatusPill>
    </div>
  ),
};
```

- [ ] **Step 8: Commit**

```bash
git add src/components/StatusPill.tsx src/components/StatusPill.stories.tsx src/components/StatusPill.test.tsx src/styles/components.css src/index.ts
git commit -m "feat(domain): StatusPill — Farm-OS status indicator (token-pure, a11y)"
```
Body ends with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 4: PalmGrid + PalmCell (one coupled task)

A grid map of palms laid out by line. `PalmCell` is the unit — a focusable `<button>` colored by palm status; `PalmGrid` lays cells out per line inside a horizontal-scroll container with line labels. Status maps to role tokens (never hardcoded). Accessible label (status + position) is consumer-supplied per cell.

**Files:**
- Create: `src/components/PalmCell.tsx`, `src/components/PalmGrid.tsx`, `src/components/PalmGrid.stories.tsx`, `src/components/PalmGrid.test.tsx`
- Modify: `src/styles/components.css`, `src/index.ts`

**Interfaces:**
```ts
// PalmCell.tsx
/** Palm health/role status set. Each maps to a role token (NOT a hardcoded hex). */
export type PalmStatus =
  | "healthy"  // سليمة   → --success-fg
  | "watch"    // مراقبة  → --warning-fg
  | "sick"     // مريضة   → --danger-fg
  | "dead"     // ميتة    → --ink-muted
  | "removed"  // مُزالة  → --neutral-fg
  | "male";    // ذكر     → --info-fg

export interface PalmCellProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  /** Palm status — selects the fill via a role-token modifier class. */
  status: PalmStatus;
  /** REQUIRED accessible label (status + position), consumer-supplied (RTL Arabic). */
  ariaLabel: string;
  /** Optional short glyph/number shown inside the cell (decorative; aria-hidden). */
  glyph?: React.ReactNode;
  /** Marks the cell as the current selection. */
  selected?: boolean;
}

// PalmGrid.tsx
export interface PalmLine {
  /** Stable id used as React key. */
  id: string;
  /** Consumer-supplied line label (e.g. "خط ١"). */
  label: React.ReactNode;
  /** Cells in this line. */
  cells: PalmCellData[];
}

export interface PalmCellData {
  id: string;
  status: PalmStatus;
  ariaLabel: string;
  glyph?: React.ReactNode;
  selected?: boolean;
}

export interface PalmGridProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Palm lines (rows of the map). */
  lines: PalmLine[];
  /** Accessible name for the whole grid region (consumer-supplied). */
  ariaLabel: string;
  /** Fired with the cell id + line id when a cell is activated. */
  onCellActivate?: (cellId: string, lineId: string) => void;
}
```
Status → role-token map (drives the `PalmCell` `--modifier` class CSS):
```ts
// PalmCell.tsx — the status→token mapping (CSS sets fill from these role tokens)
const STATUS_CLASS: Record<PalmStatus, string> = {
  healthy: "fos-palm--healthy", // --success-fg
  watch:   "fos-palm--watch",   // --warning-fg
  sick:    "fos-palm--sick",    // --danger-fg
  dead:    "fos-palm--dead",    // --ink-muted
  removed: "fos-palm--removed", // --neutral-fg
  male:    "fos-palm--male",    // --info-fg
};
```

- [ ] **Step 1: Write the failing test**

Create `src/components/PalmGrid.test.tsx`:
```tsx
import { it, expect, describe, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { PalmGrid, type PalmLine } from "./PalmGrid";
import { PalmCell, type PalmStatus } from "./PalmCell";

const lines: PalmLine[] = [
  {
    id: "L1",
    label: "خط ١",
    cells: [
      { id: "L1-1", status: "healthy", ariaLabel: "نخلة سليمة، خط ١ موضع ١" },
      { id: "L1-2", status: "sick", ariaLabel: "نخلة مريضة، خط ١ موضع ٢" },
    ],
  },
  {
    id: "L2",
    label: "خط ٢",
    cells: [{ id: "L2-1", status: "male", ariaLabel: "نخلة ذكر، خط ٢ موضع ١" }],
  },
];

describe("PalmCell", () => {
  it("maps every status to its role-token modifier class", () => {
    const all: PalmStatus[] = ["healthy", "watch", "sick", "dead", "removed", "male"];
    for (const status of all) {
      const { container, unmount } = render(<PalmCell status={status} ariaLabel={`نخلة ${status}`} />);
      expect(container.querySelector(`.fos-palm--${status}`)).not.toBeNull();
      unmount();
    }
  });
  it("renders as a button carrying the consumer accessible label", () => {
    render(<PalmCell status="healthy" ariaLabel="نخلة سليمة، خط ١ موضع ١" />);
    expect(screen.getByRole("button", { name: "نخلة سليمة، خط ١ موضع ١" })).toBeInTheDocument();
  });
});

describe("PalmGrid", () => {
  it("renders a labelled region with a line label per line and one button per cell", () => {
    render(<PalmGrid lines={lines} ariaLabel="خريطة النخيل" />);
    expect(screen.getByRole("group", { name: "خريطة النخيل" })).toBeInTheDocument();
    expect(screen.getByText("خط ١")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });
  it("fires onCellActivate with cell id + line id on click", async () => {
    const onCellActivate = vi.fn();
    render(<PalmGrid lines={lines} ariaLabel="خريطة" onCellActivate={onCellActivate} />);
    await userEvent.click(screen.getByRole("button", { name: "نخلة مريضة، خط ١ موضع ٢" }));
    expect(onCellActivate).toHaveBeenCalledWith("L1-2", "L1");
  });
  it("activates a cell with the keyboard (Enter)", async () => {
    const onCellActivate = vi.fn();
    render(<PalmGrid lines={lines} ariaLabel="خريطة" onCellActivate={onCellActivate} />);
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    expect(onCellActivate).toHaveBeenCalledWith("L1-1", "L1");
  });
  it("has no axe violations", async () => {
    const { container } = render(<PalmGrid lines={lines} ariaLabel="خريطة النخيل" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- PalmGrid`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/components/PalmCell.tsx`**

```tsx
import * as React from "react";

export type PalmStatus = "healthy" | "watch" | "sick" | "dead" | "removed" | "male";

export interface PalmCellProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  status: PalmStatus;
  ariaLabel: string;
  glyph?: React.ReactNode;
  selected?: boolean;
}

const STATUS_CLASS: Record<PalmStatus, string> = {
  healthy: "fos-palm--healthy",
  watch: "fos-palm--watch",
  sick: "fos-palm--sick",
  dead: "fos-palm--dead",
  removed: "fos-palm--removed",
  male: "fos-palm--male",
};

/**
 * Domain unit: a single palm cell in the grid map. A focusable button colored by
 * palm status (via role-token modifier class). The accessible label (status + position)
 * is consumer-supplied — the library holds no strings.
 */
export function PalmCell({
  status, ariaLabel, glyph, selected = false, className = "", type = "button", ...rest
}: PalmCellProps) {
  return (
    <button
      type={type}
      className={`fos-palm ${STATUS_CLASS[status]}${selected ? " fos-palm--selected" : ""} ${className}`.trim()}
      aria-label={ariaLabel}
      aria-pressed={selected || undefined}
      {...rest}
    >
      {glyph != null && <span aria-hidden="true">{glyph}</span>}
    </button>
  );
}
```

- [ ] **Step 4: Implement `src/components/PalmGrid.tsx`**

```tsx
import * as React from "react";
import { PalmCell, type PalmStatus } from "./PalmCell";

export interface PalmCellData {
  id: string;
  status: PalmStatus;
  ariaLabel: string;
  glyph?: React.ReactNode;
  selected?: boolean;
}

export interface PalmLine {
  id: string;
  label: React.ReactNode;
  cells: PalmCellData[];
}

export interface PalmGridProps extends React.HTMLAttributes<HTMLDivElement> {
  lines: PalmLine[];
  ariaLabel: string;
  onCellActivate?: (cellId: string, lineId: string) => void;
}

/**
 * Domain component: a grid map of palms laid out by line, inside a horizontal-scroll
 * container with line labels. Cells are PalmCell buttons; status→token mapping lives in PalmCell.
 */
export function PalmGrid({ lines, ariaLabel, onCellActivate, className = "", ...rest }: PalmGridProps) {
  return (
    <div className={`fos-palmgrid ${className}`.trim()} role="group" aria-label={ariaLabel} {...rest}>
      <div className="fos-palmgrid__scroll">
        {lines.map((line) => (
          <div className="fos-palmgrid__line" key={line.id}>
            <span className="fos-palmgrid__line-label">{line.label}</span>
            <div className="fos-palmgrid__cells">
              {line.cells.map((cell) => (
                <PalmCell
                  key={cell.id}
                  status={cell.status}
                  ariaLabel={cell.ariaLabel}
                  glyph={cell.glyph}
                  selected={cell.selected}
                  onClick={() => onCellActivate?.(cell.id, line.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Append the CSS block to `src/styles/components.css`**

```css
/* ---- PalmGrid + PalmCell (domain — palm map by line) ---- */
.fos-palmgrid { background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-card);
  box-shadow:var(--shadow-card); padding:var(--card-pad); }
.fos-palmgrid__scroll { overflow-x:auto; display:grid; gap:var(--space-2); }
.fos-palmgrid__line { display:flex; align-items:center; gap:var(--space-3); }
.fos-palmgrid__line-label { flex:none; inline-size:48px; font-size:var(--text-xs);
  font-weight:var(--weight-bold); color:var(--ink-muted); text-align:start; }
.fos-palmgrid__cells { display:flex; gap:var(--space-1); }
.fos-palm { inline-size:22px; block-size:22px; flex:none; border:1px solid var(--line);
  border-radius:var(--radius-1); cursor:pointer; padding:0; display:grid; place-items:center;
  font-size:var(--text-xs); color:var(--brand-contrast);
  transition:transform var(--dur-fast) var(--ease); }
.fos-palm:hover { transform:scale(1.12); }
.fos-palm:focus-visible { outline:2px solid var(--focus-ring); outline-offset:2px; }
.fos-palm--selected { outline:2px solid var(--focus-ring); outline-offset:1px; }
.fos-palm--healthy { background:var(--success-fg); }
.fos-palm--watch { background:var(--warning-fg); }
.fos-palm--sick { background:var(--danger-fg); }
.fos-palm--dead { background:var(--ink-muted); }
.fos-palm--removed { background:var(--surface-sunken); color:var(--neutral-fg); border-color:var(--neutral-fg); }
.fos-palm--male { background:var(--info-fg); }
```

- [ ] **Step 6: Export from `src/index.ts`**

```ts
export { PalmCell } from "./components/PalmCell";
export type { PalmCellProps, PalmStatus } from "./components/PalmCell";
export { PalmGrid } from "./components/PalmGrid";
export type { PalmGridProps, PalmLine, PalmCellData } from "./components/PalmGrid";
```

- [ ] **Step 7: Run test + purity to verify PASS**

Run: `npm test -- PalmGrid && npm run tokens:purity`
Expected: 7 passed (2 PalmCell + 5 PalmGrid); `✓ token-purity: clean`.

- [ ] **Step 8: Create the story** `src/components/PalmGrid.stories.tsx`

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { PalmGrid, type PalmLine } from "./PalmGrid";
import type { PalmStatus } from "./PalmCell";

const statuses: PalmStatus[] = ["healthy", "healthy", "watch", "sick", "healthy", "dead", "male", "removed"];
const labelFor: Record<PalmStatus, string> = {
  healthy: "سليمة", watch: "مراقبة", sick: "مريضة", dead: "ميتة", removed: "مُزالة", male: "ذكر",
};
const line = (id: string, label: string, n: number): PalmLine => ({
  id, label,
  cells: Array.from({ length: n }, (_, i) => {
    const status = statuses[i % statuses.length];
    return { id: `${id}-${i + 1}`, status, ariaLabel: `نخلة ${labelFor[status]}، ${label} موضع ${i + 1}` };
  }),
});

const lines: PalmLine[] = [line("L1", "خط ١", 12), line("L2", "خط ٢", 12), line("L3", "خط ٣", 12)];

const meta: Meta<typeof PalmGrid> = {
  title: "Domain/PalmGrid",
  component: PalmGrid,
  args: { lines, ariaLabel: "خريطة النخيل", onCellActivate: (c, l) => console.log("activate", c, l) },
};
export default meta;
type S = StoryObj<typeof PalmGrid>;

export const Default: S = {};
export const Selected: S = {
  args: {
    lines: lines.map((l, li) => ({
      ...l, cells: l.cells.map((c, ci) => (li === 0 && ci === 2 ? { ...c, selected: true } : c)),
    })),
  },
};
export const Gallery: S = {
  render: () => (
    <div style={{ display: "grid", gap: 16 }}>
      <PalmGrid ariaLabel="قطعة أ" lines={[line("A1", "خط ١", 20), line("A2", "خط ٢", 20)]} />
    </div>
  ),
};
```

- [ ] **Step 9: Commit**

```bash
git add src/components/PalmCell.tsx src/components/PalmGrid.tsx src/components/PalmGrid.stories.tsx src/components/PalmGrid.test.tsx src/styles/components.css src/index.ts
git commit -m "feat(domain): PalmGrid + PalmCell — palm map by line (status→token, keyboard, a11y)"
```
Body ends with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 5: FileTimeline

A vertical RTL timeline of farm events (operation/issue/inspection/expense/photo) with tone-coded markers on the inline-start edge and consumer-supplied time labels.

**Files:**
- Create: `src/components/FileTimeline.tsx`, `src/components/FileTimeline.stories.tsx`, `src/components/FileTimeline.test.tsx`
- Modify: `src/styles/components.css`, `src/index.ts`

**Interfaces:**
```ts
/** Farm event kind → tone-coded marker (maps to a role token). */
export type TimelineKind =
  | "operation"   // عملية   → --brand
  | "issue"       // مشكلة   → --danger-fg
  | "inspection"  // فحص     → --info-fg
  | "expense"     // مصروف   → --warning-fg
  | "photo";      // صورة    → --accent-fg

export interface TimelineEvent {
  /** Stable id used as React key. */
  id: string;
  /** Event kind — selects the marker color. */
  kind: TimelineKind;
  /** Event title (consumer-supplied). */
  title: React.ReactNode;
  /** Consumer-supplied time label (e.g. "١٢ يونيو ٠٩:٣٠"). */
  time: React.ReactNode;
  /** Optional secondary description. */
  description?: React.ReactNode;
  /** Optional marker glyph (decorative; aria-hidden). */
  glyph?: React.ReactNode;
}

export interface FileTimelineProps extends React.HTMLAttributes<HTMLOListElement> {
  /** Chronological events (consumer controls order). */
  events: TimelineEvent[];
  /** Accessible name for the timeline (consumer-supplied). */
  ariaLabel: string;
}
```
Kind → role-token map (drives the marker `--modifier` class):
```ts
const KIND_CLASS: Record<TimelineKind, string> = {
  operation: "fos-tl--operation",   // --brand
  issue: "fos-tl--issue",           // --danger-fg
  inspection: "fos-tl--inspection", // --info-fg
  expense: "fos-tl--expense",       // --warning-fg
  photo: "fos-tl--photo",           // --accent-fg
};
```

- [ ] **Step 1: Write the failing test**

Create `src/components/FileTimeline.test.tsx`:
```tsx
import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { FileTimeline, type TimelineEvent, type TimelineKind } from "./FileTimeline";

const events: TimelineEvent[] = [
  { id: "e1", kind: "operation", title: "ري", time: "١٢ يونيو ٠٩:٣٠" },
  { id: "e2", kind: "issue", title: "إصابة بالسوسة", time: "١٣ يونيو", description: "خط ٢" },
  { id: "e3", kind: "inspection", title: "فحص دوري", time: "١٤ يونيو" },
  { id: "e4", kind: "expense", title: "شراء سماد", time: "١٥ يونيو" },
  { id: "e5", kind: "photo", title: "صورة الثمار", time: "١٦ يونيو" },
];

describe("FileTimeline", () => {
  it("renders an ordered list with every event title + time", () => {
    render(<FileTimeline events={events} ariaLabel="سجل المزرعة" />);
    expect(screen.getByRole("list", { name: "سجل المزرعة" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByText("إصابة بالسوسة")).toBeInTheDocument();
    expect(screen.getByText("خط ٢")).toBeInTheDocument();
  });
  it("maps every kind to its role-token marker class", () => {
    const all: TimelineKind[] = ["operation", "issue", "inspection", "expense", "photo"];
    const { container } = render(
      <FileTimeline ariaLabel="سجل" events={all.map((k, i) => ({ id: `${i}`, kind: k, title: k, time: "اليوم" }))} />,
    );
    for (const k of all) expect(container.querySelector(`.fos-tl--${k}`)).not.toBeNull();
  });
  it("has no axe violations", async () => {
    const { container } = render(<FileTimeline events={events} ariaLabel="سجل المزرعة" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- FileTimeline`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/components/FileTimeline.tsx`**

```tsx
import * as React from "react";

export type TimelineKind = "operation" | "issue" | "inspection" | "expense" | "photo";

export interface TimelineEvent {
  id: string;
  kind: TimelineKind;
  title: React.ReactNode;
  time: React.ReactNode;
  description?: React.ReactNode;
  glyph?: React.ReactNode;
}

export interface FileTimelineProps extends React.HTMLAttributes<HTMLOListElement> {
  events: TimelineEvent[];
  ariaLabel: string;
}

const KIND_CLASS: Record<TimelineKind, string> = {
  operation: "fos-tl--operation",
  issue: "fos-tl--issue",
  inspection: "fos-tl--inspection",
  expense: "fos-tl--expense",
  photo: "fos-tl--photo",
};

/**
 * Domain component: a vertical RTL timeline of farm events. Markers sit on the
 * inline-start edge, tone-coded by event kind. Titles/times are consumer-supplied.
 */
export function FileTimeline({ events, ariaLabel, className = "", ...rest }: FileTimelineProps) {
  return (
    <ol className={`fos-tl ${className}`.trim()} aria-label={ariaLabel} {...rest}>
      {events.map((ev) => (
        <li key={ev.id} className={`fos-tl__item ${KIND_CLASS[ev.kind]}`}>
          <span className="fos-tl__marker" aria-hidden="true">{ev.glyph}</span>
          <div className="fos-tl__body">
            <div className="fos-tl__head">
              <span className="fos-tl__title">{ev.title}</span>
              <time className="fos-tl__time">{ev.time}</time>
            </div>
            {ev.description != null && <div className="fos-tl__desc">{ev.description}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 4: Append the CSS block to `src/styles/components.css`**

```css
/* ---- FileTimeline (domain — vertical RTL farm-event timeline) ---- */
.fos-tl { list-style:none; margin:0; padding:0; display:grid; gap:var(--space-3); }
.fos-tl__item { position:relative; display:flex; gap:var(--space-3);
  padding-inline-start:var(--space-5); border-inline-start:2px solid var(--line); }
.fos-tl__marker { position:absolute; inset-inline-start:calc(-1 * var(--space-2)); inset-block-start:2px;
  inline-size:var(--space-4); block-size:var(--space-4); border-radius:50%; display:grid; place-items:center;
  font-size:var(--text-xs); color:var(--brand-contrast); background:var(--ink-muted); }
.fos-tl__head { display:flex; align-items:baseline; gap:var(--space-2); justify-content:space-between; }
.fos-tl__title { font-size:var(--text-sm); font-weight:var(--weight-bold); }
.fos-tl__time { font-size:var(--text-xs); color:var(--ink-muted); font-variant-numeric:tabular-nums; }
.fos-tl__desc { font-size:var(--text-xs); color:var(--ink-muted); margin-top:2px; }
.fos-tl--operation .fos-tl__marker { background:var(--brand); }
.fos-tl--issue .fos-tl__marker { background:var(--danger-fg); }
.fos-tl--inspection .fos-tl__marker { background:var(--info-fg); }
.fos-tl--expense .fos-tl__marker { background:var(--warning-fg); }
.fos-tl--photo .fos-tl__marker { background:var(--accent-fg); }
```

- [ ] **Step 5: Export from `src/index.ts`**

```ts
export { FileTimeline } from "./components/FileTimeline";
export type { FileTimelineProps, TimelineEvent, TimelineKind } from "./components/FileTimeline";
```

- [ ] **Step 6: Run test + purity to verify PASS**

Run: `npm test -- FileTimeline && npm run tokens:purity`
Expected: 3 passed; `✓ token-purity: clean`.

- [ ] **Step 7: Create the story** `src/components/FileTimeline.stories.tsx`

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { FileTimeline, type TimelineEvent } from "./FileTimeline";

const events: TimelineEvent[] = [
  { id: "e1", kind: "operation", title: "ري الكتلة أ", time: "١٢ يونيو ٠٩:٣٠", glyph: "💧" },
  { id: "e2", kind: "issue", title: "إصابة بسوسة النخيل", time: "١٣ يونيو ١١:٠٠", description: "خط ٢ موضع ٤", glyph: "⚠️" },
  { id: "e3", kind: "inspection", title: "فحص دوري", time: "١٤ يونيو", glyph: "🔍" },
  { id: "e4", kind: "expense", title: "شراء سماد عضوي", time: "١٥ يونيو", description: "١٢٠٠ ج.م", glyph: "💰" },
  { id: "e5", kind: "photo", title: "توثيق الثمار", time: "١٦ يونيو", glyph: "📷" },
];

const meta: Meta<typeof FileTimeline> = {
  title: "Domain/FileTimeline",
  component: FileTimeline,
  args: { events, ariaLabel: "سجل أحداث المزرعة" },
};
export default meta;
type S = StoryObj<typeof FileTimeline>;

export const Default: S = {};
export const Gallery: S = {
  render: () => (
    <div style={{ maxWidth: 420 }}>
      <FileTimeline ariaLabel="سجل مختصر" events={events.slice(0, 3)} />
    </div>
  ),
};
```

- [ ] **Step 8: Commit**

```bash
git add src/components/FileTimeline.tsx src/components/FileTimeline.stories.tsx src/components/FileTimeline.test.tsx src/styles/components.css src/index.ts
git commit -m "feat(domain): FileTimeline — RTL farm-event timeline (kind→token markers, a11y)"
```
Body ends with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 6: ApprovalChain

Shows an approval sequence (requested → reviewer → approved/rejected) as an ordered list with per-step status tone and consumer-supplied actor labels. The active step gets `aria-current="step"`.

**Files:**
- Create: `src/components/ApprovalChain.tsx`, `src/components/ApprovalChain.stories.tsx`, `src/components/ApprovalChain.test.tsx`
- Modify: `src/styles/components.css`, `src/index.ts`

**Interfaces:**
```ts
/** Per-step approval state → role-token pair. */
export type ApprovalState =
  | "requested" // طلب       → --info-fg
  | "pending"   // بانتظار   → --ink-muted (current reviewer)
  | "approved"  // معتمد     → --success-fg
  | "rejected"; // مرفوض     → --danger-fg

export interface ApprovalStep {
  /** Stable id used as React key. */
  id: string;
  /** State of this step. */
  state: ApprovalState;
  /** Consumer-supplied actor/role label (e.g. "المدير: خالد"). */
  actor: React.ReactNode;
  /** Optional time/note label. */
  note?: React.ReactNode;
}

export interface ApprovalChainProps extends React.HTMLAttributes<HTMLOListElement> {
  /** Ordered approval steps. */
  steps: ApprovalStep[];
  /** Accessible name for the chain (consumer-supplied). */
  ariaLabel: string;
}
```
State → role-token map + status glyph:
```ts
const STATE_CLASS: Record<ApprovalState, string> = {
  requested: "fos-approval--requested", // --info-fg
  pending: "fos-approval--pending",     // --ink-muted (the current reviewer)
  approved: "fos-approval--approved",   // --success-fg
  rejected: "fos-approval--rejected",   // --danger-fg
};
const STATE_GLYPH: Record<ApprovalState, string> = {
  requested: "•", pending: "…", approved: "✓", rejected: "✕",
};
```

- [ ] **Step 1: Write the failing test**

Create `src/components/ApprovalChain.test.tsx`:
```tsx
import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { ApprovalChain, type ApprovalStep } from "./ApprovalChain";

const steps: ApprovalStep[] = [
  { id: "req", state: "requested", actor: "مقدّم الطلب: سعاد" },
  { id: "rev", state: "pending", actor: "المراجع: خالد", note: "بانتظار المراجعة" },
  { id: "fin", state: "approved", actor: "المالك: عمر" },
];

describe("ApprovalChain", () => {
  it("renders an ordered list of actors", () => {
    render(<ApprovalChain steps={steps} ariaLabel="سلسلة الاعتماد" />);
    expect(screen.getByRole("list", { name: "سلسلة الاعتماد" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("المراجع: خالد")).toBeInTheDocument();
  });
  it("maps each state to its role-token class and marks pending as current", () => {
    const { container } = render(<ApprovalChain steps={steps} ariaLabel="سلسلة" />);
    expect(container.querySelector(".fos-approval--requested")).not.toBeNull();
    expect(container.querySelector(".fos-approval--approved")).not.toBeNull();
    const current = container.querySelector('[aria-current="step"]');
    expect(current).toHaveClass("fos-approval--pending");
  });
  it("shows a rejected step", () => {
    const { container } = render(
      <ApprovalChain ariaLabel="سلسلة" steps={[{ id: "r", state: "rejected", actor: "المالك" }]} />,
    );
    expect(container.querySelector(".fos-approval--rejected")).not.toBeNull();
  });
  it("has no axe violations", async () => {
    const { container } = render(<ApprovalChain steps={steps} ariaLabel="سلسلة الاعتماد" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- ApprovalChain`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/components/ApprovalChain.tsx`**

```tsx
import * as React from "react";

export type ApprovalState = "requested" | "pending" | "approved" | "rejected";

export interface ApprovalStep {
  id: string;
  state: ApprovalState;
  actor: React.ReactNode;
  note?: React.ReactNode;
}

export interface ApprovalChainProps extends React.HTMLAttributes<HTMLOListElement> {
  steps: ApprovalStep[];
  ariaLabel: string;
}

const STATE_CLASS: Record<ApprovalState, string> = {
  requested: "fos-approval--requested",
  pending: "fos-approval--pending",
  approved: "fos-approval--approved",
  rejected: "fos-approval--rejected",
};

const STATE_GLYPH: Record<ApprovalState, string> = {
  requested: "•",
  pending: "…",
  approved: "✓",
  rejected: "✕",
};

/**
 * Domain component: an approval sequence (requested → reviewer → approved/rejected)
 * as an ordered list. The pending (current reviewer) step carries aria-current="step".
 * Actor labels are consumer-supplied.
 */
export function ApprovalChain({ steps, ariaLabel, className = "", ...rest }: ApprovalChainProps) {
  return (
    <ol className={`fos-approval ${className}`.trim()} aria-label={ariaLabel} {...rest}>
      {steps.map((step) => (
        <li
          key={step.id}
          className={`fos-approval__step ${STATE_CLASS[step.state]}`}
          aria-current={step.state === "pending" ? "step" : undefined}
        >
          <span className="fos-approval__marker" aria-hidden="true">{STATE_GLYPH[step.state]}</span>
          <div className="fos-approval__body">
            <span className="fos-approval__actor">{step.actor}</span>
            {step.note != null && <span className="fos-approval__note">{step.note}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 4: Append the CSS block to `src/styles/components.css`**

```css
/* ---- ApprovalChain (domain — approval sequence) ---- */
.fos-approval { list-style:none; margin:0; padding:0; display:grid; gap:var(--space-2); }
.fos-approval__step { display:flex; align-items:center; gap:var(--space-3);
  padding-block:var(--space-2); padding-inline:var(--space-3); border:1px solid var(--line);
  border-radius:var(--radius-control); background:var(--surface); }
.fos-approval__marker { inline-size:var(--space-5); block-size:var(--space-5); flex:none; border-radius:50%;
  display:grid; place-items:center; font-size:var(--text-xs); font-weight:var(--weight-bold);
  color:var(--brand-contrast); background:var(--ink-muted); }
.fos-approval__body { display:flex; flex-direction:column; gap:2px; }
.fos-approval__actor { font-size:var(--text-sm); font-weight:var(--weight-bold); }
.fos-approval__note { font-size:var(--text-xs); color:var(--ink-muted); }
.fos-approval--requested .fos-approval__marker { background:var(--info-fg); }
.fos-approval--pending .fos-approval__marker { background:var(--ink-muted); }
.fos-approval--pending { border-color:color-mix(in srgb, var(--brand) 35%, var(--surface)); background:var(--surface-sunken); }
.fos-approval--approved .fos-approval__marker { background:var(--success-fg); }
.fos-approval--approved { border-color:color-mix(in srgb, var(--success-fg) 30%, var(--surface)); }
.fos-approval--rejected .fos-approval__marker { background:var(--danger-fg); }
.fos-approval--rejected { border-color:color-mix(in srgb, var(--danger-fg) 30%, var(--surface)); }
```

- [ ] **Step 5: Export from `src/index.ts`**

```ts
export { ApprovalChain } from "./components/ApprovalChain";
export type { ApprovalChainProps, ApprovalStep, ApprovalState } from "./components/ApprovalChain";
```

- [ ] **Step 6: Run test + purity to verify PASS**

Run: `npm test -- ApprovalChain && npm run tokens:purity`
Expected: 4 passed; `✓ token-purity: clean`.

- [ ] **Step 7: Create the story** `src/components/ApprovalChain.stories.tsx`

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { ApprovalChain, type ApprovalStep } from "./ApprovalChain";

const steps: ApprovalStep[] = [
  { id: "req", state: "approved", actor: "مقدّم الطلب: سعاد", note: "١٢ يونيو" },
  { id: "rev", state: "pending", actor: "المراجع: خالد", note: "بانتظار المراجعة" },
  { id: "fin", state: "requested", actor: "المالك: عمر" },
];

const meta: Meta<typeof ApprovalChain> = {
  title: "Domain/ApprovalChain",
  component: ApprovalChain,
  args: { steps, ariaLabel: "سلسلة اعتماد طلب الصرف" },
};
export default meta;
type S = StoryObj<typeof ApprovalChain>;

export const InReview: S = {};
export const Approved: S = {
  args: { steps: steps.map((s) => ({ ...s, state: "approved" as const })) },
};
export const Rejected: S = {
  args: {
    steps: [
      { id: "req", state: "approved", actor: "مقدّم الطلب: سعاد" },
      { id: "rev", state: "rejected", actor: "المراجع: خالد", note: "تجاوز الميزانية" },
    ],
  },
};
export const Gallery: S = {
  render: () => (
    <div style={{ display: "grid", gap: 16, maxWidth: 360 }}>
      <ApprovalChain ariaLabel="قيد المراجعة" steps={steps} />
      <ApprovalChain ariaLabel="مرفوض" steps={[
        { id: "a", state: "approved", actor: "سعاد" },
        { id: "b", state: "rejected", actor: "خالد", note: "تجاوز الميزانية" },
      ]} />
    </div>
  ),
};
```

- [ ] **Step 8: Commit**

```bash
git add src/components/ApprovalChain.tsx src/components/ApprovalChain.stories.tsx src/components/ApprovalChain.test.tsx src/styles/components.css src/index.ts
git commit -m "feat(domain): ApprovalChain — approval sequence (state→token, aria-current, a11y)"
```
Body ends with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 7: Domain group verification + re-sync note

**Files:** none (verification only)

- [ ] **Step 1: Full gate run**

Run:
```bash
npm run tokens:present && npm run tokens:purity && npm test && npm run typecheck && npm run build && npm run build-storybook
```
Expected: all exit 0. `npm test` runs the new domain suites (LoopStepper, PhaseCard, StatusPill, PalmGrid, FileTimeline, ApprovalChain) plus the existing theme-matrix + harness tests, all green.

- [ ] **Step 2: Confirm the catalog export surface**

Run: `node -e "const m=require('./dist/index.js'); ['LoopStepper','PhaseCard','StatusPill','PalmGrid','PalmCell','FileTimeline','ApprovalChain'].forEach(n=>{if(!m[n])throw new Error('missing export: '+n)}); console.log('domain exports OK')"`
Expected: `domain exports OK`.

- [ ] **Step 3: Commit any incidental fixes, then tag the phase**

```bash
git add -A && git commit -m "chore: domain components phase complete" || echo "nothing to commit"
git tag phase-domain-components
```
Body ends with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

- [ ] **Step 4: Re-sync to Claude Design (manual, needs login)**

Note for the operator (NOT automated — requires `/design-login` in a login-capable session): after this phase the catalog gained 7 domain components, so re-run the Claude Design sync (`resync.mjs --remote` / the design-sync skill's upload step) so the project reflects the expanded v1 catalog (spec §8).

---

## Self-Review

**Spec coverage (this plan = spec §4 "Domain — Farm OS" row):** the row lists `✅VerdictBanner · ➕LoopStepper · ➕PhaseCard · ➕PalmGrid/PalmCell · ➕FileTimeline · ➕ApprovalChain · ➕StatusPill`. VerdictBanner already ships (untouched). The six `➕` components map 1:1 to Tasks 1–6: LoopStepper → T1, PhaseCard → T2, StatusPill → T3, PalmGrid + PalmCell → T4 (one coupled task per the "PalmGrid + PalmCell = one task" rule), FileTimeline → T5, ApprovalChain → T6. Each satisfies the §4 universal conventions (semantic `variant`/`tone`/status props, `className` passthrough, token-driven, RTL via logical CSS) and the §6 publish-ready gate (strict types, Vitest behavior + keyboard for PalmGrid, jest-axe zero-violations per component, token-purity, theme-matrix smoke inherited from the foundation). T7 runs the full gate + the §8 re-sync note. Out of scope by design: the other catalog groups (Forms/Data display/Feedback/Navigation/Charts) live in their own plans; the Changesets/CI/registry publish flow is the packaging plan.

**Placeholder scan:** no placeholders. Every component ships complete real code — full `.tsx`, the explicit status→role-token `Record` map (`LoopStepState`, `PhaseTone`, `PillStatus`, `PalmStatus`, `TimelineKind`, `ApprovalState`), the full CSS block (token-only, including the PalmGrid `overflow-x` scroll layout + per-status fills and the FileTimeline inline-start markers), CSF3 stories with Arabic samples + a Gallery, the export lines, and the verification commands. CSS uses only role tokens + numeric primitives + `color-mix(in srgb, var(--token) …)` tints, so `scripts/token-purity.mjs` (hex/rgb/hsl scanner over `components.css`) passes — each task's Step 6 runs it as the objective oracle.

**Type-consistency note:** every status union is defined once in its component and re-exported from `src/index.ts` with the matching `…Props` type (e.g. `PalmStatus` is declared in `PalmCell.tsx`, imported by `PalmGrid.tsx`, and both are exported). `PalmGrid` consumes `PalmCellData` (mirrors `PalmCellProps` minus the React-specific fields) and `PalmCell`'s `PalmStatus` — no drift. The `STATUS_CLASS`/`STATE_CLASS`/`KIND_CLASS` maps are typed `Record<Union, string>`, so adding a status without a class is a compile error. No `any` in any public signature; `PalmCellProps` uses `Omit<…, "aria-label">` to force the consumer through the required `ariaLabel` prop (status + position), satisfying the §4 a11y baseline. Props extend the correct native element (`HTMLOListElement` for the list-based steppers/timeline/chain, `HTMLDivElement` for cards/grid, `HTMLSpanElement` for the pill, `HTMLButtonElement` for the cell) — consistent with the shipped components' convention.
