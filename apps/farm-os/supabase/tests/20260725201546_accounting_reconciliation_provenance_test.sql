-- Accounting reconciliation slice 1A (migration 20260725201546). Validates the three new tables'
-- structure, FORCE RLS + finance-read gating, deny-by-default client DML, the reconciliation.write
-- authorize() gate (additive — existing permissions unchanged), the evidence-item locator-shape/
-- uniqueness invariants, batch-row typed/enum/correction constraints, correction-target/classification
-- consistency, cross-org reference rejection, the freeze-immutability guard, and the audit_read finance
-- gate. Run via test-shims/run-pgtap-local.sh (no Docker; superuser fixtures bypass RLS by design —
-- FORCE RLS itself is checked against the remote project per the farm-os skill's documented harness
-- caveat).

begin;
select plan(58);

\set orgA '00000000-0000-0000-0000-000000000001'
\set orgB 'accc0001-0000-0000-0000-000000000002'
\set userB 'accc0002-0000-0000-0000-000000000002'

-- ── fixtures (superuser, RLS-bypassing) ─────────────────────────────────────────────────────────────
select set_config('t.owner', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'owner' limit 1), false);
select set_config('t.accountant', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'accountant' limit 1), false);
select set_config('t.fm', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'farm_manager' limit 1), false);
select set_config('t.store', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'storekeeper' limit 1), false);

insert into public.organization (id, name) values (:'orgB', 'مزرعة أخرى — reconciliation test');
insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
  values (:'userB', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());
insert into public.organization_member (org_id, user_id, role) values (:'orgB', :'userB', 'accountant');

-- one batch each in org A and org B
insert into public.reconciliation_batches (id, org_id, source_workbook_sha256, source_label, status)
  values ('a1000000-0000-0000-0000-000000000001', :'orgA', repeat('a',64), 'July workbook', 'staged');
insert into public.reconciliation_batches (id, org_id, source_workbook_sha256, source_label, status)
  values ('b1000000-0000-0000-0000-000000000001', :'orgB', repeat('b',64), 'other org workbook', 'staged');

-- a valid source-workbook evidence item and a valid production-snapshot evidence item, both org A
insert into public.reconciliation_evidence_items
  (id, org_id, origin_kind, source_workbook_sha256, sheet_name, row_locator,
   source_identity_fingerprint, source_amount, source_date_text, classification)
  values ('e1000000-0000-0000-0000-000000000001', :'orgA', 'source_workbook_row',
          repeat('a',64), 'المصروفات', 'A100', 'fp-100', 500, '2026-01-15', 'source_addition_candidate');
-- Codex finding 2: a production-snapshot (orphan) evidence item has no workbook cell, so it carries NO
-- source-only value/date (no source_amount / source_date_text / source_date_parsed).
insert into public.reconciliation_evidence_items
  (id, org_id, origin_kind, production_snapshot_sha256, snapshot_target_table, snapshot_target_id,
   source_identity_fingerprint, classification)
  values ('e2000000-0000-0000-0000-000000000001', :'orgA', 'production_snapshot_row',
          repeat('c',64), 'expenses', 'f0000000-0000-0000-0000-000000000001',
          'fp-200', 'production_orphan_candidate');

-- ── structure ────────────────────────────────────────────────────────────────────────────────────────
select has_table('public', 'reconciliation_batches', 'reconciliation_batches table exists');
select has_table('public', 'reconciliation_evidence_items', 'reconciliation_evidence_items table exists');
select has_table('public', 'reconciliation_batch_rows', 'reconciliation_batch_rows table exists');
select is((select relforcerowsecurity from pg_class where relname = 'reconciliation_batches'), true,
  'reconciliation_batches: FORCE row level security is on');
select is((select relforcerowsecurity from pg_class where relname = 'reconciliation_evidence_items'), true,
  'reconciliation_evidence_items: FORCE row level security is on');
select is((select relforcerowsecurity from pg_class where relname = 'reconciliation_batch_rows'), true,
  'reconciliation_batch_rows: FORCE row level security is on');

