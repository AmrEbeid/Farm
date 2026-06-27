# Contributing to Farm OS

Dev-onboarding guide for the Farm OS monorepo (نظام تشغيل المزارع). It covers the
repo layout, prerequisites, running the app locally, the test suites, the database
migration workflow, and the PR/CI conventions.

For the *what* and *why* of the product, read `docs/` (start with `docs/README.md`).
This file is the practical *how to develop here* companion.

## Monorepo layout

This is an **npm-workspaces** monorepo (`workspaces: ["packages/*", "apps/*"]` in the
root `package.json`).

| Path | What |
|---|---|
| [`packages/ui`](packages/ui) | **`@amrebeid/ui`** — the design-system component library (React + TypeScript, RTL-first, two-tier token theming). Published to GitHub Packages. |
| [`apps/farm-os`](apps/farm-os) | **Farm OS app** — Next.js + Supabase MVP-0 (Arabic-RTL), consumes `@amrebeid/ui`. |
| [`docs`](docs) | Product documentation — research, PRD, architecture, runbooks, ADRs, specs. |

Changesets, the GitHub Actions workflows, and the package-registry config live at the
**repo root**.

## Prerequisites

- **Node 20** — the version is pinned in `packages/ui/.nvmrc` (`20`) and every CI job
  reads it via `node-version-file: packages/ui/.nvmrc`. Use `nvm use` from `packages/ui`,
  or install Node 20 to match CI.
- **npm** — this repo uses npm workspaces and a committed `package-lock.json`. Install
  once from the **repo root** so the workspace tree hoists correctly:
  ```bash
  npm install        # from the repo root — installs all workspaces
  ```
  Avoid running `npm install` inside `packages/ui` or `apps/farm-os` directly; installing
  from a sub-package can re-resolve and nest a second copy of React (the root `overrides`
  pins a single React 19), which breaks context-based tests. Always install from root.
- **Supabase CLI** — for remote operations (`supabase db push`, `supabase link`) against the
  cloud project. See <https://supabase.com/docs/guides/cli>. The local Docker-based
  `supabase start` stack has been **removed**; schema changes are applied to the remote (or a
  Supabase branch) project via the Supabase MCP / migrations (see `docs/DEPLOY-RUNBOOK.md`).
- **Homebrew Postgres 17 + pgTAP** *(for the DB test shim — the primary local DB-test path)* —
  needed to run the pgTAP suite locally; the same harness is the authoritative DB gate in CI
  (see Testing below). On macOS:
  ```bash
  brew install postgresql@17
  # build pgTAP from source:
  git clone https://github.com/theory/pgtap && cd pgtap && make && make install
  ```
  The Supabase local DB is Postgres major version **17** (`apps/farm-os/supabase/config.toml`),
  so the shim's Postgres should match.

## Working in the library (`packages/ui`)

All scripts below are defined in `packages/ui/package.json`. Run them with the
workspace flag from the root, or `cd packages/ui` and run them directly.

```bash
npm run storybook   --workspace @amrebeid/ui   # component docs on :6006
npm test            --workspace @amrebeid/ui   # vitest + Testing Library + jest-axe
npm run test:watch  --workspace @amrebeid/ui   # vitest watch mode
npm run typecheck   --workspace @amrebeid/ui   # tsc --noEmit (tsconfig.typecheck.json)
npm run tokens:present --workspace @amrebeid/ui # design-token presence gate
npm run tokens:purity --workspace @amrebeid/ui  # design-token purity gate
npm run build       --workspace @amrebeid/ui   # tsup (ESM+CJS+d.ts) + bundled styles.css
```

`npm run build` runs the token-purity gate, then `tsup`, then bundles `styles.css`. The
charts surface is code-split into a separate `@amrebeid/ui/charts` subpath (recharts).

## Working in the app (`apps/farm-os`)

App scripts are defined in `apps/farm-os/package.json`.

### 1. Environment variables

Copy the example and fill in values from the remote (or a Supabase branch) project
(Supabase dashboard → Project Settings → API):

