-- 123 — SPEC-0027 H-A: شاشة الميزان (migration 20260701530000). Verifies the budget.write gate on
-- fn_record_scale_delivery, net = gross − crates×tare (rejecting non-positive net), the PENDING price
-- posture (no journal, total null — #1), the per-org serialized بون (increments, unique), and anon
-- lockdown. budget.write = owner/accountant (migration 0001). Impersonation as tests 114/116/122.

begin;
select plan(12);

\set org '00000000-0000-0000-0000-000000000001'
select set_config('test.owner', (select user_id::text from public.organization_member where org_id = :'org' and role = 'owner' limit 1), false);
select set_config('test.sup', (select user_id::text from public.organization_member where org_id = :'org' and role = 'supervisor' limit 1), false);
select isnt(current_setting('test.owner'), '', 'fixture: an owner exists in orgA');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- 1) gate: supervisor (no budget.write) rejected
select pg_temp.as_user(current_setting('test.sup'));
select throws_ok(
  format($$ select public.fn_record_scale_delivery(%L, 'برحي', 10, 250, 2) $$, :'org'),
  '42501', null, 'supervisor (no budget.write) cannot record a scale delivery');
reset role;

-- 2) owner records: net math + serial + pending posture
select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(
  format($$ select set_config('test.d1',
    (public.fn_record_scale_delivery(%L, 'برحي', 10, 250, 2))::text, false) $$, :'org'),
  'owner records a scale delivery (10 crates, 250kg gross, 2kg tare)');
select is( (current_setting('test.d1')::jsonb ->> 'net_kg')::numeric, 230::numeric,
  'net = gross 250 − (10×2) tare = 230');
select is(
  (select price_status from public.sales where id = (current_setting('test.d1')::jsonb ->> 'id')::uuid),
  'pending', 'the scale delivery lands as a PENDING-price sale');
select is(
  (select total from public.sales where id = (current_setting('test.d1')::jsonb ->> 'id')::uuid),
  null, 'a pending scale delivery has NULL total (#1 — never 0)');
select is(
  (select count(*)::int from public.journal_entries
    where source_type like 'sale%' and source_id = (current_setting('test.d1')::jsonb ->> 'id')::uuid),
  0, 'no journal posted by the scale event');

-- 3) serial increments per org
select lives_ok(
  format($$ select set_config('test.d2',
    (public.fn_record_scale_delivery(%L, 'برحي', 8, 200, 2))::text, false) $$, :'org'),
  'a second delivery records');
select is(
  (current_setting('test.d2')::jsonb ->> 'delivery_note_no')::int,
  (current_setting('test.d1')::jsonb ->> 'delivery_note_no')::int + 1,
  'بون serial increments by 1 per org');

-- 4) validation: non-positive net rejected
select throws_ok(
  format($$ select public.fn_record_scale_delivery(%L, 'برحي', 100, 150, 2) $$, :'org'),
  '22023', null, 'net ≤ 0 (tare 200 vs gross 150) is rejected');
select throws_ok(
  format($$ select public.fn_record_scale_delivery(%L, 'برحي', 0, 150, 2) $$, :'org'),
  '22023', null, 'zero crates rejected');
reset role;

-- 5) anon lockdown
select ok(
  not has_function_privilege('anon',
    'public.fn_record_scale_delivery(uuid, text, numeric, numeric, numeric, uuid, uuid, date, text)', 'EXECUTE'),
  'fn_record_scale_delivery is not EXECUTE-able by anon');

select * from finish();
rollback;