-- ── no public/anon DML widening; no client insert/update/delete grant to authenticated either (no RPC
--    exists in this slice, so there is no client write path at all yet). ───────────────────────────────
select ok(
  not has_table_privilege('anon', 'public.reconciliation_batches', 'SELECT')
  and not has_table_privilege('anon', 'public.reconciliation_evidence_items', 'SELECT')
  and not has_table_privilege('anon', 'public.reconciliation_batch_rows', 'SELECT'),
  'anon holds no SELECT grant on any of the three tables');
select ok(
  not has_table_privilege('authenticated', 'public.reconciliation_batches', 'INSERT')
  and not has_table_privilege('authenticated', 'public.reconciliation_evidence_items', 'INSERT')
  and not has_table_privilege('authenticated', 'public.reconciliation_batch_rows', 'INSERT')
  and not has_table_privilege('authenticated', 'public.reconciliation_batches', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.reconciliation_evidence_items', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.reconciliation_batch_rows', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.reconciliation_batches', 'DELETE')
  and not has_table_privilege('authenticated', 'public.reconciliation_evidence_items', 'DELETE')
  and not has_table_privilege('authenticated', 'public.reconciliation_batch_rows', 'DELETE'),
  'authenticated holds no INSERT/UPDATE/DELETE grant on any of the three tables');

-- ── authenticated direct DML denied (as an actual statement, not just a grant check) ──────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.accountant'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  $$insert into public.reconciliation_batches (org_id, status) values ('00000000-0000-0000-0000-000000000001', 'staged')$$,
  '42501', null, 'authenticated direct INSERT into reconciliation_batches is denied');
reset role;

-- ── reconciliation.write authorize() gate: owner/accountant true, farm_manager/storekeeper false ─────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);
select is(public.authorize('reconciliation.write', :'orgA'), true, 'owner has reconciliation.write');
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.accountant'), 'role', 'authenticated')::text, true);
select is(public.authorize('reconciliation.write', :'orgA'), true, 'accountant has reconciliation.write');
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role', 'authenticated')::text, true);
select is(public.authorize('reconciliation.write', :'orgA'), false, 'farm_manager lacks reconciliation.write');
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.store'), 'role', 'authenticated')::text, true);
select is(public.authorize('reconciliation.write', :'orgA'), false, 'storekeeper lacks reconciliation.write');

-- ── existing representative permissions remain unchanged (re-emit did not drop anything) ──────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);
select is(public.authorize('site.write', :'orgA'), true, 'owner still has site.write (last prior re-emit)');
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.accountant'), 'role', 'authenticated')::text, true);
select is(public.authorize('budget.write', :'orgA'), true, 'accountant still has budget.write');
select is(public.authorize('finance.read', :'orgA'), true, 'accountant still has finance.read');
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role', 'authenticated')::text, true);
select is(public.authorize('plan.write', :'orgA'), true, 'farm_manager still has plan.write');

-- ── finance reader (accountant) reads same-org rows, not cross-org rows; non-finance role reads none ──
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.accountant'), 'role', 'authenticated')::text, true);
set local role authenticated;
select isnt((select count(*) from public.reconciliation_batches where org_id = :'orgA'), 0::bigint,
  'finance reader (accountant) sees same-org reconciliation_batches rows');
select is((select count(*) from public.reconciliation_batches where org_id = :'orgB'), 0::bigint,
  'finance reader (accountant) cannot read cross-org reconciliation_batches rows');
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*) from public.reconciliation_batches where org_id = :'orgA'), 0::bigint,
  'non-finance role (farm_manager) cannot read reconciliation_batches at all');
reset role;

-- ── locator-shape check: valid shapes lives_ok; both/neither rejected ─────────────────────────────────
select lives_ok(
  format($$insert into public.reconciliation_evidence_items
            (org_id, origin_kind, source_workbook_sha256, sheet_name, row_locator,
             source_identity_fingerprint, source_amount, classification)
            values (%L, 'source_workbook_row', %L, 'المصروفات', 'A101', 'fp-101', 100, 'source_addition_candidate')$$,
         :'orgA', repeat('a',64)),
  'source-workbook locator shape is valid and inserts');
