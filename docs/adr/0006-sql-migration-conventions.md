# 0006 — SQL migration conventions (idempotency, SECURITY DEFINER hygiene, function lockdown)

- **Status:** Accepted — 2026-06-25
- **Scope:** conventions for **future** migrations under
  `apps/farm-os/supabase/migrations/`. This ADR does **not** propose editing the
  already-applied `0001`–`0023` set — their history is recorded one-time
  application (see Re-run safety below).
- **Grounding:** the existing migration set `0001`–`0023` and its pgTAP suite
  under `apps/farm-os/supabase/tests/`.
- **Related:** ADR-0001 (`fn_execute_operation`), ADR-0002 (append-only ledger),
  ADR-0003 (SECURITY DEFINER grant lockdown).

## Context

A migration-safety audit of the Farm OS migrations found the security and
correctness patterns are sound but applied inconsistently across the set — the
guarded, re-runnable patterns appear only in the later remediation migrations,
while the original schema migrations use bare `create` statements. Because the
remote applies migrations incrementally and idempotently (it consults
`supabase_migrations.schema_migrations` and applies only unrecorded versions —
see `docs/DEPLOY-RUNBOOK.md`), the inconsistency is harmless in practice but
makes the set non-replayable from scratch outside the clean-cluster CI harness.
This ADR fixes the conventions so every new migration is independently safe.

## Decision

New migrations follow these conventions.

### 1. Re-run safety — guard object creation

- **Indexes:** `create index <name> ... if not exists`.
- **Policies:** `drop policy if exists <name> on <tbl>;` then `create policy ...`
  (the pattern in `0010_security_remediation`, `0012_rls_reference_columns`,
  `0015_inventory_write_rolegate`).
- **Triggers:** `drop trigger if exists <name> on <tbl>;` then `create trigger ...`
  (the pattern in `0023_pr_approval_sod_guard_insert`).
- **Functions:** `create or replace function ...` (used throughout, e.g.
  `0011`, `0013`, `0017`–`0021`, `0023`).

Current state for reference: `0001`–`0008`, `0017`, `0019` use bare
`create policy` / `create trigger` / `create index`, so the full set is **not**
replayable from a fresh cluster outside the clean-cluster CI harness. That is
acceptable — migration history records one-time application, and we do not
rewrite applied migrations — but **new** migrations must use the guarded forms
above so each is re-runnable in isolation.

### 2. SECURITY DEFINER hygiene

Every `security definer` function must `set search_path = ''` and
schema-qualify all object references (`public.<table>`, `public.<fn>`). All
current definer functions already do this; standardize on the empty-string form
`set search_path = ''` (note `0017` and `0023` currently spell it
`set search_path to ''` — equivalent, but new code uses `= ''`). An empty
search_path makes the definer body immune to search-path hijacking, the core
mitigation for the privilege-escalation risk a `SECURITY DEFINER` function
carries.

### 3. Function lockdown on Supabase

For every new function, after `create or replace`:

```sql
revoke execute on function public.<fn>(<argtypes>) from public, anon, authenticated;
grant  execute on function public.<fn>(<argtypes>) to <intended role>;  -- usually authenticated
```

Revoke from **`public, anon, authenticated` all three** — not `public` alone.
On Supabase, default privileges auto-`GRANT EXECUTE` to `anon` and
`authenticated` on every new function in the `public` schema; `revoke ... from
public` does **not** strip those explicit role grants. This was the `0021`
(`lock_definer_exec_to_caller_roles`) lesson — the `revoke ... from public` in
`0009`/`0011`/`0020` left `anon`/`authenticated` able to reach the write RPCs
and trigger functions over `/rest/v1/rpc/*`. See ADR-0003 for the full account
and the catalog-level invariant oracles (`tests/22_security_invariants_test.sql`)
that pin the end state.

- Trigger functions are never invoked directly: revoke from all three and grant
  to **no** client role.
- Authenticated RPCs: revoke from all three, then grant to `authenticated` only,
  and add the function to the test-22 allow-list.

### 4. Process

- **Pair each migration with a pgTAP test** under
  `apps/farm-os/supabase/tests/` (the `NN_*_test.sql` suite — every migration in
  the set has a corresponding oracle, e.g. `0021` ↔ `19`, `0023` ↔ `21`).
- The remote records applied versions in
  `supabase_migrations.schema_migrations`; `supabase db push` is incremental and
  idempotent against that table.
- **Production push is Owner-gated** — provisioning and deploy are hard stops
  per `docs/DEPLOY-RUNBOOK.md`; the actor producing a migration is not the actor
  who approves its push.

## Consequences

- **Positive:** every new migration is independently re-runnable, search-path
  safe, and locked down by default; the existing invariant oracles catch a
  definer function that forgets its lockdown regardless of which migration adds
  it. The conventions are now written down rather than re-derived per migration.
- **Negative / trade-offs:** more boilerplate per object (drop-guard + revoke +
  grant + a paired test). This is the intended friction — the alternative is the
  drift the audit found. The older `0001`–`0008`/`0017`/`0019` migrations remain
  un-guarded by design; full-set replay still depends on the clean-cluster CI
  harness, not on the migration files alone.

## Notes

- **Numbering:** the sequence skips `0014` — `…000013` is followed by
  `…000015`. The gap is harmless (the `14` slot maps to the ENGINE-DC regression
  test, not a migration file) and is left as-is; new migrations continue from the
  highest existing number.
