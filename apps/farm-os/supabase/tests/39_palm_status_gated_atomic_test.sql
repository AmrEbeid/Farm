-- 39 — PALM-STATUS-1 (#238): fn_update_palm_status gates a palm status change behind the FIELD
-- roles (op.execute) IN THE DATABASE and runs the status UPDATE + the history INSERT atomically
-- (migration 0039).
--
-- THE BUG. updatePalmStatus enforced the field-role gate ONLY in the app (requireRole). The
-- underlying `assets` UPDATE RLS (tenant_all, migration 0003) is ORG-SCOPED ONLY — no role gate —
-- so any org member (accountant/storekeeper) could change a tree's status via direct PostgREST.
-- And it did TWO non-atomic writes (assets UPDATE, then palm_status_history INSERT): a history
-- failure after the status flip left the status changed with NO audit trail. fn_update_palm_status
-- moves the op.execute gate into the DB (scoped to the asset's org) and runs both writes in ONE
-- transaction so a history failure rolls the status change back.
--
-- Asserts: (grants) anon cannot EXECUTE, authenticated CAN (the legitimate op.execute gate);
-- (a) an op.execute role (supervisor) CAN flip the status + an audit row is written; (b) a
-- non-op.execute role (accountant) is refused 42501 and the status is UNCHANGED; (c) ATOMICITY —
-- a forced history-insert failure raises and the assets.status did NOT change.
-- Run via `supabase test db`.

begin;
select plan(9);

\set orgA '00000000-0000-0000-0000-000000000001'
\set palm '540c1dd2-ca9b-5e21-ad78-59969881e488'

-- ===== grants (migration 0039 lockdown): anon must NOT execute; authenticated MUST =====
select ok(not has_function_privilege('anon',
  'public.fn_update_palm_status(uuid,text,text)', 'EXECUTE'),
  '0039: anon cannot EXECUTE fn_update_palm_status');
select ok(has_function_privilege('authenticated',
  'public.fn_update_palm_status(uuid,text,text)', 'EXECUTE'),
  '0039: authenticated CAN EXECUTE fn_update_palm_status (the legitimate op.execute gate)');

-- actors: supervisor HAS op.execute (a field role); accountant does NOT (negative authz case).
select set_config('t.sup', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'supervisor' limit 1), false);
select set_config('t.acc', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'accountant' limit 1), false);
select set_config('t.palm', :'palm', false);

-- known baseline status for the seed palm.
update public.assets set status = 'active' where id = :'palm';

-- ===== (a) an op.execute role (supervisor) CAN change the status + writes a history row =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.sup'), 'role','authenticated')::text, true);
set local role authenticated;
select set_config('t.res',
  public.fn_update_palm_status(:'palm', 'sick', 'مريضة بعد الفحص')::text, false);
reset role;

select is((current_setting('t.res')::jsonb)->>'status', 'sick',
  'PALM-STATUS: an op.execute role (supervisor) CAN change the status (RPC returns the new status)');
select is((select status from public.assets where id = :'palm'), 'sick',
  'PALM-STATUS: the assets.status was actually flipped to sick');
select is((select count(*) from public.palm_status_history
  where asset_id = :'palm' and status = 'sick' and reason = 'مريضة بعد الفحص'),
  1::bigint, 'PALM-STATUS: a history audit row was written for the change');

-- ===== (b) a non-op.execute role (accountant) is refused 42501 + the status is UNCHANGED =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.acc'), 'role','authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select public.fn_update_palm_status('%s'::uuid, 'dead', 'x') $$,
    current_setting('t.palm', true)),
  '42501', null,
  'PALM-AUTHZ: an accountant (no op.execute) is refused by fn_update_palm_status');
reset role;
select is((select status from public.assets where id = :'palm'), 'sick',
  'PALM-AUTHZ: the refused change left the status UNCHANGED (still sick)');

-- ===== (c) ATOMICITY: force the history insert to fail; the status flip must roll back with it. ==
-- A BEFORE INSERT trigger makes the palm_status_history insert raise (simulating a NOT NULL /
-- constraint failure). fn_update_palm_status flips assets.status FIRST, THEN inserts the history,
-- so the raise rolls the whole function back — the status must NOT change.
create function public.tmp_block_history() returns trigger language plpgsql as $f$
begin
  raise exception 'forced history failure' using errcode = '23502';
end $f$;
create trigger tmp_block_history before insert on public.palm_status_history
  for each row execute function public.tmp_block_history();

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.sup'), 'role','authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select public.fn_update_palm_status('%s'::uuid, 'dead', 'x') $$,
    current_setting('t.palm', true)),
  '23502', null,
  'PALM-ATOMIC: a failing history insert raises (the status flip is rolled back with it)');
reset role;
select is((select status from public.assets where id = :'palm'), 'sick',
  'PALM-ATOMIC: the status did NOT change when the history insert failed (atomic)');

drop trigger tmp_block_history on public.palm_status_history;
drop function public.tmp_block_history();

select * from finish();
rollback;
