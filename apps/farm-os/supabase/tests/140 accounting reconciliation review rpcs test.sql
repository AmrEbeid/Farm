-- Accounting reconciliation — slice 3 (migration 20260726120000). Validates the four staging/review/
-- freeze/approve RPCs: anon/farm-manager/cross-org denial; owner+accountant review; idempotent replay and
-- conflicting-identity reject; malformed / bounded / count-mismatch / no-partial staging; review→freeze→
-- approve state transitions; immutable freeze + deterministic server hash; owner-only approve with
-- separation of duties; real two-backend identical-stage and review/freeze races; and — the money
-- boundary — every financial table's row count is unchanged and the slice-1B execution tables stay empty.
-- Impersonation via request.jwt.claims (harness pattern from tests
-- 82/97/102). Run via test-shims/run-pgtap-local.sh (superuser fixtures bypass RLS by design — FORCE RLS
-- itself is checked against the remote project per the farm-os skill's documented harness caveat).

begin;
select no_plan();

\set orgA '00000000-0000-0000-0000-000000000001'
\set orgB 'acdd0001-0000-0000-0000-000000000002'
\set userB 'acdd0002-0000-0000-0000-000000000002'

-- ── fixtures (superuser, RLS-bypassing) ──────────────────────────────────────────────────────────────
select set_config('t.owner', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'owner' limit 1), false);
select set_config('t.acct', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'accountant' limit 1), false);
select set_config('t.fm', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'farm_manager' limit 1), false);
select set_config('t.store', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'storekeeper' limit 1), false);
select set_config('t.account_id', (
  select a.id::text
  from public.accounts a
  where a.org_id = :'orgA'
    and a.active
    and a.kind = 'operating'
    and not exists (
      select 1 from public.accounts child
      where child.org_id = a.org_id and child.parent_id = a.id and child.active
    )
  order by a.code
  limit 1
), false);

insert into public.organization (id, name) values (:'orgB', 'مزرعة أخرى — slice3 test');
insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
  values (:'userB', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());
insert into public.organization_member (org_id, user_id, role) values (:'orgB', :'userB', 'accountant');

-- Same-org correction targets used to exercise both successful correction review branches.
insert into public.expenses (id, org_id, date, category, description, total, status, kind)
  values ('a7100000-0000-0000-0000-000000000001', :'orgA', current_date,
          'مرجع تصحيح', 'مرجع اختبار فقط', 1, 'approved', 'operating');
insert into public.sales (id, org_id, sale_date, crop, qty, unit_price, total, price_status)
  values ('a7200000-0000-0000-0000-000000000001', :'orgA', current_date,
          'مرجع تصحيح', 1, 1, 1, 'finalized');
select set_config('t.expense_correction_id', 'a7100000-0000-0000-0000-000000000001', false);
select set_config('t.sale_correction_id', 'a7200000-0000-0000-0000-000000000001', false);

-- capture the pre-flight financial baseline: NOTHING these RPCs do may change any of these.
select set_config('t.exp0',   (select count(*)::text from public.expenses), false);
select set_config('t.sale0',  (select count(*)::text from public.sales), false);
select set_config('t.je0',    (select count(*)::text from public.journal_entries), false);
select set_config('t.jl0',    (select count(*)::text from public.journal_lines), false);
select set_config('t.cm0',    (select count(*)::text from public.custody_movements), false);
select set_config('t.pr0',    (select count(*)::text from public.payment_requests), false);

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- Exact Slice-2 StagingDraft fixture builder for one source-workbook expense row.
create or replace function pg_temp.one_source_manifest(
  p_org uuid, p_source_sha text, p_snapshot_sha text, p_locator text, p_fingerprint text
) returns jsonb language sql stable as $$
  with ids as (
    select
      public.fn_reconciliation_stable_uuid(
        'reconciliation_batch',p_source_sha,p_snapshot_sha,p_org::text
      ) as batch_id,
      public.fn_reconciliation_stable_uuid(
        'evidence_item','source_workbook_row',p_source_sha,'المصروفات',p_locator
      ) as evidence_id
  )
  select jsonb_build_object(
    'batch', jsonb_build_object(
      'id', ids.batch_id, 'org_id', p_org, 'source_workbook_sha256', p_source_sha, 'status', 'staged',
      'result_summary', jsonb_build_object(
        'evidence_item_count', 1, 'batch_row_count', 1,
        'by_dataset', jsonb_build_object(
          'expense', jsonb_build_object(
            'exception_row_count',1,'source_occurrence_count',1,'production_occurrence_count',0,
            'classification_counts',jsonb_build_object('source_addition_candidate',1),
            'matched_invalid_calendar_quality_flag_count',0),
          'sale', jsonb_build_object(
            'exception_row_count',0,'source_occurrence_count',0,'production_occurrence_count',0,
            'classification_counts','{}'::jsonb,'matched_invalid_calendar_quality_flag_count',0)))),
    'evidence_items', jsonb_build_array(jsonb_build_object(
      'id',ids.evidence_id,'org_id',p_org,'origin_kind','source_workbook_row','dataset','expense',
      'classification','source_addition_candidate','source_workbook_sha256',p_source_sha,
      'sheet_name','المصروفات','row_locator',p_locator,'production_snapshot_sha256',null,
      'snapshot_target_table',null,'snapshot_target_id',null,'source_identity_fingerprint',p_fingerprint,
      'invalid_calendar_quality_flag',false,'first_staged_batch_id',ids.batch_id,
      -- Slice 4A enriched evidence contract (a real calendar date → parsed = text).
      'evidence_label','بند اختبار','source_amount','10.00',
      'source_date_text','2023-01-01','source_date_parsed','2023-01-01')),
    'batch_rows', jsonb_build_array(jsonb_build_object(
      'id',public.fn_reconciliation_stable_uuid(
        'reconciliation_batch_row',ids.batch_id::text,ids.evidence_id::text
      ),'org_id',p_org,'batch_id',ids.batch_id,'evidence_item_id',ids.evidence_id,
      'review_state','unreviewed','target_table',null,'disposition','hold')),
    'matched_invalid_calendar_quality_flags','[]'::jsonb,
    'tool_metadata',jsonb_build_object(
      'production_snapshot_sha256',p_snapshot_sha,'exception_evidence_sha256',repeat('d',64)))
  from ids;
$$;

