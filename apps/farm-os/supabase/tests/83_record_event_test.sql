-- 51 — STAGE 3 (SPEC-0010): ad-hoc activity/event recording. Verifies migration 0054 — fn_record_event,
-- fn_set_event_status, fn_add_event_followup: the op.execute role gate, atomic event + location + status
-- history, the FULL ancestor-chain location (so a hawsha event rolls up to its sector + farm files), the
-- palm event_assets link, status transitions, and follow-ups. op.execute = owner/farm_manager/
-- agri_engineer/supervisor; storekeeper/accountant lack it. Impersonation via request.jwt.claims.

begin;
select plan(19);

\set org '00000000-0000-0000-0000-000000000001'
-- a hawsha + its sector (to assert the ancestor-chain roll-up), a palm, a person, and members.
select set_config('test.haw', (select id::text from public.hawshat where org_id = :'org' order by code limit 1), false);
select set_config('test.sec', (select sector_id::text from public.hawshat where id = current_setting('test.haw')::uuid), false);
select set_config('test.palm', (select id::text from public.assets where org_id = :'org' and type = 'palm' order by id limit 1), false);
select set_config('test.person', (select id::text from public.people where org_id = :'org' order by id limit 1), false);
select set_config('test.sup', (select user_id::text from public.organization_member where org_id = :'org' and role = 'supervisor' limit 1), false);
select set_config('test.sk',  (select user_id::text from public.organization_member where org_id = :'org' and role = 'storekeeper' limit 1), false);

select isnt(current_setting('test.haw'), '', 'fixture: a hawsha exists');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- ===== record an event against a hawsha as a supervisor (op.execute) =====
select pg_temp.as_user(current_setting('test.sup'));
select lives_ok(
  format($$ select set_config('test.ev',
    (public.fn_record_event('hawsha', %L, 'inspection', 'تفتيش', 'done', null, 'ارتفاع صيد سوسة', %L, 'count', 14, 'مصيدة'))->>'event_id', false) $$,
    current_setting('test.haw'), current_setting('test.person')),
  'fn_record_event: a supervisor (op.execute) can record an inspection on a hawsha');
select isnt(current_setting('test.ev'), '', 'record returned an event id');
reset role;

select is((select count(*)::int from public.farm_event where id = current_setting('test.ev')::uuid),
  1, 'the farm_event row exists');
select is((select hawsha_id::text from public.event_locations where event_id = current_setting('test.ev')::uuid),
  current_setting('test.haw'), 'event_locations carries the hawsha_id');
select is((select sector_id::text from public.event_locations where event_id = current_setting('test.ev')::uuid),
  current_setting('test.sec'), 'ROLL-UP: event_locations also carries the ancestor sector_id (appears on the sector file)');
select isnt((select farm_id::text from public.event_locations where event_id = current_setting('test.ev')::uuid), null,
  'ROLL-UP: event_locations also carries the farm_id (appears on the farm file)');
select is((select count(*)::int from public.event_status_history where event_id = current_setting('test.ev')::uuid),
  1, 'an opening event_status_history row was written atomically');
select is((select value_num from public.quantities where event_id = current_setting('test.ev')::uuid),
  14::numeric, 'the descriptive quantity was recorded');

-- ===== a non-op.execute role (storekeeper) cannot record =====
select pg_temp.as_user(current_setting('test.sk'));
select throws_ok(
  format($$ select public.fn_record_event('hawsha', %L, 'note') $$, current_setting('test.haw')),
  '42501', null, 'fn_record_event: a storekeeper (no op.execute) is FORBIDDEN');
reset role;

-- ===== validation: bad status, bad assignee =====
select pg_temp.as_user(current_setting('test.sup'));
select throws_ok(
  format($$ select public.fn_record_event('hawsha', %L, 'note', null, 'nonsense') $$, current_setting('test.haw')),
  '22023', null, 'fn_record_event: an invalid status is rejected');
select throws_ok(
  format($$ select public.fn_record_event('hawsha', %L, 'note', null, 'done', null, null, gen_random_uuid()) $$, current_setting('test.haw')),
  '22023', null, 'fn_record_event: an assignee not in the org is rejected');

-- ===== a palm event links the asset via event_assets =====
select lives_ok(
  format($$ select set_config('test.pev',
    (public.fn_record_event('palm', %L, 'operation', 'irrigation', 'done'))->>'event_id', false) $$,
    current_setting('test.palm')),
  'fn_record_event: record an operation on a single palm');
select is((select asset_id::text from public.event_assets where event_id = current_setting('test.pev')::uuid),
  current_setting('test.palm'), 'a palm event links the asset via event_assets');
-- L2: a palm event rolls up the FULL ancestor chain (hawsha→sector→farm) derived from the hawsha, so it
-- appears on the sector + farm files, not just the palm.
select ok(
  (select hawsha_id is not null and sector_id is not null and farm_id is not null
     from public.event_locations where event_id = current_setting('test.pev')::uuid),
  'ROLL-UP: a palm event carries hawsha_id + sector_id + farm_id (derived from the hawsha chain)');

-- ===== status transition: pending → done appends history atomically =====
select lives_ok(
  format($$ select public.fn_set_event_status(%L, 'in_progress', 'بدء') $$, current_setting('test.ev')),
  'fn_set_event_status: flip an event to in_progress');
reset role;
select is((select status from public.farm_event where id = current_setting('test.ev')::uuid),
  'in_progress', 'the event status changed');
select is((select count(*)::int from public.event_status_history where event_id = current_setting('test.ev')::uuid),
  2, 'a second status-history row was appended (status never flips without its audit row)');

-- ===== follow-up =====
select pg_temp.as_user(current_setting('test.sup'));
select lives_ok(
  format($$ select public.fn_add_event_followup(%L, 'إعادة الفحص بعد أسبوع') $$, current_setting('test.ev')),
  'fn_add_event_followup: schedule a follow-up');
reset role;

select * from finish();
rollback;