select lives_ok(
  format($$insert into public.reconciliation_evidence_items
            (org_id, origin_kind, production_snapshot_sha256, snapshot_target_table, snapshot_target_id,
             source_identity_fingerprint, classification)
            values (%L, 'production_snapshot_row', %L, 'sales', 'f0000000-0000-0000-0000-000000000002',
                    'fp-201', 'production_orphan_candidate')$$,
         :'orgA', repeat('c',64)),
  'production-snapshot locator shape is valid and inserts');
-- Codex finding 2: a production-snapshot row carrying any source-only value/date field is rejected,
-- since an orphan has no workbook cell to source that value/date from.
select throws_ok(
  format($$insert into public.reconciliation_evidence_items
            (org_id, origin_kind, production_snapshot_sha256, snapshot_target_table, snapshot_target_id,
             source_identity_fingerprint, source_amount, classification)
            values (%L, 'production_snapshot_row', %L, 'sales', 'f0000000-0000-0000-0000-000000000098',
                    'fp-badsrc', 100, 'production_orphan_candidate')$$,
         :'orgA', repeat('c',64)),
  '23514', null, 'a production-snapshot row carrying a source-only field (source_amount) is rejected');
select throws_ok(
  format($$insert into public.reconciliation_evidence_items
            (org_id, origin_kind, source_workbook_sha256, sheet_name, row_locator,
             production_snapshot_sha256, snapshot_target_table, snapshot_target_id,
             source_identity_fingerprint, classification)
            values (%L, 'source_workbook_row', %L, 'x', 'A1', %L, 'expenses', 'f0000000-0000-0000-0000-000000000003',
                    'fp-both', 'source_addition_candidate')$$,
         :'orgA', repeat('a',64), repeat('c',64)),
  '23514', null, 'both locator shapes populated is rejected');
select throws_ok(
  format($$insert into public.reconciliation_evidence_items
            (org_id, origin_kind, source_identity_fingerprint, classification)
            values (%L, 'source_workbook_row', 'fp-neither', 'source_addition_candidate')$$, :'orgA'),
  '23514', null, 'neither locator shape populated is rejected');

-- ── partial unique indexes: each rejects only a duplicate within its own origin_kind ───────────────────
select throws_ok(
  format($$insert into public.reconciliation_evidence_items
            (org_id, origin_kind, source_workbook_sha256, sheet_name, row_locator,
             source_identity_fingerprint, classification)
            values (%L, 'source_workbook_row', %L, 'المصروفات', 'A100', 'fp-dup', 'source_addition_candidate')$$,
         :'orgA', repeat('a',64)),
  '23505', null, 'duplicate workbook locator (same sheet/row/sha) is rejected');
select throws_ok(
  format($$insert into public.reconciliation_evidence_items
            (org_id, origin_kind, production_snapshot_sha256, snapshot_target_table, snapshot_target_id,
             source_identity_fingerprint, classification)
            values (%L, 'production_snapshot_row', %L, 'expenses', 'f0000000-0000-0000-0000-000000000001',
                    'fp-dup2', 'production_orphan_candidate')$$,
         :'orgA', repeat('c',64)),
  '23505', null, 'duplicate production-snapshot target is rejected');
select lives_ok(
  format($$insert into public.reconciliation_evidence_items
            (org_id, origin_kind, production_snapshot_sha256, snapshot_target_table, snapshot_target_id,
             source_identity_fingerprint, classification)
            values (%L, 'production_snapshot_row', %L, 'expenses', 'f0000000-0000-0000-0000-000000000099',
                    'fp-dup3', 'production_orphan_candidate')$$,
         :'orgA', repeat('c',64)),
  'same snapshot sha256 with a different target id does not collide with the snapshot partial index');

-- ── composite tenant FK (Codex finding 1): an org-A evidence item cannot name an org-B batch as its
--    first_staged_batch_id ───────────────────────────────────────────────────────────────────────────
select throws_ok(
  format($$insert into public.reconciliation_evidence_items
            (org_id, origin_kind, source_workbook_sha256, sheet_name, row_locator,
             source_identity_fingerprint, classification, first_staged_batch_id)
            values (%L, 'source_workbook_row', %L, 'المصروفات', 'A102', 'fp-crossbatch',
                    'source_addition_candidate', %L)$$,
         :'orgA', repeat('a',64), 'b1000000-0000-0000-0000-000000000001'),
  '23503', null, 'cross-org first_staged_batch_id (org A evidence item, org B batch) is rejected');

