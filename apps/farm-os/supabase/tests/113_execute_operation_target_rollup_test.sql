-- 113 — planned-operation execution rollup.
-- fn_execute_operation must write the same ancestor-chain event location that fn_record_event writes, so
-- executed sector/hawsha/line/palm operations show on the right 360 pages and the field dashboard.

begin;
select plan(9);

\set org '00000000-0000-0000-0000-000000000001'
\set planid 'c1130000-0000-0000-0000-000000000113'
\set secop  'c1130001-0000-0000-0000-000000000113'
\set hawop  'c1130002-0000-0000-0000-000000000113'
\set lineop 'c1130003-0000-0000-0000-000000000113'
\set palmop 'c1130004-0000-0000-0000-000000000113'

select set_config(
  'test.palm',
  (select id::text
     from public.assets
    where org_id = :'org'
      and type = 'palm'
      and line_id is not null
      and hawsha_id is not null
    order by id_tag
    limit 1),
  false);
select set_config('test.line', (select line_id::text from public.assets where id = nullif(current_setting('test.palm'), '')::uuid), false);
select set_config('test.haw', (select hawsha_id::text from public.assets where id = nullif(current_setting('test.palm'), '')::uuid), false);
select set_config('test.sec', (select sector_id::text from public.hawshat where id = nullif(current_setting('test.haw'), '')::uuid), false);
select set_config('test.sup', (select user_id::text from public.organization_member where org_id = :'org' and role = 'supervisor' limit 1), false);

select isnt(current_setting('test.palm'), '', 'fixture: palm exists');
select isnt(current_setting('test.line'), '', 'fixture: line exists');
select isnt(current_setting('test.haw'), '', 'fixture: hawsha exists');
select isnt(current_setting('test.sec'), '', 'fixture: sector exists');

-- Prove palm execution does not depend only on the palm's denormalized hawsha_id.
-- The line is still authoritative enough to recover the hawsha/sector/farm chain.
update public.assets
   set hawsha_id = null
 where id = current_setting('test.palm')::uuid
   and org_id = :'org';

insert into public.plans (id, org_id, status) values (:'planid', :'org', 'active');
insert into public.plan_operations (id, org_id, plan_id, subtype, target_type, target_id, est_cost, approval_needed, status)
values
  (:'secop',  :'org', :'planid', 'inspection', 'sector', current_setting('test.sec')::uuid, 0, false, 'ready'),
  (:'hawop',  :'org', :'planid', 'inspection', 'hawsha', current_setting('test.haw')::uuid, 0, false, 'ready'),
  (:'lineop', :'org', :'planid', 'inspection', 'line',   current_setting('test.line')::uuid, 0, false, 'ready'),
  (:'palmop', :'org', :'planid', 'inspection', 'palm',   current_setting('test.palm')::uuid, 0, false, 'ready');

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.sup'), 'role','authenticated')::text, true);
set local role authenticated;
select set_config('test.sec_ev',  (public.fn_execute_operation(:'secop',  0, 1, 'sector') ->> 'event_id'), false);
select set_config('test.haw_ev',  (public.fn_execute_operation(:'hawop',  0, 1, 'hawsha') ->> 'event_id'), false);
select set_config('test.line_ev', (public.fn_execute_operation(:'lineop', 0, 1, 'line') ->> 'event_id'), false);
select set_config('test.palm_ev', (public.fn_execute_operation(:'palmop', 0, 1, 'palm') ->> 'event_id'), false);
reset role;

select ok(
  (select sector_id::text = current_setting('test.sec') and farm_id is not null
     from public.event_locations where event_id = current_setting('test.sec_ev')::uuid),
  'sector execution writes sector_id + farm_id');
select ok(
  (select hawsha_id::text = current_setting('test.haw')
       and sector_id::text = current_setting('test.sec')
       and farm_id is not null
     from public.event_locations where event_id = current_setting('test.haw_ev')::uuid),
  'hawsha execution writes hawsha_id + sector_id + farm_id');
select ok(
  (select line_id::text = current_setting('test.line')
       and hawsha_id::text = current_setting('test.haw')
       and sector_id::text = current_setting('test.sec')
       and farm_id is not null
     from public.event_locations where event_id = current_setting('test.line_ev')::uuid),
  'line execution writes line_id + hawsha_id + sector_id + farm_id');
select ok(
  (select line_id::text = current_setting('test.line')
       and hawsha_id::text = current_setting('test.haw')
       and sector_id::text = current_setting('test.sec')
       and farm_id is not null
     from public.event_locations where event_id = current_setting('test.palm_ev')::uuid),
  'palm execution writes the ancestor location chain');
select is(
  (select asset_id::text from public.event_assets where event_id = current_setting('test.palm_ev')::uuid),
  current_setting('test.palm'),
  'palm execution links the executed event to the palm asset');

select * from finish();
rollback;
