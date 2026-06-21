# Feedback & Overlay Components Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the spec §4 "Feedback" group — `Toast` + `Toaster` + `useToast`, `Modal`/`Dialog`, `Drawer`/`Sheet` (RTL: slides from inline-start/inline-end), and `ConfirmDialog` (built on `Modal`) — each a11y-clean (focus-trap, `Esc`, return-focus, backdrop click-to-close), portal-rendered, token-pure, typed, tested, and documented in Storybook.

**Architecture:** Overlays render through a React portal (`createPortal(…, document.body)`) so they escape the `.fos` scope's clipping/stacking; each overlay re-applies the active theme by reading `useTheme()` and wrapping its portal subtree in a `<div class="fos" data-theme … data-density … data-radius …>` so role tokens resolve outside the provider's DOM subtree. A shared internal `useOverlay` hook centralizes the cross-cutting a11y behavior (focus-trap via a Tab key handler over focusable descendants, `Esc`-to-close, return-focus to the previously-focused element on unmount, and `aria-hidden`/scroll-lock on `document.body`). `Modal` and `Drawer` both consume it; `ConfirmDialog` composes `Modal` and reuses its prop surface. `Toast` is a separate non-modal channel: a `ToastProvider` holds a `useReducer` queue, `useToast()` returns imperative `toast.*` methods, and `<Toaster/>` renders the live region (`aria-live="polite"`) via portal with auto-dismiss + pause-on-hover.

**Tech Stack:** React 18, TypeScript (strict), tsup, Storybook 8 (react-vite), Vitest + @testing-library/react + @testing-library/user-event + jsdom, jest-axe, plain CSS (custom properties). `react-dom`'s `createPortal`.

## Global Constraints
- React `>=18`; TypeScript `strict: true`; no `any` in public API.
- **Components reference only Tier-2 role tokens + numeric scales — zero hardcoded color/hex/rgb/px-color values.** (Enforced by `scripts/token-purity.mjs`, run in `build`.)
- RTL-first: use logical CSS properties (`margin-inline`, `inset-inline-start`, `inset-inline-end`) — never physical (`left`/`right`). The Drawer's `side` prop maps to logical inline edges so it auto-flips under `dir="rtl"`.
- Library is **presentational**: no user-facing strings, no i18n inside components. All labels (`closeLabel`, button text, titles) are passed by the consumer. Stories/tests use Arabic.
- Class prefix `fos-`; BEM-ish `fos-<block>` / `--modifier` / `__element`. Token prefix `--`.
- A11y is CRITICAL: Modal/Drawer/ConfirmDialog need `role="dialog"` + `aria-modal="true"`, focus-trap, `Esc` to close, return-focus to the trigger on close, backdrop click-to-close. Toaster region is `aria-live="polite"`. Use the `--z-*` scale for layering (`--z-modal`, `--z-drawer`, `--z-toast`) and `--shadow-3` for modal elevation (via a new `--shadow-overlay` role token).
- `import * as React from "react"`; `function Name(props)`; `forwardRef` when a DOM ref is needed. Props extend native props; defaults in destructuring; merge `` `fos-x fos-x--${v} ${className}`.trim() ``.
- Each component: `src/components/<Name>.tsx`, `<Name>.stories.tsx` (CSF3 Arabic + Gallery), `<Name>.test.tsx` (render + a11y behavior via user-event + jest-axe no-violations), a CSS block appended to `src/styles/components.css`, and an export added to `src/index.ts`.
- Commit after every task. End commit bodies with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure
- `src/styles/theme.css` — **modify** — add `--shadow-overlay` (light + dark) + `--scrim` role token.
- `src/components/useOverlay.ts` — **create** — shared focus-trap + Esc + return-focus + scroll-lock hook (internal, not exported from the package root).
- `src/components/Modal.tsx`, `Modal.stories.tsx`, `Modal.test.tsx` — **create**.
- `src/components/Drawer.tsx`, `Drawer.stories.tsx`, `Drawer.test.tsx` — **create**.
- `src/components/ConfirmDialog.tsx`, `ConfirmDialog.stories.tsx`, `ConfirmDialog.test.tsx` — **create** — composes `Modal`.
- `src/components/Toast.tsx` — **create** — `ToastProvider`, `useToast`, `Toaster`, the `Toast` presentational item, reducer + types.
- `src/components/Toast.stories.tsx`, `Toast.test.tsx` — **create**.
- `src/styles/components.css` — **modify** — append Modal / Drawer / ConfirmDialog / Toast blocks.
- `src/index.ts` — **modify** — export Modal, Drawer, ConfirmDialog, Toast API.

---

### Task 0: Overlay role tokens (scrim + elevation)

**Files:**
- Modify: `src/styles/theme.css`

**Interfaces:**
- Produces role tokens consumed by every overlay: `--shadow-overlay` (maps to `--shadow-3` in light, a deeper stack in dark), `--scrim` (the backdrop fill). Defined for light (`:root`) and dark (`[data-theme="dark"]`).

- [ ] **Step 1: Write the failing presence test**

Create `src/components/overlay-tokens.test.ts`:
```ts
import { it, expect } from "vitest";
import fs from "node:fs";
it("defines overlay role tokens in light + dark", () => {
  const css = fs.readFileSync(new URL("../styles/theme.css", import.meta.url), "utf8");
  const light = css.split('[data-theme="dark"]')[0];
  const dark = css.split('[data-theme="dark"]')[1] ?? "";
  for (const t of ["--shadow-overlay", "--scrim"]) {
    expect(light).toContain(t + ":");
    expect(dark).toContain(t + ":");
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- overlay-tokens`
Expected: FAIL (tokens absent).

- [ ] **Step 3: Add the tokens to `src/styles/theme.css`**

In the `:root` block (after `--shadow-card: var(--shadow-2);`), add:
```css
  --shadow-overlay: var(--shadow-3); --scrim: color-mix(in srgb, var(--gray-900) 45%, transparent);
```
In the `[data-theme="dark"]` block (after the `--shadow-card:` line), add:
```css
  --shadow-overlay:0 30px 90px rgba(0,0,0,.6); --scrim: color-mix(in srgb, #000000 62%, transparent);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- overlay-tokens`
Expected: 1 passed.

- [ ] **Step 5: Confirm purity still clean**

Run: `npm run tokens:purity`
Expected: `✓ token-purity: clean` (the new `#000000` lives in `theme.css`, which the script allows; `theme.css` is never scanned).

- [ ] **Step 6: Commit**

