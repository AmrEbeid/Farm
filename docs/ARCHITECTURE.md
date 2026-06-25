# Farm OS — Technical Architecture Overview

A concise, code-grounded map of how Farm OS (نظام تشغيل المزارع) is built. It complements,
and does not duplicate:

- **`docs/CONTEXT.md`** — the ubiquitous-language domain glossary (every entity, function, and
  invariant, with the migration that defines it). Read it for *what the terms mean*.
- **`docs/adr/`** — the decision records. Read them for *why* a given structure was chosen.
- **`docs/SPEC-0001-*` / `docs/SPEC-0002-*`** — the stock-coverage engine and the
  authorization-enforcement specs.

This file is the *system shape*: layout, runtime stack, security model, the core data flow, and
the build/deploy pipeline — with file citations so it stays honest.

---

## 1. Monorepo layout

npm workspaces (`package.json` → `workspaces: ["packages/*", "apps/*"]`), React pinned once at the
root (`react`/`react-dom` `19.2.4` via `overrides`) so the whole tree dedupes to a single copy.

```
farm/
├── packages/ui/        @amrebeid/ui — Arabic-RTL-first design-system library (published)
├── apps/farm-os/       the Next.js product application
└── docs/               product evidence base, CONTEXT.md, ADRs, specs, runbooks
```

- **`packages/ui`** (`@amrebeid/ui`, v1.1.1, `package.json`) — the component library, built with
  `tsup` to ESM + CJS + `.d.ts` and a bundled `dist/styles.css`. It exposes two entry points
  (`exports` map): the main barrel `.` and a **`./charts` subpath** (`src/charts.ts`) that isolates
  the Recharts-based components. Published to GitHub Packages (`publishConfig.registry`), versioned
  by Changesets (`.changeset/`, `release.yml`). Tailwind tokens are enforced as a build gate
  (token presence + token purity scripts under `packages/ui/scripts/`). Its own ADRs live under
  `packages/ui/docs/adr/`.
- **`apps/farm-os`** (`farm-os`, `package.json`) — the Next.js 16 App Router application. Consumes
  `@amrebeid/ui` as a workspace dependency (`"@amrebeid/ui": "*"`). Owns the Supabase schema under
  `supabase/migrations/` and the pgTAP suite under `supabase/tests/`.
- **`docs`** — numbered product docs (`01`–`10`), `CONTEXT.md`, `adr/`, `SPEC-*`, deploy runbooks,
  and security reviews. State lives in `MASTER-PLAN.md` / `PROJECT-TRACKER.md` / `SESSION-BRIEF.md`
  (see `docs/CLAUDE.md`).

---

## 2. Runtime stack

| Layer        | Choice | Where |
|--------------|--------|-------|
| Framework    | **Next.js 16** App Router, React **19**, mostly **Server Components** | `apps/farm-os/app/`, `package.json` |
| Build        | `next build --webpack` (prod); Turbopack root pinned to repo root in dev | `next.config.ts`, app `package.json` |
| Styling      | **Tailwind v4** (`@tailwindcss/postcss`), **RTL/Arabic-first** | `postcss.config.mjs`, `app/globals.css` + synced `app/farm-os-ui.css` |
| Backend      | **Supabase** (cloud Postgres + Auth/GoTrue + PostgREST), project `veezkmytervjnpxcrbkw` | `lib/supabase/*`, `.env.example` |
| Hosting      | **Vercel** (`framework: nextjs`) → `farm-ui-one.vercel.app` / `ebeidfarm.business` | `apps/farm-os/vercel.json`, `docs/DEPLOY-*` |

Three Supabase clients, each with a deliberate privilege scope:

- **`lib/supabase/server.ts`** — `createServerClient` with the **anon key** + the request-cookie
  session. Every query a Server Component / Server Action / Route Handler issues is therefore
  **RLS-scoped to the signed-in user**. The comment is explicit: *never use the service-role key here.*
