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
supabase start          # local Supabase (requires Docker)
supabase db reset       # apply migrations (latest: 0023) + Ebeid seed
npm run dev             # http://localhost:3000
```

Open [http://localhost:3000](http://localhost:3000) with your browser. The page
auto-updates as you edit files under `app/`.

No Docker? Run the pgTAP suite against a plain local Postgres via
[`supabase/test-shims/run-pgtap-local.sh`](supabase/test-shims).

## Auth

Sign-in is **email + password** (Supabase `signInWithPassword`). Seed users for the six
roles are created/linked by `lib/seed-auth.ts`. (An earlier phone-OTP path was removed.)

## Fonts & styling

No web fonts and **no `next/font`** — the app uses a system-font stack defined in
[`app/globals.css`](app/globals.css) (`system-ui, -apple-system, "Segoe UI", Tahoma,
Arial, sans-serif`). Component styles come from `@amrebeid/ui`'s bundled `styles.css`
(copied locally as `app/farm-os-ui.css`; see the note in `app/layout.tsx`).

## Charts (recharts code-split)

`@amrebeid/ui`'s `BarChart`/`LineChart` are Recharts-based. The library exposes a dedicated
`@amrebeid/ui/charts` subpath so recharts is code-split into its own chunk and enters only
the **two** routes that actually render a chart — the inventory coverage page
(`/inventory/[itemId]/coverage`) and the planned-vs-actual report (`/reports/[planId]/pva`)
— instead of every route's First Load JS. See `components/charts.tsx`.

## Tests

```bash
supabase test db        # pgTAP (RLS, audit, seed, stock-engine, security, reserved)
npx playwright test     # the end-to-end wedge loop
```

## Deploy

Live on Vercel + a dedicated (non-Zeal) cloud Supabase project. Step-by-step in
[`../../docs/DEPLOY-RUNBOOK.md`](../../docs/DEPLOY-RUNBOOK.md).