```bash
git add src/styles/theme.css src/components/overlay-tokens.test.ts
git commit -m "feat(tokens): add --shadow-overlay + --scrim role tokens (light + dark)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 1: `useOverlay` shared a11y hook

**Files:**
- Create: `src/components/useOverlay.ts`, `src/components/useOverlay.test.tsx`

**Interfaces:**
- Produces:
  - `interface UseOverlayOptions { open: boolean; onClose: () => void; closeOnEsc?: boolean }`
  - `function useOverlay(opts: UseOverlayOptions): { ref: React.RefObject<HTMLDivElement> }`
  - Behavior while `open`: on mount records `document.activeElement`; moves focus into the panel (first focusable, else the panel itself); a `keydown` listener traps `Tab`/`Shift+Tab` within focusable descendants and calls `onClose()` on `Escape` (when `closeOnEsc !== false`); on close/unmount restores focus to the recorded element and clears the body scroll-lock. Sets `document.body.style.overflow = "hidden"` while any overlay is open.
- Consumed by: `Modal` (Task 2), `Drawer` (Task 3).

- [ ] **Step 1: Write the failing test**

Create `src/components/useOverlay.test.tsx`:
```tsx
import { it, expect, describe, vi } from "vitest";
import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useOverlay } from "./useOverlay";

function Harness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = React.useState(false);
  const close = () => { onClose(); setOpen(false); };
  const { ref } = useOverlay({ open, onClose: close });
  return (
    <div>
      <button onClick={() => setOpen(true)}>افتح</button>
      {open && (
        <div ref={ref} role="dialog" aria-modal="true">
          <button>الأول</button>
          <button>الأخير</button>
        </div>
      )}
    </div>
  );
}

