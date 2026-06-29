# SPEC-0014 — Knowledge / Living Documentation System (Tier A)

*Status: **DRAFT for Owner review** — design + scope only; **no app code, no migrations, no AI routes, no
walkthrough engine, no generated manual, no external sends** (Owner-gated). Builds on the verified state in
[`RECONCILE-001`](RECONCILE-001-main-ground-truth-2026-06-27.md). The premise: most ERPs ship a static help
centre that drifts stale within months; for an AI-first product, documentation should be a **living, code-anchored
knowledge system** whose source of truth lives next to the code. This spec scopes **Tier A only** — the
low-risk, high-leverage core. Tiers B and C are recorded as **explicitly deferred** (see §4).*

Owner: Amr Ebeid. Risk level: **Low/Med** (Tier A is read-only UI + content metadata; no access-control, money,
or AI surface). Last updated: 2026-06-27.

---

## 0. Basis (why this, why now)
- **Reconcile-first (RECONCILE-001):** substrate already exists — `lib/nav.ts` is a per-page registry
  (`{id,label,icon,href,roles}`), `lib/errors.ts` maps ~19 Postgres codes → Arabic business-rule messages, and
  `docs/user-manual/` holds 6 hand-written pages. Tier A is mostly **wiring existing pieces**, not invention.
- **Why now (timing, not urgency):** documentation debt compounds. With ~24 pages today and the commercial
  layer ([`SPEC-0013`](SPEC-0013-commercial-saas-layer.md)) about to add more, anchoring docs-as-code while the
  surface is small is far cheaper than retrofitting later. This is the same reason the Documentation Health
  Score is being added to the Definition of Done (CLAUDE.md) alongside this spec.
- **Discussion record:** os-discussion pass (2026-06-27) classified this as product + process, tiered it, and
  flagged overbuild + the AI-trifecta failure mode as the things to forbid. This spec honours that boundary.

## 1. Requirements (the what/why)

### Problem
Help today is static markdown (`docs/user-manual/`) that drifts out of sync with the app, and there is no
in-app, page-level help at all. A user who is stuck on a page must leave the product to find (possibly stale)
guidance, and a blocked action shows only a terse error, not *why*.

### Stories
- As **any user**, on any page I want a **Help** button that opens a drawer (not a navigation away) answering
  *what is this / why / when / how / what to avoid*, so I get unstuck in place.
- As a **blocked user**, when an action is rejected I want a **"Why?"** explanation in plain Arabic tied to the
  actual rule that stopped me (e.g. separation-of-duties, budget cap, role gate), so the system teaches instead
  of just refusing.
- As the **product team**, I want each page's help content to live in code (`pageMeta`) next to the page, so it
  ships and versions with the feature and a CI check can flag pages whose help is missing or empty.

### Acceptance criteria (the oracle — Tier A)
- [ ] A typed `pageMeta` exists per user-facing route, carrying the **five questions** (what / why / when / how /
      common-mistakes) plus `related`, `workflow`, `spec`, `permissions` (reuse `nav.ts` roles), `version`,
      `owner`. Defined **once, near the route**; `nav.ts` either hosts or links it (no parallel registry that can
      drift from nav).
- [ ] Every page renders a **Help** button that opens a **right drawer** (RTL-aware → left in RTL is acceptable
      per existing layout) showing its `pageMeta`. No page navigation occurs; focus is trapped + escapable
      (a11y).
- [ ] A **rule-based "Why?"** renders an explanation for the existing `lib/errors.ts` rule codes (SoD,
      budget-exceeded, role/permission `42501`, …) — **static mapping, no AI** — naming the rule and the
      available next steps. New error codes without a "Why?" entry degrade gracefully to the plain message.
