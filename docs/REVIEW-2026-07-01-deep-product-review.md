# Farm OS — Deep Product Review (2026‑07‑01)

*Read‑only review of `origin/main` (`d18b5c2`). 12‑agent fleet: build/health check, 8 per‑module reviews,
full‑product security, UX/IA coherence, architecture/code‑health, and market/competitive research. No code,
schema, migration, or production data was touched. Companion to [`SPEC-0019`](SPEC-0019-operations.md) (the
operations development plan that came out of this review).*

> 2026-07-06 status note: the `middleware.ts` → `proxy.ts` hygiene item called out below was
> completed and deployed in PR #773. The rest of this document remains a 2026-07-01 snapshot.
> 2026-07-06 status note: item #1 was resolved by migration
> `20260706084915_restrict_expense_drawings_read.sql` plus app-layer drawing guards on `/expenses`,
> `/expenses/[expenseId]`, and `/finance/dashboard`.

## Verdict at a glance

| Dimension | Grade | One line |
|---|---|---|
| Build health | ✅ Clean | `tsc` 0 errors; `next build` succeeded; the `middleware→proxy` warning was a review-time finding and is now resolved |
| Security backbone | **A** | RLS + FORCE‑RLS + locked SECURITY DEFINER RPCs; `authorize()` union verified (15/15 perms, no drop); no Critical/High |
| Architecture / code‑health | **A−** | Zero `as any`/`@ts-ignore` in app source; engine pinned by dense pgTAP oracle; clean RSC/action split |
| Product UX maturity | **B / B+** | Strong DS + Arabic‑RTL discipline; held back by *systemic* consistency gaps, not defects |
| Market position | Credible wedge | Native‑Arabic + honest engine + per‑farm price + عهدة digitization is a real, defensible niche |

**Bottom line:** unusually well‑engineered and genuinely secure — rare, strong foundations. The gap to "premium
and easy" is mostly **product depth + cross‑cutting UX consistency**, plus a handful of module‑specific issues.

## Highest‑priority items (verify/fix first)

1. **[Security/Privacy — Finance] Owner drawings (مسحوبات) visible to `farm_manager`.** `expenses` read‑RLS is
   **org‑only** (`20260622000044_expenses_rolegate.sql:21` — the finance gate is on WITH CHECK only); the only
   boundary is app‑layer `requireRole`, and both `expenses/page.tsx:20` and `finance/dashboard/page.tsx:41` admit
   `farm_manager` (the dashboard even renders a "مسحوبات مالك معروضة" KPI). This contradicts `budgets/[budgetId]/page.tsx:35`
   which calls the same ledger "private finance data scoped to owner/accountant." Touches non‑negotiable #6. Fix:
   filter `kind='drawing'` to owner/accountant, or add `authorize('finance.read', org_id)` to the `expenses` USING clause.
   **Resolved 2026-07-06:** drawing rows are now hidden by RLS unless `authorize('finance.read', org_id)` passes,
   and the three UI surfaces hide/normalize drawing views for non-finance roles.
2. **[Engine UI — Inventory] "Warning‑only" recommendation is a green dead‑end.** When the engine returns
   `shortage=false` + `recommend_qty>0` + `first_warning_period`, the coverage page shows a green "مغطّى" pill, a
   green banner around a ⚠️ shortage sentence, and **hides the Create‑PR button** (`coverage/page.tsx:108,120,148`).
   The engine says "order X today"; the UI offers no way to act. Add an amber warning state + show the button on
   `recommend_qty > 0`.
3. **[Engine UI — Inventory] List/dashboard bypass the engine.** `inventory/page.tsx:36` + `dashboard/page.tsx:61`
   use a static `available < reorder_point` TS flag, so an item short *next week* shows green while the engine (on the
   buried per‑item page) says `shortage=true`. Unify on the engine or clearly relabel the static flag.
4. **[Operations] Multi‑material execute bug** — `fn_execute_operation` consumes only the first material
   (`order by item_id limit 1`, `…190000:60`) → under‑records actuals/stock issue for multi‑input ops. See SPEC‑0019 P0‑1.
5. **[Dashboard] Manager view pinned to a seed fixture** — `dashboard/manager/page.tsx:23` queries `.eq("plan_id", SEED_PLAN_ID)`;
   a manager sees one demo plan regardless of real data.

## Per‑module scorecard (UX / Security / Professionalism, ⭐1‑5)

