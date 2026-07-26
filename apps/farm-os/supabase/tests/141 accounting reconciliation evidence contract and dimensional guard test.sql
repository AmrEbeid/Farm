-- Accounting reconciliation — slice 4A (migration 20260726140000). Proves the enriched evidence
-- contract (evidence_label + source_amount + source_date_text + source_date_parsed) stages, replays,
-- and fails closed on malformed values; that an older null-label row stays valid (backward-safe); and
-- that the re-emitted tenant guard enforces the sale farm→sector→hawsha hierarchy and the included-
-- expense active-leaf/kind account rule. Impersonation via request.jwt.claims (harness pattern from
-- tests 82/97/102/140). Run via test-shims/run-pgtap-local.sh (superuser fixtures bypass RLS by design).

begin;
select no_plan();

\set orgA '00000000-0000-0000-0000-000000000001'
\set srcsha '5555555555555555555555555555555555555555555555555555555555555555'
\set snapsha '6666666666666666666666666666666666666666666666666666666666666666'
\set evsha '6464646464646464646464646464646464646464646464646464646464646464'

select set_config('t.acct', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'accountant' limit 1), false);

-- ── controlled account fixtures (superuser insert; RLS bypassed) ───────────────────────────────────────
insert into public.accounts (id, org_id, parent_id, code, name_ar, account_type, normal_balance, kind, is_system, active) values
  ('c1000000-0000-0000-0000-000000000001', :'orgA', null, 'S4A-LEAF',    'حساب ورقي نشط',   'expense', 'debit', 'operating', false, true),
  ('c1000000-0000-0000-0000-000000000002', :'orgA', null, 'S4A-INACT',   'حساب غير نشط',    'expense', 'debit', 'operating', false, false),
  ('c1000000-0000-0000-0000-000000000003', :'orgA', null, 'S4A-PARENT',  'حساب أب',         'expense', 'debit', 'operating', false, true),
  ('c1000000-0000-0000-0000-000000000004', :'orgA', 'c1000000-0000-0000-0000-000000000003', 'S4A-CHILD', 'حساب ابن نشط', 'expense', 'debit', 'operating', false, true);

-- ── controlled farm/sector/hawsha fixtures for the hierarchy checks ───────────────────────────────────
insert into public.farms (id, org_id, code, name) values
  ('f1000000-0000-0000-0000-000000000001', :'orgA', 'S4A-F1', 'مزرعة 1'),
  ('f1000000-0000-0000-0000-000000000002', :'orgA', 'S4A-F2', 'مزرعة 2');
insert into public.sectors (id, org_id, farm_id, code, name) values
  ('50000000-0000-0000-0000-000000000001', :'orgA', 'f1000000-0000-0000-0000-000000000001', 'S4A-S1', 'قطاع 1'),
  ('50000000-0000-0000-0000-000000000002', :'orgA', 'f1000000-0000-0000-0000-000000000002', 'S4A-S2', 'قطاع 2');
insert into public.hawshat (id, org_id, sector_id, code, name) values
  ('40000000-0000-0000-0000-000000000001', :'orgA', '50000000-0000-0000-0000-000000000001', 'S4A-H1', 'حوشة 1');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- ── an enriched 2-row StagingDraft (both source-workbook expense rows). Row1 has a real source date
--    (parsed = text); row2 has an impossible date with the flag off (parsed must be null). ────────────
select set_config('t.batch', public.fn_reconciliation_stable_uuid(
  'reconciliation_batch', :'srcsha', :'snapsha', :'orgA'::text)::text, false);
select set_config('t.ev1', public.fn_reconciliation_stable_uuid(
  'evidence_item','source_workbook_row', :'srcsha', 'المصروفات','R1')::text, false);
select set_config('t.ev2', public.fn_reconciliation_stable_uuid(
  'evidence_item','source_workbook_row', :'srcsha', 'المصروفات','R2')::text, false);