-- ── batch rows: a duplicate evidence item CAN be reviewed in a second batch; NOT twice in one batch ────
insert into public.reconciliation_batches (id, org_id, status) values ('a1000000-0000-0000-0000-000000000002', :'orgA', 'staged');
select lives_ok(
  format($$insert into public.reconciliation_batch_rows (org_id, batch_id, evidence_item_id)
            values (%L, 'a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001')$$, :'orgA'),
  'evidence item reviewed in batch 1');
select lives_ok(
  format($$insert into public.reconciliation_batch_rows (org_id, batch_id, evidence_item_id)
            values (%L, 'a1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001')$$, :'orgA'),
  'the SAME evidence item can be reviewed again in a second, distinct batch');
select throws_ok(
  format($$insert into public.reconciliation_batch_rows (org_id, batch_id, evidence_item_id)
            values (%L, 'a1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001')$$, :'orgA'),
  '23505', null, 'the same evidence item cannot appear twice in one batch');

-- ── cross-org batch/evidence/reviewer/target references rejected ───────────────────────────────────────
select throws_ok(
  format($$insert into public.reconciliation_batch_rows (org_id, batch_id, evidence_item_id)
            values (%L, 'b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001')$$, :'orgA'),
  '23503', null, 'cross-org batch_id (org A row, org B batch) is rejected');
select throws_ok(
  format($$insert into public.reconciliation_batch_rows (org_id, batch_id, evidence_item_id)
            values (%L, 'a1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001')$$, :'orgB'),
  '23503', null, 'cross-org evidence_item_id (org B row, org A evidence item) is rejected');
select throws_ok(
  format($$insert into public.reconciliation_batch_rows (org_id, batch_id, evidence_item_id, reviewer_id)
            values (%L, 'a1000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000001', %L)$$,
         :'orgA', :'userB'),
  '23514', null, 'cross-org reviewer_id (org B member reviewing an org A row) is rejected');
insert into public.expenses (id, org_id, category, kind, total) values
  ('f5000000-0000-0000-0000-000000000009', :'orgB', 'seed', 'operating', 10);
select throws_ok(
  format($$insert into public.reconciliation_batch_rows
            (org_id, batch_id, evidence_item_id, target_table, corrects_expense_id)
            values (%L, 'a1000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000001',
                    'expenses', %L)$$,
         :'orgA', 'f5000000-0000-0000-0000-000000000009'),
  '23514', null, 'cross-org correction target (corrects_expense_id from org B) is rejected');

-- ── typed expense/sale constraints; correction target/domain consistency ───────────────────────────────
select throws_ok(
  format($$insert into public.reconciliation_batch_rows
            (org_id, batch_id, evidence_item_id, target_table, disposition)
            values (%L, 'a1000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000001',
                    'expenses', 'include')$$, :'orgA'),
  '23514', null, 'an included expenses row missing expense_category/kind/account is rejected');
select throws_ok(
  format($$insert into public.reconciliation_batch_rows
            (org_id, batch_id, evidence_item_id, target_table, disposition, sale_crop)
            values (%L, 'a1000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000001',
                    'sales', 'include', 'برحي')$$, :'orgA'),
  '23514', null, 'an included sales row missing quantity/unit_price/recorded_total is rejected');
insert into public.sales (id, org_id, crop) values ('f6000000-0000-0000-0000-000000000001', :'orgA', 'برحي');
select throws_ok(
  format($$insert into public.reconciliation_batch_rows
            (org_id, batch_id, evidence_item_id, target_table, corrects_sale_id)
            values (%L, 'a1000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000001',
                    'expenses', %L)$$, :'orgA', 'f6000000-0000-0000-0000-000000000001'),
  '23514', null, 'corrects_sale_id set while target_table = expenses is a domain mismatch, rejected');

