# Farm

Monorepo for **Farm OS** — an Arabic-RTL-first, multi-tenant operating system for date-palm and fruit farms (Egypt/MENA). نظام تشغيل المزارع

> ℹ️ **Ground truth:** for the canonical product/architecture state, see
> [`docs/PRODUCT-MASTER-FILE.md`](docs/PRODUCT-MASTER-FILE.md) and
> [`docs/RECONCILE-001-main-ground-truth-2026-06-27.md`](docs/RECONCILE-001-main-ground-truth-2026-06-27.md).
> **Note:** migration numbers quoted below are historical — as of 2026-06-27, `main` is at migration **`0089`**
> and **prod is now at `0089` too** (Owner-authorized apply of `0085` active-org, `0086` org-settings, `0089`
> palm-guard — verified, exact repo versions, no new security regressions). The "`0048`" figures in this README
> are stale. (`0087`/`0088` remain in draft PRs #366/#368 — not on prod by design.)

## Layout

| Path | What |
|---|---|
| [`packages/ui`](packages/ui) | **`@amrebeid/ui`** — the design-system component library (React + TypeScript, two-tier token theming, white-label, RTL-first). See [`packages/ui/README.md`](packages/ui/README.md). |
| [`apps/farm-os`](apps/farm-os) | **Farm OS app** — Next.js + Supabase MVP-0 (Arabic-RTL), consumes `@amrebeid/ui`. Local Supabase for dev. |
| [`docs`](docs) | **Product documentation** — research, PRD, architecture & data model, screen map, GTM, master plan, and the agentic specs/plans under [`docs/superpowers`](docs/superpowers). |

## Sub-projects

- **A — `@amrebeid/ui`** (`packages/ui`): **v1.2.0, published** to GitHub Packages — full component catalog, white-label theming, green CI. Plans in [`packages/ui/docs/superpowers/plans`](packages/ui/docs/superpowers/plans).
- **B — Farm OS app** (`apps/farm-os`): **MVP-0 DEPLOYED + LIVE** — Next.js + Supabase, the full stock-coverage wedge loop end-to-end. Auth is **email + password** (Supabase `signInWithPassword`). Independent security review done; **421 pgTAP + Playwright e2e** green. Live at **farm-ui-one.vercel.app** (+ `ebeidfarm.business`) on a dedicated cloud Supabase project (prod DB at **migration 0048**, in sync with `main` — `0032`–`0048` pushed and verified live, incl. ENGINE-STALE-1 #197 + AUTHZ-2 #181 + AUTHZ-3 #182 + atomic plan-op #196 + FK perf indexes + palm-status RPC #238 + ENGINE-REC1 #184 + inventory unit_cost #89-B + the Owner RLS role-gate trio `0042`–`0044` (plan-req/budget/expenses) + partial receipts `0045` (#155) + wage-confidentiality `0046` (PII-1 #173 wage slice) + engine null-date guard `0047` (#198) + contact-PII lockdown `0048` (PII-1 #173 phone/email slice — deny-by-default, phone/email no longer member-readable)), running on synthetic seed data. Recharts is code-split via the `@amrebeid/ui/charts` subpath, so charts load only on the **2** chart routes (inventory coverage + planned-vs-actual report). Spec/plan in [`docs/superpowers`](docs/superpowers); deploy in [`docs/DEPLOY-RUNBOOK.md`](docs/DEPLOY-RUNBOOK.md) / status in [`docs/DEPLOY-STATUS.md`](docs/DEPLOY-STATUS.md).

## Working in the library

```bash
cd packages/ui
npm install
npm test          # vitest + Testing Library + jest-axe
npm run storybook # component docs
npm run build     # tsup + token-purity gate + bundled styles.css
```

## Working in the app

```bash
cd apps/farm-os
cp .env.example .env.local   # point at the remote (or a Supabase branch) project
npm run dev                  # http://localhost:3000
```

The local Docker-based `supabase start` stack has been **removed**. Schema changes are
applied to the remote (or a Supabase branch) project via the Supabase MCP / migrations
(see [`docs/DEPLOY-RUNBOOK.md`](docs/DEPLOY-RUNBOOK.md); prod pushes stay Owner-gated). Run
the pgTAP suite locally against a plain Postgres (no Docker) via
[`apps/farm-os/supabase/test-shims/run-pgtap-local.sh`](apps/farm-os/supabase/test-shims) —
the same harness CI runs as the authoritative DB gate.

## Deploy
Live on Vercel + a dedicated (non-Zeal) Supabase project. Step-by-step in
[`docs/DEPLOY-RUNBOOK.md`](docs/DEPLOY-RUNBOOK.md). Both CI (`.github/workflows/ci.yml`) and the
deploy build the library first / consume its committed `dist/`; Tailwind v4's Linux native
binaries are pinned (`apps/farm-os/package.json` optionalDependencies) for the Linux build.

This is an npm workspaces monorepo (`packages/*` + `apps/*`).
