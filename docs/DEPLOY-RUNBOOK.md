# Deploy Runbook — Farm OS MVP-0 (pilot)

Turnkey steps to deploy or maintain the MVP-0 app on a **dedicated, non-Zeal** Supabase project +
Vercel. The original first deploy has been executed; historical first-deploy notes are kept below
for audit context. **Owner-gated:** provisioning, production DB pushes, and production deploys are
hard stops — do not run them without explicit Owner go-ahead.

## 0. Prerequisites (Owner decisions)
- A **non-Zeal** billing account for Supabase + Vercel (the connected Supabase account holds only
  Zeal production projects — do NOT use them).
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
> the newer ones (see §1a). For the current production head, use the latest ledger entry at the top
> of `docs/DEPLOY-STATUS.md`; do not infer current state from the historical `0029` milestone below.
Seed (pilot demo data — synthetic, not real Ebeid data):
```bash
# Run the seed against the remote DB (SQL editor, or psql with the project's connection string):
psql "<SUPABASE_DB_URL>" -f supabase/seed.sql
```
> For **real** Ebeid data, do NOT use seed.sql — migrate after a privacy review (Stage M).

## 1a. Historical record — post-deploy security fixes (0015→0029) — **DONE**

> **STATUS (2026-06-25): DONE.** The remote pilot DB (`veezkmytervjnpxcrbkw`) was then at migration
> **`0029`** (`0001`–`0013` + `0015`–`0029`), fully seeded. After the 8-agent adversarial prod-push
> assurance returned **GO-WITH-CAVEATS**, `0015`→`0024` were applied in order (`0018` engine change
> Owner-ratified); the subsequent access-control / engine-integrity hardening `0025`→`0029` (see the
> table below) was applied the same way. Each is recorded in `supabase_migrations.schema_migrations`
> under its repo version, so remote history matches the repo and a future `supabase db push` is a
> no-op for these. pgTAP **270/270** on a clean reset (verified 2026-06-25; prod `list_migrations`
> latest = `20260622000029`).

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
| `0023` | `…_pr_approval_sod_guard_insert.sql` | **AP-5** (#76 item 2) — extend SoD guard to BEFORE INSERT (block a born-approved PR) | financial control | ✅ |
| `0024` | `…_fn_post_receipt.sql` | **RCP-ATOMIC-1** — atomic single-transaction PR receipt posting (no half-received state) | **inventory/finance** | ✅ |
| `0025` | `…_operation_tables_rls_authz.sql` | **AUTHZ-1 (Option B)** (#146) — gate the operation tables (`plan_operations`/`farm_event`/`event_locations`/`quantities`) at the REST layer, not only inside the RPC | access-control | ✅ |
| `0026` | `…_engine_dc_constraint.sql` | **ENGINE-DC** (#144) — DB-level disjointness guard so a received receipt can't be double-counted | **core engine** | ✅ |
| `0027` | `…_delete_posture_remediation.sql` | **DELETE-posture** (#140) — tighten DELETE grants across tenant tables | access-control | ✅ |
| `0028` | `…_force_rls_tenant_tables.sql` | **FORCE-RLS** (#142) — `FORCE ROW LEVEL SECURITY` on tenant tables so even table owners are RLS-bound | access-control | ✅ |
| `0029` | `…_engine_dc_guard_pr_scope.sql` | **ENGINE-DC fix** (#151) — scope the `0026` guard to a txn-local GUC set by `fn_post_receipt` (fixes a two-PO-one-item false positive) | **core engine** | ✅ |

```bash
# Re-running is safe (idempotent). To apply any FUTURE migration with the project linked (§1):
supabase migration list           # confirm remote matches DEPLOY-STATUS and only expected new versions are pending
supabase db push                  # applies pending versions in order
```

> **Residual security caveats — now CLOSED (2026-06-25).** The prod-push assurance left two queued
> caveats; both have since landed: **AUTHZ-1 Option B** (gate the operation tables at the REST layer,
> not only inside the RPC) is closed by `0025`; **ENGINE-DC** disjointness is now DB-enforced (`0026`)
> with a PR-scoped guard fix (`0029`), no longer convention-only. *(AP-5 insert-side SoD — issue #76
> item 2 — was already closed by `0023`.)* No queued security caveats remain from the assurance.

**Historical preconditions for that push:**
- **Independent review + Owner ratification was required for `0018`** — it changes the stock-coverage
  engine (the product's core IP, a review-required area per PROJECT RULES). `0015`–`0017` are
  access-control/ledger hardening (also review-required, already diff-reviewed on their PRs).
- The app **ran correctly without these** — writes already routed through the `bypassrls` RPCs;
  `0015`/`0016` tighten *direct* REST access, `0017` hardens the approval policy, and `0018` only
  changes the coverage projection's receipt source. So there is no app-vs-DB lockstep requirement;
  the push can happen on its own change window.

**After any future push — verify in prod (read-only checks, or the SQL editor):**
- `supabase migration list` matches the head recorded at the top of `docs/DEPLOY-STATUS.md`, with no
  unexpected pending or stray versions.
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

## 3. Auth
- Auth = email + password only. Phone-OTP / Twilio is removed from MVP-0 scope (no SMS provider
  needed).

## 4. Smoke test (post-deploy)
- Sign in (email + password) as each seeded role; walk the wedge loop:
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