-- Canonical three-row exact StagingDraft: two workbook rows + one production orphan.
select set_config('t.m1', jsonb_build_object(
  'batch', jsonb_build_object(
    'id',public.fn_reconciliation_stable_uuid(
      'reconciliation_batch',repeat('a',64),repeat('c',64),:'orgA'::text),'org_id',:'orgA',
    'source_workbook_sha256',repeat('a',64),'status','staged',
    'result_summary',jsonb_build_object(
      'evidence_item_count',3,'batch_row_count',3,
      'by_dataset',jsonb_build_object(
        'expense',jsonb_build_object(
          'exception_row_count',3,'source_occurrence_count',2,'production_occurrence_count',1,
          'classification_counts',jsonb_build_object(
            'source_addition_candidate',2,'production_orphan_candidate',1),
          'matched_invalid_calendar_quality_flag_count',0),
        'sale',jsonb_build_object(
          'exception_row_count',0,'source_occurrence_count',0,'production_occurrence_count',0,
          'classification_counts','{}'::jsonb,'matched_invalid_calendar_quality_flag_count',0)))),
  'evidence_items',jsonb_build_array(
    jsonb_build_object(
      'id',public.fn_reconciliation_stable_uuid(
        'evidence_item','source_workbook_row',repeat('a',64),'المصروفات','A100'),'org_id',:'orgA',
      'origin_kind','source_workbook_row','dataset','expense','classification','source_addition_candidate',
      'source_workbook_sha256',repeat('a',64),'sheet_name','المصروفات','row_locator','A100',
      'production_snapshot_sha256',null,'snapshot_target_table',null,'snapshot_target_id',null,
      'source_identity_fingerprint','fp-100','invalid_calendar_quality_flag',false,
      'evidence_label','بند A100','source_amount','100.00',
      'source_date_text','2023-01-01','source_date_parsed','2023-01-01',
      'first_staged_batch_id',public.fn_reconciliation_stable_uuid(
        'reconciliation_batch',repeat('a',64),repeat('c',64),:'orgA'::text)),
    jsonb_build_object(
      'id',public.fn_reconciliation_stable_uuid(
        'evidence_item','source_workbook_row',repeat('a',64),'المصروفات','A101'),'org_id',:'orgA',
      'origin_kind','source_workbook_row','dataset','expense','classification','source_addition_candidate',
      'source_workbook_sha256',repeat('a',64),'sheet_name','المصروفات','row_locator','A101',
      'production_snapshot_sha256',null,'snapshot_target_table',null,'snapshot_target_id',null,
      'source_identity_fingerprint','fp-101','invalid_calendar_quality_flag',false,
      'evidence_label','بند A101','source_amount','101.50',
      'source_date_text','2023-02-15','source_date_parsed','2023-02-15',
      'first_staged_batch_id',public.fn_reconciliation_stable_uuid(
        'reconciliation_batch',repeat('a',64),repeat('c',64),:'orgA'::text)),
    jsonb_build_object(
      'id',public.fn_reconciliation_stable_uuid(
        'evidence_item','production_snapshot_row',repeat('c',64),'expenses',
        'f0000000-0000-0000-0000-0000000000a1'),'org_id',:'orgA',
      'origin_kind','production_snapshot_row','dataset','expense',
      'classification','production_orphan_candidate','source_workbook_sha256',null,
      'sheet_name',null,'row_locator',null,'production_snapshot_sha256',repeat('c',64),
      'snapshot_target_table','expenses','snapshot_target_id','f0000000-0000-0000-0000-0000000000a1',
      'source_identity_fingerprint','fp-200','invalid_calendar_quality_flag',false,
      'evidence_label','يتيم إنتاج','source_amount',null,
      'source_date_text',null,'source_date_parsed',null,
      'first_staged_batch_id',public.fn_reconciliation_stable_uuid(
        'reconciliation_batch',repeat('a',64),repeat('c',64),:'orgA'::text))),
  'batch_rows',jsonb_build_array(
    jsonb_build_object('id',public.fn_reconciliation_stable_uuid(
        'reconciliation_batch_row',
        public.fn_reconciliation_stable_uuid('reconciliation_batch',repeat('a',64),repeat('c',64),:'orgA'::text)::text,
        public.fn_reconciliation_stable_uuid('evidence_item','source_workbook_row',repeat('a',64),'المصروفات','A100')::text),
      'org_id',:'orgA',
      'batch_id',public.fn_reconciliation_stable_uuid('reconciliation_batch',repeat('a',64),repeat('c',64),:'orgA'::text),
      'evidence_item_id',public.fn_reconciliation_stable_uuid('evidence_item','source_workbook_row',repeat('a',64),'المصروفات','A100'),
      'review_state','unreviewed','target_table',null,'disposition','hold'),
    jsonb_build_object('id',public.fn_reconciliation_stable_uuid(
        'reconciliation_batch_row',
        public.fn_reconciliation_stable_uuid('reconciliation_batch',repeat('a',64),repeat('c',64),:'orgA'::text)::text,
        public.fn_reconciliation_stable_uuid('evidence_item','source_workbook_row',repeat('a',64),'المصروفات','A101')::text),
      'org_id',:'orgA',
      'batch_id',public.fn_reconciliation_stable_uuid('reconciliation_batch',repeat('a',64),repeat('c',64),:'orgA'::text),
      'evidence_item_id',public.fn_reconciliation_stable_uuid('evidence_item','source_workbook_row',repeat('a',64),'المصروفات','A101'),
      'review_state','unreviewed','target_table',null,'disposition','hold'),
    jsonb_build_object('id',public.fn_reconciliation_stable_uuid(
        'reconciliation_batch_row',
        public.fn_reconciliation_stable_uuid('reconciliation_batch',repeat('a',64),repeat('c',64),:'orgA'::text)::text,
        public.fn_reconciliation_stable_uuid('evidence_item','production_snapshot_row',repeat('c',64),'expenses',
          'f0000000-0000-0000-0000-0000000000a1')::text),
      'org_id',:'orgA',
      'batch_id',public.fn_reconciliation_stable_uuid('reconciliation_batch',repeat('a',64),repeat('c',64),:'orgA'::text),
      'evidence_item_id',public.fn_reconciliation_stable_uuid('evidence_item','production_snapshot_row',repeat('c',64),'expenses',
        'f0000000-0000-0000-0000-0000000000a1'),
      'review_state','unreviewed','target_table',null,'disposition','hold')),
  'matched_invalid_calendar_quality_flags','[]'::jsonb,
  'tool_metadata',jsonb_build_object(
    'production_snapshot_sha256',repeat('c',64),'exception_evidence_sha256',repeat('d',64))
)::text, false);

-- Same deterministic batch id with changed bytes must conflict.
select set_config('t.m1_countconflict',
  jsonb_set(current_setting('t.m1')::jsonb,
    '{evidence_items,0,source_identity_fingerprint}','"fp-DIFFERENT"'::jsonb)::text, false);

-- New batch/evidence id trying to claim A100's global position must conflict.
select set_config('t.m2_idconflict', pg_temp.one_source_manifest(
  :'orgA',repeat('a',64),repeat('b',64),'A100','fp-DIFFERENT')::text, false);

-- Malformed variants derived from an otherwise exact one-row StagingDraft.
select set_config('t.m4', pg_temp.one_source_manifest(
  :'orgA',repeat('4',64),repeat('c',64),'A400','fp-400')::text, false);
select set_config('t.m5', pg_temp.one_source_manifest(
  :'orgA',repeat('5',64),repeat('c',64),'A500','fp-500')::text, false);
select set_config('t.m6', pg_temp.one_source_manifest(
  :'orgA',repeat('6',64),repeat('c',64),'A600','fp-600')::text, false);
select set_config('t.m7', jsonb_set(
  jsonb_set(
    pg_temp.one_source_manifest(:'orgA',repeat('7',64),repeat('c',64),'A700','fp-700'),
    '{evidence_items,0,classification}','"amount_correction_candidate"'::jsonb),
  '{batch,result_summary,by_dataset,expense,classification_counts}',
  '{"amount_correction_candidate":1}'::jsonb)::text, false);
select set_config('t.m8', jsonb_set(
  jsonb_set(
    pg_temp.one_source_manifest(:'orgA',repeat('8',64),repeat('c',64),'A800','fp-800'),
    '{evidence_items,0,classification}','"amount_correction_candidate"'::jsonb),
  '{batch,result_summary,by_dataset,expense,classification_counts}',
  '{"amount_correction_candidate":1}'::jsonb)::text, false);
select set_config('t.m_badkey',
  (current_setting('t.m4')::jsonb || jsonb_build_object('bogus','x'))::text, false);
select set_config('t.m_countmismatch',
  jsonb_set(current_setting('t.m4')::jsonb,
    '{batch,result_summary,evidence_item_count}','5'::jsonb)::text, false);