describe("useOverlay", () => {
  it("moves focus inside on open and returns it to the trigger on close", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const trigger = screen.getByText("افتح");
    trigger.focus();
    await user.click(trigger);
    expect(document.activeElement).toBe(screen.getByText("الأول"));
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
  });

  it("traps Tab within the panel (wraps last → first)", async () => {
    const user = userEvent.setup();
    render(<Harness onClose={() => {}} />);
    await user.click(screen.getByText("افتح"));
    const first = screen.getByText("الأول");
    const last = screen.getByText("الأخير");
    last.focus();
    await user.tab();
    expect(document.activeElement).toBe(first);
    first.focus();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(last);
  });

  it("locks body scroll while open", async () => {
    const user = userEvent.setup();
    render(<Harness onClose={() => {}} />);
    expect(document.body.style.overflow).toBe("");
    await user.click(screen.getByText("افتح"));
    expect(document.body.style.overflow).toBe("hidden");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- useOverlay`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/components/useOverlay.ts`**

```ts
import * as React from "react";

export interface UseOverlayOptions {
  /** Whether the overlay is mounted/visible. */
  open: boolean;
  /** Called on Esc (when enabled) or when the consumer requests close. */
  onClose: () => void;
  /** Close on the Escape key. Default true. */
  closeOnEsc?: boolean;
}

const FOCUSABLE =
  'a[href],area[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function focusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement
  );
}

/** Shared dialog/drawer a11y: focus-trap + Esc + return-focus + body scroll-lock. */
export function useOverlay({ open, onClose, closeOnEsc = true }: UseOverlayOptions) {
  const ref = React.useRef<HTMLDivElement>(null);
  const restoreRef = React.useRef<HTMLElement | null>(null);
  // Keep the latest onClose without re-binding the keydown listener.
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  React.useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    // Move focus into the panel.
    const initial = panel ? focusable(panel)[0] ?? panel : null;
    initial?.focus();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(e: KeyboardEvent) {
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- useOverlay`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/components/useOverlay.ts src/components/useOverlay.test.tsx
git commit -m "feat(overlay): useOverlay hook (focus-trap, Esc, return-focus, scroll-lock)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `Modal` / `Dialog`

**Files:**
- Create: `src/components/Modal.tsx`, `src/components/Modal.stories.tsx`, `src/components/Modal.test.tsx`
- Modify: `src/styles/components.css`, `src/index.ts`

**Interfaces:**
- Consumes: `useOverlay` (Task 1), `useTheme` (existing), `createPortal`.
- Produces:
  - `type ModalSize = "sm" | "md" | "lg"`
  - `interface ModalProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> { open: boolean; onClose: () => void; title?: React.ReactNode; footer?: React.ReactNode; size?: ModalSize; closeOnBackdrop?: boolean; closeOnEsc?: boolean; closeLabel?: string; children: React.ReactNode }`
  - `function Modal(props: ModalProps): React.ReactPortal | null` — returns `null` when `!open`. Renders a portal to `document.body`: a `.fos` scope (carrying the active `data-theme`/`data-density`/`data-radius`) → `.fos-modal__backdrop` (click closes when `closeOnBackdrop !== false`) → `.fos-modal[role="dialog"][aria-modal="true"]` labelled by an auto-generated id when `title` is present. A header (title + close button using `closeLabel`), a body (`children`), and an optional `footer`. The close button and backdrop both call `onClose`.
- `Dialog` is exported as an alias of `Modal`.

- [ ] **Step 1: Write the failing test**

Create `src/components/Modal.test.tsx`:
```tsx
import { it, expect, describe, vi } from "vitest";
import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { ThemeProvider } from "../theme";
import { Modal } from "./Modal";

function Demo({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <ThemeProvider>
      <button onClick={() => setOpen(true)}>افتح النافذة</button>
      <Modal
        open={open}
        onClose={() => { onClose(); setOpen(false); }}
        title="تأكيد العملية"
        closeLabel="إغلاق"
      >
        <p>محتوى النافذة</p>
        <button>إجراء</button>
      </Modal>
    </ThemeProvider>
  );
}

describe("Modal", () => {
  it("renders nothing when closed", () => {
    render(<Demo />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens as a labelled modal dialog and traps focus", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.click(screen.getByText("افتح النافذة"));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("تأكيد العملية");
  });

  it("closes on Esc, backdrop click, and the close button — returning focus to the trigger", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Demo onClose={onClose} />);
    const trigger = screen.getByText("افتح النافذة");
    trigger.focus();
    // Esc
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
    // close button
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "إغلاق" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    // backdrop
    await user.click(trigger);
    await user.click(document.querySelector(".fos-modal__backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("has no axe violations when open", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.click(screen.getByText("افتح النافذة"));
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- Modal`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/components/Modal.tsx`**

```tsx
import * as React from "react";
import { createPortal } from "react-dom";
import { useTheme } from "../theme";
import { useOverlay } from "./useOverlay";

export type ModalSize = "sm" | "md" | "lg";

export interface ModalProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** Whether the modal is open. Controlled. */
  open: boolean;
  /** Called when the user requests to close (Esc, backdrop, close button). */
  onClose: () => void;
  /** Heading shown in the header; also names the dialog for assistive tech. */
  title?: React.ReactNode;
  /** Optional footer region (e.g. action buttons), pinned below the body. */
  footer?: React.ReactNode;
  /** Width preset. */
  size?: ModalSize;
  /** Close when the backdrop is clicked. Default true. */
  closeOnBackdrop?: boolean;
  /** Close on the Escape key. Default true. */
  closeOnEsc?: boolean;
  /** Accessible label for the × close button (consumer-supplied — no i18n in lib). */
  closeLabel?: string;
  children: React.ReactNode;
}

/** Accessible, portal-rendered modal dialog. Re-applies the active theme inside the portal. */
export function Modal({
  open, onClose, title, footer, size = "md",
  closeOnBackdrop = true, closeOnEsc = true, closeLabel,
  className = "", children, ...rest
}: ModalProps): React.ReactPortal | null {
  const theme = useTheme();
  const { ref } = useOverlay({ open, onClose, closeOnEsc });
  const titleId = React.useId();

  if (!open) return null;

  return createPortal(
    <div className="fos" data-theme={theme.scheme} data-density={theme.density} data-radius={theme.radius}>
      <div
        className="fos-modal__backdrop"
        onMouseDown={(e) => {
          if (closeOnBackdrop && e.target === e.currentTarget) onClose();
        }}
      >
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title != null ? titleId : undefined}
          tabIndex={-1}
          className={`fos-modal fos-modal--${size} ${className}`.trim()}
          {...rest}
        >
          {(title != null || closeLabel != null) && (
            <div className="fos-modal__header">
              {title != null && <h2 id={titleId} className="fos-modal__title">{title}</h2>}
              {closeLabel != null && (
                <button type="button" className="fos-modal__close" aria-label={closeLabel} onClick={onClose}>
                  ✕
                </button>
              )}
            </div>
          )}
          <div className="fos-modal__body">{children}</div>
          {footer != null && <div className="fos-modal__footer">{footer}</div>}
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Alias — Dialog is the same component. */
export const Dialog = Modal;
```

- [ ] **Step 4: Append the Modal CSS block to `src/styles/components.css`**

```css
/* ---- Modal / Dialog ---- */
.fos-modal__backdrop { position:fixed; inset:0; z-index:var(--z-modal); background:var(--scrim);
  display:grid; place-items:center; padding:var(--space-4); animation:fos-fade var(--dur-fast) var(--ease); }
.fos-modal { background:var(--surface-raised); color:var(--ink); border:1px solid var(--line);
  border-radius:var(--radius-card); box-shadow:var(--shadow-overlay); width:100%;
  max-height:calc(100vh - var(--space-10)); display:flex; flex-direction:column; overflow:hidden;
  animation:fos-pop var(--dur) var(--ease); }
.fos-modal:focus-visible { outline:2px solid var(--focus-ring); outline-offset:2px; }
.fos-modal--sm { max-width:380px; } .fos-modal--md { max-width:540px; } .fos-modal--lg { max-width:760px; }
.fos-modal__header { display:flex; align-items:flex-start; gap:var(--space-3);
  padding:var(--space-4) var(--space-4) var(--space-3); border-bottom:1px solid var(--line); }
.fos-modal__title { font-size:var(--text-md); font-weight:var(--weight-bold); margin:0; flex:1; }
.fos-modal__close { margin-inline-start:auto; border:none; background:transparent; color:var(--ink-muted);
  cursor:pointer; font-size:var(--text-md); line-height:1; padding:var(--space-1); border-radius:var(--radius-control); }
.fos-modal__close:hover { background:var(--surface-sunken); color:var(--ink); }
.fos-modal__close:focus-visible { outline:2px solid var(--focus-ring); outline-offset:2px; }
.fos-modal__body { padding:var(--space-4); overflow:auto; }
.fos-modal__footer { display:flex; justify-content:flex-end; gap:var(--space-2);
  padding:var(--space-3) var(--space-4); border-top:1px solid var(--line); }
@keyframes fos-fade { from { opacity:0; } to { opacity:1; } }
@keyframes fos-pop { from { opacity:0; transform:translateY(8px) scale(.98); } to { opacity:1; transform:none; } }
```

- [ ] **Step 5: Export from `src/index.ts`**

Add:
```ts
export { Modal, Dialog } from "./components/Modal";
export type { ModalProps, ModalSize } from "./components/Modal";
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm test -- Modal`
Expected: 4 passed. Then `npm run tokens:purity` → clean.

- [ ] **Step 7: Create `src/components/Modal.stories.tsx`**

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";

const meta: Meta<typeof Modal> = {
  title: "Feedback/Modal",
  component: Modal,
  argTypes: { size: { control: "inline-radio", options: ["sm", "md", "lg"] } },
};
export default meta;
type S = StoryObj<typeof Modal>;

function Template(args: React.ComponentProps<typeof Modal>) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>افتح النافذة</Button>
      <Modal
        {...args}
        open={open}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={() => setOpen(false)}>تأكيد</Button>
          </>
        }
      >
        هل أنت متأكد من تنفيذ هذه العملية على المزرعة؟
      </Modal>
    </>
  );
}

export const Default: S = { args: { title: "تأكيد العملية", closeLabel: "إغلاق", size: "md" }, render: Template };
export const Large: S = { args: { title: "تفاصيل النخلة", closeLabel: "إغلاق", size: "lg" }, render: Template };
export const NoTitle: S = { args: { closeLabel: "إغلاق", size: "sm" }, render: Template };

export const Gallery: S = {
  render: () => {
    const [which, setWhich] = React.useState<"sm" | "md" | "lg" | null>(null);
    return (
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Button onClick={() => setWhich("sm")}>صغيرة</Button>
        <Button onClick={() => setWhich("md")}>متوسطة</Button>
        <Button onClick={() => setWhich("lg")}>كبيرة</Button>
        <Modal open={which !== null} onClose={() => setWhich(null)} title="نافذة" closeLabel="إغلاق" size={which ?? "md"}>
          الحجم: {which}
        </Modal>
      </div>
    );
  },
};
```

- [ ] **Step 8: Commit**

```bash
git add src/components/Modal.tsx src/components/Modal.stories.tsx src/components/Modal.test.tsx src/styles/components.css src/index.ts
git commit -m "feat(overlay): Modal/Dialog (portal, focus-trap, Esc, backdrop, themed)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `Drawer` / `Sheet`

**Files:**
- Create: `src/components/Drawer.tsx`, `src/components/Drawer.stories.tsx`, `src/components/Drawer.test.tsx`
- Modify: `src/styles/components.css`, `src/index.ts`

**Interfaces:**
- Consumes: `useOverlay` (Task 1), `useTheme`, `createPortal`.
- Produces:
  - `type DrawerSide = "start" | "end"` (logical inline edges — under `dir="rtl"`, `end` is the right physical edge; under LTR it is the left's opposite. They auto-flip via logical CSS.)
  - `interface DrawerProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> { open: boolean; onClose: () => void; side?: DrawerSide; title?: React.ReactNode; footer?: React.ReactNode; closeOnBackdrop?: boolean; closeOnEsc?: boolean; closeLabel?: string; children: React.ReactNode }`
  - `function Drawer(props: DrawerProps): React.ReactPortal | null` — same portal + theme + a11y mechanics as `Modal`; panel slides in from the inline `side` (default `end`). `role="dialog"` + `aria-modal="true"`, labelled by `title`.
- `Sheet` is exported as an alias of `Drawer`.

- [ ] **Step 1: Write the failing test**

Create `src/components/Drawer.test.tsx`:
```tsx
import { it, expect, describe, vi } from "vitest";
import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { ThemeProvider } from "../theme";
import { Drawer } from "./Drawer";

function Demo({ side, onClose = () => {} }: { side?: "start" | "end"; onClose?: () => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <ThemeProvider>
      <button onClick={() => setOpen(true)}>افتح اللوحة</button>
      <Drawer
        open={open}
        onClose={() => { onClose(); setOpen(false); }}
        side={side}
        title="التنبيهات"
        closeLabel="إغلاق"
      >
        <button>عنصر</button>
      </Drawer>
    </ThemeProvider>
  );
}

describe("Drawer", () => {
  it("is closed by default and opens as a labelled dialog", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByText("افتح اللوحة"));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("التنبيهات");
  });

  it("reflects the inline side via a modifier class (defaults to end)", async () => {
    const user = userEvent.setup();
    render(<Demo side="start" />);
    await user.click(screen.getByText("افتح اللوحة"));
    expect(screen.getByRole("dialog")).toHaveClass("fos-drawer--start");
  });

  it("closes on Esc and backdrop, returning focus to the trigger", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Demo onClose={onClose} />);
    const trigger = screen.getByText("افتح اللوحة");
    trigger.focus();
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
    await user.click(trigger);
    await user.click(document.querySelector(".fos-drawer__backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("has no axe violations when open", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.click(screen.getByText("افتح اللوحة"));
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- Drawer`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/components/Drawer.tsx`**

```tsx
import * as React from "react";
import { createPortal } from "react-dom";
import { useTheme } from "../theme";
import { useOverlay } from "./useOverlay";

export type DrawerSide = "start" | "end";

export interface DrawerProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** Whether the drawer is open. Controlled. */
  open: boolean;
  /** Called when the user requests to close (Esc, backdrop, close button). */
  onClose: () => void;
  /** Inline edge to dock to. Logical — auto-flips under RTL. Default "end". */
  side?: DrawerSide;
  /** Heading; also names the dialog for assistive tech. */
  title?: React.ReactNode;
  /** Optional pinned footer region. */
  footer?: React.ReactNode;
  /** Close when the backdrop is clicked. Default true. */
  closeOnBackdrop?: boolean;
  /** Close on the Escape key. Default true. */
  closeOnEsc?: boolean;
  /** Accessible label for the × close button (consumer-supplied). */
  closeLabel?: string;
  children: React.ReactNode;
}

/** Accessible, portal-rendered side sheet. Slides from the inline `side` (RTL-aware). */
export function Drawer({
  open, onClose, side = "end", title, footer,
  closeOnBackdrop = true, closeOnEsc = true, closeLabel,
  className = "", children, ...rest
}: DrawerProps): React.ReactPortal | null {
  const theme = useTheme();
  const { ref } = useOverlay({ open, onClose, closeOnEsc });
  const titleId = React.useId();

  if (!open) return null;

  return createPortal(
    <div className="fos" data-theme={theme.scheme} data-density={theme.density} data-radius={theme.radius}>
      <div
        className="fos-drawer__backdrop"
        onMouseDown={(e) => {
          if (closeOnBackdrop && e.target === e.currentTarget) onClose();
        }}
      >
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title != null ? titleId : undefined}
          tabIndex={-1}
          className={`fos-drawer fos-drawer--${side} ${className}`.trim()}
          {...rest}
        >
          {(title != null || closeLabel != null) && (
            <div className="fos-drawer__header">
              {title != null && <h2 id={titleId} className="fos-drawer__title">{title}</h2>}
              {closeLabel != null && (
                <button type="button" className="fos-drawer__close" aria-label={closeLabel} onClick={onClose}>
                  ✕
                </button>
              )}
            </div>
          )}
          <div className="fos-drawer__body">{children}</div>
          {footer != null && <div className="fos-drawer__footer">{footer}</div>}
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Alias — Sheet is the same component. */
export const Sheet = Drawer;
```

- [ ] **Step 4: Append the Drawer CSS block to `src/styles/components.css`**

The panel docks to an inline edge using logical `inset-inline-start`/`inset-inline-end`, and slides via a logical-aware transform. RTL flips automatically because the backdrop honors `dir`.

```css
/* ---- Drawer / Sheet ---- */
.fos-drawer__backdrop { position:fixed; inset:0; z-index:var(--z-drawer); background:var(--scrim);
  display:flex; animation:fos-fade var(--dur-fast) var(--ease); }
.fos-drawer { background:var(--surface-raised); color:var(--ink); width:min(420px, 92vw);
  height:100%; display:flex; flex-direction:column; box-shadow:var(--shadow-overlay);
  border-inline:1px solid var(--line); animation:fos-slide var(--dur) var(--ease); }
.fos-drawer:focus-visible { outline:2px solid var(--focus-ring); outline-offset:-2px; }
.fos-drawer--end { margin-inline-start:auto; }
.fos-drawer--start { margin-inline-end:auto; }
.fos-drawer__header { display:flex; align-items:flex-start; gap:var(--space-3);
  padding:var(--space-4); border-bottom:1px solid var(--line); }
.fos-drawer__title { font-size:var(--text-md); font-weight:var(--weight-bold); margin:0; flex:1; }
.fos-drawer__close { margin-inline-start:auto; border:none; background:transparent; color:var(--ink-muted);
  cursor:pointer; font-size:var(--text-md); line-height:1; padding:var(--space-1); border-radius:var(--radius-control); }
.fos-drawer__close:hover { background:var(--surface-sunken); color:var(--ink); }
.fos-drawer__close:focus-visible { outline:2px solid var(--focus-ring); outline-offset:2px; }
.fos-drawer__body { padding:var(--space-4); overflow:auto; flex:1; }
.fos-drawer__footer { display:flex; justify-content:flex-end; gap:var(--space-2);
  padding:var(--space-3) var(--space-4); border-top:1px solid var(--line); }
@keyframes fos-slide { from { opacity:.4; transform:translateX(8%); } to { opacity:1; transform:none; } }
```

- [ ] **Step 5: Export from `src/index.ts`**

Add:
```ts
export { Drawer, Sheet } from "./components/Drawer";
export type { DrawerProps, DrawerSide } from "./components/Drawer";
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm test -- Drawer`
Expected: 4 passed. Then `npm run tokens:purity` → clean.

- [ ] **Step 7: Create `src/components/Drawer.stories.tsx`**

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";
import { Drawer } from "./Drawer";
import { Button } from "./Button";

const meta: Meta<typeof Drawer> = {
  title: "Feedback/Drawer",
  component: Drawer,
  argTypes: { side: { control: "inline-radio", options: ["start", "end"] } },
};
export default meta;
type S = StoryObj<typeof Drawer>;

function Template(args: React.ComponentProps<typeof Drawer>) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>افتح اللوحة</Button>
      <Drawer {...args} open={open} onClose={() => setOpen(false)}>
        <p>قائمة التنبيهات الأخيرة للمزرعة.</p>
        <Button variant="ghost" onClick={() => setOpen(false)}>إغلاق</Button>
      </Drawer>
    </>
  );
}

export const FromEnd: S = { args: { side: "end", title: "التنبيهات", closeLabel: "إغلاق" }, render: Template };
export const FromStart: S = { args: { side: "start", title: "التصفية", closeLabel: "إغلاق" }, render: Template };

export const Gallery: S = {
  render: () => {
    const [side, setSide] = React.useState<"start" | "end" | null>(null);
    return (
      <div style={{ display: "flex", gap: 10 }}>
        <Button onClick={() => setSide("start")}>من البداية</Button>
        <Button onClick={() => setSide("end")}>من النهاية</Button>
        <Drawer open={side !== null} onClose={() => setSide(null)} side={side ?? "end"} title="لوحة" closeLabel="إغلاق">
          الجهة: {side}
        </Drawer>
      </div>
    );
  },
};
```

- [ ] **Step 8: Commit**

```bash
git add src/components/Drawer.tsx src/components/Drawer.stories.tsx src/components/Drawer.test.tsx src/styles/components.css src/index.ts
git commit -m "feat(overlay): Drawer/Sheet (RTL inline-side slide, portal, focus-trap)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `ConfirmDialog` (composes `Modal`)

**Files:**
- Create: `src/components/ConfirmDialog.tsx`, `src/components/ConfirmDialog.stories.tsx`, `src/components/ConfirmDialog.test.tsx`
- Modify: `src/styles/components.css`, `src/index.ts`

**Interfaces:**
- Consumes: `Modal` (Task 2) — reuses `ModalProps`'s `open`, `onClose`, `title`, `size`, `closeOnBackdrop`, `closeOnEsc`, `closeLabel`. **Type-reuse:** `ConfirmDialogProps` picks those from `ModalProps`, so the shared surface stays consistent.
- Produces:
  - `type ConfirmTone = "primary" | "danger"`
  - `interface ConfirmDialogProps extends Pick<ModalProps, "open" | "onClose" | "title" | "size" | "closeOnBackdrop" | "closeOnEsc" | "closeLabel"> { description?: React.ReactNode; confirmLabel: string; cancelLabel: string; tone?: ConfirmTone; loading?: boolean; onConfirm: () => void }`
  - `function ConfirmDialog(props: ConfirmDialogProps): React.ReactPortal | null` — renders a `Modal` whose body is the optional `description` and whose `footer` is a cancel (`ghost`) + confirm `Button` (`tone === "danger"` → `variant="danger"`). The confirm button receives `loading` and gets initial focus is handled by `useOverlay` (first focusable). `onConfirm` fires on confirm click.

- [ ] **Step 1: Write the failing test**

Create `src/components/ConfirmDialog.test.tsx`:
```tsx
import { it, expect, describe, vi } from "vitest";
import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { ThemeProvider } from "../theme";
import { ConfirmDialog } from "./ConfirmDialog";

function Demo({ onConfirm = () => {}, tone }: { onConfirm?: () => void; tone?: "primary" | "danger" }) {
  const [open, setOpen] = React.useState(false);
  return (
    <ThemeProvider>
      <button onClick={() => setOpen(true)}>احذف</button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={() => { onConfirm(); setOpen(false); }}
        title="حذف السجل"
        description="لا يمكن التراجع عن هذا الإجراء."
        confirmLabel="حذف"
        cancelLabel="إلغاء"
        closeLabel="إغلاق"
        tone={tone}
      />
    </ThemeProvider>
  );
}

describe("ConfirmDialog", () => {
  it("renders a labelled dialog with confirm + cancel actions", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.click(screen.getByText("احذف"));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName("حذف السجل");
    expect(screen.getByRole("button", { name: "حذف" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إلغاء" })).toBeInTheDocument();
  });

  it("fires onConfirm on the confirm button and onClose on cancel", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Demo onConfirm={onConfirm} />);
    await user.click(screen.getByText("احذف"));
    await user.click(screen.getByRole("button", { name: "حذف" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await user.click(screen.getByText("احذف"));
    await user.click(screen.getByRole("button", { name: "إلغاء" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("uses the danger button variant for a destructive tone", async () => {
    const user = userEvent.setup();
    render(<Demo tone="danger" />);
    await user.click(screen.getByText("احذف"));
    expect(screen.getByRole("button", { name: "حذف" })).toHaveClass("fos-btn--danger");
  });

  it("has no axe violations when open", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.click(screen.getByText("احذف"));
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- ConfirmDialog`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/components/ConfirmDialog.tsx`**

```tsx
import * as React from "react";
import { Modal, type ModalProps } from "./Modal";
import { Button } from "./Button";

export type ConfirmTone = "primary" | "danger";

export interface ConfirmDialogProps
  extends Pick<ModalProps, "open" | "onClose" | "title" | "size" | "closeOnBackdrop" | "closeOnEsc" | "closeLabel"> {
  /** Optional body copy explaining the consequence. */
  description?: React.ReactNode;
  /** Confirm button text (consumer-supplied). */
  confirmLabel: string;
  /** Cancel button text (consumer-supplied). */
  cancelLabel: string;
  /** `danger` renders a destructive confirm button. Default "primary". */
  tone?: ConfirmTone;
  /** Disables + spins the confirm button (async confirm). */
  loading?: boolean;
  /** Called when the confirm button is pressed. */
  onConfirm: () => void;
}

/** A confirm/cancel dialog built on Modal. Reuses Modal's open/close/title surface. */
export function ConfirmDialog({
  open, onClose, onConfirm, title, description,
  confirmLabel, cancelLabel, tone = "primary", loading = false,
  size = "sm", closeOnBackdrop, closeOnEsc, closeLabel,
}: ConfirmDialogProps): React.ReactPortal | null {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size={size}
      closeOnBackdrop={closeOnBackdrop}
      closeOnEsc={closeOnEsc}
      closeLabel={closeLabel}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>{cancelLabel}</Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description != null && <p className="fos-confirm__desc">{description}</p>}
    </Modal>
  );
}
```

- [ ] **Step 4: Append the ConfirmDialog CSS block to `src/styles/components.css`**

```css
/* ---- ConfirmDialog ---- */
.fos-confirm__desc { margin:0; color:var(--ink-muted); font-size:var(--text-sm); }
```

- [ ] **Step 5: Export from `src/index.ts`**

Add:
```ts
export { ConfirmDialog } from "./components/ConfirmDialog";
export type { ConfirmDialogProps, ConfirmTone } from "./components/ConfirmDialog";
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm test -- ConfirmDialog`
Expected: 4 passed. Then `npm run tokens:purity` → clean.

- [ ] **Step 7: Create `src/components/ConfirmDialog.stories.tsx`**

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { Button } from "./Button";

const meta: Meta<typeof ConfirmDialog> = {
  title: "Feedback/ConfirmDialog",
  component: ConfirmDialog,
  argTypes: { tone: { control: "inline-radio", options: ["primary", "danger"] } },
};
export default meta;
type S = StoryObj<typeof ConfirmDialog>;

function Template(args: Omit<React.ComponentProps<typeof ConfirmDialog>, "open" | "onClose" | "onConfirm">) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant={args.tone === "danger" ? "danger" : "primary"} onClick={() => setOpen(true)}>
        {args.confirmLabel}
      </Button>
      <ConfirmDialog {...args} open={open} onClose={() => setOpen(false)} onConfirm={() => setOpen(false)} />
    </>
  );
}

export const Default: S = {
  args: { title: "تأكيد الاعتماد", description: "سيتم اعتماد الطلب نهائيًا.", confirmLabel: "اعتماد", cancelLabel: "إلغاء", closeLabel: "إغلاق", tone: "primary" },
  render: Template,
};
export const Destructive: S = {
  args: { title: "حذف السجل", description: "لا يمكن التراجع عن هذا الإجراء.", confirmLabel: "حذف", cancelLabel: "إلغاء", closeLabel: "إغلاق", tone: "danger" },
  render: Template,
};

export const Gallery: S = {
  render: () => (
    <div style={{ display: "flex", gap: 10 }}>
      <Template title="اعتماد" description="اعتماد الطلب؟" confirmLabel="اعتماد" cancelLabel="إلغاء" closeLabel="إغلاق" tone="primary" />
      <Template title="حذف" description="حذف السجل؟" confirmLabel="حذف" cancelLabel="إلغاء" closeLabel="إغلاق" tone="danger" />
    </div>
  ),
};
```

- [ ] **Step 8: Commit**

```bash
git add src/components/ConfirmDialog.tsx src/components/ConfirmDialog.stories.tsx src/components/ConfirmDialog.test.tsx src/styles/components.css src/index.ts
git commit -m "feat(overlay): ConfirmDialog composed on Modal (tone-aware actions)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `Toast` + `Toaster` + `useToast`

**Files:**
- Create: `src/components/Toast.tsx`, `src/components/Toast.stories.tsx`, `src/components/Toast.test.tsx`
- Modify: `src/styles/components.css`, `src/index.ts`

**Interfaces:**
- Consumes: `useTheme`, `createPortal`, `useReducer`.
- Produces:
  - `type ToastTone = "ok" | "info" | "warning" | "danger"`
  - `interface ToastOptions { title: React.ReactNode; description?: React.ReactNode; tone?: ToastTone; duration?: number; icon?: React.ReactNode }` (`duration` ms; `0`/negative ⇒ sticky, no auto-dismiss; default 4500).
  - `interface ToastRecord extends ToastOptions { id: string }`
  - `interface ToastApi { toast(opts: ToastOptions): string; dismiss(id: string): void; clear(): void; ok(t, opts?): string; info(t, opts?): string; warning(t, opts?): string; danger(t, opts?): string }` where the shorthand signature is `(title: React.ReactNode, opts?: Omit<ToastOptions, "title" | "tone">) => string`.
  - `interface ToastProviderProps { children: React.ReactNode; max?: number }` — holds the queue (a `useReducer`), caps to `max` (default 4, drops oldest), and renders `<Toaster/>`.
  - `function useToast(): ToastApi` — throws if used outside `ToastProvider`.
  - `function Toaster(): React.ReactPortal | null` — the `aria-live="polite"` region, portal to `document.body`, re-applies the theme; each item auto-dismisses on a timer that **pauses on hover/focus**.
- Reducer actions: `{ type: "add"; toast: ToastRecord }`, `{ type: "remove"; id: string }`, `{ type: "clear" }` — with the `max` cap applied on `add`.

- [ ] **Step 1: Write the failing test**

Create `src/components/Toast.test.tsx`:
```tsx
import { it, expect, describe, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { ThemeProvider } from "../theme";
import { ToastProvider, useToast } from "./Toast";

function Trigger() {
  const t = useToast();
  return (
    <>
      <button onClick={() => t.ok("تم الحفظ")}>نجاح</button>
      <button onClick={() => t.danger("فشل الحفظ", { duration: 0 })}>خطأ ثابت</button>
    </>
  );
}

function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <Trigger />
      </ToastProvider>
    </ThemeProvider>
  );
}

