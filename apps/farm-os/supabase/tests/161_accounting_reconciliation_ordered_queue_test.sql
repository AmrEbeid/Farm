-- Canonical, bounded reconciliation review queue ordering.
begin;
select no_plan();

\set orgA '00000000-0000-0000-0000-000000000001'
\set batchA 'b1610000-0000-0000-0000-000000000001'
\set orgB 'b1610000-0000-0000-0000-000000000002'
\set batchB 'b1610000-0000-0000-0000-000000000002'

select set_config('t.owner', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'owner' limit 1), false);
select set_config('t.acct', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'accountant' limit 1), false);
select set_config('t.sup', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'supervisor' limit 1), false);

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create or replace function pg_temp.as_superuser() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
end $$;

insert into public.reconciliation_batches (id, org_id, status, created_by)
values (:'batchA', :'orgA', 'staged', current_setting('t.acct')::uuid);

insert into public.organization (id, name) values (:'orgB', 'مزرعة أخرى لاختبار العزل');
insert into public.reconciliation_batches (id, org_id, status, created_by)
values (:'batchB', :'orgB', 'staged', current_setting('t.owner')::uuid);

insert into public.expenses (id, org_id, category, total, kind)
values ('d1610000-0000-0000-0000-000000000001', :'orgA', 'هدف تصحيح للاختبار', 20, 'operating');
insert into public.sales (id, org_id, sale_date, crop, qty, unit)
values ('c1610000-0000-0000-0000-000000000001', :'orgA', '2026-08-08', 'هدف تصحيح بيع', 1, 'كجم');

insert into public.reconciliation_evidence_items (
  id, org_id, origin_kind, source_workbook_sha256, sheet_name, row_locator,
  source_identity_fingerprint, source_amount, classification, invalid_calendar_quality_flag
) values
  ('e1610000-0000-0000-0000-000000000001', :'orgA', 'source_workbook_row', repeat('a',64),
   'المصروفات', '2',  'ordered-1', 20, 'source_addition_candidate', false),
  ('e1610000-0000-0000-0000-000000000002', :'orgA', 'source_workbook_row', repeat('a',64),
   'المصروفات', '10', 'ordered-2', 100, 'source_addition_candidate', true),
  -- A different workbook may legitimately expose the same human locator; the evidence UUID then
  -- supplies the comparator's final total-order tiebreak without violating workbook-position UNIQUE.
  ('e1610000-0000-0000-0000-000000000004', :'orgA', 'source_workbook_row', repeat('c',64),
   'المصروفات', '2',  'ordered-4', 40, 'source_addition_candidate', false),
  ('e1610000-0000-0000-0000-000000000005', :'orgA', 'source_workbook_row', repeat('a',64),
   'المصروفات', '02', 'ordered-5', null, 'source_addition_candidate', false);

insert into public.reconciliation_evidence_items (
  id, org_id, origin_kind, production_snapshot_sha256, snapshot_target_table, snapshot_target_id,
  source_identity_fingerprint, source_amount, classification, invalid_calendar_quality_flag
) values (
  'e1610000-0000-0000-0000-000000000003', :'orgA', 'production_snapshot_row', repeat('b',64),
  'expenses', '00000000-0000-4000-8000-000000000003', 'ordered-3', null,
  'production_orphan_candidate', false
);

insert into public.reconciliation_batch_rows (
  id, org_id, batch_id, evidence_item_id, review_state, disposition,
  reviewer_id, reviewed_at, review_reason, frozen, frozen_at
) values
  ('a1610000-0000-0000-0000-000000000001', :'orgA', :'batchA',
   'e1610000-0000-0000-0000-000000000001', 'unreviewed', 'hold', null, null, null, false, null),
  ('a1610000-0000-0000-0000-000000000002', :'orgA', :'batchA',
   'e1610000-0000-0000-0000-000000000002', 'rejected', 'hold', current_setting('t.acct')::uuid,
   now(), 'مرفوض للاختبار', false, null),
  ('a1610000-0000-0000-0000-000000000003', :'orgA', :'batchA',
   'e1610000-0000-0000-0000-000000000003', 'reviewed', 'hold', current_setting('t.acct')::uuid,
   now(), 'معلّق ومجمّد للاختبار', true, now()),
  ('a1610000-0000-0000-0000-000000000004', :'orgA', :'batchA',
   'e1610000-0000-0000-0000-000000000004', 'reviewed', 'hold', current_setting('t.acct')::uuid,
   now(), 'معلّق للاختبار', false, null),
  ('a1610000-0000-0000-0000-000000000005', :'orgA', :'batchA',
   'e1610000-0000-0000-0000-000000000005', 'reviewed', 'hold', current_setting('t.acct')::uuid,
   now(), 'مبلغ مفقود', false, null);