- **`lib/supabase/browser.ts`** — the client-side browser client (anon key) for `"use client"` islands.
- **`lib/supabase/admin.ts`** — the **service-role** client, isolated to privileged server-only
  paths (e.g. the dev seed-auth route `app/api/dev/seed-auth/route.ts`, excluded from middleware).

**`middleware.ts`** refreshes the auth session on every request (Server Components cannot set
cookies) and writes refreshed cookies onto the response. It is *resilience-first*: if the Supabase
env is missing or `getUser()` throws, it falls through and serves the request — auth is still
enforced per-route by `requireMembership`, so a refresh hiccup never 500s the whole site.

---

## 3. Security model

Multi-tenant isolation is enforced **in Postgres, not the app layer** (`docs/CLAUDE.md` non-negotiable).
The application code is one client among potentially several (PostgREST, the future AI assistant);
the database is the trust boundary.

- **Deny-by-default RLS.** Every tenant table is `org_id`-scoped with row-level security enabled,
  policies `TO authenticated`. The standard policy is `tenant_all`
  (`USING (org_id IN (select public.user_org_ids())) WITH CHECK (same)`). `user_org_ids()` is a
  `SECURITY DEFINER STABLE search_path=''` helper returning the caller's orgs. RLS is the tenant
  boundary; grants only let a policy run. `farm_event` is range-partitioned, with RLS re-asserted on
  **every partition child** (a child queried directly does not inherit the parent policy).
  _(`…000001_extensions_tenancy_rbac.sql`, every Phase-B migration; `CONTEXT.md` §Tenancy.)_
- **Role model via `authorize(perm)`.** A `SECURITY DEFINER` permission map is the single source of
  truth for write gates — policies and RPCs call `authorize('pr.approve' | 'plan.write' |
  'op.execute' | 'inventory.write' | 'budget.write')` rather than hard-coding roles. Six canonical
  roles (`organization_member.role`), Arabic-labelled in `lib/auth.ts`
  (`owner`/`farm_manager`/`agri_engineer`/`accountant`/`supervisor`/`storekeeper`). The app mirrors
  this with `requireMembership` / `requireRole` (`lib/auth.ts`), but the app check is **advisory** —
  Postgres is authoritative. _(`…000001`; `SPEC-0002`.)_
- **`SECURITY DEFINER` RPCs are the write path** for the controlled mutations:
  - **`fn_post_movement(...)`** — the inventory mutation primitive: append one movement, then
    `fn_bin_rebuild` recomputes `on_hand`/`reserved` from the ledger (no read-modify-write, so it is
    lost-update-safe and always reconciled). _(`…000011`.)_
  - **`fn_execute_operation(op_id, …)`** — the atomic `op.execute` gate (ADR-0001 / SPEC-0002
    Option A): enforces `authorize('op.execute')` server-side, claims the op `→ done` idempotently,
    writes the `done` event + quantities, and posts `issue` + `release` movements — all in **one
    transaction**, all-or-nothing. _(`…000020`.)_
  - Definer grants are **clawed back from the default anon/authenticated EXECUTE** and pinned with
    invariant oracles (ADR-0003, `…000021`).
- **Append-only ledger + audit log.** `inventory_movements` is append-only by privilege: clients
  cannot DELETE (`…000016`) or UPDATE (`…000022`); corrections are compensating movements.
  `audit_log` is written **only** by the `fn_audit` AFTER-trigger (`SECURITY DEFINER`); clients have
  no INSERT/UPDATE/DELETE policy *and* those grants are revoked (AP-4), so the trigger is the only
  writer (ADR-0002; `CONTEXT.md` §Inventory/§Audit).