select set_config('t.row1', public.fn_reconciliation_stable_uuid(
  'reconciliation_batch_row', current_setting('t.batch'), current_setting('t.ev1'))::text, false);
select set_config('t.row2', public.fn_reconciliation_stable_uuid(
  'reconciliation_batch_row', current_setting('t.batch'), current_setting('t.ev2'))::text, false);

select set_config('t.m', jsonb_build_object(
  'batch', jsonb_build_object(
    'id', current_setting('t.batch'), 'org_id', :'orgA', 'source_workbook_sha256', :'srcsha', 'status','staged',
    'result_summary', jsonb_build_object(
      'evidence_item_count',2,'batch_row_count',2,
      'by_dataset', jsonb_build_object(
        'expense', jsonb_build_object(
          'exception_row_count',2,'source_occurrence_count',2,'production_occurrence_count',0,
          'classification_counts', jsonb_build_object('source_addition_candidate',2),
          'matched_invalid_calendar_quality_flag_count',0),
        'sale', jsonb_build_object(
          'exception_row_count',0,'source_occurrence_count',0,'production_occurrence_count',0,
          'classification_counts','{}'::jsonb,'matched_invalid_calendar_quality_flag_count',0)))),
  'evidence_items', jsonb_build_array(
    jsonb_build_object(
      'id', current_setting('t.ev1'),'org_id', :'orgA','origin_kind','source_workbook_row','dataset','expense',
      'classification','source_addition_candidate','source_workbook_sha256', :'srcsha',
      'sheet_name','المصروفات','row_locator','R1','production_snapshot_sha256',null,
      'snapshot_target_table',null,'snapshot_target_id',null,'source_identity_fingerprint',null,
      'invalid_calendar_quality_flag',false,'first_staged_batch_id', current_setting('t.batch'),
      'evidence_label','بند مصروف R1','source_amount','50.00',
      'source_date_text','2023-06-01','source_date_parsed','2023-06-01'),
    jsonb_build_object(
      'id', current_setting('t.ev2'),'org_id', :'orgA','origin_kind','source_workbook_row','dataset','expense',
      'classification','source_addition_candidate','source_workbook_sha256', :'srcsha',
      'sheet_name','المصروفات','row_locator','R2','production_snapshot_sha256',null,
      'snapshot_target_table',null,'snapshot_target_id',null,'source_identity_fingerprint',null,
      'invalid_calendar_quality_flag',false,'first_staged_batch_id', current_setting('t.batch'),
      'evidence_label','بند مصروف R2','source_amount','0',
      'source_date_text','2024-02-30','source_date_parsed',null)),
  'batch_rows', jsonb_build_array(
    jsonb_build_object('id', current_setting('t.row1'),
      'org_id', :'orgA','batch_id', current_setting('t.batch'),'evidence_item_id', current_setting('t.ev1'),
      'review_state','unreviewed','target_table',null,'disposition','hold'),
    jsonb_build_object('id', current_setting('t.row2'),
      'org_id', :'orgA','batch_id', current_setting('t.batch'),'evidence_item_id', current_setting('t.ev2'),
      'review_state','unreviewed','target_table',null,'disposition','hold')),
  'matched_invalid_calendar_quality_flags','[]'::jsonb,
  'tool_metadata', jsonb_build_object('production_snapshot_sha256', :'snapsha','exception_evidence_sha256', :'evsha')
)::text, false);

-- ══ 1) enriched staging persists the four fields exactly ══════════════════════════════════════════════
select pg_temp.as_user(current_setting('t.acct'));
select lives_ok(
  format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, %L::jsonb) $q$, :'orgA', current_setting('t.m')),
  'enriched manifest stages without error');
reset role;

select is((select evidence_label from public.reconciliation_evidence_items where id = current_setting('t.ev1')::uuid),
  'بند مصروف R1', 'evidence_label persisted');
select is((select source_amount from public.reconciliation_evidence_items where id = current_setting('t.ev1')::uuid),
  50.00, 'source_amount persisted as numeric');