select set_config('t.m_partial',
  jsonb_set(current_setting('t.m4')::jsonb,
    '{evidence_items,0}',(current_setting('t.m4')::jsonb#>'{evidence_items,0}')
      || jsonb_build_object('bogus_field','x'))::text, false);
select set_config('t.m_wrongorg',
  jsonb_set(current_setting('t.m4')::jsonb,
    '{evidence_items,0,org_id}',to_jsonb(:'orgB'::text))::text, false);
select set_config('t.m_wronghash',
  jsonb_set(current_setting('t.m4')::jsonb,
    '{evidence_items,0,source_workbook_sha256}',to_jsonb(repeat('b',64)))::text, false);
select set_config('t.m_wrongdefault',
  jsonb_set(current_setting('t.m4')::jsonb,
    '{batch_rows,0,disposition}','"include"'::jsonb)::text, false);
select set_config('t.m_opposite_locator',
  jsonb_set(current_setting('t.m4')::jsonb,
    '{evidence_items,0,snapshot_target_table}','"expenses"'::jsonb)::text, false);
select set_config('t.m_badtype',
  jsonb_set(current_setting('t.m4')::jsonb,
    '{evidence_items,0,invalid_calendar_quality_flag}','"false"'::jsonb)::text, false);
select set_config('t.m_arbitraryid',
  jsonb_set(current_setting('t.m4')::jsonb,
    '{batch,id}','"aaaaaaaa-bbbb-5ccc-8ddd-eeeeeeeeeeee"'::jsonb)::text, false);
select set_config('t.m_arbitrary_evidence_id',
  jsonb_set(current_setting('t.m4')::jsonb,
    '{evidence_items,0,id}','"aaaaaaaa-bbbb-5ccc-8ddd-eeeeeeeeeeee"'::jsonb)::text, false);
select set_config('t.m_arbitrary_row_id',
  jsonb_set(current_setting('t.m4')::jsonb,
    '{batch_rows,0,id}','"aaaaaaaa-bbbb-5ccc-8ddd-eeeeeeeeeeee"'::jsonb)::text, false);
select set_config('t.m_upperhash',
  jsonb_set(current_setting('t.m1')::jsonb,
    '{batch,source_workbook_sha256}',to_jsonb(upper(repeat('a',64))))::text, false);
select set_config('t.m_noncanonicalorg',
  jsonb_set(current_setting('t.m4')::jsonb,
    '{batch,org_id}',to_jsonb('{' || :'orgA'::text || '}'))::text, false);
select set_config('t.m_dupevidence',
  jsonb_set(current_setting('t.m1')::jsonb,
    '{evidence_items,1,id}',current_setting('t.m1')::jsonb#>'{evidence_items,0,id}')::text, false);
select set_config('t.m_duplocator',
  jsonb_set(current_setting('t.m1')::jsonb,
    '{evidence_items,1,row_locator}',current_setting('t.m1')::jsonb#>'{evidence_items,0,row_locator}')::text, false);
select set_config('t.m_duprow',
  jsonb_set(current_setting('t.m1')::jsonb,
    '{batch_rows,1,id}',current_setting('t.m1')::jsonb#>'{batch_rows,0,id}')::text, false);
select set_config('t.m_duperef',
  jsonb_set(current_setting('t.m1')::jsonb,
    '{batch_rows,1,evidence_item_id}',current_setting('t.m1')::jsonb#>'{batch_rows,0,evidence_item_id}')::text, false);
select set_config('t.m_orphanref',
  jsonb_set(current_setting('t.m4')::jsonb,
    '{batch_rows,0,evidence_item_id}','"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"'::jsonb)::text, false);

-- Structurally exact but above the hard 1,000-row bound.
with generated as (
  select
    jsonb_agg(jsonb_build_object(
      'id',('ee900000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid,
      'org_id',:'orgA','origin_kind','source_workbook_row','dataset','expense',
      'classification','source_addition_candidate','source_workbook_sha256',repeat('a',64),
      'sheet_name','المصروفات','row_locator','OB' || i,'production_snapshot_sha256',null,
      'snapshot_target_table',null,'snapshot_target_id',null,'source_identity_fingerprint','fp-ob-' || i,
      'invalid_calendar_quality_flag',false,
      'first_staged_batch_id','ba900000-0000-0000-0000-000000000009') order by i) as evidence,
    jsonb_agg(jsonb_build_object(
      'id',('bb900000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid,
      'org_id',:'orgA','batch_id','ba900000-0000-0000-0000-000000000009',
      'evidence_item_id',('ee900000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid,
      'review_state','unreviewed','target_table',null,'disposition','hold') order by i) as rows
  from generate_series(1,1001) i
)
select set_config('t.m_overbound', jsonb_build_object(
  'batch',jsonb_build_object(
    'id','ba900000-0000-0000-0000-000000000009','org_id',:'orgA',
    'source_workbook_sha256',repeat('a',64),'status','staged',
    'result_summary',jsonb_build_object(
      'evidence_item_count',1001,'batch_row_count',1001,
      'by_dataset',jsonb_build_object(
        'expense',jsonb_build_object(
          'exception_row_count',1001,'source_occurrence_count',1001,'production_occurrence_count',0,
          'classification_counts',jsonb_build_object('source_addition_candidate',1001),
          'matched_invalid_calendar_quality_flag_count',0),
        'sale',jsonb_build_object(
          'exception_row_count',0,'source_occurrence_count',0,'production_occurrence_count',0,
          'classification_counts','{}'::jsonb,'matched_invalid_calendar_quality_flag_count',0)))),
  'evidence_items',generated.evidence,'batch_rows',generated.rows,
  'matched_invalid_calendar_quality_flags','[]'::jsonb,
  'tool_metadata',jsonb_build_object(
    'production_snapshot_sha256',repeat('c',64),'exception_evidence_sha256',repeat('d',64))
)::text,false) from generated;

-- typed review decisions
select set_config('t.dec_include', jsonb_build_object('action','review','reason','valid addition',
  'target_table','expenses','expense', jsonb_build_object('category','تسميد','kind','operating',
    'account_id', current_setting('t.account_id'),'payment_decision','routed_now'))::text, false);
select set_config('t.dec_hold',   jsonb_build_object('action','hold','reason','ambiguous — hold')::text, false);
select set_config('t.dec_reject', jsonb_build_object('action','reject','reason','orphan — do not add')::text, false);
select set_config('t.dec_noreason', jsonb_build_object('action','hold')::text, false);
select set_config('t.dec_badkey', jsonb_build_object('action','hold','reason','x','bogus',1)::text, false);
select set_config('t.dec_badexpkey', jsonb_build_object('action','review','reason','x','target_table','expenses',
  'expense', jsonb_build_object('category','c','kind','operating','account_id',current_setting('t.account_id'),'bogus','x'))::text, false);
select set_config('t.dec_missingacct', jsonb_build_object('action','review','reason','x','target_table','expenses',
  'expense', jsonb_build_object('category','c','kind','operating'))::text, false);
select set_config('t.dec_badtexttype', jsonb_build_object('action','review','reason','x','target_table','expenses',
  'expense', jsonb_build_object('category',jsonb_build_object('nested','not text'),'kind','operating',
    'account_id',current_setting('t.account_id')))::text, false);
select set_config('t.dec_sale', jsonb_build_object('action','review','reason','valid sale',
  'target_table','sales','sale',jsonb_build_object(
    'crop','تمر','quantity',1,'unit','كجم','unit_price',2,'recorded_total',2))::text, false);
select set_config('t.dec_exp_correction', jsonb_build_object('action','review','reason','valid expense correction',
  'target_table','expenses','corrects_expense_id',current_setting('t.expense_correction_id'),
  'expense',jsonb_build_object('category','تصحيح','kind','operating',
    'account_id',current_setting('t.account_id'),'payment_decision','routed_now'))::text, false);
select set_config('t.dec_sale_correction', jsonb_build_object('action','review','reason','valid sale correction',
  'target_table','sales','corrects_sale_id',current_setting('t.sale_correction_id'),
  'sale',jsonb_build_object('crop','تمر','quantity',1,'unit_price',2,'recorded_total',2))::text, false);
select set_config('t.dec_hold_irrelevant', jsonb_build_object(
  'action','hold','reason','x','target_table','expenses')::text, false);
select set_config('t.dec_exp_opposite', jsonb_build_object(
  'action','review','reason','x','target_table','expenses',
  'expense',jsonb_build_object('category','c','kind','operating','account_id',current_setting('t.account_id')),
  'sale',jsonb_build_object('crop','dates'))::text, false);
select set_config('t.dec_exp_wrong_correction', jsonb_build_object(
  'action','review','reason','x','target_table','expenses',
  'expense',jsonb_build_object('category','c','kind','operating','account_id',current_setting('t.account_id')),
  'corrects_sale_id','f0000000-0000-0000-0000-0000000000a1')::text, false);

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 1) EXECUTE lockdown — anon (and public) hold no EXECUTE on any of the four RPCs
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
select ok(not has_function_privilege('anon', 'public.fn_stage_reconciliation_manifest(uuid, jsonb)', 'EXECUTE'),
  'anon cannot EXECUTE fn_stage_reconciliation_manifest');
select ok(not has_function_privilege('anon', 'public.fn_review_reconciliation_row(uuid, jsonb)', 'EXECUTE'),
  'anon cannot EXECUTE fn_review_reconciliation_row');
select ok(not has_function_privilege('anon', 'public.fn_freeze_reconciliation_batch(uuid)', 'EXECUTE'),
  'anon cannot EXECUTE fn_freeze_reconciliation_batch');
select ok(not has_function_privilege('anon', 'public.fn_approve_reconciliation_batch(uuid)', 'EXECUTE'),
  'anon cannot EXECUTE fn_approve_reconciliation_batch');
select ok(has_function_privilege('authenticated', 'public.fn_stage_reconciliation_manifest(uuid, jsonb)', 'EXECUTE'),
  'authenticated CAN EXECUTE fn_stage_reconciliation_manifest');
-- the internal helpers are reachable only from the owner-context RPCs, never a client role
select ok(not has_function_privilege('authenticated', 'public.fn_reconciliation_validate_staging_manifest(uuid, jsonb)', 'EXECUTE'),
  'authenticated cannot EXECUTE the internal staging-manifest validator');
select ok(not has_function_privilege('authenticated', 'public.fn_reconciliation_assert_exact_object_keys(jsonb, text[], text)', 'EXECUTE'),
  'authenticated cannot EXECUTE the internal exact-key validator');
select ok(not has_function_privilege('authenticated', 'public.fn_reconciliation_assert_object_keys(jsonb, text[], text)', 'EXECUTE'),
  'authenticated cannot EXECUTE the internal fn_reconciliation_assert_object_keys helper');
select ok(not has_function_privilege('authenticated', 'public.fn_reconciliation_stable_uuid(text[])', 'EXECUTE'),
  'authenticated cannot EXECUTE the internal stable-id mirror directly');
select ok(not has_function_privilege('authenticated',
  'public.fn_reconciliation_assert_json_scalar_types(jsonb, text[], text[], text)', 'EXECUTE'),
  'authenticated cannot EXECUTE the internal scalar-type validator');
select is(public.fn_reconciliation_stable_uuid(
    'reconciliation_batch',
    '9728167b7860b18ff802dda85fe01897a2c645c4fc21677c22dfeaead2f71dc3',
    '32ff3abe1a586627066301396427c31e4ff9242eb4254f482c585e112dbec058',
    :'orgA'),
  '80a1051d-5bcf-504c-93cd-07206b4c59ef'::uuid,
  'the SQL stable-id mirror matches Slice 2 for the real canonical batch');

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 2) authz denial — farm_manager / storekeeper lack reconciliation.write; cross-org fails closed
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(current_setting('t.fm'));
select throws_ok(
  format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, %L::jsonb) $q$, :'orgA', current_setting('t.m1')),
  '42501', null, 'farm_manager cannot stage (reconciliation.write required)');
reset role;
select pg_temp.as_user(current_setting('t.store'));
select throws_ok(
  format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, %L::jsonb) $q$, :'orgA', current_setting('t.m1')),
  '42501', null, 'storekeeper cannot stage (reconciliation.write required)');
reset role;
-- accountant of org A staging into org B (not a member) → fail closed
select pg_temp.as_user(current_setting('t.acct'));
select throws_ok(
  format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, %L::jsonb) $q$, :'orgB', current_setting('t.m1')),
  '42501', null, 'accountant cannot stage into an org they are not a member of');
reset role;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 3) happy staging (accountant) — three tables written; rows default unreviewed/hold
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(current_setting('t.acct'));
select lives_ok(
  format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, %L::jsonb) $q$, :'orgA', current_setting('t.m1')),
  'accountant stages the manifest (mk-1) atomically');
reset role;

select set_config('t.batch1', current_setting('t.m1')::jsonb#>>'{batch,id}', false);
select is((select id::text from public.reconciliation_batches where id = current_setting('t.batch1')::uuid),
  current_setting('t.batch1'), 'staging preserved the deterministic batch id');
select is((select result_summary->>'evidence_item_count' from public.reconciliation_batches
  where id = current_setting('t.batch1')::uuid), '3', 'staging preserved the parser result summary');
select ok((select result_summary->>'staging_manifest_sha256' ~ '^[0-9a-f]{64}$'
  from public.reconciliation_batches where id = current_setting('t.batch1')::uuid),
  'staging stored a canonical whole-manifest hash');
select is((select result_summary#>>'{tool_metadata,production_snapshot_sha256}'
  from public.reconciliation_batches where id = current_setting('t.batch1')::uuid),
  repeat('c',64), 'staging retained non-row snapshot provenance as hash metadata');
select is((select count(*)::int from public.reconciliation_batch_rows where batch_id = current_setting('t.batch1')::uuid),
  3, 'mk-1 staged three batch rows');
select is((select count(distinct evidence_item_id)::int from public.reconciliation_batch_rows
  where batch_id = current_setting('t.batch1')::uuid), 3, 'mk-1 staged three distinct evidence items');
select is((select count(*)::int from public.reconciliation_batch_rows
  where batch_id = current_setting('t.batch1')::uuid and review_state = 'unreviewed' and disposition = 'hold'),
  3, 'every staged row defaults to unreviewed/hold');

select set_config('t.row_a100', (select br.id::text from public.reconciliation_batch_rows br
  join public.reconciliation_evidence_items ei on ei.id = br.evidence_item_id
  where br.batch_id = current_setting('t.batch1')::uuid and ei.source_identity_fingerprint = 'fp-100'), false);
select set_config('t.row_a101', (select br.id::text from public.reconciliation_batch_rows br
  join public.reconciliation_evidence_items ei on ei.id = br.evidence_item_id
  where br.batch_id = current_setting('t.batch1')::uuid and ei.source_identity_fingerprint = 'fp-101'), false);
select set_config('t.row_orphan', (select br.id::text from public.reconciliation_batch_rows br
  join public.reconciliation_evidence_items ei on ei.id = br.evidence_item_id
  where br.batch_id = current_setting('t.batch1')::uuid and ei.source_identity_fingerprint = 'fp-200'), false);

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 4) idempotent replay + conflict rejection
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(current_setting('t.acct'));
select is(
  (select (public.fn_stage_reconciliation_manifest(:'orgA'::uuid, current_setting('t.m1')::jsonb))->>'idempotent_replay'),
  'true', 'exact replay of mk-1 is reported idempotent');
reset role;
select is((select count(*)::int from public.reconciliation_batches where id = current_setting('t.batch1')::uuid),
  1, 'exact replay created no second batch');
select is((select count(*)::int from public.reconciliation_batch_rows where batch_id = current_setting('t.batch1')::uuid),
  3, 'exact replay created no extra rows');

update public.reconciliation_evidence_items
   set source_amount = 1
 where id = (current_setting('t.m1')::jsonb#>>'{evidence_items,0,id}')::uuid;
select pg_temp.as_user(current_setting('t.acct'));
select throws_ok(
  format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, %L::jsonb) $q$, :'orgA', current_setting('t.m1')),
  '23505', null, 'exact replay rejects a persisted evidence row carrying a non-manifest source value');
