-- 22 — generic regression-pin oracles for the security invariants the prod-push assurance
-- flagged as un-pinned. The earlier tests (05, 19) pin SPECIFIC functions/findings by name;
-- these are CATALOG-LEVEL invariants that hold no matter which migration is added next, so a
-- future migration cannot silently regress them (e.g. add a new public SECURITY DEFINER fn that
-- inherits the Supabase default anon/authenticated EXECUTE grant, or add a table/partition that
-- forgets RLS).
--
-- All checks are pg_catalog / has_function_privilege based — independent of RLS, so they are valid
-- even on the local superuser cluster where FORCE ROW LEVEL SECURITY cannot be exercised. The
-- assertions are built DYNAMICALLY (count of violations = 0), so they auto-extend to new objects.
-- Run via `supabase test db` or the local shim (test-shims/run-pgtap-local.sh).

begin;
select plan(8);

-- ============================================================================================
-- Invariant 1 — anon may EXECUTE no public SECURITY DEFINER function except the RLS helpers.
-- Generalises migration 0021. authorize(text)/user_org_ids() are the intentional helpers anon
-- needs so RLS policies can evaluate for an unauthenticated request; every other definer fn is a
-- privileged code path that must never be reachable from the anon (unauthenticated) JWT.
-- ============================================================================================
select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname not in ('authorize', 'user_org_ids')
      and has_function_privilege('anon', p.oid, 'EXECUTE')),
  0,
  'INV-1: no public SECURITY DEFINER fn (other than authorize/user_org_ids) is EXECUTE-able by anon');

-- Pin the positive side too: the two intended helpers MUST stay anon-executable (so a future
-- over-zealous revoke that breaks anonymous RLS evaluation is also caught).
select ok(has_function_privilege('anon', 'public.authorize(text)', 'EXECUTE'),
  'INV-1: authorize(text) remains EXECUTE-able by anon (RLS helper)');
select ok(has_function_privilege('anon', 'public.user_org_ids()', 'EXECUTE'),
  'INV-1: user_org_ids() remains EXECUTE-able by anon (RLS helper)');

-- ============================================================================================
-- Invariant 2 — authenticated may EXECUTE only the intended API surface of public SECURITY
-- DEFINER functions. The allow-list is the RLS helpers + the deliberate write/read RPCs. In
-- particular the trigger functions (pr_guard_approval, fn_audit, fn_audit_org_member, and any
-- other `returns trigger` definer fn) are never invoked directly and must hold no client EXECUTE.
-- ============================================================================================
select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname not in (
        'authorize', 'user_org_ids',             -- RLS helpers
        'fn_stock_coverage', 'fn_post_movement',
        'fn_bin_rebuild', 'fn_execute_operation' -- intended authenticated RPC surface
      )
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  0,
  'INV-2: no unexpected public SECURITY DEFINER fn is EXECUTE-able by authenticated (trigger fns locked)');

-- Pin the trigger functions explicitly — these are the ones 0021 had to claw back from PUBLIC/
-- authenticated, so guard the regression directly as well as via the dynamic count above.
select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     join pg_type t on t.oid = p.prorettype
    where n.nspname = 'public'
      and p.prosecdef
      and t.typname = 'trigger'
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  0,
  'INV-2: no public SECURITY DEFINER trigger function is EXECUTE-able by anon or authenticated');

-- ============================================================================================
-- Invariant 3 — every base table in schema public has row-level security ENABLED (deny-by-
-- default, generalised). relkind 'r' = ordinary table; relispartition excluded here because
-- partition children are covered separately by INV-4. There are no pgTAP-owned tables in public
-- (pgTAP installs into the pg_catalog/extension schema), so no name exclusions are needed; if
-- that ever changes, exclude them here by name with a comment rather than weakening the count.
-- ============================================================================================
select is(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relispartition
      and not c.relrowsecurity),
  0,
  'INV-3: every non-partition base table in public has RLS enabled');

-- ============================================================================================
-- Invariant 4 — every partition CHILD has RLS enabled. A child queried directly does NOT inherit
-- the parent partitioned table's RLS, so each child must carry its own (see migration 0004 for
-- farm_event). This covers all partition children, and explicitly the farm_event children.
-- ============================================================================================
select is(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relispartition
      and not c.relrowsecurity),
  0,
  'INV-4: every partition child in public has RLS enabled');

-- Sanity floor: there is at least one partition child (otherwise INV-4 is vacuously true and a
-- future change that drops partitioning would silently stop testing this surface).
select cmp_ok(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     join pg_inherits i on i.inhrelid = c.oid
     join pg_class parent on parent.oid = i.inhparent
    where n.nspname = 'public' and parent.relname = 'farm_event'),
  '>=', 1,
  'INV-4: farm_event still has partition children (the invariant is not vacuous)');

select * from finish();
rollback;
