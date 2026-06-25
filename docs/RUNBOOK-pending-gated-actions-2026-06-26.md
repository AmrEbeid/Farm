# Runbook — pending Owner-gated actions (2026-06-26)

*Turnkey, copy-paste steps for the actions that currently gate the project. **Each is an Owner hard
stop** (deploy / DB migration / secret rotation / access) — nothing here has been executed; this doc
only makes execution one pass. Companion to [`DEPLOY-RUNBOOK.md`](DEPLOY-RUNBOOK.md) (general deploy)
and [`DEPLOY-STATUS.md`](DEPLOY-STATUS.md) (current live state). Separation of duties: the person
executing must not be the same agent that authored the change.*

Current ground truth: prod Supabase `veezkmytervjnpxcrbkw` at migration **`0031`**; repo `main` at
**`0033`**. App deploys via Vercel on merge to `main`.

---

## A. Merge the open PRs (each merge to `main` = a Vercel deploy)

Recommended order — **docs/specs first** (no behaviour change), then the **code deploys** batched:

```
# docs/specs (safe, no app-behaviour change):
#189  docs reconcile (prod 0031)      — also finish the @amrebeid/ui 1.1.0→1.2.0 cleanup in
                                          PROJECT-TRACKER.md:114 and DEPLOY-STATUS.md:52
#183  SPEC-0002 (authz-2/3 + PII-1)
#192  SPEC-0009 (partial receipts)
#193  SPEC-0003 (Stage-2 status)
#194  SPEC-0001/0004 (fork captures)
#200  pricing research (#89)

# code deploys (verify each Vercel preview, then merge as a batch, then ONE live smoke):
#186  Stage 2 farm views + reconciliation oracle
#190  budget honest-signal (#157 step-1)
#191  Arabic error mapping (#187)
#195  field-UI Arabic + plan-check false-pass fix
```
All 9 were independently reviewed → SAFE TO MERGE (the 3 overclaim/citation findings in #192/#193/#194
are fixed). After the code batch, smoke the live app (login + one dashboard) — baseline already verified
healthy 2026-06-26.

---

## B. Push migrations `0032`/`0033` to prod — **Critical apply**

`0032` = `pr_items_lock_and_version_bump`; `0033` = `fn_post_movement_floor_lock` (CONC-1 concurrency
fix). Both verified on `main` (full pgTAP), not yet on prod.

```bash
cd apps/farm-os
supabase link --project-ref veezkmytervjnpxcrbkw   # if not already linked
supabase db push                                    # incremental: applies only 0032, 0033
```
**Verify (run in the Supabase SQL editor):**
```sql
select version from supabase_migrations.schema_migrations
where version in ('20260622000032','20260622000033') order by version;
-- expect exactly these two rows.
```
Then re-run the pgTAP suite against prod (or the Docker-free shim) and confirm green. Rollback path:
these are additive guards (a lock + a floor); if needed, a forward `create or replace` revert migration
(never edit applied files).

---

## C. 🔴 Secret rotation — **do before any real Ebeid data** (confirmed-needed)

The Supabase **DB password** and **`service_role` key** were pasted in the setup chat (DEPLOY-STATUS
"Security follow-ups"). The `service_role` key bypasses RLS → full data access.

1. Supabase → **Settings → Database** → reset the DB password. (Committed migrations still apply via a
   fresh connection string.)
2. Supabase → **Settings → API** → roll the **`service_role`** (secret) key. Optionally roll the
   publishable/anon key too.
3. Vercel → project `farm-ui` → **Settings → Environment Variables** → update
   `SUPABASE_SERVICE_ROLE_KEY` (and anon key if rolled) → **redeploy**.
4. Confirm the app still works (login + a dashboard read) after redeploy.

---

## D. 🔴 Demo-account remediation — **CONFIRMED public exposure**

**Reproduced live 2026-06-26:** the committed demo password logs in as **owner (المالك)** on
`farm-ui-one.vercel.app` — the login page pre-fills `owner@ebeid.test` + the password, and the
password constant ships in the client bundle. Anyone visiting the live site can sign in as the owner.
Mitigated only by synthetic data; **must close before any real Ebeid data.** Options (Owner decides):

- **Minimal:** rotate the 6 demo-account passwords to a new out-of-band secret (Supabase → Auth →
  Users → reset password) and remove the prefill/constant from `app/login/page.tsx` for production.
- **Cleaner:** delete the demo `*@ebeid.test` users (Supabase → Auth) and create real per-user
  accounts; gate the demo affordance (chips + prefill) behind a non-production check, mirroring the
  `VERCEL_ENV !== 'production'` guard already on `/api/dev/seed-auth`.

> This is a product/security tradeoff for the pilot demo — Owner's call. (Code change to the login
> surface is Owner-gated; not done autonomously.)

---

## E. Ratifications / decisions (no code — Owner sign-off)

- **Ratify SPEC-0009** (partial receipts) → unblocks the next engine build (slice 1: schema +
  oracle). Engine/financial → independent reviewer ≠ implementer required.
- **#157 step-2** (budget hard-cap + owner-override + audit) — financial decision; gated to SPEC-0004
  live actuals.
- **#89 pricing** — Owner-only commercial decision; provisional band in
  [`PRICING-RESEARCH-89-2026-06-26.md`](PRICING-RESEARCH-89-2026-06-26.md); needs the 5 design-partner
  interviews before publishing.
- **Provide real per-item unit costs** → unblocks the #89 code half (replace the hardcoded `×84` /
  `reserveQty` / `needed_by` in the seed-plan wedge with real data + a `unit_cost` source).

---

## Order of operations (recommended)
1. Merge docs/specs (A) → 2. Merge code batch + smoke (A) → 3. Push `0032`/`0033` (B) + verify →
4. Rotate secrets (C) → 5. Remediate demo accounts (D) → 6. Ratify SPEC-0009 (E) → next engine build.
Steps C/D/E are independent of A/B and can proceed in parallel once decided.