-- ── correction target tied to correction classification (Codex finding 4): a correction id is only
--    valid when the same-org evidence item (selected via evidence_item_id) is classified
--    amount_correction_candidate, and an included amount_correction_candidate row must carry exactly the
--    domain-matching correction id ──────────────────────────────────────────────────────────────────────
insert into public.reconciliation_batches (id, org_id, status) values ('a1000000-0000-0000-0000-000000000003', :'orgA', 'staged');
insert into public.reconciliation_evidence_items
  (id, org_id, origin_kind, source_workbook_sha256, sheet_name, row_locator,
   source_identity_fingerprint, classification)
  values ('e5000000-0000-0000-0000-000000000001', :'orgA', 'source_workbook_row',
          repeat('a',64), 'التصحيحات', 'C200', 'fp-corr', 'amount_correction_candidate');
insert into public.expenses (id, org_id, category, total) values
  ('f7000000-0000-0000-0000-000000000001', :'orgA', 'seed', 50);

select throws_ok(
  format($$insert into public.reconciliation_batch_rows
            (org_id, batch_id, evidence_item_id, target_table, corrects_expense_id)
            values (%L, 'a1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001',
                    'expenses', %L)$$,
         :'orgA', 'f7000000-0000-0000-0000-000000000001'),
  '23514', null, 'corrects_expense_id on a non-amount_correction_candidate evidence item is rejected');

select throws_ok(
  format($$insert into public.reconciliation_batch_rows
            (org_id, batch_id, evidence_item_id, target_table, disposition,
             expense_category, expense_kind, expense_account_id)
            values (%L, 'a1000000-0000-0000-0000-000000000003', 'e5000000-0000-0000-0000-000000000001',
                    'expenses', 'include', 'seed', 'operating', %L)$$,
         :'orgA', (select id from public.accounts where org_id = :'orgA' limit 1)),
  '23514', null,
  'an included amount_correction_candidate expenses row missing corrects_expense_id is rejected');

select lives_ok(
  format($$insert into public.reconciliation_batch_rows
            (org_id, batch_id, evidence_item_id, target_table, disposition,
             expense_category, expense_kind, expense_account_id, corrects_expense_id)
            values (%L, 'a1000000-0000-0000-0000-000000000003', 'e5000000-0000-0000-0000-000000000001',
                    'expenses', 'include', 'seed', 'operating', %L, %L)$$,
         :'orgA', (select id from public.accounts where org_id = :'orgA' limit 1),
         'f7000000-0000-0000-0000-000000000001'),
  'a valid included amount_correction_candidate expenses row with matching corrects_expense_id lives');

-- ── ambiguous/invalid-date rows default to 'hold' (safe default; applies to every new row) ─────────────
insert into public.reconciliation_evidence_items
  (id, org_id, origin_kind, source_workbook_sha256, sheet_name, row_locator,
   source_identity_fingerprint, classification, invalid_calendar_quality_flag)
  values ('e3000000-0000-0000-0000-000000000001', :'orgA', 'source_workbook_row', repeat('a',64),
          'المبيعات', 'B129', 'fp-badcal', 'ambiguous_identity_group', true);
insert into public.reconciliation_batch_rows (id, org_id, batch_id, evidence_item_id)
  values ('c1000000-0000-0000-0000-000000000001', :'orgA', 'a1000000-0000-0000-0000-000000000002',
          'e3000000-0000-0000-0000-000000000001');
select is(
  (select disposition from public.reconciliation_batch_rows where id = 'c1000000-0000-0000-0000-000000000001'),
  'hold', 'a newly staged row (ambiguous/invalid-calendar included) defaults to disposition = hold');

-- ── freeze-immutability: frozen payload edit rejected; unfreeze rejected; bookkeeping update accepted ──
insert into public.reconciliation_batch_rows
  (id, org_id, batch_id, evidence_item_id, target_table, disposition,
   expense_category, expense_kind, expense_account_id, payload_hash, frozen, frozen_at)
  values ('c2000000-0000-0000-0000-000000000001', :'orgA', 'a1000000-0000-0000-0000-000000000002',
          'e2000000-0000-0000-0000-000000000001', 'expenses', 'include', 'seed', 'operating',
          (select id from public.accounts where org_id = :'orgA' limit 1),
          'deadbeef', true, now());
