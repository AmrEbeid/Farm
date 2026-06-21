# Farm OS — Design System
*Single source of truth for the UI. Pairs with [`tokens.css`](tokens.css). Arabic-RTL-first, mobile-first for field roles. Supersedes the ad-hoc CSS in the three prototypes (see §Migration).*

**Principles:** consistency over creativity · flexibility within constraints · document everything · decisions-not-dashboards (every screen answers a "what do I do?" question) · enforce status meaning by token, never by raw hex.

---

## 1. Tokens (summary — full values in `tokens.css`)

| Group | Tokens | Notes |
|---|---|---|
| **Brand** | `--color-green-900…100`, `--color-gold`, `--color-gold-light` | greens = brand/primary; gold = dates/harvest/highlight |
| **Semantic** | `--color-success / --warning / --danger / --info / --accent` | the *only* way to express status |
| **Status pairs** | `--status-{ok,warning,danger,info,neutral,accent}-{bg,fg}` | tag & alert backgrounds/foregrounds |
| **Neutral** | `--color-bg / --surface / --ink / --muted / --line` | surfaces & text |
| **Type** | `--text-xs…3xl` (8 steps), `--font-family`, weights, `--numeral-tabular` | replaces 16–24 ad-hoc sizes |
| **Space** | `--space-1…10` (4px base) | replaces arbitrary paddings |
| **Radius** | `--radius-sm…xl`, `-pill`, `-round` | 8→18px |
| **Elevation** | `--shadow-sm / md / lg` | card = `md` |
| **Motion** | `--dur-fast/dur/slow`, `--ease` | |

**Color-use rules:** primary action = `--color-green-600` (hover `-700`); accent/CTA highlight = gold; status colors are reserved for status only (never decorative); text on light = `--color-ink`, secondary = `--color-muted`. Financial numbers use `--numeral-tabular`.

---

## 2. Component catalog

### Button
- **Description:** primary interactive control. **Variants:** `btn--primary` (green, main actions), `btn--ghost` (white + border, secondary), `btn--danger` (white + danger border/text, destructive/reject). **Sizes:** `btn--md` (default), `btn--sm`.
- **States:** Default → · Hover (darken to green-700 / tint) · Active · **Disabled** (40% opacity, non-interactive — used to express *permission denied*, e.g. a non-owner sees Approve disabled) · Loading (spinner, label retained).
- **A11y:** real `<button>`; `:focus-visible` ring (2px green-600); disabled sets `aria-disabled`; min height `--tap-min` on mobile.
- **Do / Don't:** ✅ one primary per view · ❌ don't use color alone to signal danger (also use the danger variant + confirm).

### Tag / Badge
- **Description:** compact status label. **Variants (semantic only):** `tag--ok`, `tag--warning`, `tag--danger`, `tag--info`, `tag--neutral`, `tag--accent` → each = `--status-*-bg` + `--status-*-fg`. **A11y:** text carries the meaning (color is reinforcement, not sole signal); not a button unless given a role.

### Card / KPI Card
- **Description:** content container (`--surface`, `--radius-lg`, `--shadow-md`, `--space-4` pad). **KPI variant:** label (muted, icon chip) + value (`--text-xl`, extrabold, tabular) + delta (success/danger). **Empty state:** every card defines its own "no data + primary CTA."

### Table
- **Description:** dense data. Sticky header (`--color-bg` tint), row hover, `--numeral-tabular` on number columns, status via Tag. **Mobile:** wrap in `overflow-x:auto`; never break the page horizontally. **A11y:** real `<table>` semantics, `<th scope>`.

### Tabs / Sub-tabs
- Active = green-700 text + 2px green-600 underline; content panels toggle. **Keyboard:** arrow-key roving, `aria-selected`.

### Progress bar
- **Variants:** default (green), `--warning` (gold), `--danger`. Used for budget/plan completion; pair with a number.

### Alert / Inline message
- **Variants:** `alert--ok / --warning / --info / --danger` (tinted bg + icon chip + title + sub). Used in dashboards & notification drawer. **A11y:** `role="status"` (info) / `role="alert"` (danger).

### Timeline (activity / approval / care calendar)
- Vertical rail + dots; dot color = node type (green default, gold milestone, danger incident). Powers the farm-file event history and the approval chain.

### Modal & Drawer
- **Modal:** centered, `--radius-xl`, `--shadow-lg`, scrim; for voucher/PR detail, palm file, forms. **Drawer:** inline-end slide-in (notifications); hidden via `translateX(-100%)` so it tucks off the inline-start edge in RTL. **A11y:** focus trap, `Esc` closes, `aria-modal`, return focus to trigger.