| Module | UX | Sec | Pro | Headline |
|---|---|---|---|---|
| Home/Dashboard | 4 | 5 | 4 | Strong owner cockpit; manager view seed‑pinned; KPI delta‑coloring is dead code; KPIs not clickable |
| Farm structure/map | 3.5 | 5 | 3.5 | Stored palm counts can diverge from `assets` (trust); **no search across 4,380 palms**; croquis is a schematic not a map |
| Planning/Ops | 3 | 4.5 | 3.5 | "Offline‑tolerant" not implemented; no agronomist sign‑off (#4); `/m` a flat list — see **SPEC‑0019** |
| Inventory/Engine | 3 | 4 | 3.5 | Items #2–#3 above; verdict message hardcodes "كجم"/"الأسبوع القادم" regardless of unit/period |
| Finance | 4 | 4 | 4 | Drawings/opex separation **DB‑enforced** (strong); item #1 resolved 2026-07-06; no P&L view; dashboard totals are a 12‑row sample |
| People | 2 | 5 | 3 | PII posture best‑in‑class, but a read‑only 6‑person directory — no crew onboarding/attendance/day‑rate cost; payroll engine orphaned |
| Weather | 3 | 5 | 4 | Honestly degrades to empty (no fake data ✓); **no frost gate**; "editable thresholds" has no editor |
| Settings/Admin | 4 | 4 | 4 | Import route well‑guarded; seed‑auth double‑gated vs prod; import not idempotent across retries; dashboard `people` query not org‑scoped |

**Cross‑cutting security positive:** every module independently rated security 4–5/5; the "never fabricate data"
rule (non‑neg #1) is respected throughout (empty states, not placeholders). `authorize()` latest re‑emit
(`20260629150000`) carries all 15 permissions; FORCE‑RLS has no gaps (`tests/29` invariant).

## Whole‑product UX/IA (grade B/B+) — the systemic, fix‑once‑lift‑everywhere gaps

1. **No global search / command palette (⌘K)** across 42 pages — DS `SearchInput` ships but is used nowhere.
2. **The app forks the DS nav** — `AppChrome` passes `navItems={[]}` and renders a custom `ModuleSidebar`; the tested `SidebarNav`/`NavItem` are dead weight.
3. **No toasts, no confirm dialogs** — mutations do full‑page `window.location.reload()` (5×); DS `Toast`/`ConfirmDialog` unused; destructive/approval actions have no confirmation.
4. **One generic loading skeleton** → layout shift on 360/map/mobile pages.
5. **No first‑run / empty‑org onboarding.**
6. **Login screen is bare** vs. an otherwise premium landing page.
7. Token drift (`--muted`/`--ink-muted`, `--border`/`--line`) + ~95 inline styles → a missing `<Text tone="muted">` primitive.

## Architecture / code‑health (A−)
Zero `as any` / `@ts-ignore` in app source; two principled write paths (RPC for engine‑critical, RLS‑guarded direct
for simple); service‑role confined to 2 files; engine pinned by ~27 pgTAP oracle tests. Gaps: **Playwright e2e never
runs in CI**; **no lint gate on `packages/ui`**; `authorize()` re‑emitted in 55/115 migrations (structural debt);
`middleware.ts`→`proxy.ts` was due at review time and is now resolved; recharts held at v2 behind a server stub. Build verified: `tsc` clean,
`next build` succeeds.

## Market position & feature gaps
Direct MENA date‑palm rivals: **Zr3i** (Cairo, Arabic, palm carbon‑MRV), **AGRXAI** (advertises full Arabic‑RTL),
**Platfarm** (UAE/Egypt palm "digital twins"), **FarmERP** (enterprise date‑palm ME). Global FMIS (Croptracker,
Agrivi, Conservis) aren't Arabic‑native or date‑palm‑shaped. **Wedge:** *"the honest, Arabic‑first operating system
for your date‑palm farm — priced per farm, not per seat"* — native Arabic (à la Foodics), the never‑fake‑data engine
as a *trust* story, and عهدة/petty‑cash digitization no global player touches.

**P0 feature gaps:** offline‑first field capture; yield/harvest tracking per block/palm wired to finance (per‑block
P&L); one‑click professional PDF reports. **P1:** WhatsApp channel (highest‑ROI in MENA); satellite/NDVI map layer
(the biggest "premium" visual signal); red‑palm‑weevil pest alerts; GlobalGAP/export traceability; guided onboarding.

## Prioritized roadmap (product‑wide)
- **P0 — correctness & trust:** Finance drawings visibility (#1, resolved 2026-07-06); engine warning‑only dead‑end + list/engine
  unification (#2–3); manager dashboard real query + palm‑count reconciliation (#5); operations multi‑material fix
  + soften the offline claim + agronomist gate (SPEC‑0019 P0).
- **P1 — "feels premium":** ⌘K palette + search; DS toasts + confirm dialogs; kill the nav fork; per‑route
  skeletons; first‑run onboarding; redesign login.
- **P1 — product depth:** owner P&L (drawings below the line); yield/harvest; frost gate + editable thresholds;
  crew/labor module (onboarding + attendance + day/piece‑rate cost, reviving `lib/payroll.ts`); one‑click PDF reports.
- **P2 — differentiation:** WhatsApp alerts; satellite/NDVI layer; pest alerts; export/traceability compliance.
- **Engineering hygiene:** run the Playwright e2e in CI; lint gate on `packages/ui`; plan recharts 2→3. (`middleware`→`proxy` resolved 2026-07-06.)

**Operations** — the deepest workstream — is specced separately in [`SPEC-0019`](SPEC-0019-operations.md)
(Work‑Order maturity, real date‑palm operation vocabulary, lifecycle activation, field‑grade `/m`, offline,
spray compliance, phenology, RPW scouting).

---
*Method: read‑only agents over a clean `origin/main` worktree. External research spanned agtech competitors,
Arabic‑RTL SaaS excellence, open‑source farm/orchard repos (farmOS, Tania, Ekylibre, LiteFarm), FAO date‑palm
agronomy (Y4360E), Egyptian APC pesticide registration, and offline‑first engineering references. Full per‑module
findings (with file:line and source URLs) are preserved in the session transcript.*
