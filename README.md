# Farm

Monorepo for **Farm OS** — an Arabic-RTL-first, multi-tenant operating system for date-palm and fruit farms (Egypt/MENA). نظام تشغيل المزارع

> ℹ️ **Ground truth:** for the canonical product/architecture state, see
> [`docs/PRODUCT-MASTER-FILE.md`](docs/PRODUCT-MASTER-FILE.md) and
> [`docs/RECONCILE-001-main-ground-truth-2026-06-27.md`](docs/RECONCILE-001-main-ground-truth-2026-06-27.md).
> **Note:** migration numbers in older narrative docs are historical. Use
> [`docs/DEPLOY-STATUS.md`](docs/DEPLOY-STATUS.md) as the current deployment and migration ledger.

## Layout

| Path | What |
|---|---|
| [`packages/ui`](packages/ui) | **`@amrebeid/ui`** — the design-system component library (React + TypeScript, two-tier token theming, white-label, RTL-first). See [`packages/ui/README.md`](packages/ui/README.md). |
| [`apps/farm-os`](apps/farm-os) | **Farm OS app** — Next.js + Supabase MVP-0 (Arabic-RTL), consumes `@amrebeid/ui`. Dev points at an approved remote project or Supabase branch; the old local Docker stack is removed. |
| [`docs`](docs) | **Product documentation** — research, PRD, architecture & data model, screen map, GTM, master plan, and the agentic specs/plans under [`docs/superpowers`](docs/superpowers). |

## Sub-projects

- **A — `@amrebeid/ui`** (`packages/ui`): **v1.3.0** workspace package — full component catalog, white-label theming, green CI. Plans in [`packages/ui/docs/superpowers/plans`](packages/ui/docs/superpowers/plans).
- **B — Farm OS app** (`apps/farm-os`): **MVP-0 DEPLOYED + LIVE** — Next.js + Supabase, the full stock-coverage wedge loop end-to-end. Auth is **email + password** (Supabase `signInWithPassword`). Live at **farm-ui-one.vercel.app** (+ `ebeidfarm.business`) on a dedicated cloud Supabase project, running on synthetic seed data; the current production deployment and migration ledger live in [`docs/DEPLOY-STATUS.md`](docs/DEPLOY-STATUS.md). Recharts is code-split via the `@amrebeid/ui/charts` subpath, so charts load only on the **2** chart routes (inventory coverage + planned-vs-actual report). Spec/plan in [`docs/superpowers`](docs/superpowers); deploy runbook in [`docs/DEPLOY-RUNBOOK.md`](docs/DEPLOY-RUNBOOK.md).

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
[`docs/DEPLOY-RUNBOOK.md`](docs/DEPLOY-RUNBOOK.md). CI (`.github/workflows/ci.yml`) builds the
library; the Vercel app deploy consumes the committed `packages/ui/dist/` copy and runs the app build.
Tailwind v4's Linux native binaries are pinned (`apps/farm-os/package.json` optionalDependencies)
for the Linux build.

This is an npm workspaces monorepo (`packages/*` + `apps/*`).