select is((select source_date_text from public.reconciliation_evidence_items where id = current_setting('t.ev1')::uuid),
  '2023-06-01', 'source_date_text persisted verbatim');
select is((select source_date_parsed from public.reconciliation_evidence_items where id = current_setting('t.ev1')::uuid),
  '2023-06-01'::date, 'real source date parses to itself');
select is((select source_date_parsed from public.reconciliation_evidence_items where id = current_setting('t.ev2')::uuid),
  null, 'impossible source date (2024-02-30) parses to null');
select is((select source_date_text from public.reconciliation_evidence_items where id = current_setting('t.ev2')::uuid),
  '2024-02-30', 'impossible source date text preserved verbatim');

-- ══ 2) exact enriched replay is idempotent ═══════════════════════════════════════════════════════════
select pg_temp.as_user(current_setting('t.acct'));
select is(
  (select (public.fn_stage_reconciliation_manifest(:'orgA'::uuid, current_setting('t.m')::jsonb))->>'idempotent_replay'),
  'true', 'exact enriched replay is idempotent');
reset role;

-- ══ 3) malformed enriched values fail closed (validator, 22023) ══════════════════════════════════════
select pg_temp.as_user(current_setting('t.acct'));
select throws_ok(format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, %L::jsonb) $q$, :'orgA',
  jsonb_set(current_setting('t.m')::jsonb, '{evidence_items,0,source_amount}', '"-5"'::jsonb)),
  '22023', null, 'negative source_amount rejected');
select throws_ok(format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, %L::jsonb) $q$, :'orgA',
  jsonb_set(current_setting('t.m')::jsonb, '{evidence_items,0,source_date_text}', '"2023/06/01"'::jsonb)),
  '22023', null, 'malformed source_date_text rejected');
select throws_ok(format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, %L::jsonb) $q$, :'orgA',
  jsonb_set(current_setting('t.m')::jsonb, '{evidence_items,0,evidence_label}', '""'::jsonb)),
  '22023', null, 'empty evidence_label rejected');
select throws_ok(format($q$ select public.fn_stage_reconciliation_manifest(%L::uuid, %L::jsonb) $q$, :'orgA',
  jsonb_set(current_setting('t.m')::jsonb, '{evidence_items,0,source_date_parsed}', '"2020-01-01"'::jsonb)),
  '22023', null, 'source_date_parsed not matching the derivation rule is rejected');
reset role;

-- ══ 4) backward-safe: an evidence row with a null evidence_label is still valid ═══════════════════════
select lives_ok($$ insert into public.reconciliation_evidence_items
  (id, org_id, origin_kind, production_snapshot_sha256, snapshot_target_table, snapshot_target_id,
   classification, invalid_calendar_quality_flag, evidence_label)
  values ('e9000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-000000000001',
   'production_snapshot_row', '6666666666666666666666666666666666666666666666666666666666666666',
   'expenses', 'e9000000-0000-0000-0000-0000000000bb', 'production_orphan_candidate', false, null) $$,
  'a null evidence_label remains valid (backward-safe nullable column)');

-- ══ 5) included-expense account rule: active + kind match + leaf ══════════════════════════════════════
select pg_temp.as_user(current_setting('t.acct'));
-- inactive account rejected
select throws_ok(format($q$ select public.fn_review_reconciliation_row(%L::uuid, %L::jsonb) $q$,
  current_setting('t.row1'),
  jsonb_build_object('action','review','reason','مصروف','target_table','expenses',
    'expense', jsonb_build_object('category','أسمدة','kind','operating',
      'account_id','c1000000-0000-0000-0000-000000000002'))),
  '23514', null, 'inactive posting account rejected');
-- kind mismatch rejected (account kind operating, decision kind capex)
select throws_ok(format($q$ select public.fn_review_reconciliation_row(%L::uuid, %L::jsonb) $q$,
  current_setting('t.row1'),
  jsonb_build_object('action','review','reason','مصروف','target_table','expenses',
    'expense', jsonb_build_object('category','أسمدة','kind','capex',
      'account_id','c1000000-0000-0000-0000-000000000001'))),
  '23514', null, 'account kind must equal expense_kind');