reset role;
update public.reconciliation_evidence_items
   set source_amount = null
 where id = (current_setting('t.m1')::jsonb#>>'{evidence_items,0,id}')::uuid;

select pg_temp.as_user(current_setting('t.acct'));
select throws_ok(
  format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, %L::jsonb) $q$, :'orgA', current_setting('t.m1_countconflict')),
  '23505', null, 'same deterministic batch id replayed with different bytes is rejected');
select throws_ok(
  format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, %L::jsonb) $q$, :'orgA', current_setting('t.m2_idconflict')),
  '23505', null, 'conflicting identity at an already-staged position (A100, different fingerprint) is rejected');
reset role;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 5) malformed / bounded / count-mismatch / no-partial staging — all fail closed
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
select set_config('t.batchcount_before', (select count(*)::text from public.reconciliation_batches where org_id = :'orgA'), false);
select pg_temp.as_user(current_setting('t.acct'));
select throws_ok(
  format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, %L::jsonb) $q$, :'orgA', current_setting('t.m_badkey')),
  '22023', null, 'an unexpected top-level manifest key is rejected');
select throws_ok(
  format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, %L::jsonb) $q$, :'orgA', current_setting('t.m_overbound')),
  '22023', null, 'a manifest above the bounded row cap is rejected');
select throws_ok(
  format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, %L::jsonb) $q$, :'orgA', current_setting('t.m_countmismatch')),
  '22023', null, 'expected_count not matching evidence_items length is rejected');
