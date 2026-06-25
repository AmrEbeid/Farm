# Farm

Monorepo for **Farm OS** — an Arabic-RTL-first, multi-tenant operating system for date-palm and fruit farms (Egypt/MENA). نظام تشغيل المزارع

## Layout

| Path | What |
|---|---|
| [`packages/ui`](packages/ui) | **`@amrebeid/ui`** — the design-system component library (React + TypeScript, two-tier token theming, white-label, RTL-first). See [`packages/ui/README.md`](packages/ui/README.md). |
| [`apps/farm-os`](apps/farm-os) | **Farm OS app** — Next.js + Supabase MVP-0 (Arabic-RTL), consumes `@amrebeid/ui`. Local Supabase for dev. |
| [`docs`](docs) | **Product documentation** — research, PRD, architecture & data model, screen map, GTM, master plan, and the agentic specs/plans under [`docs/superpowers`](docs/superpowers). |

## Sub-projects

- **A — `@amrebeid/ui`** (`packages/ui`): **v1.1.1, published** to GitHub Packages — full component catalog, white-label theming, green CI. Plans in [`packages/ui/docs/superpowers/plans`](packages/ui/docs/superpowers/plans).
- **B — Farm OS app** (`apps/farm-os`): **MVP-0 DEPLOYED + LIVE** — Next.js + Supabase, the full stock-coverage wedge loop end-to-end. Independent security review done; **74 pgTAP + Playwright e2e** green. Live at **farm-ui-one.vercel.app** (+ `ebeidfarm.business`) on a dedicated Supabase project, running on synthetic seed data. Spec/plan in [`docs/superpowers`](docs/superpowers); deploy in [`docs/DEPLOY-RUNBOOK.md`](docs/DEPLOY-RUNBOOK.md) / status in [`docs/DEPLOY-STATUS.md`](docs/DEPLOY-STATUS.md).

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
supabase start          # local Supabase (requires Docker)
supabase db reset       # apply migrations + Ebeid seed
npm run dev             # http://localhost:3000
supabase test db        # 74 pgTAP (RLS, audit, seed, stock-engine, security, reserved)
npx playwright test     # the end-to-end wedge loop
```

No Docker? Run the pgTAP suite against a plain local Postgres via
[`apps/farm-os/supabase/test-shims/run-pgtap-local.sh`](apps/farm-os/supabase/test-shims).

## Deploy
Live on Vercel + a dedicated (non-Zeal) Supabase project. Step-by-step in
[`docs/DEPLOY-RUNBOOK.md`](docs/DEPLOY-RUNBOOK.md). Both CI (`.github/workflows/ci.yml`) and the
deploy build the library first / consume its committed `dist/`; Tailwind v4's Linux native
binaries are pinned (`apps/farm-os/package.json` optionalDependencies) for the Linux build.

This is an npm workspaces monorepo (`packages/*` + `apps/*`).
