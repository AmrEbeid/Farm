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
supabase db push                 # applies the migration set in supabase/migrations/ to the remote DB
```
> `supabase db push` is **incremental and idempotent** — it consults
> `supabase_migrations.schema_migrations` on the remote and applies only versions not yet recorded.
> A first run on a fresh project applies the whole set; a re-run after the initial deploy applies only
> the newer ones (see §1a). The remote was first provisioned at migration `0013`; the security fixes
> `0015`–`0018` are the not-yet-applied delta. *(There is no `0014` — the numbering skips it; pgTAP
> test `14` is the ENGINE-DC regression, unrelated to a migration file.)*
Seed (pilot demo data — synthetic, not real Ebeid data):
```bash
# Run the seed against the remote DB (SQL editor, or psql with the project's connection string):
psql "<SUPABASE_DB_URL>" -f supabase/seed.sql
```
> For **real** Ebeid data, do NOT use seed.sql — migrate after a privacy review (Stage M).

## 1a. Incremental migration push — post-deploy security fixes (0015→0018) — **Owner-gated**

> **STATUS (2026-06-25): DONE.** The remote pilot DB (`veezkmytervjnpxcrbkw`) is now at migration
> **`0022`** (`0001`–`0013` + `0015`–`0022`), fully seeded. After the 8-agent adversarial prod-push
> assurance returned **GO-WITH-CAVEATS**, `0015`→`0022` were applied in order (`0018` engine change
> Owner-ratified) via the Supabase MCP and each recorded in `supabase_migrations.schema_migrations`
> under its repo version, so remote history matches the repo and a future `supabase db push` is a
> no-op for these. pgTAP **126/126** on a clean reset.

The pilot DB was first provisioned at migration `0013`. The security/correctness delta below has
since been applied (rows ✅ are live on prod). Each was a hard stop per PROJECT RULES, applied only
on the Owner's go-ahead:

| # | File | Closes | Risk | Applied |
|---|------|--------|------|---------|
| `0015` | `…_inventory_write_rolegate.sql` | **B2** — inventory writes are role-gated (not org-wide) | access-control | ✅ |
| `0016` | `…_inventory_ledger_append_only.sql` | **B2.1** — stock ledger DELETE-immutable | access-control | ✅ |
| `0017` | `…_pr_approval_sod_guard.sql` | **AP-5** — PR self-approval / `requested_by` rewrite blocked | financial control | ✅ |
| `0018` | `…_engine_scheduled_receipts_from_pos.sql` | **ENGINE-DC** — scheduled receipts from open POs (no double-count) | **core engine** | ✅ (Owner-ratified) |
| `0019` | `…_audit_organization_member.sql` | **AUDIT-1** — membership/role changes audited | audit | ✅ |
| `0020` | `…_fn_execute_operation.sql` | **AUTHZ-1 (Option A)** — atomic, server-gated `op.execute` RPC | access-control | ✅ |
| `0021` | `…_lock_definer_exec_to_caller_roles.sql` | **GRANT-C1** — revoke anon/PUBLIC EXECUTE on definer write + trigger fns | access-control | ✅ |
| `0022` | `…_inventory_ledger_no_update.sql` | **B2.1** — ledger UPDATE-immutable (now fully append-only) | access-control | ✅ |

```bash
# Re-running is safe (idempotent). To apply any FUTURE migration with the project linked (§1):
supabase migration list           # confirm remote is at 0022 and only newer versions are pending
supabase db push                  # applies pending versions in order
```

> **Residual security caveats (queued, not blocking — from the prod-push assurance):** AUTHZ-1
> Option B (gate the operation tables at the REST layer, not only inside the RPC); AP-5 insert-side
> SoD (issue #76 item 2 — a born-approved PR sidesteps the `BEFORE UPDATE` trigger); ENGINE-DC
> disjointness is convention-enforced, not DB-constraint-enforced. None are live-exploitable on
> synthetic single-tenant data; all tracked for a follow-up change window.

**Before the push:**
- **Independent review + Owner ratification is required for `0018`** — it changes the stock-coverage
  engine (the product's core IP, a review-required area per PROJECT RULES). `0015`–`0017` are
  access-control/ledger hardening (also review-required, already diff-reviewed on their PRs).
- The app **runs correctly without these** — writes already route through the `bypassrls` RPCs;
  `0015`/`0016` tighten *direct* REST access, `0017` hardens the approval policy, and `0018` only
  changes the coverage projection's receipt source. So there is no app-vs-DB lockstep requirement;
  the push can happen on its own change window.

**After the push — verify in prod (read-only checks, or the SQL editor):**
- `supabase migration list` shows `0018` as the latest applied version.
- **B2.1 (append-only):** a direct `delete from inventory_movements …` as an authenticated tenant is
  rejected (pgTAP `11` invariant).
- **AP-5 (SoD):** an owner-author cannot self-approve a PR by rewriting `requested_by` in the approving
  `UPDATE` (pgTAP `12`).
- **ENGINE-DC:** `fn_stock_coverage` for an item with a received receipt no longer double-counts —
  `available` matches `on_hand − reserved` plus *open-PO* scheduled receipts only (pgTAP `06`/`14`).

> **Rollback:** migrations are forward-only (see §5). A regression is fixed forward with a new additive
> migration — never destructive-reset prod.

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