select throws_ok(
  format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, %L::jsonb) $q$, :'orgA', current_setting('t.m_partial')),
  '22023', null, 'a manifest with one malformed item is rejected (no partial staging)');
select throws_ok(
  format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, %L::jsonb) $q$, :'orgA', current_setting('t.m_wrongorg')),
  '22023', null, 'an evidence item carrying the wrong org is rejected');
select throws_ok(
  format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, %L::jsonb) $q$, :'orgA', current_setting('t.m_wronghash')),
  '22023', null, 'an evidence locator carrying a hash other than the pinned batch hash is rejected');
select throws_ok(
  format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, %L::jsonb) $q$, :'orgA', current_setting('t.m_wrongdefault')),
  '22023', null, 'a staged batch row with a non-hold default is rejected');
select throws_ok(
  format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, %L::jsonb) $q$, :'orgA', current_setting('t.m_opposite_locator')),
  '22023', null, 'a source item carrying an opposite production locator is rejected');
select throws_ok(
  format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, %L::jsonb) $q$, :'orgA', current_setting('t.m_badtype')),
  '22023', null, 'a boolean staging field encoded as a string is rejected');
select throws_ok(
  format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, %L::jsonb) $q$, :'orgA', current_setting('t.m_arbitraryid')),
  '22023', null, 'an arbitrary UUID cannot replace the Slice-2 deterministic batch identity');
select throws_ok(
  format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, %L::jsonb) $q$, :'orgA', current_setting('t.m_arbitrary_evidence_id')),
  '22023', null, 'an arbitrary UUID cannot replace a Slice-2 deterministic evidence identity');
select throws_ok(
  format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, %L::jsonb) $q$, :'orgA', current_setting('t.m_arbitrary_row_id')),
  '22023', null, 'an arbitrary UUID cannot replace a Slice-2 deterministic batch-row identity');
select throws_ok(
  format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, %L::jsonb) $q$, :'orgA', current_setting('t.m_upperhash')),
  '22023', null, 'uppercase hash aliases are rejected instead of creating a second global locator');
select throws_ok(
  format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, %L::jsonb) $q$, :'orgA', current_setting('t.m_noncanonicalorg')),
  '22023', null, 'a non-normalized org UUID string is rejected outside the exact Slice-2 contract');
select throws_ok(
  format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, %L::jsonb) $q$, :'orgA', current_setting('t.m_dupevidence')),
  '22023', null, 'duplicate deterministic evidence ids inside one manifest are rejected');
select throws_ok(
  format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, %L::jsonb) $q$, :'orgA', current_setting('t.m_duplocator')),
  '22023', null, 'duplicate evidence positions inside one manifest are rejected');
select throws_ok(
  format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, %L::jsonb) $q$, :'orgA', current_setting('t.m_duprow')),
  '22023', null, 'duplicate deterministic batch-row ids are rejected');
select throws_ok(
  format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, %L::jsonb) $q$, :'orgA', current_setting('t.m_duperef')),
  '22023', null, 'duplicate evidence references in batch rows are rejected');
select throws_ok(
  format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, %L::jsonb) $q$, :'orgA', current_setting('t.m_orphanref')),
  '22023', null, 'an orphan batch-row evidence reference is rejected');
select throws_ok(
  format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, '{"manifest_key":"x","expected_count":1,"evidence_items":"notarray"}'::jsonb) $q$, :'orgA'),
  '22023', null, 'evidence_items that is not an array is rejected');
reset role;
select is((select count(*)::text from public.reconciliation_batches where org_id = :'orgA'),
  current_setting('t.batchcount_before'),
  'no partial batch survived any rejected staging attempt');
select is((select count(*)::int from public.reconciliation_evidence_items
  where org_id = :'orgA' and source_identity_fingerprint in ('fp-900','fp-901','fp-902','fp-903','fp-904','fp-DIFFERENT')),
  0, 'no evidence item from any rejected manifest was written');

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 6) review decisions (owner + accountant) — review / hold / reject; malformed decisions fail closed
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
-- cross-org: an org-B member cannot review an org-A row
select pg_temp.as_user(:'userB');
select throws_ok(
  format($q$ select public.fn_review_reconciliation_row(%L::uuid, %L::jsonb) $q$, current_setting('t.row_a100'), current_setting('t.dec_hold')),
  '42501', null, 'an org-B member cannot review an org-A row (cross-org)');
reset role;
-- farm_manager lacks reconciliation.write
select pg_temp.as_user(current_setting('t.fm'));
select throws_ok(
  format($q$ select public.fn_review_reconciliation_row(%L::uuid, %L::jsonb) $q$, current_setting('t.row_a100'), current_setting('t.dec_hold')),
  '42501', null, 'farm_manager cannot review a row');
reset role;

select pg_temp.as_user(current_setting('t.acct'));
-- malformed decisions
select throws_ok(
  format($q$ select public.fn_review_reconciliation_row(%L::uuid, %L::jsonb) $q$, current_setting('t.row_a100'), current_setting('t.dec_noreason')),
  '22023', null, 'a review decision without a reason is rejected');
select throws_ok(
  format($q$ select public.fn_review_reconciliation_row(%L::uuid, %L::jsonb) $q$, current_setting('t.row_a100'), current_setting('t.dec_badkey')),
  '22023', null, 'an unexpected decision key is rejected');
select throws_ok(
  format($q$ select public.fn_review_reconciliation_row(%L::uuid, %L::jsonb) $q$, current_setting('t.row_a100'), current_setting('t.dec_badexpkey')),
  '22023', null, 'an unexpected key inside decision.expense is rejected');
select throws_ok(
  format($q$ select public.fn_review_reconciliation_row(%L::uuid, %L::jsonb) $q$, current_setting('t.row_a100'), current_setting('t.dec_hold_irrelevant')),
  '22023', null, 'a hold decision rejects irrelevant target fields instead of silently ignoring them');
select throws_ok(
  format($q$ select public.fn_review_reconciliation_row(%L::uuid, %L::jsonb) $q$, current_setting('t.row_a100'), current_setting('t.dec_exp_opposite')),
  '22023', null, 'an expense review rejects an opposite-domain sale payload');