```bash
cd apps/farm-os
cp .env.example .env.local      # never commit .env.local
```

`.env.example` documents:

- `NEXT_PUBLIC_SUPABASE_URL` — the remote (or branch) project URL (dashboard → Settings → API).
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — RLS-scoped public key; from the project's API settings.
- `SUPABASE_SERVICE_ROLE_KEY` — **server-only, bypasses RLS**; from the project's API settings.
  Never expose to the client or commit a real value.

(`.env.production.example` documents the deployed-environment variables — for Owner-gated
deploy only; see `docs/DEPLOY-RUNBOOK.md`.)

### 2. Database — remote project (no local Docker stack)

The local Docker-based Supabase stack (`supabase start`) has been **removed**. Point
`.env.local` (above) at the remote project, or at a per-developer **Supabase branch** if you
need an isolated database. Schema changes are applied to the remote/branch project via the
**Supabase MCP** / migrations — not a local `supabase db reset` — and prod pushes remain
Owner-gated (see `docs/DEPLOY-RUNBOOK.md`).

To exercise the migration set + seed locally for a fast correctness check (no Docker), use
the pgTAP shim — it applies `supabase/migrations/*` + `supabase/seed.sql` (synthetic pilot
demo data, not real farm data) to a throwaway local Postgres (see Testing below).

### 3. Run the app

```bash
npm run dev --workspace farm-os     # next dev (default port 3000)
```

Other app scripts:

```bash
npm run lint  --workspace farm-os   # eslint (eslint-config-next)
npm run build --workspace farm-os   # next build --webpack
npm run start --workspace farm-os   # next start (serves the production build)
```

## Testing

The repo has three test layers. CI runs the unit and pgTAP layers on every PR — the pgTAP
harness is the authoritative **automated** DB gate. With the local Docker stack removed, the
full-stack `supabase test db` + Playwright e2e are run against the remote (or a Supabase
branch) project rather than a local stack.

### Library unit + a11y tests (vitest)

```bash
npm test --workspace @amrebeid/ui
```

jsdom environment, Testing Library, and jest-axe accessibility assertions
(`packages/ui/vitest.config.ts`).

### App unit tests (vitest)

```bash
npm test --workspace farm-os
```

Node environment; covers `lib/**/*.test.ts` (`apps/farm-os/vitest.config.ts`).

### Database tests (pgTAP)

The DB tests live in `apps/farm-os/supabase/tests/*.sql` (RLS isolation, audit
immutability, seed invariants, the SPEC-0001 stock-coverage engine, and the
security-remediation regressions). Two ways to run them:

**Authoritative automated gate — Docker-free pgTAP shim** (needs Homebrew Postgres 17 +
pgTAP; this is the same harness CI runs):

```bash
apps/farm-os/supabase/test-shims/run-pgtap-local.sh
```

**Full-stack verification (FORCE RLS / PostgREST / GoTrue)** — with the local Docker stack
removed, run `supabase test db` against the remote (or a Supabase branch) project, managed
via the Supabase MCP (see `docs/DEPLOY-RUNBOOK.md`).

The shim spins up a throwaway local Postgres, applies `bootstrap.sql` (minimal Supabase
role/`auth` shims) → all migrations → seed → every test, and prints a TAP summary. It is
a **convenience, not a replacement**: a local superuser bypasses RLS, so it cannot verify
`FORCE ROW LEVEL SECURITY`, and it does not run PostgREST/GoTrue or the e2e. See
`apps/farm-os/supabase/test-shims/README.md`.

### End-to-end (Playwright)

The wedge-loop e2e runs against a **production build** of the app plus a Supabase backend
(`apps/farm-os/playwright.config.ts`). With the local Docker stack removed, point it at the
remote (or a Supabase branch) project seeded via the Supabase MCP (see `docs/DEPLOY-RUNBOOK.md`):

```bash
cd apps/farm-os
npx playwright test                      # builds & serves on :3100, runs e2e
```