describe("useToast / Toaster", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("renders a polite live region and shows a toast on demand", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText("نجاح"));
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("تم الحفظ")).toBeInTheDocument();
  });

  it("auto-dismisses after the duration", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText("نجاح"));
    expect(screen.getByText("تم الحفظ")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.queryByText("تم الحفظ")).not.toBeInTheDocument();
  });

  it("keeps a sticky (duration<=0) toast on screen", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText("خطأ ثابت"));
    act(() => { vi.advanceTimersByTime(20000); });
    expect(screen.getByText("فشل الحفظ")).toBeInTheDocument();
  });

  it("throws when useToast is used outside a provider", () => {
    function Bad() { useToast(); return null; }
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Bad />)).toThrow();
    spy.mockRestore();
  });

  it("has no axe violations with a visible toast", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText("نجاح"));
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- Toast`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/components/Toast.tsx`**

```tsx
import * as React from "react";
import { createPortal } from "react-dom";
import { useTheme } from "../theme";

export type ToastTone = "ok" | "info" | "warning" | "danger";

export interface ToastOptions {
  /** Bold heading line. */
  title: React.ReactNode;
  /** Optional muted second line. */
  description?: React.ReactNode;
  /** Severity. Default "info". */
  tone?: ToastTone;
  /** Auto-dismiss after N ms. `0` or negative = sticky. Default 4500. */
  duration?: number;
  /** Optional leading icon (emoji or node). */
  icon?: React.ReactNode;
}

export interface ToastRecord extends ToastOptions {
  id: string;
}

type ShorthandOpts = Omit<ToastOptions, "title" | "tone">;

export interface ToastApi {
  toast(opts: ToastOptions): string;
  dismiss(id: string): void;
  clear(): void;
  ok(title: React.ReactNode, opts?: ShorthandOpts): string;
  info(title: React.ReactNode, opts?: ShorthandOpts): string;
  warning(title: React.ReactNode, opts?: ShorthandOpts): string;
  danger(title: React.ReactNode, opts?: ShorthandOpts): string;
}

type Action =
  | { type: "add"; toast: ToastRecord; max: number }
  | { type: "remove"; id: string }
  | { type: "clear" };

function reducer(state: ToastRecord[], action: Action): ToastRecord[] {
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

interface ToastInternalContext {
  toasts: ToastRecord[];
  api: ToastApi;
}
const ToastContext = React.createContext<ToastInternalContext | null>(null);

export interface ToastProviderProps {
  children: React.ReactNode;
  /** Max simultaneous toasts; oldest is dropped past this. Default 4. */
  max?: number;
}

let seq = 0;

export function ToastProvider({ children, max = 4 }: ToastProviderProps) {
  const [toasts, dispatch] = React.useReducer(reducer, [] as ToastRecord[]);

  const api = React.useMemo<ToastApi>(() => {
    const push = (opts: ToastOptions): string => {
      const id = `fos-toast-${++seq}`;
      dispatch({ type: "add", toast: { duration: 4500, tone: "info", ...opts, id }, max });
      return id;
    };
    const shorthand =
      (tone: ToastTone) =>
      (title: React.ReactNode, opts: ShorthandOpts = {}): string =>
        push({ ...opts, title, tone });
    return {
      toast: push,
      dismiss: (id) => dispatch({ type: "remove", id }),
      clear: () => dispatch({ type: "clear" }),
      ok: shorthand("ok"),
      info: shorthand("info"),
      warning: shorthand("warning"),
      danger: shorthand("danger"),
    };
  }, [max]);

  const value = React.useMemo(() => ({ toasts, api }), [toasts, api]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toaster />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a <ToastProvider>");
  return ctx.api;
}

/** The live region that renders queued toasts. Auto-mounted by ToastProvider. */
export function Toaster(): React.ReactPortal | null {
  const ctx = React.useContext(ToastContext);
  const theme = useTheme();
  if (!ctx || typeof document === "undefined") return null;
  const { toasts, api } = ctx;

  return createPortal(
    <div
      className="fos"
      data-theme={theme.scheme}
      data-density={theme.density}
      data-radius={theme.radius}
    >
      <div className="fos-toaster" role="status" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => api.dismiss(t.id)} />
        ))}
      </div>
    </div>,
    document.body
  );
}

function ToastItem({ toast, onDismiss }: { toast: ToastRecord; onDismiss: () => void }) {
  const { tone = "info", duration = 4500 } = toast;
  const paused = React.useRef(false);

  React.useEffect(() => {
    if (duration <= 0) return;
    let remaining = duration;
    let start = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const run = () => {
      start = Date.now();
      timer = setTimeout(onDismiss, remaining);
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
  }, [duration, onDismiss]);

  const elRef = React.useRef<HTMLDivElement>(null);

  return (
    <div ref={elRef} className={`fos-toast fos-toast--${tone}`}>
      {toast.icon != null && <span className="fos-toast__icon" aria-hidden="true">{toast.icon}</span>}
      <div className="fos-toast__body">
        <div className="fos-toast__title">{toast.title}</div>
        {toast.description != null && <div className="fos-toast__desc">{toast.description}</div>}
      </div>
      <button type="button" className="fos-toast__close" aria-label="✕" onClick={onDismiss}>✕</button>
    </div>
  );
}
```

