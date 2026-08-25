begin;
select plan(14);

\set org '00000000-0000-0000-0000-000000000001'
select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'owner' limit 1), false);
select set_config('test.manager', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'farm_manager' limit 1), false);
select set_config('test.other', (select user_id::text from public.organization_member
  where org_id = :'org' and role <> 'owner' and user_id::text <> current_setting('test.manager') limit 1), false);

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select has_table('public', 'system_tickets', 'system_tickets exists');
select is((select relrowsecurity from pg_class where oid = 'public.system_tickets'::regclass), true, 'RLS enabled');
select is((select relforcerowsecurity from pg_class where oid = 'public.system_tickets'::regclass), true, 'RLS forced');
select policies_are('public', 'system_tickets', array['system_tickets_create', 'system_tickets_owner_update', 'system_tickets_read']);
select ok(not has_table_privilege('authenticated', 'public.system_tickets', 'DELETE'), 'tickets cannot be deleted');

select pg_temp.as_user(current_setting('test.manager'));
select lives_ok(
  format($$ insert into public.system_tickets (org_id, category, title, description)
    values (%L, 'bug', 'Test ticket', 'The page does not load correctly') $$, :'org'),
  'any organization member can submit a ticket');
select is((select count(*)::int from public.system_tickets), 1, 'submitter reads their own ticket');
select lives_ok($$ update public.system_tickets set status = 'done' $$, 'non-owner update is safely filtered by RLS');
select is((select status from public.system_tickets limit 1), 'new', 'submitter cannot change ticket status');
reset role;

select pg_temp.as_user(current_setting('test.other'));
select is((select count(*)::int from public.system_tickets), 0, 'another member cannot read the submitter ticket');
reset role;

select pg_temp.as_user(current_setting('test.owner'));
select is((select count(*)::int from public.system_tickets), 1, 'owner reads the organization queue');
select lives_ok($$ update public.system_tickets set status = 'done', resolution = 'Fixed' $$, 'owner can update workflow fields');
select throws_ok(
  $$ update public.system_tickets set title = 'Changed submission' $$,
  '42501', 'ticket submission fields are immutable', 'owner cannot rewrite the submitted request');
reset role;

select is((select count(*)::int from public.audit_log where entity_type = 'system_tickets'), 0,
  'ticket text is not copied into the shared audit log');

select * from finish();
rollback;
