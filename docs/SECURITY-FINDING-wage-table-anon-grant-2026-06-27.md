# Security Finding — `anon` holds data DML on the wage table (`people_compensation`)   (2026-06-27)

Scope: `apps/farm-os` grant-level posture. Status: **✅ RESOLVED + DEPLOYED** — migration
`0079_people_comp_anon_revoke` applied to prod 2026-06-27 (verified:
`has_table_privilege('anon','public.people_compensation','SELECT')` = false; `schema_migrations` max =
`20260622000079`). Deployed via the Supabase MCP. (On `main`:
`20260622000079_people_comp_anon_revoke.sql`, PR #339, renumbered 0078→0079 per PR #340 + regression
guard `tests/80_anon_dml_lockdown_test.sql`.)

## Summary

`people_compensation` — the **wage / PII** table — was the **only** public table granting the
unauthenticated `anon` role data DML (`SELECT, INSERT, UPDATE, DELETE`). Every other tenant table
grants `anon` only the harmless schema privileges (`REFERENCES, TRIGGER, TRUNCATE`, none of which is
reachable via the PostgREST REST API or by a role with no direct SQL connection).

| table | `anon` privileges (prod, pre-fix) |
|---|---|
| people, expenses, purchase_requests, budgets, … | REFERENCES, TRIGGER, TRUNCATE |
| **people_compensation** | **DELETE, INSERT, SELECT, UPDATE**, REFERENCES, TRIGGER, TRUNCATE |

## Severity

**LOW (defense-in-depth) — not a live exploit.** `people_compensation` has RLS **and** `FORCE ROW
LEVEL SECURITY` (migration 0046). An `anon` caller has no org, so the `comp_rw` policy
(`org_id in (select user_org_ids())` — empty for anon) yields **zero rows** for any SELECT, and the
WITH CHECK rejects any write. So the grant is currently neutralized. The finding is that the **most
sensitive table is the sole exception to grant-level lockdown**: if RLS were ever disabled or
misconfigured on this one table (a future migration bug), `anon` could read/modify **every wage**
through the public PostgREST endpoint. Grant-level revocation is the defense-in-depth backstop the
other tables already have.

## Root cause

- Migration `0009` granted `anon`/`authenticated` data DML on **all then-existing** public tables.
- Migration `0010` (security remediation) **revoked** `anon`'s data DML — the lockdown — table by table.
- `people_compensation` was created **later** (migration `0046`) and inherited the DML grant from
  **Supabase's platform default-privileges** (`ALTER DEFAULT PRIVILEGES … TO anon`), which the
  `0010` table-by-table revoke did not cover. So the one table added after the lockdown is the one
  table still exposed.

## Why the linter did not catch it

The Supabase database advisor (`get_advisors security`) lints `rls_disabled_in_public` and
`*_security_definer_function_executable`, **not** the anon-table-grant pattern. This was caught by a
**manual grant audit** (`information_schema.role_table_grants` for `grantee = 'anon'`), not the
advisor. The advisor cross-check confirmed `people_compensation`'s RLS is **not** disabled
(consistent with FORCE RLS being on), so nothing contradicted the finding.

## Fix

`20260622000079_people_comp_anon_revoke.sql`:

```sql
revoke select, insert, update, delete on public.people_compensation from anon;
```

- **Targeted** — revokes only `anon`'s four data DMLs; `REFERENCES/TRIGGER/TRUNCATE` and **all of
  `authenticated`'s grants are untouched** (the app uses the `authenticated` role, still gated by
  `comp_rw`'s `payroll.read`), so **no app behavior changes**.
- **Idempotent** — `revoke` of an absent grant is a no-op, so it is safe on prod (removes the real
  grant) and a no-op in the Docker-free pgTAP harness (which models only migration-granted privileges,
  not Supabase's platform default-privileges).

### Regression guard

`tests/80_anon_dml_lockdown_test.sql` — a catalog invariant: `anon` holds no data DML on
`people_compensation`, and **no** public table grants `anon` data DML. Any future migration that grants
`anon` DML fails CI by name. (The harness models only migration-granted privileges, so the test pins
the desired end-state as a regression guard; the prod-specific revoke is verified directly via
`role_table_grants` — see below.)

## Verification (reproducible, read-only)

```sql
-- BEFORE 0079 (prod): people_compensation is the ONLY row returned.
select table_name, string_agg(privilege_type, ',' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'anon'
  and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')
group by table_name;
-- AFTER 0079: returns no rows.

-- App role unaffected (stays true before and after):
select has_table_privilege('authenticated','public.people_compensation','SELECT');  -- t
```

Independently confirmed against prod (project `veezkmytervjnpxcrbkw`) during review of PR #339: `anon`
held all four DMLs on `people_compensation` and it was the only such table; `authenticated` retained
all four; RLS + FORCE RLS both on.

## Prod-apply

**Done (2026-06-27).** `0079` is applied to prod — `schema_migrations` max = `20260622000079`, and
`has_table_privilege('anon','public.people_compensation','SELECT')` = false — so the live grant is
closed. Deployed via the Supabase MCP alongside `0078` (a cosmetic engine-message change).
