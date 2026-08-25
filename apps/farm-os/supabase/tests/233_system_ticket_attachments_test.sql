begin;
select plan(38);

\set org '00000000-0000-0000-0000-000000000001'
\set ticket 'a1000000-0000-0000-0000-000000000001'
\set foreign_org '00000000-0000-0000-0000-000000000099'
\set foreign_ticket 'a1000000-0000-0000-0000-000000000099'
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

insert into public.organization(id, name) values (:'foreign_org', 'Attachment isolation organization');
insert into public.system_tickets(id, org_id, created_by, category, title, description)
values (:'foreign_ticket', :'foreign_org', null, 'bug', 'Foreign ticket', 'Must remain isolated from Ebeid Farm');

select has_table('public', 'system_ticket_attachments', 'ticket attachments table exists');
select is((select relrowsecurity from pg_class where oid = 'public.system_ticket_attachments'::regclass), true, 'RLS enabled');
select is((select relforcerowsecurity from pg_class where oid = 'public.system_ticket_attachments'::regclass), true, 'RLS forced');
select policies_are('public', 'system_ticket_attachments', array[
  'system_ticket_attachments_create', 'system_ticket_attachments_read'
]);
select ok(has_table_privilege('authenticated', 'public.system_ticket_attachments', 'SELECT'), 'authenticated can select');
select ok(has_table_privilege('authenticated', 'public.system_ticket_attachments', 'INSERT'), 'authenticated can insert');
select ok(not has_table_privilege('authenticated', 'public.system_ticket_attachments', 'UPDATE'), 'attachments are immutable');
select ok(not has_table_privilege('authenticated', 'public.system_ticket_attachments', 'DELETE'), 'attachments cannot be deleted');
select ok(not has_table_privilege('anon', 'public.system_ticket_attachments', 'SELECT'), 'anonymous cannot read metadata');
select has_index('public', 'system_ticket_attachments', 'system_ticket_attachments_creator_created_idx',
  'attachment creator foreign key has a covering index');

select pg_temp.as_user(current_setting('test.manager'));
insert into public.system_tickets(id, org_id, category, title, description)
values (:'ticket', :'org', 'bug', 'Screenshot test', 'The page displays an unexpected error');
select lives_ok(
  format($$ insert into public.system_ticket_attachments
    (org_id, ticket_id, storage_path, file_name, content_type, size_bytes)
    values (%L, %L, %L, 'error screenshot.png', 'image/png', 12345) $$,
    :'org', :'ticket', :'org' || '/' || :'ticket' || '/a2000000-0000-4000-8000-000000000001.png'),
  'submitter can attach a permitted screenshot');
select is((select count(*)::int from public.system_ticket_attachments), 1, 'submitter reads own attachment');
select throws_ok(
  format($$ insert into public.system_ticket_attachments
    (org_id, ticket_id, storage_path, file_name, content_type, size_bytes)
    values (%L, %L, %L, 'script.svg', 'image/svg+xml', 100) $$,
    :'org', :'ticket', :'org' || '/' || :'ticket' || '/a2000000-0000-4000-8000-000000000002.svg'),
  '23514', null, 'executable SVG content is rejected');
select throws_ok(
  format($$ insert into public.system_ticket_attachments
    (org_id, ticket_id, storage_path, file_name, content_type, size_bytes)
    values (%L, %L, %L, 'large.pdf', 'application/pdf', 26214401) $$,
    :'org', :'ticket', :'org' || '/' || :'ticket' || '/a2000000-0000-4000-8000-000000000003.pdf'),
  '23514', null, 'files above 25 MB are rejected');
select throws_ok(
  format($$ insert into public.system_ticket_attachments
    (org_id, ticket_id, storage_path, file_name, content_type, size_bytes)
    values (%L, %L, %L, 'mismatch.jpg', 'image/png', 100) $$,
    :'org', :'ticket', :'org' || '/' || :'ticket' || '/a2000000-0000-4000-8000-000000000006.jpg'),
  '23514', null, 'metadata content type must match the exact object extension');

select lives_ok(
  format($$ insert into storage.objects(bucket_id, name) values ('support-attachments', %L) $$,
    :'org' || '/' || :'ticket' || '/a2000000-0000-4000-8000-000000000001.png'),
  'submitter can upload an object to their ticket folder');
