-- Optimistic concurrency for reconciliation row review.
begin;
select plan(11);

\set orgA '00000000-0000-0000-0000-000000000001'

select set_config('t.owner', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'owner' limit 1), false);
select set_config('t.acct', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'accountant' limit 1), false);

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

insert into public.reconciliation_batches (id, org_id, status, created_by)
values ('ba160000-0000-0000-0000-000000000001', :'orgA', 'staged', current_setting('t.acct')::uuid);

insert into public.reconciliation_evidence_items (
  id, org_id, origin_kind, source_workbook_sha256, sheet_name, row_locator,
  source_identity_fingerprint, classification
) values (
  'ea160000-0000-0000-0000-000000000001', :'orgA', 'source_workbook_row', repeat('a', 64),
  'المصروفات', 'CONCURRENCY-1', 'concurrency-1', 'ambiguous_identity_group'
);

insert into public.reconciliation_batch_rows (id, org_id, batch_id, evidence_item_id)
values (
  'aa160000-0000-0000-0000-000000000001', :'orgA',
  'ba160000-0000-0000-0000-000000000001', 'ea160000-0000-0000-0000-000000000001'
);

select is(
  (select count(*)::integer from pg_trigger
    where tgrelid = 'public.reconciliation_batch_rows'::regclass
      and tgname = 'reconciliation_bump_review_version'
      and not tgisinternal),
  1, 'replay-safe migration leaves exactly one review-version trigger');

select ok(
  not has_function_privilege('authenticated',
    'public.fn_review_reconciliation_row_unversioned(uuid,jsonb)', 'EXECUTE'),
  'authenticated cannot bypass the versioned wrapper'
);
select ok(
  not has_function_privilege('anon',
    'public.fn_review_reconciliation_row_unversioned(uuid,jsonb)', 'EXECUTE'),
  'anon cannot bypass the versioned wrapper'
);

select pg_temp.as_user(current_setting('t.acct'));
select lives_ok(
  $$ select public.fn_review_reconciliation_row(
    'aa160000-0000-0000-0000-000000000001'::uuid,
    '{"action":"hold","reason":"قرار المحاسب الأول","expected_review_version":0}'::jsonb
  ) $$,
  'the first decision with version zero succeeds'
);
reset role;

select is(
  (select review_reason from public.reconciliation_batch_rows
    where id = 'aa160000-0000-0000-0000-000000000001'),
  'قرار المحاسب الأول',
  'the first decision is persisted'
);
select ok(
  (select review_version = 1 from public.reconciliation_batch_rows
    where id = 'aa160000-0000-0000-0000-000000000001'),
  'the first decision increments the monotonic version token'
);

select pg_temp.as_user(current_setting('t.owner'));
select throws_ok(
  $$ select public.fn_review_reconciliation_row(
    'aa160000-0000-0000-0000-000000000001'::uuid,
    '{"action":"reject","reason":"قرار مالك قديم","expected_review_version":0}'::jsonb
  ) $$,
  '40001', null,
  'a stale explicit token cannot overwrite the first reviewer'
);
select throws_ok(
  $$ select public.fn_review_reconciliation_row(
    'aa160000-0000-0000-0000-000000000001'::uuid,
    '{"action":"reject","reason":"عميل قديم بدون نسخة"}'::jsonb
  ) $$,
  '40001', null,
  'a tokenless old client cannot overwrite an existing decision'
);
reset role;

select is(
  (select review_state || '/' || disposition || '/' || review_reason
     from public.reconciliation_batch_rows
    where id = 'aa160000-0000-0000-0000-000000000001'),
  'reviewed/hold/قرار المحاسب الأول',
  'both stale attempts leave the first decision byte-for-byte authoritative'
);

select pg_temp.as_user(current_setting('t.owner'));
select lives_ok(
  format(
    $q$ select public.fn_review_reconciliation_row(
      'aa160000-0000-0000-0000-000000000001'::uuid,
      jsonb_build_object('action','reject','reason','تعديل مالك حديث','expected_review_version',%s)
    ) $q$,
    (select review_version::text from public.reconciliation_batch_rows
      where id = 'aa160000-0000-0000-0000-000000000001')
  ),
  'a fresh exact token permits an explicit re-review'
);
reset role;

select is(
  (select review_state || '/' || disposition || '/' || review_reason
     from public.reconciliation_batch_rows
    where id = 'aa160000-0000-0000-0000-000000000001'),
  'rejected/hold/تعديل مالك حديث',
  'the fresh re-review is persisted'
);

select * from finish();
rollback;