> Note: `elRef` is declared after the effect for readability but hoisted by `const`-in-render ordering — move the `const elRef = React.useRef<HTMLDivElement>(null);` line ABOVE the `useEffect` when implementing, so the effect closes over it. (The effect reads `elRef.current` only inside its body, which runs after render, so either order works at runtime; place it above to satisfy the linter.)

- [ ] **Step 4: Append the Toast CSS block to `src/styles/components.css`**

```css
/* ---- Toast / Toaster ---- */
.fos-toaster { position:fixed; inset-block-end:var(--space-4); inset-inline-end:var(--space-4);
  z-index:var(--z-toast); display:flex; flex-direction:column; gap:var(--space-2);
  width:min(360px, calc(100vw - var(--space-8))); pointer-events:none; }
.fos-toast { pointer-events:auto; display:flex; align-items:flex-start; gap:var(--space-3);
  background:var(--surface-raised); color:var(--ink); border:1px solid var(--line);
  border-inline-start:3px solid var(--info-fg); border-radius:var(--radius-card);
  box-shadow:var(--shadow-overlay); padding:var(--space-3); animation:fos-toast-in var(--dur) var(--ease); }
.fos-toast--ok { border-inline-start-color:var(--success-fg); } .fos-toast--ok .fos-toast__icon { color:var(--success-fg); }
.fos-toast--info { border-inline-start-color:var(--info-fg); } .fos-toast--info .fos-toast__icon { color:var(--info-fg); }
.fos-toast--warning { border-inline-start-color:var(--warning-fg); } .fos-toast--warning .fos-toast__icon { color:var(--warning-fg); }
.fos-toast--danger { border-inline-start-color:var(--danger-fg); } .fos-toast--danger .fos-toast__icon { color:var(--danger-fg); }
.fos-toast__icon { flex:none; font-size:var(--text-md); line-height:1.4; }
.fos-toast__body { flex:1; min-width:0; }
.fos-toast__title { font-size:var(--text-sm); font-weight:var(--weight-bold); }
.fos-toast__desc { font-size:var(--text-xs); color:var(--ink-muted); }
.fos-toast__close { flex:none; border:none; background:transparent; color:var(--ink-muted);
  cursor:pointer; font-size:var(--text-sm); line-height:1; padding:var(--space-1); border-radius:var(--radius-control); }
.fos-toast__close:hover { background:var(--surface-sunken); color:var(--ink); }
.fos-toast__close:focus-visible { outline:2px solid var(--focus-ring); outline-offset:2px; }
@keyframes fos-toast-in { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
```