select is((select count(*)::int from storage.objects), 1, 'submitter reads their ticket object');
select lives_ok(
  $$ delete from storage.objects where name like '%000000000001.png' $$,
  'deleting a registered object is safely filtered');
select is((select count(*)::int from storage.objects), 1, 'registered object remains immutable');
select lives_ok(
  format($$ insert into storage.objects(bucket_id, name) values ('support-attachments', %L) $$,
    :'org' || '/' || :'ticket' || '/a2000000-0000-4000-8000-000000000007.pdf'),
  'submitter can upload a second unregistered object');
select lives_ok(
  $$ delete from storage.objects where name like '%000000000007.pdf' $$,
  'submitter can clean an object whose metadata registration failed');
select is((select count(*)::int from storage.objects), 1, 'cleanup removes only the unregistered object');
select throws_ok(
  format($$ insert into storage.objects(bucket_id, name) values ('support-attachments', %L) $$,
    :'foreign_org' || '/' || :'foreign_ticket' || '/a2000000-0000-4000-8000-000000000008.pdf'),
  '42501', null, 'submitter cannot upload into another organization');
select throws_ok(
  $$ insert into storage.objects(bucket_id, name)
    values ('support-attachments', 'not-a-uuid/not-a-ticket/file.pdf') $$,
  '42501', null, 'malformed storage paths fail closed');
reset role;

select pg_temp.as_user(current_setting('test.other'));
select is((select count(*)::int from public.system_ticket_attachments), 0, 'another member cannot read attachment metadata');
select is((select count(*)::int from storage.objects), 0, 'another member cannot read ticket objects');
select throws_ok(
  format($$ insert into public.system_ticket_attachments
    (org_id, ticket_id, storage_path, file_name, content_type, size_bytes)
    values (%L, %L, %L, 'foreign.pdf', 'application/pdf', 100) $$,
    :'org', :'ticket', :'org' || '/' || :'ticket' || '/a2000000-0000-4000-8000-000000000004.pdf'),
  '42501', null, 'another member cannot attach to the request');
select throws_ok(
  format($$ insert into storage.objects(bucket_id, name) values ('support-attachments', %L) $$,
    :'org' || '/' || :'ticket' || '/a2000000-0000-4000-8000-000000000009.pdf'),
  '42501', null, 'another member cannot upload into the request folder');
reset role;

select pg_temp.as_user(current_setting('test.owner'));
select is((select count(*)::int from public.system_ticket_attachments), 1, 'owner reads organization ticket attachments');
select is((select count(*)::int from storage.objects), 1, 'owner reads organization ticket objects');
select lives_ok(
  format($$ insert into public.system_ticket_attachments
    (org_id, ticket_id, storage_path, file_name, content_type, size_bytes)
    values (%L, %L, %L, 'owner note.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 500) $$,
    :'org', :'ticket', :'org' || '/' || :'ticket' || '/a2000000-0000-4000-8000-000000000005.docx'),
  'owner can add a document to the request');
select lives_ok(
  format($$ insert into storage.objects(bucket_id, name) values ('support-attachments', %L) $$,
    :'org' || '/' || :'ticket' || '/a2000000-0000-4000-8000-000000000005.docx'),
  'owner can upload a document to the request folder');
select is((select count(*)::int from storage.objects), 2, 'owner sees both ticket objects');
reset role;

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
select is((select count(*)::int from storage.objects), 0, 'anonymous users cannot read support objects');
select throws_ok(
  format($$ insert into storage.objects(bucket_id, name) values ('support-attachments', %L) $$,
    :'org' || '/' || :'ticket' || '/a2000000-0000-4000-8000-000000000010.pdf'),
  '42501', null, 'anonymous users cannot upload support objects');
reset role;

select is((select count(*)::int from public.system_ticket_attachments), 2, 'two attachment rows persist for the ticket');
select is((select count(*)::int from public.audit_log where entity_type = 'system_ticket_attachments'), 0,
  'attachment names are not copied into the shared audit log');
select is((select count(*)::int from public.system_ticket_attachments
  where storage_path not like org_id::text || '/' || ticket_id::text || '/%'), 0,
  'every metadata path is bound to its organization and ticket');

select * from finish();
rollback;