- **Separation of duties on procurement.** `purchase_requests` has **no blanket `FOR ALL`** policy
  (a permissive one would OR-in and bypass the guard). Approval to `status='approved'` requires
  `authorize('pr.approve')` (owner only, AP-1) **and** `requested_by <> auth.uid()` (author ≠
  approver, AP-2), with a `pr_guard_approval` trigger closing INSERT/UPDATE bypasses (AP-5,
  `…000017`/`…000023`). The app's `approvePurchaseRequest` action *relies on* this policy rather than
  re-checking — see `purchase-requests/[prId]/actions.ts`.
- **HTTP hardening.** Baseline security headers (`X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy`, HSTS) on every route via `next.config.ts → headers()`.
  CSP is deliberately deferred (high breakage risk; needs dedicated tuning). Full review history in
  `docs/SECURITY-REVIEW-*` and `docs/SECURITY-NOTES.md`.

---

## 4. Core data flow — the "wedge loop"

The product wedge is **stock coverage → procurement → execution → planned-vs-actual** (SPEC-0001).
Each step is a route under `app/(app)/`; each write goes through RLS or a definer RPC.

```
  PLAN (demand)                                                INVENTORY (supply)
  plan_material_requirements ─────────────┐         ┌──── inventory_bin (snapshot)
                                          ▼         ▼      = Σ inventory_movements (ledger)
                                  ┌───────────────────────────┐
                            (1)   │   fn_stock_coverage(item)  │  SECURITY DEFINER, org-guarded
   coverage/page.tsx  ◄──────────│   PAB(t)=PAB(t-1)-issues+rcv│  mirrors lib/stock-calc.ts
   (server component, RLS read)  └───────────────────────────┘  (parity-tested)
            │ shortage? recommend_qty
            ▼
   (2) CreatePrButton ──► purchase_requests (draft)        [RLS pr_insert]
            │
   (3) submit (draft→submitted)                            [actions.ts, RLS]
            │
   (4) APPROVE (submitted→approved)  ◄── owner only, author≠approver
            │                            [RLS pr_update + pr_guard_approval trigger; AP-1/2/5]
            │   approved-but-unreceived PR = the engine's "scheduled receipts" (ADR-0004)
            ▼
   (5) RECEIPT (approved→received) ──► fn_post_movement('receipt') ──► on_hand ↑
            │                          [counted once: leaves projection as it enters on_hand]
            ▼
   (6) RESERVE for approved plan ────► fn_post_movement('reserve') ──► available ↓ (on_hand same)
            │
   (7) EXECUTE operation ───────────► fn_execute_operation(op_id, actual_qty, …)
            │                          ONE txn: op→done (idempotent) + done event + quantities
            │                          + issue (consume) + release (clear reservation)
            │                          [authorize('op.execute') server-side; ADR-0001]
            ▼
   (8) PvA report ◄── reports/[planId]/pva   est_cost (plan) vs actual_cost (executed events)
```

The pure-calc core of step (1) lives in `lib/stock-calc.ts` and is mirrored **exactly** by the SQL
`fn_stock_coverage` (a parity test binds them so TS and SQL cannot drift — `CONTEXT.md` §engine).
`coverage/page.tsx` validates the RPC payload shape at runtime (`isCoverage`) and throws to the
segment error boundary on drift rather than rendering `NaN`.

---

## 5. How data is typed & fetched

- **Server Components by default.** Pages under `app/(app)/` are async server components that call
  `requireMembership()` then read through the RLS-scoped server client (`createClient()` →
  `lib/supabase/server.ts`). Example: `coverage/page.tsx`, `farm/page.tsx`, the dashboards.
- **Mutations are Server Actions** (`"use server"`, e.g. `m/execute/[opId]/actions.ts`,
  `purchase-requests/[prId]/actions.ts`). They call the definer RPCs or RLS-gated table writes, map
  Postgres SQLSTATEs to **Arabic** action errors (Postgres is the source of truth for the message),
  and `revalidatePath` the affected routes.
- **Membership is request-cached.** `getActiveMembership` / `requireMembership` are wrapped in React
  `cache()` so the `(app)` layout and the page it renders share one result per request, and the two
  reads (`organization_member` + `people`) run in parallel after `getUser()`.