select throws_ok(
  $$update public.reconciliation_batch_rows set expense_category = 'changed'
    where id = 'c2000000-0000-0000-0000-000000000001'$$,
  '22023', null, 'editing a typed reviewed column on a frozen row is rejected');
select throws_ok(
  $$update public.reconciliation_batch_rows set frozen = false
    where id = 'c2000000-0000-0000-0000-000000000001'$$,
  '22023', null, 'unfreezing a frozen row is rejected');
-- Codex finding 3: frozen rows must not accept changes to row identity/creation provenance either.
select throws_ok(
  format($$update public.reconciliation_batch_rows set id = %L
    where id = 'c2000000-0000-0000-0000-000000000001'$$, 'c2000000-0000-0000-0000-000000000099'),
  '22023', null, 'changing id on a frozen row is rejected');
select throws_ok(
  format($$update public.reconciliation_batch_rows set created_by = %L
    where id = 'c2000000-0000-0000-0000-000000000001'$$, :'userB'),
  '22023', null, 'changing created_by on a frozen row is rejected');
select lives_ok(
  $$update public.reconciliation_batch_rows set execution_result = 'posted'
    where id = 'c2000000-0000-0000-0000-000000000001'$$,
  'the allowed execution-bookkeeping column (execution_result) can still be updated while frozen');
select lives_ok(
  $$update public.reconciliation_batch_rows set execution_error = 'posting failed: timeout'
    where id = 'c2000000-0000-0000-0000-000000000001'$$,
  'the allowed execution-bookkeeping column (execution_error) can still be updated while frozen');

-- ── audit: rows recorded, visible only through the finance gate ────────────────────────────────────────
select isnt((select count(*) from public.audit_log where entity_type = 'reconciliation_batch'), 0::bigint,
  'reconciliation_batches writes are recorded in audit_log');
select isnt((select count(*) from public.audit_log where entity_type = 'reconciliation_evidence_item'), 0::bigint,
  'reconciliation_evidence_items writes are recorded in audit_log');
select isnt((select count(*) from public.audit_log where entity_type = 'reconciliation_batch_row'), 0::bigint,
  'reconciliation_batch_rows writes are recorded in audit_log');
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.accountant'), 'role', 'authenticated')::text, true);
set local role authenticated;
select isnt(
  (select count(*) from public.audit_log where entity_type = 'reconciliation_batch' and org_id = :'orgA'), 0::bigint,
  'finance reader (accountant) can see reconciliation_batch audit rows for their own org');
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role', 'authenticated')::text, true);
set local role authenticated;
select is(
  (select count(*) from public.audit_log where entity_type = 'reconciliation_batch' and org_id = :'orgA'), 0::bigint,
  'a non-finance role (farm_manager) cannot see reconciliation_batch audit rows at all');
reset role;

-- ── redaction discipline: free-text review_reason never leaks into a raised error/notice ────────────────
select throws_ok(
  format($$insert into public.reconciliation_batch_rows
            (org_id, batch_id, evidence_item_id, target_table, disposition, review_reason)
            values (%L, 'a1000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000001',
                    'expenses', 'include', 'PRIVATE-REASON-TOKEN-XYZ')$$, :'orgA'),
  '23514', 'new row for relation "reconciliation_batch_rows" violates check constraint "reconciliation_batch_rows_target_required"',
  'a rejected insert error message does not echo the free-text review_reason value');

-- ── migration-replay structural invariant: the two partial unique indexes exist exactly once each ──────
select is(
  (select count(*) from pg_indexes where indexname = 'reconciliation_evidence_items_workbook_position_uq'),
  1::bigint, 'workbook-position partial unique index exists exactly once');
select is(
  (select count(*) from pg_indexes where indexname = 'reconciliation_evidence_items_snapshot_position_uq'),
  1::bigint, 'snapshot-position partial unique index exists exactly once');
select is(
  (select count(*) from pg_trigger where tgname = 'guard_frozen_batch_row_immutable' and not tgisinternal),
  1::bigint, 'freeze-immutability trigger exists exactly once');

select * from finish();
rollback;