select throws_ok(
  format($q$ select public.fn_review_reconciliation_row(%L::uuid, %L::jsonb) $q$, current_setting('t.row_a100'), current_setting('t.dec_exp_wrong_correction')),
  '22023', null, 'an expense review rejects a sale correction id');
select throws_ok(
  format($q$ select public.fn_review_reconciliation_row(%L::uuid, %L::jsonb) $q$, current_setting('t.row_a100'), current_setting('t.dec_missingacct')),
  '23514', null, 'an included expenses review missing account_id is rejected by the table CHECK backstop');
select throws_ok(
  format($q$ select public.fn_review_reconciliation_row(%L::uuid, %L::jsonb) $q$, current_setting('t.row_a100'), current_setting('t.dec_badtexttype')),
  '22023', null, 'an object supplied for a typed text review field is rejected before coercion');
-- valid decisions
select lives_ok(
  format($q$ select public.fn_review_reconciliation_row(%L::uuid, %L::jsonb) $q$, current_setting('t.row_a100'), current_setting('t.dec_include')),
  'accountant reviews A100 as an included expense');
select lives_ok(
  format($q$ select public.fn_review_reconciliation_row(%L::uuid, %L::jsonb) $q$, current_setting('t.row_a101'), current_setting('t.dec_hold')),
  'accountant holds A101');
select lives_ok(
  format($q$ select public.fn_review_reconciliation_row(%L::uuid, %L::jsonb) $q$, current_setting('t.row_orphan'), current_setting('t.dec_reject')),
  'accountant rejects the orphan row');
reset role;

select is((select review_state || '/' || disposition from public.reconciliation_batch_rows where id = current_setting('t.row_a100')::uuid),
  'reviewed/include', 'A100 is reviewed + include with typed columns set');
select is((select review_state || '/' || disposition from public.reconciliation_batch_rows where id = current_setting('t.row_a101')::uuid),
  'reviewed/hold', 'A101 is a reviewed hold');
select is((select review_state || '/' || disposition from public.reconciliation_batch_rows where id = current_setting('t.row_orphan')::uuid),
  'rejected/hold', 'the orphan row is rejected + held');
select is((select expense_category from public.reconciliation_batch_rows where id = current_setting('t.row_a100')::uuid),
  'تسميد', 'the reviewed expense category is persisted from the decision');

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 7) freeze — reject unreviewed-included; freeze happy path; deterministic hash; idempotent
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
-- a batch carrying an include row that is still unreviewed cannot be frozen (guard fixture, superuser)
insert into public.reconciliation_batches (id, org_id, status, created_by)
  values ('ba700000-0000-0000-0000-000000000001', :'orgA', 'staged', current_setting('t.acct')::uuid);
insert into public.reconciliation_evidence_items (id, org_id, origin_kind, source_workbook_sha256, sheet_name,
  row_locator, source_identity_fingerprint, classification)
  values ('ee700000-0000-0000-0000-000000000001', :'orgA', 'source_workbook_row', repeat('a',64), 'المصروفات',
          'A700', 'fp-700', 'source_addition_candidate');
insert into public.reconciliation_batch_rows (id, org_id, batch_id, evidence_item_id, target_table, disposition,
  review_state, expense_category, expense_kind, expense_account_id, expense_payment_decision)
  values ('bb700000-0000-0000-0000-000000000001', :'orgA', 'ba700000-0000-0000-0000-000000000001',
          'ee700000-0000-0000-0000-000000000001', 'expenses', 'include', 'unreviewed', 'c', 'operating',
          current_setting('t.account_id')::uuid, 'routed_now');
select pg_temp.as_user(current_setting('t.acct'));
select throws_ok(
  $q$ select public.fn_freeze_reconciliation_batch('ba700000-0000-0000-0000-000000000001'::uuid) $q$,
  '22023', null, 'a batch with an unreviewed included row cannot be frozen');
-- freeze mk-1 (one included plus two explicitly excluded rows; all three have review decisions)
select lives_ok(
  format($q$ select public.fn_freeze_reconciliation_batch(%L::uuid) $q$, current_setting('t.batch1')),
  'accountant freezes the fully-reviewed batch mk-1');
reset role;

select is((select status from public.reconciliation_batches where id = current_setting('t.batch1')::uuid),
  'reviewed', 'freezing moves the batch to reviewed');
select is((select review_state || '/' || frozen::text from public.reconciliation_batch_rows where id = current_setting('t.row_a100')::uuid),
  'frozen/true', 'the included row is frozen');
select is((select review_state || '/' || frozen::text from public.reconciliation_batch_rows where id = current_setting('t.row_a101')::uuid),
  'reviewed/true', 'the explicitly held row is immutable-frozen while retaining its hold decision state');
select is((select review_state || '/' || frozen::text from public.reconciliation_batch_rows where id = current_setting('t.row_orphan')::uuid),
  'rejected/true', 'the rejected row is immutable-frozen while retaining its rejection state');
select ok((select payload_hash ~ '^[0-9a-f]{64}$' from public.reconciliation_batch_rows where id = current_setting('t.row_a100')::uuid),
  'a 64-hex sha-256 payload_hash was written on freeze');
-- deterministic: recomputing the exact canonical serialization from the stored row reproduces the hash
select is(
  (select payload_hash from public.reconciliation_batch_rows where id = current_setting('t.row_a100')::uuid),
  (select encode(sha256(convert_to(jsonb_build_object(
      'evidence_item_id', evidence_item_id, 'target_table', target_table, 'disposition', disposition,
      'expense_category', expense_category, 'expense_description', expense_description, 'expense_kind', expense_kind,
      'expense_account_id', expense_account_id, 'expense_cost_center_id', expense_cost_center_id,
      'expense_supplier_id', expense_supplier_id, 'expense_payment_decision', expense_payment_decision,
      'sale_crop', sale_crop, 'sale_quantity', sale_quantity, 'sale_unit', sale_unit,
      'sale_unit_price', sale_unit_price, 'sale_recorded_total', sale_recorded_total, 'sale_buyer_id', sale_buyer_id,
      'sale_cost_center_id', sale_cost_center_id, 'sale_farm_id', sale_farm_id, 'sale_sector_id', sale_sector_id,
      'sale_hawsha_id', sale_hawsha_id, 'sale_season', sale_season, 'sale_delivery_date', sale_delivery_date,
      'sale_notes', sale_notes, 'sale_historical_date_decision', sale_historical_date_decision,
      'sale_effective_date', sale_effective_date, 'corrects_expense_id', corrects_expense_id,
      'corrects_sale_id', corrects_sale_id)::text, 'UTF8')), 'hex')
   from public.reconciliation_batch_rows where id = current_setting('t.row_a100')::uuid),
  'the payload hash is a deterministic sha-256 over the frozen typed columns');
-- idempotent re-freeze
select pg_temp.as_user(current_setting('t.acct'));
select is(
  (select (public.fn_freeze_reconciliation_batch(current_setting('t.batch1')::uuid))->>'idempotent'),
  'true', 're-freezing an already-reviewed batch is idempotent');
reset role;
select is((select count(distinct payload_hash)::int from public.reconciliation_batch_rows
  where id = current_setting('t.row_a100')::uuid), 1, 're-freeze did not change the stored hash');

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 8) immutability after freeze — no re-review, no direct typed-column edit
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(current_setting('t.acct'));
select throws_ok(
  format($q$ select public.fn_review_reconciliation_row(%L::uuid, %L::jsonb) $q$, current_setting('t.row_a100'), current_setting('t.dec_hold')),
  '22023', null, 'a row in a frozen (reviewed) batch can no longer be reviewed');