-- non-leaf (parent with active child) rejected
select throws_ok(format($q$ select public.fn_review_reconciliation_row(%L::uuid, %L::jsonb) $q$,
  current_setting('t.row1'),
  jsonb_build_object('action','review','reason','مصروف','target_table','expenses',
    'expense', jsonb_build_object('category','أسمدة','kind','operating',
      'account_id','c1000000-0000-0000-0000-000000000003'))),
  '23514', null, 'non-leaf account (has active children) rejected');
reset role;

-- ══ 6) sale farm→sector→hawsha hierarchy ═════════════════════════════════════════════════════════════
select pg_temp.as_user(current_setting('t.acct'));
-- sector without farm rejected
select throws_ok(format($q$ select public.fn_review_reconciliation_row(%L::uuid, %L::jsonb) $q$,
  current_setting('t.row2'),
  jsonb_build_object('action','review','reason','بيع','target_table','sales',
    'sale', jsonb_build_object('crop','برحي','quantity',1,'unit_price',1,'recorded_total',1,
      'sector_id','50000000-0000-0000-0000-000000000001'))),
  '23514', null, 'sale_sector_id without sale_farm_id rejected');
-- sector not belonging to the given farm rejected (S1 belongs to F1, not F2)
select throws_ok(format($q$ select public.fn_review_reconciliation_row(%L::uuid, %L::jsonb) $q$,
  current_setting('t.row2'),
  jsonb_build_object('action','review','reason','بيع','target_table','sales',
    'sale', jsonb_build_object('crop','برحي','quantity',1,'unit_price',1,'recorded_total',1,
      'farm_id','f1000000-0000-0000-0000-000000000002','sector_id','50000000-0000-0000-0000-000000000001'))),
  '23514', null, 'sector not belonging to the chosen farm rejected');
-- hawsha not belonging to the given sector rejected (H1 belongs to S1, not S2)
select throws_ok(format($q$ select public.fn_review_reconciliation_row(%L::uuid, %L::jsonb) $q$,
  current_setting('t.row2'),
  jsonb_build_object('action','review','reason','بيع','target_table','sales',
    'sale', jsonb_build_object('crop','برحي','quantity',1,'unit_price',1,'recorded_total',1,
      'farm_id','f1000000-0000-0000-0000-000000000002','sector_id','50000000-0000-0000-0000-000000000002',
      'hawsha_id','40000000-0000-0000-0000-000000000001'))),
  '23514', null, 'hawsha not belonging to the chosen sector rejected');
reset role;

-- ══ 7) valid decisions succeed (leaf/kind account; full valid hierarchy) ═════════════════════════════
select pg_temp.as_user(current_setting('t.acct'));
select lives_ok(format($q$ select public.fn_review_reconciliation_row(%L::uuid, %L::jsonb) $q$,
  current_setting('t.row1'),
  jsonb_build_object('action','review','reason','مصروف صحيح','target_table','expenses',
    'expense', jsonb_build_object('category','أسمدة','kind','operating',
      'account_id','c1000000-0000-0000-0000-000000000001'))),
  'included expense with an active leaf account of matching kind is accepted');
select lives_ok(format($q$ select public.fn_review_reconciliation_row(%L::uuid, %L::jsonb) $q$,
  current_setting('t.row2'),
  jsonb_build_object('action','review','reason','بيع صحيح','target_table','sales',
    'sale', jsonb_build_object('crop','برحي','quantity',1,'unit_price',1,'recorded_total',1,
      'farm_id','f1000000-0000-0000-0000-000000000001','sector_id','50000000-0000-0000-0000-000000000001',
      'hawsha_id','40000000-0000-0000-0000-000000000001'))),
  'a full valid farm→sector→hawsha hierarchy is accepted');
reset role;

select * from finish();
rollback;
