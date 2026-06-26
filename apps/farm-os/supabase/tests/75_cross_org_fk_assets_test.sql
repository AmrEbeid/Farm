-- 75 — #306: the two cross-org FKs the registry sweep missed (surfaced by the test-74 review, both
-- proven exploitable). 0073 gates event_assets.asset_id (RLS) and assets.parent_id (trigger, self-ref).
-- A member cannot link an event to a FOREIGN asset, nor give an asset a FOREIGN parent; same-org is fine.
-- assets writes need op.execute, so the actor is an owner. orgB + its asset, an orgA event + asset are
-- seeded as superuser. Impersonation via request.jwt.claims.
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(5);

\set orgA  '00000000-0000-0000-0000-000000000001'
\set orgB  '07400000-0000-0000-0000-0000000000b0'
\set evA   '07400000-0000-0000-0000-0000000000e1'
\set astA  '07400000-0000-0000-0000-0000000000a1'
\set astB  '07400000-0000-0000-0000-0000000000b1'

select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'owner' limit 1), false);

insert into public.organization (id, name) values (:'orgB', 'مزرعة تاسعة');
insert into public.farm_event (id, org_id, type, occurred_at)
  values (:'evA', :'orgA', 'note', '2026-01-01T00:00:00Z');
insert into public.assets (id, org_id) values (:'astA', :'orgA'), (:'astB', :'orgB');

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;

-- event_assets.asset_id: a member cannot attach a CROSS-ORG asset to their event
select throws_ok(
  format($$ insert into public.event_assets (org_id, event_id, asset_id) values (%L, %L, %L) $$,
         :'orgA', :'evA', :'astB'),
  '42501', null, '#306: event_assets cannot reference a CROSS-ORG asset');

-- ...but a same-org asset is fine
select lives_ok(
  format($$ insert into public.event_assets (org_id, event_id, asset_id) values (%L, %L, %L) $$,
         :'orgA', :'evA', :'astA'),
  '#306: event_assets CAN reference a same-org asset');

-- assets.parent_id: a member cannot give their asset a CROSS-ORG parent (the trigger)
select throws_ok(
  format($$ insert into public.assets (org_id, parent_id) values (%L, %L) $$, :'orgA', :'astB'),
  '42501', null, '#306: an asset cannot have a CROSS-ORG parent (trigger)');

-- ...but a same-org parent is fine
select lives_ok(
  format($$ insert into public.assets (org_id, parent_id) values (%L, %L) $$, :'orgA', :'astA'),
  '#306: an asset CAN have a same-org parent');

reset role;

select is(
  (select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'assets' and t.tgname = 'assets_parent_same_org' and not t.tgisinternal),
  1,
  '#306: the assets_parent_same_org trigger is present');

select * from finish();
rollback;