reset role;
select throws_ok(
  format($q$ update public.reconciliation_batch_rows set expense_category = 'tampered' where id = %L $q$, current_setting('t.row_a100')),
  '22023', null, 'a frozen row rejects a direct typed-column edit even via a privileged path');

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 9) approve — state transition + owner-only + separation of duties
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
-- cannot approve a batch that is not yet reviewed (mk-4, staged by accountant)
select pg_temp.as_user(current_setting('t.acct'));
select lives_ok(
  format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, %L::jsonb) $q$, :'orgA', current_setting('t.m4')),
  'accountant stages mk-4');
reset role;
select set_config('t.batch4', current_setting('t.m4')::jsonb#>>'{batch,id}', false);
select set_config('t.row4', current_setting('t.m4')::jsonb#>>'{batch_rows,0,id}', false);
select pg_temp.as_user(current_setting('t.acct'));
select throws_ok(
  format($q$ select public.fn_freeze_reconciliation_batch(%L::uuid) $q$, current_setting('t.batch4')),
  '22023', null, 'a default unreviewed/hold row is not treated as reviewed and cannot be frozen');
reset role;
select pg_temp.as_user(current_setting('t.owner'));
select throws_ok(
  format($q$ select public.fn_approve_reconciliation_batch(%L::uuid) $q$, current_setting('t.batch4')),
  '22023', null, 'the owner cannot approve a batch that is still staged (must be frozen first)');
reset role;

select pg_temp.as_user(current_setting('t.acct'));
select lives_ok(
  format($q$ select public.fn_review_reconciliation_row(%L::uuid, %L::jsonb) $q$,
    current_setting('t.row4'), current_setting('t.dec_sale')),
  'the sales review branch accepts a fully typed numeric payload');
select lives_ok(
  format($q$ select public.fn_freeze_reconciliation_batch(%L::uuid) $q$, current_setting('t.batch4')),
  'the reviewed sales batch freezes');
reset role;
select pg_temp.as_user(current_setting('t.owner'));
select lives_ok(
  format($q$ select public.fn_approve_reconciliation_batch(%L::uuid) $q$, current_setting('t.batch4')),
  'the owner approves the accountant-created and reviewed sales batch');
reset role;

-- happy approve: mk-1 was created + reviewed by the accountant; the OWNER (neither creator nor reviewer)
-- approves. First prove the accountant (non-owner) is refused.
select pg_temp.as_user(current_setting('t.acct'));
select throws_ok(
  format($q$ select public.fn_approve_reconciliation_batch(%L::uuid) $q$, current_setting('t.batch1')),
  '42501', null, 'a non-owner (accountant) cannot approve, even with reconciliation.write');
reset role;
select pg_temp.as_user(current_setting('t.owner'));
select lives_ok(
  format($q$ select public.fn_approve_reconciliation_batch(%L::uuid) $q$, current_setting('t.batch1')),
  'the owner approves the reviewed batch (SoD satisfied: not creator, not reviewer)');
select throws_ok(
  format($q$ select public.fn_approve_reconciliation_batch(%L::uuid) $q$, current_setting('t.batch1')),
  '22023', null, 're-approving an already-approved batch is rejected');
reset role;
select is((select status from public.reconciliation_batches where id = current_setting('t.batch1')::uuid),
  'approved', 'approval moved the batch to approved');
select is((select approved_by::text from public.reconciliation_batches where id = current_setting('t.batch1')::uuid),
  current_setting('t.owner'), 'approved_by records the owner');

-- SoD (creator arm): the owner stages + reviews + freezes mk-5, then cannot approve their own batch
select pg_temp.as_user(current_setting('t.owner'));
select lives_ok(format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, %L::jsonb) $q$, :'orgA', current_setting('t.m5')),
  'owner stages mk-5');
reset role;
select set_config('t.batch5', current_setting('t.m5')::jsonb#>>'{batch,id}', false);
select set_config('t.row5', (select id::text from public.reconciliation_batch_rows where batch_id = current_setting('t.batch5')::uuid limit 1), false);
select pg_temp.as_user(current_setting('t.owner'));
select lives_ok(format($q$ select public.fn_review_reconciliation_row(%L::uuid, %L::jsonb) $q$, current_setting('t.row5'), current_setting('t.dec_include')),
  'owner reviews the mk-5 row as included');
select lives_ok(format($q$ select public.fn_freeze_reconciliation_batch(%L::uuid) $q$, current_setting('t.batch5')),
  'owner freezes mk-5');
select throws_ok(format($q$ select public.fn_approve_reconciliation_batch(%L::uuid) $q$, current_setting('t.batch5')),
  '42501', null, 'separation of duties: the batch creator (owner) may not approve it');
reset role;

-- SoD (reviewer arm): accountant creates mk-6, the OWNER reviews it, then the owner cannot approve it
select pg_temp.as_user(current_setting('t.acct'));
select lives_ok(format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, %L::jsonb) $q$, :'orgA', current_setting('t.m6')),
  'accountant stages mk-6');
reset role;
select set_config('t.batch6', current_setting('t.m6')::jsonb#>>'{batch,id}', false);
select set_config('t.row6', (select id::text from public.reconciliation_batch_rows where batch_id = current_setting('t.batch6')::uuid limit 1), false);
select pg_temp.as_user(current_setting('t.owner'));
select lives_ok(format($q$ select public.fn_review_reconciliation_row(%L::uuid, %L::jsonb) $q$, current_setting('t.row6'), current_setting('t.dec_include')),
  'owner reviews the mk-6 row');
reset role;
select pg_temp.as_user(current_setting('t.acct'));
select lives_ok(format($q$ select public.fn_freeze_reconciliation_batch(%L::uuid) $q$, current_setting('t.batch6')),
  'accountant freezes mk-6');
reset role;
select pg_temp.as_user(current_setting('t.owner'));
select throws_ok(format($q$ select public.fn_approve_reconciliation_batch(%L::uuid) $q$, current_setting('t.batch6')),
  '42501', null, 'separation of duties: a reviewer of the batch (owner) may not approve it');
reset role;

-- Both correction success paths: classification and same-org correction targets are enforced by the
-- Slice-1A tenant/classification trigger, while this RPC supplies strict typed decisions.
select pg_temp.as_user(current_setting('t.acct'));
select lives_ok(format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, %L::jsonb) $q$,
  :'orgA', current_setting('t.m7')), 'accountant stages the expense-correction fixture');
select lives_ok(format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, %L::jsonb) $q$,
  :'orgA', current_setting('t.m8')), 'accountant stages the sale-correction fixture');