- [ ] Content is **Arabic-first** (CLAUDE.md #2); agronomy/financial guidance in help repeats the
      template-not-prescription disclaimer where relevant (CLAUDE.md #4) and **fabricates no data** (#1).
- [ ] A **Documentation Health Score** check (lints `pageMeta` completeness: required fields non-empty, spec
      linked, "Why?" present for the page's known error codes) runs in CI — **blocking for user-facing pages,
      advisory for internal/admin/infra** (mirrors the CLAUDE.md DoD amendment).

### Non-goals (Tier A — explicitly out of scope)
- **AI Expert / AI "Why?"** (Layer 4) — **blocked behind Stage 11** security review; the first "Why?" is
  rule-based only. The `assistant-policy.ts` deny-by-default boundary is unchanged.
- **Manual generation / search index** (Tier B) — `docs/user-manual` stays hand-maintained for now.
- **Interactive walkthrough engine** (Layer 2 / Tier B).
- **Videos** (Tier C).
- Any migration, RPC, AI route, external send, or prod apply.

## 2. Design (the how)
- **Approach:** extend the existing `AppNavItem` (or a sibling `pageMeta` map keyed by the same `id`) in
  `lib/nav.ts` so help metadata and nav cannot drift apart. A presentational `<HelpDrawer/>` reads `pageMeta`;
  a `<WhyButton code=…/>` reads a static `WHY` map keyed by the same codes as `lib/errors.ts` (co-locate so a new
  error code is a visible gap). All client-presentational + content — **no server, RLS, or data-access change**.
- **Affected areas:** `lib/nav.ts` (extend), new `lib/page-meta.ts` + `lib/why.ts` (content), `components/HelpDrawer.tsx`
  + `components/WhyButton.tsx`, a thin Help affordance in `AppChrome.tsx` / page headers, a CI lint script for the
  Health Score. No `supabase/`, no `app/api/*`, no `assistant-policy` change.
- **Test strategy:** Vitest for the Health-Score lint (asserts required fields + "Why?" coverage) and the
  `WHY`-map↔`errors.ts` key parity (every gated error code a user can hit has a "Why?" or is intentionally
  excluded); component render smoke; `tsc` + `next build` green. No pgTAP (no schema change). No independent
  review required (no access/money/AI surface) — though the Health-Score CI gate itself should be sanity-checked.

## 3. Tasks (small, reviewable slices — ratify before building each)
- [ ] **A1 — `pageMeta` schema + content for existing user-facing pages** *(Low).* Type + populate the five
      questions for the ~13 nav pages, reusing `nav.ts` roles + linking specs. Content-only.
- [ ] **A2 — Help drawer** *(Low).* `<HelpDrawer/>` + a Help button in the page header; a11y focus handling;
      renders A1's `pageMeta`. No nav-away.
- [ ] **A3 — Rule-based "Why?"** *(Low).* `WHY` map over `lib/errors.ts` codes (SoD, budget, role gate, …) +
      `<WhyButton/>` on rejected actions; graceful fallback. **No AI.**
- [ ] **A4 — Documentation Health Score (CI lint)** *(Low).* Lints `pageMeta` completeness + "Why?" coverage;
      blocking for user-facing, advisory otherwise. Cross-link the CLAUDE.md DoD amendment.

## 4. Deferred tiers (recorded, NOT scoped here)
- **Tier B (Med, later spec/slice):** generate the product manual + search index from `pageMeta` +
  `docs/user-manual` (docs-as-code); interactive walkthrough engine (Layer 2). Revisit after Tier A proves the
  metadata model.
- **Tier C (High, blocked behind Stage 11):** **AI Expert** + **AI "Why?"** (natural-language reasoning over
  live tenant data + business rules); videos. Requires Stage 11's reviewed AI assistant; subject to the
  lethal-trifecta rule (private data + untrusted input + outbound never combined) and per-slice security review.
  An AI that confidently explains a *wrong* money/approval rule is worse than no help — Tier C does not start
  until Stage 11 ships its reviewed assistant.

## Risks & mitigations
- **Overbuild into a side quest** → scope frozen at Tier A; B/C are separate, later decisions.
- **AI built early** → Tier C hard-gated behind Stage 11; "Why?" v1 is rule-based; `assistant-policy` untouched.
- **False "documented" signal** (metadata present, content empty) → Health Score checks **non-empty** required
  fields + "Why?" coverage, not mere key existence; it is a CI check, not a prompt sentence.
- **DoD becomes bureaucracy** → blocking only for user-facing pages/workflows; advisory for internal/admin/infra
  (per the CLAUDE.md amendment).
- **Metadata drifts from nav/roles** → host `pageMeta` in/next to `nav.ts` keyed by the same `id`; roles reused,
  not re-declared.
- **Stale/wrong help content** → content is Arabic-first, carries the template-not-prescription disclaimer for
  agronomy/financial guidance, fabricates no data (CLAUDE.md #1/#2/#4).

## Decisions log
- 2026-06-27 — Spec created from an Owner product idea (living documentation as a differentiator), after an
  os-discussion pass. **Owner decision: "go for both, keep scope tight" → SPEC-0014 Tier A only + CLAUDE.md DoD
  amendment; no app code/migrations/AI/walkthrough/manual yet; AI Expert blocked behind Stage 11 security
  review.** Tiers B/C recorded as deferred.

## Build status (2026-06-27, under Owner `/goal`) — **Tier A BUILT + verified**
Tier A is implemented in `apps/farm-os` (low-risk: presentational + pure logic; no schema/AI/access surface):
- **A1 `pageMeta`** → `lib/page-help.ts` (typed, Arabic-first, keyed by `nav.ts` id; content from `PAGE-HELP.md`).
- **A2 Help drawer** → `components/HelpDrawer.tsx` (uses `@amrebeid/ui` `Drawer`), wired once into
  `components/AppChrome.tsx` topbar via the existing `activeNavId`.
- **A3 rule-based "Why?"** → `lib/why.ts` (+ `components/WhyButton.tsx`), grounded in `lib/errors.ts`
  (`AR_ERROR_CODES` exported for parity); content from `WHY-CATALOG.md`. **No AI** (Tier C stays behind Stage 11).
- **A4 Health Score** → realized as **Vitest drift-guards** (`lib/page-help.test.ts`, `lib/why.test.ts`): a new
  nav page or error code fails CI until its help/Why exists. (A standalone CI lint config can layer on later.)
- **Verified:** `tsc` 0, ESLint 0, **Vitest 159/159** (incl. the 2 new specs). Interactive (in-browser) check of
  the drawer is pending a logged-in session (the shell is auth-gated); static verification is complete.
- **Local/uncommitted; not deployed** (deploy/commit remain Owner-gated). Tiers B/C unchanged (deferred / Stage 11).

## Open Owner decisions (carry into the tracker)
- [ ] **Ratify SPEC-0014 Tier A app-wiring** (pageMeta + Help drawer + WhyButton + CI lint) — the content already
      exists as docs; wiring is app code.
- [ ] **Sequence vs SPEC-0013** — Tier A is complementary/low-risk and can run alongside the commercial layer,
      or wait behind it. Owner's call on ordering.