-- A held correction may carry its immutable target summary without becoming an executable include.
update public.reconciliation_evidence_items
   set classification = 'amount_correction_candidate'
 where id in (
   'e1610000-0000-0000-0000-000000000001',
   'e1610000-0000-0000-0000-000000000002',
   'e1610000-0000-0000-0000-000000000004'
 );
update public.reconciliation_batch_rows
   set target_table = 'expenses',
       corrects_expense_id = 'd1610000-0000-0000-0000-000000000001'
 where id = 'a1610000-0000-0000-0000-000000000001';
update public.reconciliation_batch_rows
   set target_table = 'sales',
       corrects_sale_id = 'c1610000-0000-0000-0000-000000000001'
 where id = 'a1610000-0000-0000-0000-000000000002';

-- Catalog and least-privilege contract.
select is(
  (select p.provolatile::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fn_reconciliation_queue_page'),
  's', 'queue page is STABLE');
select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fn_reconciliation_queue_page'),
  false, 'queue page is SECURITY INVOKER');
select ok(
  (select p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fn_reconciliation_queue_page')
   @> array['search_path=""']::text[],
  'queue page locks search_path');
select ok(has_function_privilege('authenticated',
  'public.fn_reconciliation_queue_page(uuid,uuid,text,text,text,integer,integer)', 'EXECUTE'),
  'authenticated can execute queue page');
select ok(not has_function_privilege('anon',
  'public.fn_reconciliation_queue_page(uuid,uuid,text,text,text,integer,integer)', 'EXECUTE'),
  'anon cannot execute queue page');
select ok(has_function_privilege('authenticated',
  'private.fn_reconciliation_natural_sort_key(text)', 'EXECUTE'),
  'authenticated can execute the pure sort helper required by the invoker RPC');
select ok(not has_function_privilege('anon',
  'private.fn_reconciliation_natural_sort_key(text)', 'EXECUTE'),
  'anon cannot execute the private sort helper');

-- Natural ordering mirrors compareLocatorText, including numeric value, zero padding and segments.
select is(
  (select array_agg(v order by private.fn_reconciliation_natural_sort_key(v))
     from unnest(array['10','2','02','R10','R2']) v),
  array['2','02','10','R2','R10'],
  'natural helper orders 2 before zero-padded 02 before 10 and handles later digit runs');
select is(
  (select array_agg(v order by private.fn_reconciliation_natural_sort_key(v))
     from unnest(array[pg_catalog.chr(57344), pg_catalog.chr(128512)]) v),
  array[pg_catalog.chr(128512), pg_catalog.chr(57344)],
  'text runs follow JavaScript UTF-16 code-unit order for supplementary characters');

select pg_temp.as_user(current_setting('t.acct'));
select set_config('t.page1', (select public.fn_reconciliation_queue_page(
  :'orgA', :'batchA', null, null, null, 1, 2)::text), false);
select is(current_setting('t.page1')::jsonb ->> 'status', 'ok',
  'accountant can read the queue');
select is((current_setting('t.page1')::jsonb ->> 'total')::int, 5,
  'unfiltered total is exact');
select is(current_setting('t.page1')::jsonb -> 'counts',
  '{"total":5,"unreviewed":1,"included":0,"held":3,"rejected":1,"frozen":1,"executed":0}'::jsonb,
  'the same snapshot carries exact whole-batch KPI counts');
select is((select pg_catalog.jsonb_agg(row_value -> 'id')
             from pg_catalog.jsonb_array_elements(current_setting('t.page1')::jsonb -> 'rows') row_value),
  '["a1610000-0000-0000-0000-000000000001","a1610000-0000-0000-0000-000000000004"]'::jsonb,
  'page one uses locator order and evidence UUID as the total-order tiebreak');
select is(
  (select pg_catalog.jsonb_agg(row_value -> 'id') from pg_catalog.jsonb_array_elements(
    public.fn_reconciliation_queue_page(:'orgA', :'batchA', null, null, null, 2, 2) -> 'rows') row_value),
  '["a1610000-0000-0000-0000-000000000005","a1610000-0000-0000-0000-000000000002"]'::jsonb,
  'page two preserves 02 before 10');
select is(
  (select pg_catalog.jsonb_agg(row_value -> 'id') from pg_catalog.jsonb_array_elements(
    public.fn_reconciliation_queue_page(:'orgA', :'batchA', null, null, null, 3, 2) -> 'rows') row_value),
  '["a1610000-0000-0000-0000-000000000003"]'::jsonb,
  'production snapshot rows follow workbook rows');
select is(current_setting('t.page1')::jsonb -> 'rows' -> 0 -> 'evidence' ->> 'id',
  'e1610000-0000-0000-0000-000000000001',
  'the ordered page carries its display evidence in the same database snapshot');
select is(current_setting('t.page1')::jsonb -> 'rows' -> 0 -> 'correction_expense' ->> 'id',
  'd1610000-0000-0000-0000-000000000001',
  'the ordered page carries its correction target summary in the same database snapshot');
select is((public.fn_reconciliation_queue_page(
  :'orgA', :'batchA', null, null, null, 99, 2) ->> 'page')::int, 3,
  'an oversized requested page clamps to the real final page');

select is((public.fn_reconciliation_queue_page(
  :'orgA', :'batchA', 'production_orphan_candidate', null, null, 1, 50) ->> 'total')::int,
  1, 'classification filter has an exact total');
select is((public.fn_reconciliation_queue_page(
  :'orgA', :'batchA', 'production_orphan_candidate', null, null, 1, 50) -> 'counts' ->> 'total')::int,
  5, 'whole-batch KPI counts remain independent of queue filters');
select is((public.fn_reconciliation_queue_page(
  :'orgA', :'batchA', null, 'held', null, 1, 50) ->> 'total')::int,
  3, 'held state filter mirrors the review queue predicate');
select is((public.fn_reconciliation_queue_page(
  :'orgA', :'batchA', null, 'frozen', null, 1, 50) ->> 'total')::int,
  1, 'frozen state filter uses the frozen flag');
select is((public.fn_reconciliation_queue_page(
  :'orgA', :'batchA', null, null, 'invalid_source_date', 1, 50) ->> 'total')::int,
  1, 'invalid-date quality filter is exact');
select is((public.fn_reconciliation_queue_page(
  :'orgA', :'batchA', null, null, 'missing_source_amount', 1, 50) ->> 'total')::int,
  2, 'missing-amount quality filter distinguishes null from zero');
select is((public.fn_reconciliation_queue_page(
  :'orgA', :'batchA', null, null, 'unlinked_correction', 1, 50) ->> 'total')::int,
  1, 'unlinked-correction quality filter excludes corrections with expense or sale targets');
select is(
  (public.fn_reconciliation_queue_page(
    :'orgA', :'batchA', null, null, 'unlinked_correction', 1, 50) -> 'rows' -> 0 ->> 'id'),
  'a1610000-0000-0000-0000-000000000004',
  'unlinked-correction quality filter returns the correction with neither target');
select is((public.fn_reconciliation_queue_page(
  :'orgA', :'batchA', 'production_orphan_candidate', null, 'unlinked_correction', 1, 50) ->> 'total')::int,
  0, 'contradictory classification and unlinked-correction filters compose to an empty queue');
select pg_temp.as_superuser();

select pg_temp.as_user(current_setting('t.owner'));
select is((public.fn_reconciliation_queue_page(
  :'orgA', :'batchA', null, 'unreviewed', null, 1, 50) ->> 'total')::int,
  1, 'owner can read the queue');
select is(public.fn_reconciliation_queue_page(
  :'orgA', :'batchB', null, null, null, 1, 50) ->> 'status',
  'not_found', 'a real batch from another organization is not_found under the active organization');
select throws_ok(format(
  'select public.fn_reconciliation_queue_page(%L,%L,null,null,null,1,50)', :'orgB', :'batchB'),
  '42501', null, 'a finance user cannot select an organization where they have no membership');
select pg_temp.as_superuser();

select pg_temp.as_user(current_setting('t.sup'));
select throws_ok(format(
  'select public.fn_reconciliation_queue_page(%L,%L,null,null,null,1,50)', :'orgA', :'batchA'),
  '42501', null, 'non-finance role is denied');
select pg_temp.as_superuser();

set local role anon;
select throws_ok(format(
  'select public.fn_reconciliation_queue_page(%L,%L,null,null,null,1,50)', :'orgA', :'batchA'),
  '42501', null, 'anon is denied');
reset role;

-- Realistic queue volume: prove the response remains exactly one bounded page at the canonical 698 rows.
select pg_temp.as_superuser();
with inserted_evidence as (
  insert into public.reconciliation_evidence_items (
    id, org_id, origin_kind, source_workbook_sha256, sheet_name, row_locator,
    source_identity_fingerprint, source_amount, classification, invalid_calendar_quality_flag
  )
  select
    pg_catalog.gen_random_uuid(), :'orgA', 'source_workbook_row', repeat('d',64), 'volume',
    g::text, 'ordered-volume-' || g::text, 1, 'source_addition_candidate', false
  from pg_catalog.generate_series(1, 693) g
  returning id
)
insert into public.reconciliation_batch_rows (
  id, org_id, batch_id, evidence_item_id, review_state, disposition, frozen
)
select pg_catalog.gen_random_uuid(), :'orgA', :'batchA', id, 'unreviewed', 'hold', false
from inserted_evidence;

select pg_temp.as_user(current_setting('t.acct'));
select is((public.fn_reconciliation_queue_page(
  :'orgA', :'batchA', null, null, null, 1, 50) ->> 'total')::int,
  698, 'realistic queue volume returns the exact 698-row total');
select is(public.fn_reconciliation_queue_page(
  :'orgA', :'batchA', null, null, null, 1, 50) -> 'counts',
  '{"total":698,"unreviewed":694,"included":0,"held":3,"rejected":1,"frozen":1,"executed":0}'::jsonb,
  'realistic queue volume returns exact whole-batch KPI counts in the same response');
select is(pg_catalog.jsonb_array_length(public.fn_reconciliation_queue_page(
  :'orgA', :'batchA', null, null, null, 1, 50) -> 'rows'),
  50, 'realistic queue volume still returns only the fixed 50-row page');
select throws_ok(format(
  'select public.fn_reconciliation_queue_page(%L,%L,%L,null,null,1,50)',
  :'orgA', :'batchA', 'not-a-classification'),
  '22023', null, 'unknown classification is rejected');
select throws_ok(format(
  'select public.fn_reconciliation_queue_page(%L,%L,null,%L,null,1,50)',
  :'orgA', :'batchA', 'not-a-state'),
  '22023', null, 'unknown state is rejected');
select throws_ok(format(
  'select public.fn_reconciliation_queue_page(%L,%L,null,null,%L,1,50)',
  :'orgA', :'batchA', 'not-a-quality'),
  '22023', null, 'unknown quality is rejected');
select throws_ok(format(
  'select public.fn_reconciliation_queue_page(%L,%L,null,null,null,0,50)', :'orgA', :'batchA'),
  '22023', null, 'zero page is rejected');
select throws_ok(format(
  'select public.fn_reconciliation_queue_page(%L,%L,null,null,null,1,51)', :'orgA', :'batchA'),
  '22023', null, 'limit above 50 is rejected');
select pg_temp.as_superuser();

select * from finish();
rollback;