reset role;
select set_config('t.row7', current_setting('t.m7')::jsonb#>>'{batch_rows,0,id}', false);
select set_config('t.row8', current_setting('t.m8')::jsonb#>>'{batch_rows,0,id}', false);
select pg_temp.as_user(current_setting('t.acct'));
select lives_ok(format($q$ select public.fn_review_reconciliation_row(%L::uuid, %L::jsonb) $q$,
  current_setting('t.row7'), current_setting('t.dec_exp_correction')),
  'an amount-correction expense row accepts its same-org corrects_expense_id');
select lives_ok(format($q$ select public.fn_review_reconciliation_row(%L::uuid, %L::jsonb) $q$,
  current_setting('t.row8'), current_setting('t.dec_sale_correction')),
  'an amount-correction sale row accepts its same-org corrects_sale_id');
reset role;
select is((select corrects_expense_id::text from public.reconciliation_batch_rows
  where id = current_setting('t.row7')::uuid), current_setting('t.expense_correction_id'),
  'expense correction target is persisted exactly');
select is((select corrects_sale_id::text from public.reconciliation_batch_rows
  where id = current_setting('t.row8')::uuid), current_setting('t.sale_correction_id'),
  'sale correction target is persisted exactly');

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 10) REAL two-backend races — identical staging serializes; freeze defeats a concurrent late review
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
-- dblink backends cannot see this test transaction's uncommitted fixtures. Use only committed seed
-- users/org/accounts plus a self-contained manifest, and clean up every committed reconciliation row.
create extension if not exists dblink;
select set_config('t.dsn', format('host=%s port=%s dbname=%s user=%s',
    (select setting from pg_settings where name = 'unix_socket_directories'),
    (select setting from pg_settings where name = 'port'),
    current_database(), current_user),
  false);
select set_config('t.race_manifest', pg_temp.one_source_manifest(
  :'orgA',repeat('f',64),repeat('c',64),'RACE700','fp-race-700')::text, false);
select set_config('t.race_batch', current_setting('t.race_manifest')::jsonb#>>'{batch,id}', false);
select set_config('t.race_evidence', current_setting('t.race_manifest')::jsonb#>>'{evidence_items,0,id}', false);
select set_config('t.race_row', current_setting('t.race_manifest')::jsonb#>>'{batch_rows,0,id}', false);

select dblink_connect('stage_racer_1', current_setting('t.dsn'));
select dblink_connect('stage_racer_2', current_setting('t.dsn'));
select dblink_exec('stage_racer_1', format('set request.jwt.claims = %L',
  json_build_object('sub',current_setting('t.acct'),'role','authenticated')::text));
select dblink_exec('stage_racer_1', 'set role authenticated');
select dblink_exec('stage_racer_2', format('set request.jwt.claims = %L',
  json_build_object('sub',current_setting('t.acct'),'role','authenticated')::text));
select dblink_exec('stage_racer_2', 'set role authenticated');

select dblink_exec('stage_racer_1', 'begin');
select is(
  (select result->>'idempotent_replay'
     from dblink('stage_racer_1', format(
       'select public.fn_stage_reconciliation_manifest(%L::uuid,%L::jsonb)',
       :'orgA', current_setting('t.race_manifest'))) as t(result jsonb)),
  'false', 'race backend 1 stages the deterministic manifest while retaining its transaction lock');
select dblink_send_query('stage_racer_2', format(
  'select public.fn_stage_reconciliation_manifest(%L::uuid,%L::jsonb)',
  :'orgA', current_setting('t.race_manifest')));
select is(dblink_is_busy('stage_racer_2'), 1,
  'race backend 2 is blocked behind backend 1 on the deterministic batch lock');
select dblink_exec('stage_racer_1', 'commit');

do $$
declare
  v_result jsonb;
begin
  select result into v_result
    from dblink_get_result('stage_racer_2') as t(result jsonb);
  perform set_config('t.stage_race_replay', coalesce(v_result->>'idempotent_replay','missing'), false);
  -- Drain libpq's trailing ready result before reusing this async connection.
  begin
    perform * from dblink_get_result('stage_racer_2') as t(result jsonb);
  exception when others then
    null;
  end;
end $$;
select is(current_setting('t.stage_race_replay'), 'true',
  'after backend 1 commits, backend 2 succeeds as an exact idempotent replay');
select is((select count(*)::int from public.reconciliation_batches
  where id = current_setting('t.race_batch')::uuid), 1,
  'the two-backend identical staging race creates exactly one batch');
select is((select count(*)::int from public.reconciliation_batch_rows
  where batch_id = current_setting('t.race_batch')::uuid), 1,
  'the two-backend identical staging race creates exactly one batch row');

-- Prepare the committed race row as an included expense, then freeze it in backend 1 while backend 2
-- attempts a late hold. The batch-row review RPC locks both parent batch and row, so it must wait and
-- then re-evaluate the now-reviewed batch status instead of mutating after freeze.
select result
  from dblink('stage_racer_1', format(
    'select public.fn_review_reconciliation_row(%L::uuid,%L::jsonb)',
    current_setting('t.race_row'),
    jsonb_build_object('action','review','reason','race setup','target_table','expenses',
      'expense',jsonb_build_object('category','race','kind','operating',
        'account_id',current_setting('t.account_id'),
        'payment_decision','routed_now'))::text)) as t(result jsonb);
select dblink_exec('stage_racer_1', 'begin');
select is(
  (select result->>'status'
     from dblink('stage_racer_1', format(
       'select public.fn_freeze_reconciliation_batch(%L::uuid)',
       current_setting('t.race_batch'))) as t(result jsonb)),
  'reviewed', 'race backend 1 freezes the batch while retaining its transaction lock');
select is(dblink_send_query('stage_racer_2', format(
    'select public.fn_review_reconciliation_row(%L::uuid,%L::jsonb)',
    current_setting('t.race_row'),
    jsonb_build_object('action','hold','reason','too late')::text)),
  1, 'the concurrent late review query is dispatched');
select pg_sleep(0.1);
select set_config('t.review_freeze_race_busy', dblink_is_busy('stage_racer_2')::text, false);
select is(current_setting('t.review_freeze_race_busy'), '1',
  'the late reviewer is blocked by the freeze transaction');
select dblink_exec('stage_racer_1', 'commit');

do $$
declare
  v_sqlstate text;
begin
  begin
    perform * from dblink_get_result('stage_racer_2') as t(result jsonb);
    v_sqlstate := 'no_error';
  exception when others then
    v_sqlstate := sqlstate;
  end;
  perform set_config('t.review_freeze_race_sqlstate', v_sqlstate, false);
  begin
    perform * from dblink_get_result('stage_racer_2') as t(result jsonb);
  exception when others then
    null;
  end;
end $$;
select diag('review/freeze race busy=' || current_setting('t.review_freeze_race_busy')
  || ' sqlstate=' || current_setting('t.review_freeze_race_sqlstate'));
select is(current_setting('t.review_freeze_race_sqlstate'), '22023',
  'after freeze commits, the concurrent late review fails closed on the new batch status');
select is((select review_state || '/' || frozen::text
  from public.reconciliation_batch_rows
  where id = current_setting('t.race_row')::uuid), 'frozen/true',
  'the race leaves the row frozen, not overwritten by the late review');

select dblink_disconnect('stage_racer_1');
select dblink_disconnect('stage_racer_2');
select is((select count(*) from pg_stat_activity
  where application_name like '%dblink%' and pid <> pg_backend_pid()), 0::bigint,
  'no dblink backend remains after the reconciliation races');

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
-- 11) THE MONEY BOUNDARY — no financial table row count changed; slice-1B execution tables stay empty
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
select is((select count(*)::text from public.expenses),          current_setting('t.exp0'),  'expenses row count unchanged');
select is((select count(*)::text from public.sales),             current_setting('t.sale0'), 'sales row count unchanged');
select is((select count(*)::text from public.journal_entries),   current_setting('t.je0'),   'journal_entries row count unchanged');
select is((select count(*)::text from public.journal_lines),     current_setting('t.jl0'),   'journal_lines row count unchanged');
select is((select count(*)::text from public.custody_movements), current_setting('t.cm0'),   'custody_movements row count unchanged');
select is((select count(*)::text from public.payment_requests),  current_setting('t.pr0'),   'payment_requests row count unchanged');
select is((select count(*)::int from public.reconciliation_execution_ledger), 0, 'no execution-ledger row was written (slice-1B, not slice 3)');
select is((select count(*)::int from public.reconciliation_action_links), 0, 'no action-link row was written');
select is((select count(*)::int from public.reconciliation_baselines), 0, 'no baseline row was written');
select is((select count(*)::int from public.reconciliation_baseline_journal_headers), 0, 'no baseline journal header was written');
select is((select count(*)::int from public.reconciliation_baseline_journal_lines), 0, 'no baseline journal line was written');
-- non-vacuity: the flow really did drive the reconciliation tables
select cmp_ok((select count(*)::int from public.reconciliation_batches where org_id = :'orgA'), '>=', 4,
  'non-vacuity: the flow created reconciliation batches (mk-1/4/5/6 + guard fixture)');

select * from finish();
rollback;