### Field / Input (form)
- Label (muted, bold, `--text-xs`) + control (`--radius-sm`, `--color-line` border). Grid `fg` (2-col desktop → 1-col mobile). Field forms cap at ≤5 fields for supervisor flows. **A11y:** `<label for>`, error text + `aria-invalid`.

### Nav item
- Sidebar link; active = green-600 fill; **locked** = 30% opacity + non-interactive (role lacks access — the visible expression of RLS scope). Badge for counts.

### Toast
- Bottom-center, green-800, auto-dismiss ~2.3s; confirmation of an action. **A11y:** `role="status"`, polite.

### Domain components
| Component | Purpose | Notes |
|---|---|---|
| **Palm-grid cell** | one palm in the grid map | bg = status color; 44px hit area on mobile; `title` + click→file |
| **Verdict banner** | stock-coverage / budget result | `v--ok / --warning / --danger`; icon + sentence |
| **Loop stepper** | the 6-step plan→…→file core loop | step n + title + status tag; clickable |
| **Phase card** | roadmap phase | number chip (brand) + title + status tag + chips |
| **Chat (عبدالجليل)** | AI assistant | bot/me bubbles + source line; suggestion chips |
| **Map plot / croquis pin** | sector polygon on farm map | tinted fill, hover, click→file |

---

## 3. Patterns (components composed)
- **Role-based dashboard:** KPI row → core-loop stepper → chart + alert feed. Content swaps by role; nav locks by role.
- **Core-loop stepper:** Plan → Stock coverage → Budget → Approval → Execution → Farm file (the product's spine).
- **Plan builder:** 6-step `steps` tablist → option cards → checks panel (alerts) → submit.
- **File timeline:** header (entity facts) + filterable Timeline of events; same component at farm/sector/hawsha/line/palm scope.
- **Approval chain:** Timeline + Modal + gated Buttons (only owner sees enabled Approve) + audit toast.
- **Field capture (mobile):** Field form (≤5) + camera + offline-draft badge + Toast on save.

---

## 4. RTL & internationalization rules
- App root `dir="rtl"`; **use logical properties** (`margin-inline-*`, `inset-inline-start`, `padding-inline`) so an English/LTR build flips for free. (The notifications drawer bug — sliding the wrong way — came from a physical `translateX`; logical direction prevents it.)
- Arabic-safe font stack; Arabic-Indic vs Western numerals is a setting; financial tables use tabular figures.
- Mirror icons that imply direction (back/forward, progress); never mirror logos or media.

## 5. Accessibility baseline
- Color is never the sole signal — always pair with text/icon (critical for status tags and the palm map).
- `:focus-visible` ring on all interactive elements; full keyboard path; modals trap focus and close on `Esc`.
- Sunlight/field use: high-contrast text, ≥`--tap-min` (44px) touch targets, voice-note attachment option for low-literacy workers.
- Respect `prefers-reduced-motion` (disable non-essential transitions).

## 6. Migration map (from the prototypes → this system)
Apply when consolidating `ebeid-farm-os-demo.html`, `farm-os-prototype.html`, `farm-os-full-demo.html` into the real codebase:

| Found in prototypes | Replace with |
|---|---|
| `--g9 … --g5`, `--g1` | `--color-green-900 … -500`, `--color-green-100` |
| `--gold`, `--goldl` | `--color-gold`, `--color-gold-light` |
| `--mut`, `--line`, `--ink`, `--bg`, `--card` | `--color-muted/-line/-ink/-bg/-surface` |
| `.t-d / .t-w / .t-m / .t-i / .t-p / .t-ok` and `.t-dng/.t-warn/.t-mut/.t-info/.t-pur` | `.tag--danger/--warning/--neutral/--info/--accent/--ok` |
| `.btn-dng`, `.btn-d` | `.btn--danger` |
| `.btn-ok`, `.btn-gh`, `.btn-sm` | `.btn--primary`, `.btn--ghost`, `.btn--sm` |
| raw chart hex (`'#2f7d49'`, `'#c8922a'`…) | read from CSS vars (`getComputedStyle`) or a JS token map mirroring `tokens.css` |
| ad-hoc `font-size:NNpx` (16–24 distinct) | nearest `--text-*` step |
| arbitrary `gap`/`padding` px | nearest `--space-*` step |

**Definition of done for the consolidation slice** (per the OS): all three prototypes (or the real components) reference `tokens.css` only; zero hardcoded hex in CSS; font sizes map to the scale; the migration table is fully applied; RTL drawer/logical-property check passes. Treat as a Low-risk refactor with a visual-diff review.

---
*Score after applying §6 + documenting: target 90/100 (tokens unified, scales added, catalog documented, a11y baseline stated). Remaining gap to 100: real component code + a living Storybook/Figma library — a Phase-1 task once the build starts.*