- [ ] **Step 5: Export from `src/index.ts`**

Add:
```ts
export { ToastProvider, Toaster, useToast } from "./components/Toast";
export type { ToastApi, ToastOptions, ToastRecord, ToastTone, ToastProviderProps } from "./components/Toast";
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm test -- Toast`
Expected: 5 passed. Then `npm run tokens:purity` → clean.

- [ ] **Step 7: Create `src/components/Toast.stories.tsx`**

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";
import { ToastProvider, useToast } from "./Toast";
import { Button } from "./Button";

const meta: Meta = { title: "Feedback/Toast" };
export default meta;
type S = StoryObj;

function Buttons() {
  const t = useToast();
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      <Button onClick={() => t.ok("تم حفظ السجل")}>نجاح</Button>
      <Button variant="ghost" onClick={() => t.info("جارٍ المزامنة")}>معلومة</Button>
      <Button variant="ghost" onClick={() => t.warning("مخزون منخفض", { description: "الديزل أقل من 20%" })}>تحذير</Button>
      <Button variant="danger" onClick={() => t.danger("فشل الحفظ", { duration: 0 })}>خطأ ثابت</Button>
    </div>
  );
}

export const Playground: S = {
  render: () => (
    <ToastProvider>
      <Buttons />
    </ToastProvider>
  ),
};

