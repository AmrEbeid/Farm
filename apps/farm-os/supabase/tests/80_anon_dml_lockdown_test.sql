-- 80 — grant-level anon-DML lockdown invariant. RLS + FORCE RLS are the row gate, but the GRANT is
-- defense-in-depth: the unauthenticated `anon` role must hold NO data DML (SELECT/INSERT/UPDATE/DELETE)
-- on any public base table, so a future RLS misconfiguration can't expose data to the public PostgREST
-- endpoint. people_compensation (the wage/PII table) was the lone violator on prod — it picked up
-- Supabase's platform default-privilege anon grant that 0010's lockdown didn't cover; 0078 revokes it.
--
-- NOTE: the local harness models only MIGRATION-granted privileges (0009 grant → 0010 revoke), NOT
-- Supabase's platform default-privileges, so people_compensation has no anon grant HERE to begin with.
-- This test therefore pins the DESIRED end state (a regression guard catching any future migration that
-- grants anon DML); the prod-specific revoke in 0078 is verified directly against prod via
-- role_table_grants / get_advisors.
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(2);

-- the wage/PII table specifically: anon holds none of the four data DMLs
select ok(
  not has_table_privilege('anon', 'public.people_compensation', 'SELECT')
  and not has_table_privilege('anon', 'public.people_compensation', 'INSERT')
  and not has_table_privilege('anon', 'public.people_compensation', 'UPDATE')
  and not has_table_privilege('anon', 'public.people_compensation', 'DELETE'),
  'anon holds NO data DML on people_compensation (the wage/PII table)');

-- broad: no public base table grants anon data DML
select is(
  (select coalesce(string_agg(table_name, ', ' order by table_name), '(none)')
     from information_schema.role_table_grants
     where table_schema = 'public' and grantee = 'anon'
       and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
  '(none)',
  'grant-level lockdown: no public table grants anon data DML (RLS-independent defense-in-depth)');

select * from finish();
rollback;
