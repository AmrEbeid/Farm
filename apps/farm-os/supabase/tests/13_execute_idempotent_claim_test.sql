-- 13 — EXE-1: the operation-execute path is idempotent at the claim boundary.
--
-- executeOperation (app/(app)/m/execute/[opId]/actions.ts) is a server action = a POST
-- endpoint, so a double-submit / network retry / concurrent call bypasses the page's
-- "hide form when done" guard. Before the fix it read the op with no status precondition
-- and flipped status -> done unconditionally at the END, so a re-entry re-ran the whole
-- issue/release path (double stock loss, over-release, duplicate `done` event).
--
-- The fix is "claim-first": flip status -> done as the FIRST write, guarded by
-- `status <> 'done'`, and abort if no row comes back — exactly the predicate asserted
-- here. This pins that a second claim of the same op affects zero rows, so the action
-- returns "already executed" before touching stock. Run via `supabase test db`.

begin;
select plan(3);

\set orgA '00000000-0000-0000-0000-000000000001'

-- a planned (not-done) op in orgA, and an orgA member to act as (org-scoped RLS)
select set_config('test.op',
  (select id::text from public.plan_operations
     where org_id = :'orgA' and status <> 'done' limit 1), false);
select set_config('test.owner',
  (select user_id::text from public.organization_member
     where org_id = :'orgA' and role = 'owner' limit 1), false);

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;

-- precondition: the seed actually has a claimable op
select isnt(current_setting('test.op'), '',
  'EXE-1: a not-done plan_operation exists in the pristine seed to claim');

-- 1st claim: flips -> done, affecting exactly one row (this caller "wins").
-- The data-modifying CTE must be top-level, so capture the affected count via set_config.
with c as (
  update public.plan_operations set status = 'done'
  where id = current_setting('test.op')::uuid and status <> 'done'
  returning 1)
select set_config('test.claim1', (select count(*) from c)::text, false);

select is(current_setting('test.claim1')::int, 1,
  'EXE-1: the first claim wins (1 row updated) — the executor proceeds');

-- 2nd claim (the double-submit / retry): the guard returns NO row, so the action
-- aborts with "already executed" BEFORE any issue/release — no double stock movement.
with c as (
  update public.plan_operations set status = 'done'
  where id = current_setting('test.op')::uuid and status <> 'done'
  returning 1)
select set_config('test.claim2', (select count(*) from c)::text, false);

select is(current_setting('test.claim2')::int, 0,
  'EXE-1: a second claim is rejected (0 rows) — re-execution is blocked');

reset role;
select * from finish();
rollback;