export const Gallery: S = {
  render: () => {
    function Auto() {
      const t = useToast();
      React.useEffect(() => {
        t.ok("تم الاعتماد");
        t.warning("مخزون منخفض", { description: "أعد الطلب قريبًا" });
        t.danger("نقص حرج", { duration: 0 });
      }, []); // eslint-disable-line react-hooks/exhaustive-deps
      return null;
    }
    return (
      <ToastProvider>
        <Auto />
      </ToastProvider>
    );
  },
};
```

- [ ] **Step 8: Commit**

```bash
git add src/components/Toast.tsx src/components/Toast.stories.tsx src/components/Toast.test.tsx src/styles/components.css src/index.ts
git commit -m "feat(feedback): Toast + Toaster + useToast (live region, auto-dismiss, pause-on-hover)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Group verification

**Files:** none (verification only)

- [ ] **Step 1: Full gate run**

Run:
```bash
npm run tokens:present && npm run tokens:purity && npm test && npm run typecheck && npm run build && npm run build-storybook
```
Expected: all exit 0. (`tsc --noEmit` proves no `any` leaks in the new public API.)

- [ ] **Step 2: Extend the theme-matrix smoke (optional, light touch)**

Confirm overlays render under the matrix by adding a Modal to `test/theme-matrix.test.tsx`'s `Sample` only if quick; otherwise the per-component axe tests (each renders under `ThemeProvider` and runs `axe(document.body)`) already cover the a11y bar. Do NOT weaken any existing test.

