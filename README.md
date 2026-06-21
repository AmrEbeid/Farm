# Farm

Monorepo for **Farm OS** — an Arabic-RTL-first, multi-tenant operating system for date-palm and fruit farms (Egypt/MENA). نظام تشغيل المزارع

## Layout

| Path | What |
|---|---|
| [`packages/ui`](packages/ui) | **`@farm-os/ui`** — the design-system component library (React + TypeScript, two-tier token theming, white-label, RTL-first). See [`packages/ui/README.md`](packages/ui/README.md). |
| [`docs`](docs) | **Product documentation** — research, PRD, architecture & data model, screen map, GTM, master plan, and the agentic specs/plans under [`docs/superpowers`](docs/superpowers). |

## Sub-projects

- **A — `@farm-os/ui`** (`packages/ui`): publish-ready component library. Phase 1 (theming foundation) is shipped; Plans 2–8 (component catalog + packaging/CI/publish) are in [`packages/ui/docs/superpowers/plans`](packages/ui/docs/superpowers/plans).
- **B — Farm OS app** (docs only, so far): the Next.js + Supabase application that consumes `@farm-os/ui`. Its MVP-0 build spec and implementation plan live in [`docs/superpowers`](docs/superpowers).

## Working in the library

```bash
cd packages/ui
npm install
npm test          # vitest + Testing Library + jest-axe
npm run storybook # component docs
npm run build     # tsup + token-purity gate + bundled styles.css
```

This is an npm workspaces monorepo (`packages/*`). The product app (`apps/farm-os`) will be added under `packages/` or `apps/` when Sub-project B is built.
