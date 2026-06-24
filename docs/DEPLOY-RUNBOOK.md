# Deploy Runbook — Farm OS MVP-0 (pilot)

Turnkey steps to deploy the MVP-0 app to a **dedicated, non-Zeal** Supabase project + Vercel.
Pre-written so deploy is one pass once the Owner makes the decisions in
`OWNER-DECISIONS-2026-06-24.md` (§1 infra owner, §2 Twilio). **Owner-gated:** provisioning,
deploy, and SMS are hard stops — do not run these without explicit Owner go-ahead. Nothing here
has been executed.

## 0. Prerequisites (Owner decisions)
- A **non-Zeal** billing account for Supabase + Vercel (the connected Supabase account holds only
  Zeal production projects — do NOT use them).
- A Twilio account for phone-OTP (or chosen SMS provider).
- Stage 0 closed (`STAGE-0-REMEDIATION-RUNBOOK.md`) before any **real** data.

## 1. Supabase project
```bash
# Create the project in the Supabase dashboard (region close to Egypt, e.g. eu-central-1).
# Then, from apps/farm-os:
supabase link --project-ref <PROJECT_REF>
supabase db push                 # applies migrations 0001–0013 to the remote DB
```
Seed (pilot demo data — synthetic, not real Ebeid data):
```bash
# Run the seed against the remote DB (SQL editor, or psql with the project's connection string):
psql "<SUPABASE_DB_URL>" -f supabase/seed.sql
```
> For **real** Ebeid data, do NOT use seed.sql — migrate after a privacy review (Stage M).

## 2. Vercel app
- Import the GitHub repo into Vercel; set **Root Directory = `apps/farm-os`** (monorepo).
- Framework preset: **Next.js** (auto). Build command/output: defaults.
- Environment variables (Project Settings → Environment Variables) — from `.env.production.example`:
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Production + Preview)
  - `SUPABASE_SERVICE_ROLE_KEY` — **Production only, server-side**; never expose to the client.
- Deploy. (The `@amrebeid/ui` workspace dep resolves via the monorepo; no registry token needed
  for the app build.)

## 3. Phone-OTP auth (Twilio)
- Supabase Dashboard → Authentication → Providers → **Phone** → enable, set Twilio Account SID /
  Auth Token / Message Service SID.
- Validate **Egypt SMS delivery** with a real handset during the pilot (deliverability varies).
- The email/password seed accounts remain for demo; field roles use phone-OTP.

## 4. Smoke test (post-deploy)
- Sign in (phone-OTP) as each seeded role; walk the wedge loop:
  coverage → PR(reserve) → budget gate → owner approve → receipt → execute → PvA.
- Confirm RLS: a second org cannot see tenant-1 data (the pgTAP `01` isolation invariant in prod).
- Optionally point the Playwright e2e at the deployed URL (set `baseURL`), though it assumes the
  synthetic seed + the dev seed-auth route (local-only) — prefer a manual smoke for prod.

## 5. Rollback
- **App:** Vercel → Deployments → previous deployment → **Promote/Rollback** (instant).
- **DB:** migrations are forward-only; a bad migration is fixed forward with a new additive
  migration (or `supabase db reset` on a *non-production* branch DB). Never destructive-reset prod.

## Security checklist (must hold in prod)
- `SUPABASE_SERVICE_ROLE_KEY` is server-only (no `NEXT_PUBLIC_`); confirm it is NOT in the client bundle.
- `/api/dev/seed-auth` returns 403 in prod (URL guard) — confirm with a request.
- RLS deny-by-default verified (pgTAP `01` + the security remediation in `0010`/`0012`).
- No secrets in the repo or build logs; rotate any key that ever appears in a log.