- **Client islands are minimal.** `@amrebeid/ui` components use React context, so they cross a
  `"use client"` boundary via `components/ui.tsx`; charts are a separate client component
  (`components/charts.tsx`) importing the `@amrebeid/ui/charts` subpath.

---

## 6. Build / CI / deploy pipeline

**CI — `.github/workflows/ci.yml`** (on every PR + push to `main`), two jobs:

- **build** (`packages/ui`): typecheck → token **presence** → token **purity** → unit + a11y tests
  (Vitest/jsdom/jest-axe) → `tsup` build → Storybook build.
- **app** (`apps/farm-os`): typecheck → **eslint** → Vitest unit tests → `next build --webpack` →
  a **recharts code-split guard** (`scripts/check-recharts-codesplit.mjs`) that scans the built
  `.next` chunks and asserts the recharts-bearing chunk is referenced **only** by the two chart
  routes' manifests — never the global bundle (ADR-0005).

Both jobs install **Linux native binaries** after `npm ci` (an inline workaround for npm/cli#4828:
the macOS-generated lockfile omits Linux optional natives — `@next/swc`, `@tailwindcss/oxide`,
`lightningcss`, rolldown/rollup/esbuild bindings — which broke the Vercel build). The app also pins
two of these as `optionalDependencies`.

**DB tests — `.github/workflows/db-tests.yml`**: runs the pgTAP suite
(`supabase/tests/*` — RLS isolation, audit immutability, seed invariants, the SPEC-0001 engine, and
the security-remediation regressions) via a **Docker-free harness**
(`supabase/test-shims/run-pgtap-local.sh`) on plain Postgres + pgTAP. Caveat (documented in the
workflow): a local superuser bypasses RLS, so this does **not** verify `FORCE ROW LEVEL SECURITY`
nor exercise PostgREST/GoTrue/Playwright — the authoritative integration run is
`supabase test db` + Playwright on the Docker stack.

**Release — `.github/workflows/release.yml`**: Changesets versions and publishes `@amrebeid/ui` to
GitHub Packages.

**DS-CSS sync.** The app cannot import global CSS from a `node_modules`/workspace path (it breaks the
Vercel build), so `scripts/sync-ds-css.mjs` copies `packages/ui/dist/styles.css` →
`app/farm-os-ui.css` on `prebuild`/`predev`. That file is generated — do not hand-edit it
(`app/layout.tsx` imports it).

**Deploy.** Vercel builds `apps/farm-os` (`vercel.json → framework: nextjs`) against cloud Supabase
`veezkmytervjnpxcrbkw`, served at `farm-ui-one.vercel.app` / `ebeidfarm.business`. Migrations are an
**Owner-gated, manual** step (a hard stop in `docs/CLAUDE.md`); see `docs/DEPLOY-RUNBOOK.md` and
`docs/DEPLOY-STATUS.md`.

---

## 7. Key design decisions

The decisions behind this structure are recorded in **`docs/adr/`** (see its README index) — read
them rather than re-deriving:

- **0001** — AUTHZ-1 via an atomic `fn_execute_operation` RPC (server-side gate, atomicity, idempotency).
- **0002** — Append-only inventory ledger (revoke client UPDATE/DELETE; writes only via `fn_post_movement`).
- **0003** — `SECURITY DEFINER` grant lockdown (claw back the default EXECUTE; pin with invariant oracles).
- **0004** — ENGINE-DC: scheduled receipts from open purchase requests (project open POs, not the ledger).
- **0005** — Recharts tree-shaken via the `@amrebeid/ui/charts` subpath.
- **0006** — SQL migration conventions (idempotency, `SECURITY DEFINER` hygiene, function lockdown).

For domain terms used above (PAB, ROP, safety stock, bins, partitions, the role/permission map),
see **`docs/CONTEXT.md`**. For engine and authorization scope, see **`SPEC-0001`** / **`SPEC-0002`**.
