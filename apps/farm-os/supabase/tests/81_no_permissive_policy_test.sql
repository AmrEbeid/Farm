-- 81 — no-permissive-policy invariant. test 22 (INV-3/4) checks RLS is ENABLED on every table, but a
-- table can have RLS enabled AND a policy that leaks: USING (true) applies no row filter (every row
-- visible), and a policy granted to anon/public exposes rows to the unauthenticated endpoint. Those pass
-- the RLS-enabled check while leaking tenant data. This pins the policy PREDICATES: no public RLS policy
-- may have a `true` USING/WITH CHECK, nor be granted to anon/public. The app convention is org-scoped
-- `to authenticated` policies; any deviation fails CI by name for review.
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(2);

select is(
  (select coalesce(string_agg(tablename || '.' || policyname, ', ' order by tablename, policyname), '(none)')
     from pg_policies
     where schemaname = 'public'
       and (
         (roles::text[] && array['anon','public'])                    -- exposed to the unauthenticated/public role
         or (qual is not null and btrim(qual) in ('true','(true)'))   -- USING true → no row filter (read leak)
         or (with_check is not null and btrim(with_check) in ('true','(true)'))  -- WITH CHECK true → unrestricted write
       )),
  '(none)',
  'no public RLS policy is overly permissive (anon/public-granted, or USING/WITH CHECK = true)');

-- non-vacuity: there are many policies to check (so an empty catalog can't pass silently)
select cmp_ok(
  (select count(*)::int from pg_policies where schemaname='public'),
  '>=', 20,
  'the detector has many public policies to check (not vacuous)');

select * from finish();
rollback;
