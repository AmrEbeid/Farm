-- 97 — grant hygiene / default-privilege lockdown (#317/#229).
--
-- The local harness does not reproduce Supabase prod's platform default ACL drift by itself, so this
-- test pins the desired catalog end state:
--   * no public table grants TRUNCATE to anon/authenticated
--   * no public table grants DELETE to anon/authenticated except authenticated plan_checks
--   * no public-schema default table ACL grants future privileges to PUBLIC/anon/authenticated from
--     grantor roles the migration role can administer. Production's platform-owned `supabase_admin`
--     grantor is reported as a residual follow-up when the migration role is not a member.
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(4);

-- TRUNCATE is never a client-role operation. RLS policies do not make it an intended app path.
select is(
  (select coalesce(string_agg(n.nspname || '.' || c.relname || ':' || r.role_name, ', '
                              order by n.nspname, c.relname, r.role_name), '(none)')
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     cross join (values ('anon'), ('authenticated')) as r(role_name)
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and has_table_privilege(r.role_name, c.oid, 'TRUNCATE')),
  '(none)',
  'grant hygiene: no public table grants TRUNCATE to anon/authenticated');

-- DELETE remains closed everywhere except the existing plan_checks recompute path.
select is(
  (select coalesce(string_agg(n.nspname || '.' || c.relname || ':' || r.role_name, ', '
                              order by n.nspname, c.relname, r.role_name), '(none)')
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     cross join (values ('anon'), ('authenticated')) as r(role_name)
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not (c.relname = 'plan_checks' and r.role_name = 'authenticated')
      and has_table_privilege(r.role_name, c.oid, 'DELETE')),
  '(none)',
  'grant hygiene: no public table grants DELETE to anon/authenticated except authenticated plan_checks');

select ok(
  has_table_privilege('authenticated', 'public.plan_checks', 'DELETE'),
  'grant hygiene: authenticated plan_checks DELETE remains available for the recompute path');

-- Future public tables should not inherit client-role privileges from the prod grantor default ACL.
select is(
  (select coalesce(string_agg(coalesce(grantee.rolname, 'PUBLIC') || ':' || x.privilege_type, ', '
                              order by coalesce(grantee.rolname, 'PUBLIC'), x.privilege_type), '(none)')
     from pg_default_acl d
     join pg_namespace n on n.oid = d.defaclnamespace
     cross join lateral aclexplode(d.defaclacl) as x
     left join pg_roles grantee on grantee.oid = x.grantee
    where n.nspname = 'public'
      and d.defaclobjtype = 'r'
      and pg_has_role(current_user, pg_get_userbyid(d.defaclrole), 'member')
      and (x.grantee = 0 or grantee.rolname in ('anon', 'authenticated'))
      and x.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')),
  '(none)',
  'grant hygiene: public-table default ACL grants no future table privileges to PUBLIC/anon/authenticated');

select * from finish();
rollback;
