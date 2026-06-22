# Design — Make `@amrebeid/ui` publish-ready (Sub-project A)
*Date: 2026-06-21 · Status: Approved (brainstorm) → ready for implementation plan · Owner: Amr Ebeid*

## 1. Context & decomposition
Farm OS is a **generic, multi-tenant SaaS** for date-palm and fruit farms in Egypt/MENA. **Ebeid Farm is dummy/seed data** used to develop and demo the product — not the customer. The work splits into two sub-projects built in sequence:

- **Sub-project A (this spec)** — make `@amrebeid/ui` publish-ready: stabilize the API, fill the component catalog, add full theming, docs, versioning, and a publish path.
- **Sub-project B (later)** — build the Farm OS application (screens, data, auth, workflows) on top of A. Its own spec → plan → build cycle.

A is scoped against B's documented needs (PRD + screen map in `../../../farm-os-docs/`) so we publish the *right* components, not a vacuum design system.

### Decisions locked in brainstorming
| Decision | Choice |
|---|---|
| Publish target | **Public-quality bar, shipped privately first** (build so nothing blocks going public; ship to a private registry for B) |
| Theming | **Full white-label**: light + dark, custom brand palette, density, radius |
| Component scope | **Full v1-app coverage** (the whole screen map), not just the MVP-0 wedge loop |
| Styling architecture | **CSS classes + a layered CSS-variable theme system** (keep what's shipped + synced to Claude Design; deepen the token layer) |

## 2. Goal & success criteria
**Goal:** a stable, themeable, accessible, documented component library that B can build on and that is publishable.

**v1 (1.0) = "publish-ready" when:**
- The full v1 catalog (§4) exists, each component a11y-clean, **token-pure** (no hardcoded values), typed, and documented in Storybook.
- Full white-label theming works: light/dark × density × brand × radius, verified on key components.
- Changesets + private publish flow works end-to-end; CI green-gates merges.
- The Claude Design sync re-runs cleanly against the expanded catalog.

## 3. Token & theme architecture (the white-label engine)
Two tiers; components reference **only** Tier 2.

- **Tier 1 — Primitives** (theme-agnostic constants): color ramps (`--green-50…900`, `--gold-*`, neutral `--gray-*`, status hues), and numeric scales for space, radius, type, shadow, z-index, duration.
- **Tier 2 — Role tokens** (used by components, *flip* per theme): `--brand`/`--brand-hover`, `--surface`/`--surface-raised`, `--ink`/`--ink-muted`, `--line`, `--focus-ring`, and status pairs `--{success,warning,danger,info}-{bg,fg}`.

**Four independent, composable theme dimensions:**
1. **Color scheme** — `light` / `dark` (role tokens remap under `[data-theme="dark"]`).
2. **Brand (white-label)** — tenant supplies one brand color (we derive `--brand*`) + optional accent + logo slot; applied as inline CSS vars on the tenant scope.
3. **Density** — `comfortable` / `compact` (control heights + spacing scale; office vs. field).
4. **Radius** — `sharp` / `default` / `rounded` scale knob.

**Mechanism:** a small **`ThemeProvider`** writes `data-theme`, `data-density`, `data-radius` and the brand vars onto a scope element; a **no-React escape hatch** (set the attributes/vars directly) keeps the library framework-agnostic and SSR-safe (theme set server-side → no flash). Theme switching is pure CSS-variable cascade — instant, no re-render. A **token-purity lint** (§6) fails the build on any hardcoded color/hex/px in component CSS, which is what enforces white-label.

## 4. Component catalog & conventions (full v1 coverage)
Built to the screen map (`farm-os-docs/07-SCREEN-MAP.md`). **9 exist; the rest are the v1 gap.**

| Group | Components (✅ exists · ➕ new) |
|---|---|
| **Forms** | ✅Button · ➕IconButton · ✅Field · ➕Input/Textarea/NumberField · ➕Select · ➕Combobox · ➕Checkbox · ➕Radio · ➕Switch · ➕DateField · ➕FormRow + Label/Help/Error |
| **Data display** | ✅Tag(=Badge) · ✅KpiCard · ➕Stat · ➕DataTable (sortable, sticky, RTL, tabular nums) · ✅Progress · ➕Timeline · ➕DescriptionList · ➕Avatar · ➕Tooltip · ➕Pagination · ➕EmptyState · ➕Skeleton |
| **Feedback** | ✅Alert · ➕Toast + Toaster · ➕Modal/Dialog · ➕Drawer/Sheet · ➕ConfirmDialog |
| **Navigation / shell** | ➕AppShell (RTL sidebar + topbar, role-aware) · ➕SidebarNav/NavItem · ✅Tabs · ➕Breadcrumbs · ➕RoleSwitcher · ➕SearchInput |
| **Charts** (theme-aware) | ➕Bar / Line / Doughnut wrappers reading role tokens |
| **Domain — Farm OS** | ✅VerdictBanner · ➕LoopStepper (plan→…→file) · ➕PhaseCard · ➕PalmGrid/PalmCell · ➕FileTimeline · ➕ApprovalChain · ➕StatusPill |

**Universal API conventions:** `forwardRef`; extends the native element's props; semantic `variant`/`tone`/`size` props; `className` passthrough; **controlled-first**; **100% token-driven**. **States** as relevant: default/hover/active/`:focus-visible`/disabled/loading/error. **Sizes** sm/md(/lg), density-aware.

**A11y baseline (publish bar):** real semantics, ARIA roles/labels, full keyboard paths, focus-trap + `Esc` + return-focus on Modal/Drawer, visible focus ring via `--focus-ring`.

**Boundaries:**
- **Presentational only — no strings / no i18n in the library.** Consumers pass all text; RTL + LTR both supported via `dir` + logical CSS; the app (B) owns translation.
- **Charts are thin themed wrappers**, not a charting engine — they bind a chart lib to our tokens so dark/brand themes apply.

## 5. Packaging & publish
- **Repo:** keep `@amrebeid/ui` standalone now, **structured to drop into a monorepo later** (`packages/ui` + `apps/farm-os`). No restructure today.
- **Exports:** `.` (components + `ThemeProvider`), `./styles.css`; tree-shakeable ESM + CJS + `.d.ts` (tsup). `sideEffects` flags CSS.
- **Build:** tsup for JS/types; the two-tier token CSS (primitives + role tokens + theme blocks) compiles into the single `styles.css`.
- **Versioning:** **Changesets** (auto CHANGELOG + bumps). Stay 0.x while the API moves; **cut 1.0 as the publish-ready milestone**.
- **Publish:** **private registry** (GitHub Packages or npm-private) with a `prepublishOnly` gate (build + typecheck + test).
- **Docs:** Storybook is the canonical, deployed (private) docs — autodocs + authored **Getting Started** (install → import `styles.css` → wrap in `ThemeProvider`) and **Theming** (the 4 dimensions). Claude Design sync stays wired (`resync.mjs` on change).
- **CI:** typecheck → build → test → build-storybook → Changesets release; red blocks merge.

## 6. Testing / the publish-ready gate
A component is done only when all pass:
- **Types** — strict `tsc`; public API typed (no `any` leaks).
- **Behavior** — Vitest + Testing Library (controlled state, keyboard, focus-trap).
- **A11y** — axe per component (Storybook a11y addon + CI), **zero violations**.
- **Token-purity check** — custom lint fails the build on hardcoded hex/color/px outside the token system.
- **Theme matrix smoke** — key components rendered across light/dark × comfortable/compact.
- **Visual** — Storybook + the existing Claude Design compare loop.

## 7. Non-goals (v1)
- Building the Farm OS app (that's B).
- Public npm launch / marketing site / external contribution process (private-first; public-*capable* only).
- i18n/translation inside the library (presentational only).
- A bespoke charting engine (thin themed wrappers only).
- Native-mobile components (web, mobile-responsive + RTL).

## 8. Migration notes
- The 9 existing components already use semantic classes + CSS-variable tokens and are synced to Claude Design — keep them; the work is **deepening the token layer** (Tier 1/2 split, dark/density/radius/brand) and auditing them token-pure, then adding the gap components to the same conventions.
- After the catalog expands, re-run the Claude Design sync (`resync.mjs --remote`) so the project reflects v1.

## 9. Decisions log
- 2026-06-21: A/B decomposition; Ebeid = dummy data; publish target = public-quality/private-first; theming = full white-label; scope = full v1 coverage; architecture = CSS classes + layered CSS-variable theming. All approved in brainstorming.

## Open questions (resolve during planning)
- Private registry choice: GitHub Packages vs npm-private (pick at implementation; both satisfy the gate).
- Which chart lib to wrap (Chart.js is in the demos; confirm vs a lighter alt during the charts slice).
- Brand-color → ramp derivation: accept one brand color and compute, or accept an explicit small set (decide in the theming slice).
