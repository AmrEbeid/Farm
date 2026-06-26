-- 70 — defensive invariant (from the #309/#310 review): farm_event is PARTITIONED and `authenticated`
-- holds direct DML on its partition children, so its tenant_all RLS policy must be re-emitted on EVERY
-- partition (the 0025/0035/0064/0065 loops do this). The loop arrays are STATIC, so a future migration
-- that adds a new farm_event partition WITHOUT applying the policy would leave a child writable with a
-- stale/missing policy — re-opening the partition-direct bypass (#309) on the new partition. This test
-- fails the moment any farm_event relation (parent or partition) lacks the cross-org person-FK gate, so
-- the omission is caught in CI rather than shipping a silent isolation hole.
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(2);

-- the set of relations RLS must cover: the partitioned parent + all its partitions.
-- (pg_partition_tree includes the parent itself.)
-- (1) NON-VACUITY: there is more than just the parent — the partition children exist, so the invariant
-- below is actually checking partitions (if this collapses to 1, the partition setup changed and the
-- invariant would be vacuous on the children).
select cmp_ok(
  (select count(*)::int from pg_partition_tree('public.farm_event'::regclass)),
  '>=', 4,
  'non-vacuity: farm_event has the partitioned parent + >= 3 partition children to gate');

-- (2) THE INVARIANT: every farm_event relation (parent + each partition) has a tenant_all policy whose
-- WITH CHECK carries the cross-org person-FK gate (matched by `people pe`, the correlation alias). Zero
-- relations may be missing it.
select is(
  (select count(*)::int
     from pg_partition_tree('public.farm_event'::regclass) pt
     where not exists (
       select 1 from pg_policies p
       where p.schemaname = 'public'
         and p.tablename = (select relname from pg_class where oid = pt.relid)
         and p.policyname = 'tenant_all'
         and coalesce(p.with_check, '') ilike '%people pe%'
     )),
  0,
  'invariant: every farm_event partition carries the person-FK-gated tenant_all policy (no un-gated partition)');

select * from finish();
rollback;
