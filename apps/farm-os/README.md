# Farm OS app

The MVP-0 **Farm OS** app — an Arabic-RTL-first, multi-tenant [Next.js](https://nextjs.org)
+ Supabase application that consumes the `@amrebeid/ui` design system. It implements the
full stock-coverage wedge loop end-to-end.

**Deployed + live** at [farm-ui-one.vercel.app](https://farm-ui-one.vercel.app)
(+ `ebeidfarm.business`) on a dedicated cloud Supabase project, running on synthetic seed
data. See [`../../docs/DEPLOY-RUNBOOK.md`](../../docs/DEPLOY-RUNBOOK.md) and
[`../../docs/DEPLOY-STATUS.md`](../../docs/DEPLOY-STATUS.md).

## Getting Started

```bash
cp .env.example .env.local   # point at the approved remote (or Supabase branch) project
npm run dev                  # http://localhost:3000
```

The local Docker-based `supabase start` stack has been **removed**; schema changes go to the
remote (or a Supabase branch) project via the Supabase MCP / migrations (see
[`../../docs/DEPLOY-RUNBOOK.md`](../../docs/DEPLOY-RUNBOOK.md)). Run the DB tests with no
Docker via [`supabase/test-shims/run-pgtap-local.sh`](supabase/test-shims).

Open [http://localhost:3000](http://localhost:3000) with your browser. The page
auto-updates as you edit files under `app/`.

No Docker? Run the pgTAP suite against a plain local Postgres via
[`supabase/test-shims/run-pgtap-local.sh`](supabase/test-shims).

## Auth

Sign-in is **email + password** (Supabase `signInWithPassword`). (An earlier phone-OTP path
was removed.)

The login page is credential-free by design: **both fields start blank**, and there is no
demo-account chooser, no shared password, and no in-app way to provision or reset accounts.
The former `POST /api/dev/seed-auth` route and its `lib/seed-auth.ts` helper have been
**deleted** — user provisioning is an Owner action in Supabase, never a request the app can
serve. `lib/login-auth-surface.test.ts` fails the build if any of that comes back.

For local/e2e work, users are provisioned by the Playwright global setup only (see Tests).

## Fonts & styling

The app self-hosts the Arabic/Latin font pair through `next/font/google` in
[`app/layout.tsx`](app/layout.tsx), exposing `--font-readex` and `--font-tajawal` CSS vars
without runtime Google font requests. [`app/globals.css`](app/globals.css) maps the design-system
font tokens to those vars with a system fallback. Component styles come from `@amrebeid/ui`'s
bundled `styles.css` (copied locally as `app/farm-os-ui.css`; see the note in `app/layout.tsx`).

## Charts (recharts code-split)

`@amrebeid/ui`'s `BarChart`/`LineChart` are Recharts-based. The library exposes a dedicated
`@amrebeid/ui/charts` subpath so recharts is code-split into its own chunk and enters only
the **two** routes that actually render a chart — the inventory coverage page
(`/inventory/[itemId]/coverage`) and the planned-vs-actual report (`/reports/[planId]/pva`)
— instead of every route's First Load JS. See `components/charts.tsx`.

## Tests

```bash
npx vitest run
npx tsc --noEmit
npm run build
apps/farm-os/supabase/test-shims/run-pgtap-local.sh  # DB pgTAP via plain local Postgres, no Docker
```

The legacy Playwright wedge loop mutates seed data and is guarded against remote Supabase targets.
Do not run it against production or a shared branch. Browser smoke should use an already-authenticated
session or another explicitly approved non-Docker path.

It provisions its own test users in `e2e/global-setup.ts` and requires a **per-run,
test-only** password — there is no committed default and no fallback, so a missing value
fails the run loudly instead of trying a known password:

```bash
export FARM_OS_ALLOW_LOCAL_E2E_RESET=1
export FARM_OS_E2E_PASSWORD="$(openssl rand -base64 24)"   # ≥16 chars; or put it in .env.local (gitignored)
npx playwright test
```

## Deploy

Live on Vercel + a dedicated (non-Zeal) cloud Supabase project. Step-by-step in
[`../../docs/DEPLOY-RUNBOOK.md`](../../docs/DEPLOY-RUNBOOK.md).
