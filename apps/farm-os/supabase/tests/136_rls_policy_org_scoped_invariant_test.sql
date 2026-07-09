-- 136 — security-360 MEDIUM-1 (test-net gap): every RLS policy on a public base table must be
-- org-scoped, and none may be unconditionally permissive.
--
-- WHY. tests/22 (INV-3/INV-4) and tests/29 pin that every public base table ENABLES + FORCEs RLS, but
-- nothing asserts the POLICY PREDICATES are tenant-scoped. A future migration could add a new public
-- table with `create policy x for all using (true)` — it would pass INV-3 (RLS enabled) and test 29
-- (forced) yet leak every org's rows cross-tenant. This closes that gap with two dynamic catalog
-- invariants (violation-count = 0), so they auto-extend to any table added later.
--
-- SCOPE. Non-partition base tables in schema public (same scope as tests/22 INV-3). Partition children
-- are covered by their own per-partition tests (farm_event children in tests 01/24). All checks read
-- pg_policies / pg_catalog, so they are valid on the local superuser harness (no RLS runtime needed).
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(3);

-- ============================================================================================
-- INV-6a — every RLS-enabled public base table that HAS policies is scoped by a per-caller boundary.
-- "Scoped" = the policy's USING/WITH CHECK text references either the TENANT boundary — user_org_ids(),
-- an org_id predicate, or authorize(...) (which joins organization_member on p_org) — OR per-user
-- OWNERSHIP via auth.uid() (e.g. public.user_active_org: a user reads only their own preference row,
-- writes revoked). Both are deny-by-default safe. A table whose only policy is `using (true)` has
-- policies but none scoped → flagged. (A table deliberately RLS-enabled with NO policy = deny-all, e.g.
-- an internal/append-only table, is NOT flagged: the "has >=1 policy" precondition excludes it.)
-- ============================================================================================
select is(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relispartition
      and c.relrowsecurity
      and exists (select 1 from pg_policies p
                   where p.schemaname = 'public' and p.tablename = c.relname)
      and not exists (
        select 1 from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname
           and (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''))
               ~ '(user_org_ids|org_id|authorize|auth\.uid)')),
  0,
  'INV-6a: every RLS public base table that has policies carries >=1 scoped policy — org (user_org_ids/org_id/authorize) or owner (auth.uid) — no permissive-only table');

-- ============================================================================================
-- INV-6b — no policy on a public table is unconditionally permissive. A bare `using (true)` or
-- `with check (true)` surfaces in pg_policies as the literal 'true'; because permissive policies
-- combine with OR, a single such policy alongside an org-scoped one still leaks every row. Flag any.
-- ============================================================================================
select is(
  (select count(*)::int
     from pg_policies p
    where p.schemaname = 'public'
      and (btrim(coalesce(p.qual, '')) = 'true' or btrim(coalesce(p.with_check, '')) = 'true')),
  0,
  'INV-6b: no public RLS policy is unconditionally permissive (bare USING(true)/WITH CHECK(true))');

-- Sanity floor: many tables actually carry an org-scoped policy, so the invariants are not vacuously
-- satisfied by an empty catalog after some future refactor.
select cmp_ok(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      and exists (select 1 from pg_policies p
                   where p.schemaname = 'public' and p.tablename = c.relname
                     and (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) ~ 'user_org_ids')),
  '>=', 5,
  'INV-6: many public tables carry org-scoped (user_org_ids) policies (invariants are not vacuous)');

select * from finish();
rollback;