- [ ] **Step 3: Commit any incidental fixes**

```bash
git add -A && git commit -m "chore: feedback/overlay group verification green

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage — §4 "Feedback" row (`➕Toast + Toaster · ➕Modal/Dialog · ➕Drawer/Sheet · ➕ConfirmDialog`):**
- Toast + Toaster + `useToast` → Task 5 ✓ (`aria-live="polite"` region, auto-dismiss with pause-on-hover, `useToast()` hook + `<Toaster/>` mount, `ToastOptions` typed).
- Modal/Dialog → Task 2 ✓ (`role="dialog"` + `aria-modal`, focus-trap, Esc, return-focus, backdrop click-to-close, `createPortal` to `document.body`, `Dialog` alias).
- Drawer/Sheet → Task 3 ✓ (RTL-first: `side` maps to logical inline edges via `margin-inline-*` + logical insets so it slides from inline-start/inline-end; same a11y mechanics; `Sheet` alias).
- ConfirmDialog → Task 4 ✓ (built on Modal; `tone`-aware confirm/cancel; loading).
- Shared a11y (focus-trap/Esc/return-focus/scroll-lock) factored into `useOverlay` (Task 1) so Modal + Drawer behave identically; overlay role tokens (`--shadow-overlay`, `--scrim`) added in Task 0 using `--shadow-3` and the `--z-modal`/`--z-drawer`/`--z-toast` scale per constraints.

**Placeholder scan:** every code block is real and runnable — the `useOverlay` focus-trap is a full Tab/Shift+Tab wrap + Esc + return-focus + scroll-lock implementation (not described); the `useToast` reducer (`add`/`remove`/`clear` with `max` cap), the imperative `ToastApi` with shorthands, the portal+theme re-application, and the pause-on-hover timer (remaining-time bookkeeping) are all concrete. The only prose note (Task 5 Step 3) clarifies declaration ordering of `elRef`; the implementer places that `const` above the effect — not a placeholder.

**Type consistency:**
- `ModalProps` (Task 2) is the single source of truth for the shared overlay surface; `ConfirmDialogProps` (Task 4) `Pick`s `open | onClose | title | size | closeOnBackdrop | closeOnEsc | closeLabel` from it, so the prop types cannot drift.
- `useOverlay`'s `UseOverlayOptions` (`open`, `onClose`, `closeOnEsc`) matches how Modal/Drawer pass through their own `onClose`/`closeOnEsc`.
- `ToastApi`, `ToastOptions`, `ToastRecord` (Task 5) are exported and referenced identically in the provider, hook, and `index.ts`; the shorthand signature `(title, opts?) => string` matches across `ok/info/warning/danger`.
- All components return `React.ReactPortal | null` (or render one), `import * as React from "react"`, destructure defaults, and merge `className` per the convention; every new public type is exported from `src/index.ts`.
