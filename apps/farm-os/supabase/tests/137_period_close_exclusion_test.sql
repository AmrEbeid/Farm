-- 137 — #719 item 2: no two LOCKED accounting periods may overlap for the same org, enforced by the
-- DB-level exclusion constraint accounting_periods_no_overlap_locked (migration 20260712100000). This
-- is the concurrency backstop the app-level exists()-then-insert check cannot provide: two simultaneous
-- closes on overlapping ranges must not both land. Rows seeded as superuser (RLS bypassed); orgA from seed.
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(6);

\set orgA '00000000-0000-0000-0000-000000000001'
\set orgB '00000000-0000-0000-0000-0000000007b2'

insert into public.organization (id, name) values (:'orgB', 'مزرعة اختبار القفل') on conflict (id) do nothing;

-- structural: the exclusion constraint exists on accounting_periods
select is(
  (select count(*)::int from pg_constraint
    where conname = 'accounting_periods_no_overlap_locked'
      and conrelid = 'public.accounting_periods'::regclass
      and contype = 'x'),
  1, '#719-2: accounting_periods carries the no-overlap-locked exclusion constraint');

-- a first locked period inserts fine
select lives_ok(
  $$ insert into public.accounting_periods (org_id, period_start, period_end, status)
     values ('00000000-0000-0000-0000-000000000001', '2025-01-01', '2025-01-31', 'locked') $$,
  '#719-2: the first locked period inserts');

-- a SECOND overlapping locked period for the SAME org is rejected (the concurrent-double-close case)
select throws_ok(
  $$ insert into public.accounting_periods (org_id, period_start, period_end, status)
     values ('00000000-0000-0000-0000-000000000001', '2025-01-15', '2025-02-15', 'locked') $$,
  '23P01',
  null,
  '#719-2: an overlapping locked period for the same org is rejected (exclusion_violation)');

-- a NON-overlapping locked period for the same org is allowed
select lives_ok(
  $$ insert into public.accounting_periods (org_id, period_start, period_end, status)
     values ('00000000-0000-0000-0000-000000000001', '2025-03-01', '2025-03-31', 'locked') $$,
  '#719-2: a non-overlapping locked period for the same org inserts');

-- the SAME overlapping range for a DIFFERENT org is allowed (org_id scoping in the exclusion)
select lives_ok(
  $$ insert into public.accounting_periods (org_id, period_start, period_end, status)
     values ('00000000-0000-0000-0000-0000000007b2', '2025-01-10', '2025-01-20', 'locked') $$,
  '#719-2: an overlapping locked period for a DIFFERENT org is allowed (org-scoped)');

-- an OPEN period overlapping a locked one is allowed (the partial WHERE status='locked' excludes it,
-- so a reopened range can be re-closed)
select lives_ok(
  $$ insert into public.accounting_periods (org_id, period_start, period_end, status)
     values ('00000000-0000-0000-0000-000000000001', '2025-01-10', '2025-01-20', 'open') $$,
  '#719-2: an OPEN period overlapping a locked one is allowed (partial index on status=locked)');

select * from finish();
rollback;