`global-setup` makes the seeded users sign-in-able and resets loop-mutated state so the
run is repeatable. Locale is `ar-EG`.

## Migration workflow

The schema is migration-driven under `apps/farm-os/supabase/migrations/` (timestamped
`YYYYMMDDHHMMSS_slug.sql`). Each behavioural migration is paired with a pgTAP test in
`apps/farm-os/supabase/tests/`.

When you change the schema:

1. **Add a migration file** under `apps/farm-os/supabase/migrations/`.
2. **Add (or extend) a pgTAP test** under `apps/farm-os/supabase/tests/` that pins the new
   behaviour — RLS, audit, invariants, etc.
3. **Run the suite** with the Docker-free pgTAP shim (and, for full-stack checks, apply the
   migration to a Supabase branch via the MCP and run `supabase test db` there):
   ```bash
   apps/farm-os/supabase/test-shims/run-pgtap-local.sh   # applies all migrations + seed, runs tests
   ```
4. Commit the migration and its test together. The pgTAP gate runs in CI on every PR.

**Version recording / prod push:** `supabase db push` is incremental and idempotent — it
consults `supabase_migrations.schema_migrations` on the remote and applies only versions
not yet recorded. Pushing to the **production** database is **Owner-gated** and documented
step-by-step in `docs/DEPLOY-RUNBOOK.md`; do not run a prod push without explicit Owner
go-ahead.

## PR / CI conventions

### Changesets (required for any user-facing `@amrebeid/ui` change)

Every PR that changes the published surface of `@amrebeid/ui` (components, props, tokens,
styles, exports) must include a changeset. From the **repo root**:

```bash
npm run changeset
```

Pick the bump type and write a one-line summary:

- **patch** — bug fix, token tweak, internal change with no API change.
- **minor** — new component, new prop, additive theming dimension.
- **major** — breaking API change.

Commit the generated `.changeset/*.md` file alongside your code. A PR without a changeset
will not bump the version or appear in the CHANGELOG.

### CI gates

Three workflows run on every PR to `main` (and on push to `main`):

- **`ci.yml`** — two jobs:
  - **lib** (`@amrebeid/ui`): typecheck → token presence → token purity → unit + a11y
    tests → build → build Storybook.
  - **app** (`farm-os`): typecheck (`tsc --noEmit`) → unit tests → `next build --webpack`.
- **`db-tests.yml`** — runs the pgTAP suite via the Docker-free shim
  (`apps/farm-os/supabase/test-shims/run-pgtap-local.sh`) on a plain Postgres + pgTAP
  runner; this is the authoritative **automated** DB gate. (It does not verify `FORCE ROW
  LEVEL SECURITY` or the HTTP API — those full-stack checks run against the remote/branch
  project via the Supabase MCP, the local Docker stack having been removed.)
- **`release.yml`** — on push to `main`, runs `changesets/action`: opens/updates a
  **"Version Packages"** PR when unreleased changesets exist, and on its merge publishes
  `@amrebeid/ui` to GitHub Packages (`@amrebeid` scope, `npm.pkg.github.com`).

### Merging

All CI gates must be green. **Merges are Owner-gated** — open a PR and request review;
do not self-merge.

## Where to read more (`docs/`)

- **`docs/README.md`** — the product documentation index + executive summary.
- **`docs/DEPLOY-RUNBOOK.md`** — Owner-gated deploy steps (Supabase + Vercel).
- **`docs/DEPLOY-STATUS.md`** — current deploy state.
- **`docs/OWNER-DECISIONS-2026-06-24.md`** — recorded Owner decisions.
- **`docs/adr/`** — Architecture Decision Records for the app + monorepo
  (`@amrebeid/ui` ADRs live under `packages/ui/docs/adr/`).
- **`docs/03-architecture-and-data-model.md`**, **`docs/SPEC-0001…`**,
  **`docs/SPEC-0002…`** — the data model, the stock-coverage engine, and the
  authorization-enforcement specs.
