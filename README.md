# Farm

Monorepo for **Farm OS** — an Arabic-RTL-first, multi-tenant operating system for date-palm and fruit farms (Egypt/MENA). نظام تشغيل المزارع

## Layout

| Path | What |
|---|---|
| [`packages/ui`](packages/ui) | **`@amrebeid/ui`** — the design-system component library (React + TypeScript, two-tier token theming, white-label, RTL-first). See [`packages/ui/README.md`](packages/ui/README.md). |
| [`apps/farm-os`](apps/farm-os) | **Farm OS app** — Next.js + Supabase MVP-0 (Arabic-RTL), consumes `@amrebeid/ui`. Local Supabase for dev. |
| [`docs`](docs) | **Product documentation** — research, PRD, architecture & data model, screen map, GTM, master plan, and the agentic specs/plans under [`docs/superpowers`](docs/superpowers). |

## Sub-projects

- **A — `@amrebeid/ui`** (`packages/ui`): **v1.0, shipped** — full component catalog, white-label theming, green CI. Plans in [`packages/ui/docs/superpowers/plans`](packages/ui/docs/superpowers/plans).
- **B — Farm OS app** (`apps/farm-os`): **MVP-0 built** — Next.js + Supabase, the full stock-coverage wedge loop working end-to-end (Playwright e2e passing) against **local** Supabase. Engineering-complete on a local DB; pending an independent security review, pilot validation, and a cloud deploy. Spec + plan in [`docs/superpowers`](docs/superpowers).

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
supabase test db        # 36 pgTAP (RLS, audit, seed, stock-engine)
npx playwright test     # the end-to-end wedge loop
```

This is an npm workspaces monorepo (`packages/*` + `apps/*`).
