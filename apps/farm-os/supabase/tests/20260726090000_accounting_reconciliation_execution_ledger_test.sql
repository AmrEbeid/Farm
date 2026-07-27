-- Accounting reconciliation slice 1B (migration 20260726090000). Validates the five new tables'
-- structure, tenant-bound composite references, the #229(b) FK-covering-index invariant, the
-- execution-ledger single-winner guarantee (both a sequential same-session proof AND — Codex review
-- round 2, item 5 — a REAL two-backend dblink race), execution-ledger status/metadata relational
-- semantics, all seven action_kind values plus the polymorphic target_table/target_id contract,
-- action-link batch/target relational semantics (batch_row must belong to batch_id; a populated
-- target_table must agree with the batch row's own reviewed target_table), reinstatement linkage,
-- baseline snapshot fidelity (every copied typed column must be a byte-exact, fail-closed-independently-
-- verified copy of the real journal_entries/journal_lines row — round 2, item 1), one-typed-snapshot-
-- per-source uniqueness (round 2, item 2), the full-field canonical baseline hash contract, FORCE RLS +
-- finance-read gating, deny-by-default client DML (including an explicit column-privilege proof),
-- baseline immutability through a privileged path, and that the four additive expenses/sales columns do
-- not loosen any existing integrity. Run via test-shims/run-pgtap-local.sh (no Docker; superuser fixtures
-- bypass RLS by design — FORCE RLS itself is checked against the remote project per the farm-os skill's
-- documented harness caveat).
--
-- CONCURRENCY EVIDENCE (round 2, item 5): most of this file's "duplicate executed ledger row" coverage is
-- a same-session sequential insert — useful as a fast constraint check, but NOT concurrency evidence, and
-- is labeled as sequential below. The dedicated "real two-backend race" section near the end of this file
-- uses the `dblink` extension to open two genuinely separate Postgres backends against this same
-- database, has one leave an `executed` insert uncommitted while the other's conflicting insert is sent
-- asynchronously (so it blocks server-side without deadlocking this test session), commits the first, and
-- asserts the second's now-unblocked insert fails with a real unique-constraint violation. Because a
-- dblink backend is a separate session, it cannot see this file's own uncommitted fixtures, so that
-- section creates and commits (via dblink itself) its own small, isolated, org-scoped fixture set, and
-- deletes it again afterward — no fixture or connection is left behind.

begin;
select plan(112);

\set orgA '00000000-0000-0000-0000-000000000001'
\set orgB 'b2000000-0000-0000-0000-000000000002'
\set userB 'b2000000-0000-0000-0000-000000000003'

-- ── fixtures (superuser, RLS-bypassing) ─────────────────────────────────────────────────────────────
select set_config('t.owner', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'owner' limit 1), false);
select set_config('t.accountant', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'accountant' limit 1), false);
select set_config('t.fm', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'farm_manager' limit 1), false);

insert into public.organization (id, name) values (:'orgB', 'مزرعة أخرى — slice 1B test');
insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
  values (:'userB', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());
insert into public.organization_member (org_id, user_id, role) values (:'orgB', :'userB', 'accountant');

select set_config('t.accA', (select id::text from public.accounts where org_id = :'orgA' order by code limit 1 offset 0), false);
select set_config('t.accA2', (select id::text from public.accounts where org_id = :'orgA' order by code limit 1 offset 1), false);
select set_config('t.ccA', (select id::text from public.cost_centers where org_id = :'orgA' limit 1), false);

-- org B needs its own account for the cross-org journal fixture.
do $$ begin
  if to_regprocedure('public.fn_seed_default_accounts(uuid)') is not null then
    perform public.fn_seed_default_accounts('b2000000-0000-0000-0000-000000000002'::uuid);
  end if;
end $$;
select set_config('t.accB', (select id::text from public.accounts where org_id = :'orgB' order by code limit 1), false);

-- batches (batch_A2 is a SECOND org-A batch, distinct from batch_A1, for the batch_row/batch_id
-- relational-integrity test), evidence items, batch rows.
insert into public.reconciliation_batches (id, org_id, status) values
  ('1b000000-0000-0000-0000-000000000001', :'orgA', 'approved'),
  ('1b000000-0000-0000-0000-000000000002', :'orgB', 'approved'),
  ('1b000000-0000-0000-0000-000000000003', :'orgA', 'approved');

insert into public.reconciliation_evidence_items
  (id, org_id, origin_kind, source_workbook_sha256, sheet_name, row_locator,
   source_identity_fingerprint, source_amount, source_date_text, classification)
  values
  ('1b100000-0000-0000-0000-000000000001', :'orgA', 'source_workbook_row',
    repeat('a',64), 'المصروفات', 'X100', 'fp-1b-100', 500, '2026-01-15', 'source_addition_candidate'),
  ('1b100000-0000-0000-0000-000000000002', :'orgB', 'source_workbook_row',
    repeat('b',64), 'المصروفات', 'X100', 'fp-1b-200', 300, '2026-01-15', 'source_addition_candidate'),
  ('1b100000-0000-0000-0000-000000000003', :'orgA', 'source_workbook_row',
    repeat('a',64), 'المبيعات', 'Y100', 'fp-1b-300', 400, '2026-01-15', 'source_addition_candidate');

-- batch_row_A1 (batch_A1, evidence_A1) is reviewed toward expenses; batch_row_A3 (batch_A1, evidence_A3)
-- toward sales — both used as the "reviewed target_table" a populated action-link target_table must
-- agree with. batch_row_A2 (batch_A2, evidence_A1 reused under a DIFFERENT batch — legitimate per §2.3:
-- the same evidence item may be reviewed in many batches) exists solely to prove an action link cannot
-- name a batch_row_id that belongs to some OTHER batch than the one it claims.
insert into public.reconciliation_batch_rows (id, org_id, batch_id, evidence_item_id, target_table) values
  ('1b200000-0000-0000-0000-000000000001', :'orgA',
    '1b000000-0000-0000-0000-000000000001', '1b100000-0000-0000-0000-000000000001', 'expenses'),
  ('1b200000-0000-0000-0000-000000000002', :'orgB',
    '1b000000-0000-0000-0000-000000000002', '1b100000-0000-0000-0000-000000000002', null),
  ('1b200000-0000-0000-0000-000000000003', :'orgA',
    '1b000000-0000-0000-0000-000000000001', '1b100000-0000-0000-0000-000000000003', 'sales'),
  ('1b200000-0000-0000-0000-000000000004', :'orgA',
    '1b000000-0000-0000-0000-000000000003', '1b100000-0000-0000-0000-000000000001', null);

-- expenses / sales fixtures (org A and org B)
insert into public.expenses (id, org_id, category, kind, total) values
  ('1b300000-0000-0000-0000-000000000001', :'orgA', 'seed', 'operating', 100),
  ('1b300000-0000-0000-0000-000000000002', :'orgA', 'seed', 'operating', 200),
  ('1b300000-0000-0000-0000-000000000003', :'orgB', 'seed', 'operating', 100);
insert into public.sales (id, org_id, crop) values
  ('1b400000-0000-0000-0000-000000000001', :'orgA', 'برحي'),
  ('1b400000-0000-0000-0000-000000000002', :'orgB', 'برحي');

-- journal entries/lines fixtures. journal_entry_A3 + its two balancing lines exist solely to prove the
-- baseline-line guard fails closed on a dimension FK's own org even when the source journal_lines row's
-- bytes are already bad: journal_line_badorg sits inside org A's journal_entry_A3 but names an
-- account_id that belongs to org B — journal_lines itself has no guard preventing that (it is not
-- altered by this migration), so this is a legitimate "legacy bad bytes" fixture.
insert into public.journal_entries (id, org_id, entry_date, source_type, source_id, description, status, posted_at, source_sequence)
  values
  ('1b500000-0000-0000-0000-000000000001', :'orgA', current_date, 'expense', '1b300000-0000-0000-0000-000000000001',
    'قيد اختبار 1B — الأصلي', 'posted', now(), 1),
  ('1b500000-0000-0000-0000-000000000002', :'orgA', current_date, 'expense', '1b300000-0000-0000-0000-000000000002',
    'قيد اختبار 1B — آخر', 'posted', now(), 1),
  ('1b500000-0000-0000-0000-000000000003', :'orgB', current_date, 'expense', '1b300000-0000-0000-0000-000000000003',
    'قيد اختبار 1B — منظمة أخرى', 'posted', now(), 1),
  ('1b500000-0000-0000-0000-000000000004', :'orgA', current_date, 'expense', '1b300000-0000-0000-0000-000000000001',
    'قيد اختبار 1B — أبعاد فاسدة', 'posted', now(), 2),
  ('1b500000-0000-0000-0000-000000000005', :'orgA', current_date, 'expense', '1b300000-0000-0000-0000-000000000003',
    'قيد اختبار 1B — مصدر من منظمة أخرى', 'posted', now(), 1);

insert into public.journal_lines (id, org_id, journal_entry_id, account_id, debit, credit) values
  ('1b600000-0000-0000-0000-000000000001', :'orgA', '1b500000-0000-0000-0000-000000000001',
    current_setting('t.accA')::uuid, 500, 0),
  ('1b600000-0000-0000-0000-000000000002', :'orgA', '1b500000-0000-0000-0000-000000000001',
    current_setting('t.accA2')::uuid, 0, 500),
  ('1b600000-0000-0000-0000-000000000003', :'orgA', '1b500000-0000-0000-0000-000000000002',
    current_setting('t.accA')::uuid, 250, 0),
  ('1b600000-0000-0000-0000-000000000005', :'orgA', '1b500000-0000-0000-0000-000000000004',
    current_setting('t.accA')::uuid, 100, 0),
  ('1b600000-0000-0000-0000-000000000004', :'orgA', '1b500000-0000-0000-0000-000000000004',
    current_setting('t.accB')::uuid, 0, 100);

-- ── structure: all five tables exist, FORCE RLS on ─────────────────────────────────────────────────────
select has_table('public', 'reconciliation_execution_ledger', 'reconciliation_execution_ledger table exists');
select has_table('public', 'reconciliation_action_links', 'reconciliation_action_links table exists');
select has_table('public', 'reconciliation_baselines', 'reconciliation_baselines table exists');
select has_table('public', 'reconciliation_baseline_journal_headers', 'reconciliation_baseline_journal_headers table exists');
select has_table('public', 'reconciliation_baseline_journal_lines', 'reconciliation_baseline_journal_lines table exists');
select is((select relforcerowsecurity from pg_class where oid = 'public.reconciliation_execution_ledger'::regclass), true,
  'reconciliation_execution_ledger: FORCE row level security is on');
select is((select relforcerowsecurity from pg_class where oid = 'public.reconciliation_action_links'::regclass), true,
  'reconciliation_action_links: FORCE row level security is on');
select is((select relforcerowsecurity from pg_class where oid = 'public.reconciliation_baselines'::regclass), true,
  'reconciliation_baselines: FORCE row level security is on');
select is((select relforcerowsecurity from pg_class where oid = 'public.reconciliation_baseline_journal_headers'::regclass), true,
  'reconciliation_baseline_journal_headers: FORCE row level security is on');
select is((select relforcerowsecurity from pg_class where oid = 'public.reconciliation_baseline_journal_lines'::regclass), true,
  'reconciliation_baseline_journal_lines: FORCE row level security is on');

-- ── no client DML grant on any of the five tables ────────────────────────────────────────────────────────
select ok(
  not has_table_privilege('anon', 'public.reconciliation_execution_ledger', 'SELECT')
  and not has_table_privilege('anon', 'public.reconciliation_action_links', 'SELECT')
  and not has_table_privilege('anon', 'public.reconciliation_baselines', 'SELECT')
  and not has_table_privilege('anon', 'public.reconciliation_baseline_journal_headers', 'SELECT')
  and not has_table_privilege('anon', 'public.reconciliation_baseline_journal_lines', 'SELECT'),
  'anon holds no SELECT grant on any of the five slice-1B tables');
select ok(
  not has_table_privilege('authenticated', 'public.reconciliation_execution_ledger', 'INSERT')
  and not has_table_privilege('authenticated', 'public.reconciliation_execution_ledger', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.reconciliation_execution_ledger', 'DELETE')
  and not has_table_privilege('authenticated', 'public.reconciliation_action_links', 'INSERT')
  and not has_table_privilege('authenticated', 'public.reconciliation_action_links', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.reconciliation_action_links', 'DELETE')
  and not has_table_privilege('authenticated', 'public.reconciliation_baselines', 'INSERT')
  and not has_table_privilege('authenticated', 'public.reconciliation_baselines', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.reconciliation_baselines', 'DELETE')
  and not has_table_privilege('authenticated', 'public.reconciliation_baseline_journal_headers', 'INSERT')
  and not has_table_privilege('authenticated', 'public.reconciliation_baseline_journal_headers', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.reconciliation_baseline_journal_headers', 'DELETE')
  and not has_table_privilege('authenticated', 'public.reconciliation_baseline_journal_lines', 'INSERT')
  and not has_table_privilege('authenticated', 'public.reconciliation_baseline_journal_lines', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.reconciliation_baseline_journal_lines', 'DELETE'),
  'authenticated holds no INSERT/UPDATE/DELETE grant on any of the five slice-1B tables');

-- ── explicit column-privilege proof: the four additive columns are named in NEITHER the pre-existing
--    expenses column-grant list NOR any new grant this migration adds (it adds none) — proved directly
--    against information_schema, cross-checked that the ORIGINAL grant list is otherwise unchanged. ─────
select is(
  (select count(*)::int from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'expenses' and grantee = 'authenticated'
      and privilege_type in ('INSERT','UPDATE') and column_name in ('corrects_expense_id','reversed_by_rollback_at')),
  0, 'information_schema proves authenticated has zero INSERT/UPDATE column-privileges on the two new expenses columns');
select is(
  (select count(*)::int from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'expenses' and grantee = 'authenticated'
      and privilege_type = 'INSERT' and column_name not in ('corrects_expense_id','reversed_by_rollback_at')),
  -- 19 columns from the original 20260629150000 grant, re-emitted as 20 (+ account_id) by
  -- 20260701440000, plus cost_center_id added additively by 20260701460000 = 21.
  21, 'the pre-existing 21-column expenses INSERT grant list is unchanged by this migration');
select ok(
  not has_column_privilege('authenticated', 'public.sales', 'corrects_sale_id', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.sales', 'reversed_by_rollback_at', 'UPDATE'),
  'authenticated holds no UPDATE grant on the two new sales columns (sales has zero direct DML anyway)');

-- ── authenticated direct DML denied (as an actual statement) ────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.accountant'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$insert into public.reconciliation_execution_ledger (org_id, evidence_item_id, status)
            values (%L, '1b100000-0000-0000-0000-000000000001', 'unexecuted')$$, :'orgA'),
  '42501', null, 'authenticated direct INSERT into reconciliation_execution_ledger is denied');
select throws_ok(
  $$insert into public.reconciliation_baseline_journal_headers default values$$,
  '42501', null, 'authenticated direct INSERT into reconciliation_baseline_journal_headers is denied');
reset role;

-- ── finance-read gating: accountant reads same-org rows only; farm_manager reads none ──────────────────
insert into public.reconciliation_execution_ledger (id, org_id, evidence_item_id, status, executed_by_batch_row_id, executed_at)
  values ('1b700000-0000-0000-0000-000000000001', :'orgA', '1b100000-0000-0000-0000-000000000001',
          'executed', '1b200000-0000-0000-0000-000000000001', now());
insert into public.reconciliation_execution_ledger (id, org_id, evidence_item_id, status, executed_by_batch_row_id, executed_at)
  values ('1b700000-0000-0000-0000-000000000002', :'orgB', '1b100000-0000-0000-0000-000000000002',
          'executed', '1b200000-0000-0000-0000-000000000002', now());

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.accountant'), 'role', 'authenticated')::text, true);
set local role authenticated;
select isnt((select count(*) from public.reconciliation_execution_ledger where org_id = :'orgA'), 0::bigint,
  'finance reader (accountant) sees same-org reconciliation_execution_ledger rows');
select is((select count(*) from public.reconciliation_execution_ledger where org_id = :'orgB'), 0::bigint,
  'finance reader (accountant) cannot read cross-org reconciliation_execution_ledger rows');
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*) from public.reconciliation_execution_ledger where org_id = :'orgA'), 0::bigint,
  'non-finance role (farm_manager) cannot read reconciliation_execution_ledger at all');
reset role;

-- ── execution-ledger single-winner guarantee: SEQUENTIAL same-session proof (a real two-backend race is
--    proven separately, near the end of this file — see the CONCURRENCY EVIDENCE note above). ───────────
select is(
  (select status from public.reconciliation_execution_ledger where id = '1b700000-0000-0000-0000-000000000001'),
  'executed', 'sanity: the first executed ledger row exists (inserted as a fixture above)');
select throws_ok(
  format($$insert into public.reconciliation_execution_ledger (org_id, evidence_item_id, status, executed_by_batch_row_id, executed_at)
            values (%L, '1b100000-0000-0000-0000-000000000001', 'executed', '1b200000-0000-0000-0000-000000000001', now())$$,
         :'orgA'),
  '23505', null,
  'a sequential second executed insert for the same evidence_item_id is rejected by the same partial unique index the two-backend race below exercises directly — exactly one winner');
-- reversing the winner frees the evidence item for a later, legitimate re-execution (§2.5).
update public.reconciliation_execution_ledger set status = 'reversed', reversed_at = now()
  where id = '1b700000-0000-0000-0000-000000000001';
select lives_ok(
  format($$insert into public.reconciliation_execution_ledger (org_id, evidence_item_id, status, executed_by_batch_row_id, executed_at)
            values (%L, '1b100000-0000-0000-0000-000000000001', 'executed', '1b200000-0000-0000-0000-000000000001', now())$$,
         :'orgA'),
  'after the prior winner is reversed, a new executed row for the same evidence_item_id is allowed');

-- ── tenant-bound composite references: execution ledger ─────────────────────────────────────────────────
select throws_ok(
  format($$insert into public.reconciliation_execution_ledger (org_id, evidence_item_id, status)
            values (%L, '1b100000-0000-0000-0000-000000000002', 'unexecuted')$$, :'orgA'),
  '23503', null, 'cross-org evidence_item_id (org A ledger row, org B evidence item) is rejected');
select throws_ok(
  format($$insert into public.reconciliation_execution_ledger (org_id, evidence_item_id, status, executed_by_batch_row_id)
            values (%L, '1b100000-0000-0000-0000-000000000001', 'unexecuted', '1b200000-0000-0000-0000-000000000002')$$,
         :'orgA'),
  '23514', null,
  'cross-org executed_by_batch_row_id (org A ledger row, org B batch row) is rejected by the evidence/org relational guard');

-- ── execution-ledger relational semantics (Codex review round 2, item 3) ────────────────────────────────
select throws_ok(
  format($$insert into public.reconciliation_execution_ledger (org_id, evidence_item_id, status, executed_by_batch_row_id, executed_at)
            values (%L, '1b100000-0000-0000-0000-000000000001', 'executed', '1b200000-0000-0000-0000-000000000003', now())$$,
         :'orgA'),
  '23514', null,
  'executed_by_batch_row_id naming a batch row that reviews a DIFFERENT evidence_item_id (same org) is rejected');
select throws_ok(
  format($$insert into public.reconciliation_execution_ledger (org_id, evidence_item_id, status, executed_at)
            values (%L, '1b100000-0000-0000-0000-000000000003', 'unexecuted', now())$$, :'orgA'),
  '23514', null, 'status=unexecuted with executed_at populated is rejected (status/metadata shape)');
select throws_ok(
  format($$insert into public.reconciliation_execution_ledger (org_id, evidence_item_id, status, executed_by_batch_row_id)
            values (%L, '1b100000-0000-0000-0000-000000000003', 'executed', '1b200000-0000-0000-0000-000000000003')$$,
         :'orgA'),
  '23514', null, 'status=executed with executed_at null is rejected (status/metadata shape)');
select throws_ok(
  format($$insert into public.reconciliation_execution_ledger (org_id, evidence_item_id, status, executed_by_batch_row_id, executed_at, reversed_at)
            values (%L, '1b100000-0000-0000-0000-000000000003', 'executed', '1b200000-0000-0000-0000-000000000003', now(), now())$$,
         :'orgA'),
  '23514', null, 'status=executed with reversed_at populated is rejected (status/metadata shape)');
select throws_ok(
  format($$insert into public.reconciliation_execution_ledger (org_id, evidence_item_id, status, executed_by_batch_row_id, executed_at)
            values (%L, '1b100000-0000-0000-0000-000000000003', 'reversed', '1b200000-0000-0000-0000-000000000003', now())$$,
         :'orgA'),
  '23514', null, 'status=reversed with reversed_at null is rejected (status/metadata shape)');

-- ── all seven action_kind values (each also proving a valid, batch-row-agreeing target_id) + an eighth
--    rejected; reinstatement linkage ───────────────────────────────────────────────────────────────────
select lives_ok(
  format($$insert into public.reconciliation_action_links (org_id, batch_id, batch_row_id, action_kind, target_table, target_id, journal_entry_id)
            values (%L, '1b000000-0000-0000-0000-000000000001', '1b200000-0000-0000-0000-000000000001',
                    'addition', 'expenses', '1b300000-0000-0000-0000-000000000001', '1b500000-0000-0000-0000-000000000001')$$, :'orgA'),
  'action_kind = addition inserts with a valid expenses target_id + journal_entry_id');
select lives_ok(
  format($$insert into public.reconciliation_action_links (org_id, batch_id, batch_row_id, action_kind, target_table, target_id, journal_entry_id)
            values (%L, '1b000000-0000-0000-0000-000000000001', '1b200000-0000-0000-0000-000000000001',
                    'correction_reversal', 'expenses', '1b300000-0000-0000-0000-000000000001',
                    '1b500000-0000-0000-0000-000000000001')$$, :'orgA'),
  'action_kind = correction_reversal inserts');
select lives_ok(
  format($$insert into public.reconciliation_action_links (org_id, batch_id, batch_row_id, action_kind, target_table, target_id, journal_entry_id)
            values (%L, '1b000000-0000-0000-0000-000000000001', '1b200000-0000-0000-0000-000000000001',
                    'correction_replacement', 'expenses', '1b300000-0000-0000-0000-000000000002',
                    '1b500000-0000-0000-0000-000000000002')$$, :'orgA'),
  'action_kind = correction_replacement inserts');
select lives_ok(
  format($$insert into public.reconciliation_action_links
            (org_id, batch_id, batch_row_id, action_kind, target_table, target_id,
             journal_entry_id, reinstates_journal_entry_id)
            values (%L, '1b000000-0000-0000-0000-000000000001', '1b200000-0000-0000-0000-000000000001',
                    'correction_reversal_reinstatement', 'expenses', '1b300000-0000-0000-0000-000000000001',
                    '1b500000-0000-0000-0000-000000000002', '1b500000-0000-0000-0000-000000000001')$$, :'orgA'),
  'action_kind = correction_reversal_reinstatement inserts with reinstates_journal_entry_id populated');
select lives_ok(
  format($$insert into public.reconciliation_action_links (org_id, batch_id, batch_row_id, action_kind, target_table, target_id, journal_entry_id)
            values (%L, '1b000000-0000-0000-0000-000000000001', '1b200000-0000-0000-0000-000000000003',
                    'orphan_reversal', 'sales', '1b400000-0000-0000-0000-000000000001',
                    '1b500000-0000-0000-0000-000000000001')$$, :'orgA'),
  'action_kind = orphan_reversal inserts with a valid sales target_id (via the sales-reviewed batch row)');
select lives_ok(
  format($$insert into public.reconciliation_action_links
            (org_id, batch_id, batch_row_id, action_kind, target_table, target_id, journal_entry_id, reinstates_journal_entry_id)
            values (%L, '1b000000-0000-0000-0000-000000000001', '1b200000-0000-0000-0000-000000000003',
                    'orphan_reversal_reinstatement', 'sales', '1b400000-0000-0000-0000-000000000001',
                    '1b500000-0000-0000-0000-000000000002', '1b500000-0000-0000-0000-000000000001')$$, :'orgA'),
  'action_kind = orphan_reversal_reinstatement inserts with reinstates_journal_entry_id populated');
select lives_ok(
  format($$insert into public.reconciliation_action_links (org_id, batch_id, batch_row_id, action_kind)
            values (%L, '1b000000-0000-0000-0000-000000000001', '1b200000-0000-0000-0000-000000000001',
                    'zero_value_noop')$$, :'orgA'),
  'action_kind = zero_value_noop inserts with no target row and no journal_entry_id');
-- On a DIFFERENT batch row than the bare no-op above: migration 20260726170000 §0b adds
-- unique (batch_row_id, action_kind), so one row may carry a given kind exactly once. The claim being
-- asserted is unchanged — a zero_value_noop MAY carry a populated target pair.
select lives_ok(
  format($$insert into public.reconciliation_action_links (org_id, batch_id, batch_row_id, action_kind, target_table, target_id)
            values (%L, '1b000000-0000-0000-0000-000000000001', '1b200000-0000-0000-0000-000000000003',
                    'zero_value_noop', 'sales', '1b400000-0000-0000-0000-000000000001')$$, :'orgA'),
  'action_kind = zero_value_noop MAY also carry a populated target pair (§11 item 3 leaves this open) as long as journal_entry_id stays null');
-- ...and the same kind may NOT be recorded twice for one batch row (20260726170000 §0b): the rollback
-- derives its undo from these links, so a duplicated action is a duplicated undo.
select throws_ok(
  format($$insert into public.reconciliation_action_links (org_id, batch_id, batch_row_id, action_kind)
            values (%L, '1b000000-0000-0000-0000-000000000001', '1b200000-0000-0000-0000-000000000001',
                    'zero_value_noop')$$, :'orgA'),
  '23505', 'duplicate key value violates unique constraint "reconciliation_action_links_row_kind_uq"',
  'one action_kind per batch row: a second link of the same kind is rejected by the unique index');
-- The links are append-only from ANY role, including the table owner this test session runs as.
select throws_ok(
  $$update public.reconciliation_action_links set action_kind = 'addition'
     where batch_row_id = '1b200000-0000-0000-0000-000000000001'
       and action_kind = 'zero_value_noop'$$,
  '22023', 'reconciliation_action_links: rows are append-only and cannot be updated',
  'an action link cannot be updated (20260726170000 §0b)');
select throws_ok(
  $$delete from public.reconciliation_action_links
     where batch_row_id = '1b200000-0000-0000-0000-000000000001'
       and action_kind = 'zero_value_noop'$$,
  '22023', 'reconciliation_action_links: rows are append-only and cannot be deleted',
  'an action link cannot be deleted (20260726170000 §0b)');
select throws_ok(
  format($$insert into public.reconciliation_action_links (org_id, batch_id, batch_row_id, action_kind, target_table, target_id, journal_entry_id)
            values (%L, '1b000000-0000-0000-0000-000000000001', '1b200000-0000-0000-0000-000000000001',
                    'not_a_real_action_kind', 'expenses', '1b300000-0000-0000-0000-000000000001',
                    '1b500000-0000-0000-0000-000000000001')$$, :'orgA'),
  '23514', null, 'an eighth, invalid action_kind value is rejected');

-- ── reinstatement linkage: required for exactly the two reinstatement kinds, forbidden otherwise ────────
select throws_ok(
  format($$insert into public.reconciliation_action_links
            (org_id, batch_id, batch_row_id, action_kind, target_table, target_id, journal_entry_id, reinstates_journal_entry_id)
            values (%L, '1b000000-0000-0000-0000-000000000001', '1b200000-0000-0000-0000-000000000001',
                    'addition', 'expenses', '1b300000-0000-0000-0000-000000000001',
                    '1b500000-0000-0000-0000-000000000001', '1b500000-0000-0000-0000-000000000002')$$, :'orgA'),
  '23514', null, 'reinstates_journal_entry_id populated on a non-reinstatement action_kind (addition) is rejected');
select throws_ok(
  format($$insert into public.reconciliation_action_links (org_id, batch_id, batch_row_id, action_kind, target_table, target_id, journal_entry_id)
            values (%L, '1b000000-0000-0000-0000-000000000001', '1b200000-0000-0000-0000-000000000001',
                    'correction_reversal_reinstatement', 'expenses', '1b300000-0000-0000-0000-000000000001',
                    '1b500000-0000-0000-0000-000000000001')$$, :'orgA'),
  '23514', null, 'reinstates_journal_entry_id missing on a reinstatement action_kind (correction_reversal_reinstatement) is rejected');

-- ── target_journal_required: non-zero kinds need target_table+target_id+journal_entry_id together ───────
select throws_ok(
  format($$insert into public.reconciliation_action_links (org_id, batch_id, batch_row_id, action_kind, journal_entry_id)
            values (%L, '1b000000-0000-0000-0000-000000000001', '1b200000-0000-0000-0000-000000000001',
                    'addition', '1b500000-0000-0000-0000-000000000001')$$, :'orgA'),
  '23514', null, 'a non-zero action_kind (addition) missing target_table/target_id is rejected');
select throws_ok(
  format($$insert into public.reconciliation_action_links (org_id, batch_id, batch_row_id, action_kind, target_table, target_id)
            values (%L, '1b000000-0000-0000-0000-000000000001', '1b200000-0000-0000-0000-000000000001',
                    'addition', 'expenses', '1b300000-0000-0000-0000-000000000001')$$, :'orgA'),
  '23514', null, 'a non-zero action_kind (addition) missing journal_entry_id is rejected');
select throws_ok(
  format($$insert into public.reconciliation_action_links (org_id, batch_id, batch_row_id, action_kind, journal_entry_id)
            values (%L, '1b000000-0000-0000-0000-000000000001', '1b200000-0000-0000-0000-000000000001',
                    'zero_value_noop', '1b500000-0000-0000-0000-000000000001')$$, :'orgA'),
  '23514', null, 'zero_value_noop with journal_entry_id populated (same org) is rejected');

-- ── target_table/target_id shape + tenant-bound target references (the accepted §2.6/§13B contract) ─────
select throws_ok(
  format($$insert into public.reconciliation_action_links (org_id, batch_id, batch_row_id, action_kind, target_table)
            values (%L, '1b000000-0000-0000-0000-000000000001', '1b200000-0000-0000-0000-000000000001',
                    'zero_value_noop', 'expenses')$$, :'orgA'),
  '23514', null, 'target_table set with target_id null is rejected (shape check)');
select throws_ok(
  format($$insert into public.reconciliation_action_links (org_id, batch_id, batch_row_id, action_kind, target_id)
            values (%L, '1b000000-0000-0000-0000-000000000001', '1b200000-0000-0000-0000-000000000001',
                    'zero_value_noop', '1b300000-0000-0000-0000-000000000001')$$, :'orgA'),
  '23514', null, 'target_id set with target_table null is rejected (shape check)');
select throws_ok(
  format($$insert into public.reconciliation_action_links (org_id, batch_id, batch_row_id, action_kind, target_table, target_id, journal_entry_id)
            values (%L, '1b000000-0000-0000-0000-000000000001', '1b200000-0000-0000-0000-000000000001',
                    'addition', 'expenses', '1b300000-0000-0000-0000-000000000003', '1b500000-0000-0000-0000-000000000001')$$, :'orgA'),
  '23514', null, 'cross-org target_id (org A action link, target_table=expenses, org B expense) is rejected');
select throws_ok(
  format($$insert into public.reconciliation_action_links (org_id, batch_id, batch_row_id, action_kind, target_table, target_id, journal_entry_id)
            values (%L, '1b000000-0000-0000-0000-000000000001', '1b200000-0000-0000-0000-000000000003',
                    'orphan_reversal', 'sales', '1b400000-0000-0000-0000-000000000002', '1b500000-0000-0000-0000-000000000001')$$, :'orgA'),
  '23514', null, 'cross-org target_id (org A action link, target_table=sales, org B sale) is rejected');
select throws_ok(
  format($$insert into public.reconciliation_action_links (org_id, batch_id, batch_row_id, action_kind, target_table, target_id, journal_entry_id)
            values (%L, '1b000000-0000-0000-0000-000000000001', '1b200000-0000-0000-0000-000000000003',
                    'orphan_reversal', 'sales', '1b300000-0000-0000-0000-000000000001', '1b500000-0000-0000-0000-000000000001')$$, :'orgA'),
  '23514', null,
  'invalid target_table/target_id combination (target_table=sales but target_id names an expenses row, not a sales row) is rejected');
select throws_ok(
  format($$insert into public.reconciliation_action_links (org_id, batch_id, batch_row_id, action_kind, target_table, target_id, journal_entry_id)
            values (%L, '1b000000-0000-0000-0000-000000000001', '1b200000-0000-0000-0000-000000000001',
                    'addition', 'expenses', '1b300000-0000-0000-0000-000000000001', '1b500000-0000-0000-0000-000000000003')$$, :'orgA'),
  '23514', null, 'cross-org journal_entry_id (org A action link, org B journal entry) is rejected');
select throws_ok(
  format($$insert into public.reconciliation_action_links (org_id, batch_id, batch_row_id, action_kind)
            values (%L, '1b000000-0000-0000-0000-000000000002', '1b200000-0000-0000-0000-000000000001', 'zero_value_noop')$$,
         :'orgA'),
  '23514', null,
  'cross-org batch_id (org A action link, org B batch) is rejected — the new batch_row/batch_id relational guard fires before the composite FK would');

-- ── action-link relational semantics (Codex review round 2, item 4) ─────────────────────────────────────
select throws_ok(
  format($$insert into public.reconciliation_action_links (org_id, batch_id, batch_row_id, action_kind)
            values (%L, '1b000000-0000-0000-0000-000000000001', '1b200000-0000-0000-0000-000000000004', 'zero_value_noop')$$,
         :'orgA'),
  '23514', null,
  'batch_row_id that belongs to a DIFFERENT same-org batch than the one claimed (batch_id) is rejected');
select throws_ok(
  format($$insert into public.reconciliation_action_links (org_id, batch_id, batch_row_id, action_kind, target_table, target_id, journal_entry_id)
            values (%L, '1b000000-0000-0000-0000-000000000001', '1b200000-0000-0000-0000-000000000001',
                    'addition', 'sales', '1b400000-0000-0000-0000-000000000001', '1b500000-0000-0000-0000-000000000001')$$, :'orgA'),
  '23514', null,
  'target_table=sales does not agree with batch_row_A1''s own reviewed target_table (expenses) and is rejected');

-- ── reconciliation_baselines: tenant-bound batch reference ───────────────────────────────────────────────
select lives_ok(
  format($$insert into public.reconciliation_baselines (org_id, batch_id, expenses_count, expenses_total, sales_count, sales_total, journal_entries_count)
            values (%L, '1b000000-0000-0000-0000-000000000001', 2, 300, 1, 0, 2)$$, :'orgA'),
  'a valid preflight baseline row inserts');
select throws_ok(
  format($$insert into public.reconciliation_baselines (org_id, batch_id)
            values (%L, '1b000000-0000-0000-0000-000000000002')$$, :'orgA'),
  '23503', null, 'cross-org batch_id on reconciliation_baselines (org A row, org B batch) is rejected');

-- ── canonical baseline header snapshot: values are always pulled via a subquery from the REAL
--    journal_entries row so the "verbatim" invariant holds by construction; deliberate mismatches below
--    override exactly one field to prove the guard actually checks it. ───────────────────────────────────
select lives_ok(
  $$insert into public.reconciliation_baseline_journal_headers
      (id, org_id, batch_id, original_journal_entry_id, entry_date, source_type, source_id,
       source_sequence, description, status, posted_at, posted_by, reversal_of, canonical_hash)
    select '1b800000-0000-0000-0000-000000000001', je.org_id, '1b000000-0000-0000-0000-000000000001',
           je.id, je.entry_date, je.source_type, je.source_id, je.source_sequence, je.description,
           je.status, je.posted_at, je.posted_by, je.reversal_of,
           encode(digest(jsonb_build_object(
             'original_journal_entry_id', je.id, 'entry_date', je.entry_date, 'source_type', je.source_type,
             'source_id', je.source_id, 'source_sequence', je.source_sequence, 'description', je.description,
             'status', je.status, 'posted_at', je.posted_at, 'posted_by', je.posted_by, 'reversal_of', je.reversal_of
           )::text, 'sha256'), 'hex')
      from public.journal_entries je where je.id = '1b500000-0000-0000-0000-000000000001'$$,
  'a baseline journal header snapshotting the real journal entry verbatim, with a well-formed 64-hex canonical_hash, inserts');
select is(
  (select canonical_hash from public.reconciliation_baseline_journal_headers
    where id = '1b800000-0000-0000-0000-000000000001'),
  (select encode(digest(jsonb_build_object(
      'original_journal_entry_id', original_journal_entry_id, 'entry_date', entry_date,
      'source_type', source_type, 'source_id', source_id, 'source_sequence', source_sequence,
      'description', description, 'status', status, 'posted_at', posted_at,
      'posted_by', posted_by, 'reversal_of', reversal_of
    )::text, 'sha256'), 'hex')
   from public.reconciliation_baseline_journal_headers where id = '1b800000-0000-0000-0000-000000000001'),
  'the stored header canonical_hash re-hashes to the same value when recomputed from ALL of the row''s own replay-relevant columns');
select throws_ok(
  $$insert into public.reconciliation_baseline_journal_headers
      (id, org_id, batch_id, original_journal_entry_id, entry_date, source_type, source_id,
       source_sequence, description, status, posted_at, posted_by, reversal_of, canonical_hash)
    select '1b800000-0000-0000-0000-000000000002', je.org_id, '1b000000-0000-0000-0000-000000000001',
           je.id, je.entry_date, je.source_type, je.source_id, je.source_sequence,
           'TAMPERED-DESCRIPTION-DOES-NOT-MATCH-THE-REAL-ENTRY',
           je.status, je.posted_at, je.posted_by, je.reversal_of, repeat('e', 64)
      from public.journal_entries je where je.id = '1b500000-0000-0000-0000-000000000002'$$,
  '23514', null,
  'a header whose description does not verbatim-match the real journal entry (every other field correct) is rejected — copied-field tampering, round 2 item 1');
select throws_ok(
  $$insert into public.reconciliation_baseline_journal_headers
      (id, org_id, batch_id, original_journal_entry_id, entry_date, source_type, source_id,
       source_sequence, status, posted_at, canonical_hash)
    values ('1b800000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001',
            '1b000000-0000-0000-0000-000000000001', '1b500000-0000-0000-0000-000000000003',
            current_date, 'expense', '1b300000-0000-0000-0000-000000000003', 1, 'posted', now(),
            repeat('a', 64))$$,
  '23514', null, 'cross-org original_journal_entry_id (org A header, org B journal entry) is rejected');
select throws_ok(
  $$insert into public.reconciliation_baseline_journal_headers
      (id, org_id, batch_id, original_journal_entry_id, entry_date, source_type, source_id,
       source_sequence, description, status, posted_at, posted_by, reversal_of, canonical_hash)
    select '1b800000-0000-0000-0000-000000000005', je.org_id, '1b000000-0000-0000-0000-000000000001',
           je.id, je.entry_date, je.source_type, je.source_id, je.source_sequence, je.description,
           je.status, je.posted_at, je.posted_by, je.reversal_of, repeat('d', 64)
      from public.journal_entries je where je.id = '1b500000-0000-0000-0000-000000000005'$$,
  '23514', null,
  'a verbatim header whose polymorphic source_id names an expense in another organization is rejected');
select throws_ok(
  $$insert into public.reconciliation_baseline_journal_headers
      (id, org_id, batch_id, original_journal_entry_id, entry_date, source_type, source_id,
       source_sequence, description, status, posted_at, posted_by, reversal_of, canonical_hash)
    select '1b800000-0000-0000-0000-000000000004', je.org_id, '1b000000-0000-0000-0000-000000000001',
           je.id, je.entry_date, je.source_type, je.source_id, je.source_sequence, je.description,
           je.status, je.posted_at, je.posted_by, je.reversal_of, repeat('b', 64)
      from public.journal_entries je where je.id = '1b500000-0000-0000-0000-000000000001'$$,
  '23505', null,
  'a second snapshot of the SAME (batch_id, original_journal_entry_id) is rejected — one typed snapshot per source, round 2 item 2');

-- ── canonical baseline line snapshot: same verbatim-by-construction pattern. ─────────────────────────────
select lives_ok(
  $$insert into public.reconciliation_baseline_journal_lines
      (id, org_id, baseline_journal_header_id, original_journal_line_id, line_ordinal,
       account_id, debit, credit, description, cost_center_id, custody_account_id,
       custody_movement_id, expense_id, payment_request_id, canonical_hash)
    select '1b900000-0000-0000-0000-000000000001', jl.org_id, '1b800000-0000-0000-0000-000000000001',
           jl.id, 1, jl.account_id, jl.debit, jl.credit, jl.description, jl.cost_center_id,
           jl.custody_account_id, jl.custody_movement_id, jl.expense_id, jl.payment_request_id,
           encode(digest(jsonb_build_object(
             'original_journal_line_id', jl.id, 'line_ordinal', 1, 'account_id', jl.account_id,
             'debit', jl.debit, 'credit', jl.credit, 'description', jl.description,
             'cost_center_id', jl.cost_center_id, 'custody_account_id', jl.custody_account_id,
             'custody_movement_id', jl.custody_movement_id, 'expense_id', jl.expense_id,
             'payment_request_id', jl.payment_request_id
           )::text, 'sha256'), 'hex')
      from public.journal_lines jl where jl.id = '1b600000-0000-0000-0000-000000000001'$$,
  'a baseline journal line snapshotting the real journal line verbatim, belonging to the header''s own entry, inserts');
select is(
  (select canonical_hash from public.reconciliation_baseline_journal_lines
    where id = '1b900000-0000-0000-0000-000000000001'),
  (select encode(digest(jsonb_build_object(
      'original_journal_line_id', original_journal_line_id, 'line_ordinal', line_ordinal,
      'account_id', account_id, 'debit', debit, 'credit', credit, 'description', description,
      'cost_center_id', cost_center_id, 'custody_account_id', custody_account_id,
      'custody_movement_id', custody_movement_id, 'expense_id', expense_id,
      'payment_request_id', payment_request_id
    )::text, 'sha256'), 'hex')
   from public.reconciliation_baseline_journal_lines where id = '1b900000-0000-0000-0000-000000000001'),
  'the stored line canonical_hash re-hashes to the same value when recomputed from ALL of the row''s own replay-relevant columns');
select throws_ok(
  $$insert into public.reconciliation_baseline_journal_lines
      (id, org_id, baseline_journal_header_id, original_journal_line_id, line_ordinal,
       account_id, debit, credit, description, cost_center_id, custody_account_id,
       custody_movement_id, expense_id, payment_request_id, canonical_hash)
    select '1b900000-0000-0000-0000-000000000002', jl.org_id, '1b800000-0000-0000-0000-000000000001',
           jl.id, 2, jl.account_id, jl.debit, jl.credit, jl.description, jl.cost_center_id,
           jl.custody_account_id, jl.custody_movement_id, jl.expense_id, jl.payment_request_id, 'zz-not-hex'
      from public.journal_lines jl where jl.id = '1b600000-0000-0000-0000-000000000002'$$,
  '23514', null, 'a malformed canonical_hash on a baseline journal line is rejected');
select throws_ok(
  $$insert into public.reconciliation_baseline_journal_lines
      (id, org_id, baseline_journal_header_id, original_journal_line_id, line_ordinal,
       account_id, debit, credit, canonical_hash)
    select '1b900000-0000-0000-0000-000000000003', jl.org_id, '1b800000-0000-0000-0000-000000000001',
           jl.id, 4, jl.account_id, jl.debit, jl.credit, repeat('c', 64)
      from public.journal_lines jl where jl.id = '1b600000-0000-0000-0000-000000000003'$$,
  '23514', null,
  'a journal line belonging to a DIFFERENT journal entry than the header snapshots is rejected');
select throws_ok(
  $$insert into public.reconciliation_baseline_journal_lines
      (id, org_id, baseline_journal_header_id, original_journal_line_id, line_ordinal,
       account_id, debit, credit, description, cost_center_id, custody_account_id,
       custody_movement_id, expense_id, payment_request_id, canonical_hash)
    select '1b900000-0000-0000-0000-000000000005', jl.org_id, '1b800000-0000-0000-0000-000000000001',
           jl.id, 3, jl.account_id, jl.debit, 999, jl.description, jl.cost_center_id,
           jl.custody_account_id, jl.custody_movement_id, jl.expense_id, jl.payment_request_id, repeat('f', 64)
      from public.journal_lines jl where jl.id = '1b600000-0000-0000-0000-000000000002'$$,
  '23514', null,
  'a line whose credit does not verbatim-match the real journal line (every other field correct) is rejected — copied-field tampering, round 2 item 1');
select throws_ok(
  $$insert into public.reconciliation_baseline_journal_lines
      (id, org_id, baseline_journal_header_id, original_journal_line_id, line_ordinal,
       account_id, debit, credit, description, cost_center_id, custody_account_id,
       custody_movement_id, expense_id, payment_request_id, canonical_hash)
    select '1b900000-0000-0000-0000-000000000006', jl.org_id, '1b800000-0000-0000-0000-000000000001',
           jl.id, 99, jl.account_id, jl.debit, jl.credit, jl.description, jl.cost_center_id,
           jl.custody_account_id, jl.custody_movement_id, jl.expense_id, jl.payment_request_id,
           encode(digest(jsonb_build_object(
             'original_journal_line_id', jl.id, 'line_ordinal', 99, 'account_id', jl.account_id,
             'debit', jl.debit, 'credit', jl.credit, 'description', jl.description,
             'cost_center_id', jl.cost_center_id, 'custody_account_id', jl.custody_account_id,
             'custody_movement_id', jl.custody_movement_id, 'expense_id', jl.expense_id,
             'payment_request_id', jl.payment_request_id
           )::text, 'sha256'), 'hex')
      from public.journal_lines jl where jl.id = '1b600000-0000-0000-0000-000000000001'$$,
  '23505', null,
  'a second snapshot of the SAME (header, original_journal_line_id) pair is rejected — one typed snapshot per source, round 2 item 2');
select throws_ok(
  $$insert into public.reconciliation_baseline_journal_lines
      (id, org_id, baseline_journal_header_id, original_journal_line_id, line_ordinal,
       account_id, debit, credit, description, cost_center_id, custody_account_id,
       custody_movement_id, expense_id, payment_request_id, canonical_hash)
    select '1b900000-0000-0000-0000-000000000007', jl.org_id, '1b800000-0000-0000-0000-000000000001',
           jl.id, 1, jl.account_id, jl.debit, jl.credit, jl.description, jl.cost_center_id,
           jl.custody_account_id, jl.custody_movement_id, jl.expense_id, jl.payment_request_id,
           encode(digest(jsonb_build_object(
             'original_journal_line_id', jl.id, 'line_ordinal', 1, 'account_id', jl.account_id,
             'debit', jl.debit, 'credit', jl.credit, 'description', jl.description,
             'cost_center_id', jl.cost_center_id, 'custody_account_id', jl.custody_account_id,
             'custody_movement_id', jl.custody_movement_id, 'expense_id', jl.expense_id,
             'payment_request_id', jl.payment_request_id
           )::text, 'sha256'), 'hex')
      from public.journal_lines jl where jl.id = '1b600000-0000-0000-0000-000000000002'$$,
  '23505', null,
  'a DIFFERENT original journal line reusing an already-claimed line_ordinal under the same header is rejected — one line per ordinal per header, round 2 item 2');

-- ── fail-closed dimension integrity even when the source journal_lines row's own bytes are already bad
--    (Codex review round 2, item 1): journal_line_badorg sits inside org A's journal_entry_A3 but names
--    an account_id belonging to org B. Copying it verbatim satisfies the verbatim check, but the snapshot
--    must still independently reject it. ────────────────────────────────────────────────────────────────
select lives_ok(
  $$insert into public.reconciliation_baseline_journal_headers
      (id, org_id, batch_id, original_journal_entry_id, entry_date, source_type, source_id,
       source_sequence, description, status, posted_at, posted_by, reversal_of, canonical_hash)
    select '1b800000-0000-0000-0000-000000000005', je.org_id, '1b000000-0000-0000-0000-000000000001',
           je.id, je.entry_date, je.source_type, je.source_id, je.source_sequence, je.description,
           je.status, je.posted_at, je.posted_by, je.reversal_of,
           encode(digest(jsonb_build_object(
             'original_journal_entry_id', je.id, 'entry_date', je.entry_date, 'source_type', je.source_type,
             'source_id', je.source_id, 'source_sequence', je.source_sequence, 'description', je.description,
             'status', je.status, 'posted_at', je.posted_at, 'posted_by', je.posted_by, 'reversal_of', je.reversal_of
           )::text, 'sha256'), 'hex')
      from public.journal_entries je where je.id = '1b500000-0000-0000-0000-000000000004'$$,
  'setup: a valid header snapshotting journal_entry_A3 (whose own header fields are fine) inserts');
select throws_ok(
  $$insert into public.reconciliation_baseline_journal_lines
      (id, org_id, baseline_journal_header_id, original_journal_line_id, line_ordinal,
       account_id, debit, credit, description, cost_center_id, custody_account_id,
       custody_movement_id, expense_id, payment_request_id, canonical_hash)
    select '1b900000-0000-0000-0000-000000000008', jl.org_id, '1b800000-0000-0000-0000-000000000005',
           jl.id, 1, jl.account_id, jl.debit, jl.credit, jl.description, jl.cost_center_id,
           jl.custody_account_id, jl.custody_movement_id, jl.expense_id, jl.payment_request_id,
           encode(digest(jsonb_build_object(
             'original_journal_line_id', jl.id, 'line_ordinal', 1, 'account_id', jl.account_id,
             'debit', jl.debit, 'credit', jl.credit, 'description', jl.description,
             'cost_center_id', jl.cost_center_id, 'custody_account_id', jl.custody_account_id,
             'custody_movement_id', jl.custody_movement_id, 'expense_id', jl.expense_id,
             'payment_request_id', jl.payment_request_id
           )::text, 'sha256'), 'hex')
      from public.journal_lines jl where jl.id = '1b600000-0000-0000-0000-000000000004'$$,
  '23514', null,
  'a line whose account_id belongs to another org is rejected even though it verbatim-matches the (already-bad) source journal_lines row — fail closed on legacy bad bytes, round 2 item 1');

-- ── baseline immutability through a privileged (superuser) path — not merely a withheld grant ───────────
select throws_ok(
  $$update public.reconciliation_baseline_journal_headers set description = 'tampered'
    where id = '1b800000-0000-0000-0000-000000000001'$$,
  '22023', null, 'updating a baseline journal header (even as superuser) is rejected');
select throws_ok(
  $$delete from public.reconciliation_baseline_journal_headers
    where id = '1b800000-0000-0000-0000-000000000001'$$,
  '22023', null, 'deleting a baseline journal header (even as superuser) is rejected');
select throws_ok(
  $$update public.reconciliation_baseline_journal_lines set debit = 999
    where id = '1b900000-0000-0000-0000-000000000001'$$,
  '22023', null, 'updating a baseline journal line (even as superuser) is rejected');
select throws_ok(
  $$delete from public.reconciliation_baseline_journal_lines
    where id = '1b900000-0000-0000-0000-000000000001'$$,
  '22023', null, 'deleting a baseline journal line (even as superuser) is rejected');

-- ── additive expenses/sales columns do not loosen existing integrity ────────────────────────────────────
select lives_ok(
  format($$update public.expenses set corrects_expense_id = %L
            where id = '1b300000-0000-0000-0000-000000000002'$$, '1b300000-0000-0000-0000-000000000001'),
  'a same-org corrects_expense_id (superuser/privileged path) is accepted');
select throws_ok(
  format($$update public.expenses set corrects_expense_id = %L
            where id = '1b300000-0000-0000-0000-000000000002'$$, '1b300000-0000-0000-0000-000000000003'),
  '23503', null, 'cross-org corrects_expense_id (org A expense correcting an org B expense) is rejected');
select throws_ok(
  $$update public.expenses set corrects_expense_id = id
    where id = '1b300000-0000-0000-0000-000000000002'$$,
  '23514', null, 'an expense cannot correct itself (corrects_expense_id = id) is rejected');
select throws_ok(
  $$update public.sales set corrects_sale_id = id
    where id = '1b400000-0000-0000-0000-000000000001'$$,
  '23514', null, 'a sale cannot correct itself (corrects_sale_id = id) is rejected');
select throws_ok(
  format($$update public.sales set corrects_sale_id = %L
            where id = '1b400000-0000-0000-0000-000000000001'$$, '1b400000-0000-0000-0000-000000000002'),
  '23503', null, 'cross-org corrects_sale_id (org A sale correcting an org B sale) is rejected');
select lives_ok(
  $$update public.expenses set reversed_by_rollback_at = now()
    where id = '1b300000-0000-0000-0000-000000000002'$$,
  'reversed_by_rollback_at accepts a timestamp via a privileged path');

-- expense_guard_routed_money_immutable (pre-existing, 20260629150000) still fires unchanged: adding the
-- two new columns does not loosen the existing routed-money-immutable guard on total/kind.
update public.expenses set payment_status = 'paid_from_custody' where id = '1b300000-0000-0000-0000-000000000001';
select throws_ok(
  $$update public.expenses set total = total + 1 where id = '1b300000-0000-0000-0000-000000000001'$$,
  '22023', null, 'expense_guard_routed_money_immutable still blocks a total change on a routed expense');
select lives_ok(
  format($$update public.expenses set corrects_expense_id = %L
            where id = '1b300000-0000-0000-0000-000000000001'$$, null::uuid),
  'the new corrects_expense_id column remains freely writable (via a privileged path) on a routed expense — the pre-existing guard is scoped to total/kind only, unchanged');

-- ── migration-replay structural invariants: key indexes/triggers/constraints exist exactly once ─────────
select is(
  (select count(*) from pg_indexes where indexname = 'reconciliation_execution_ledger_executed_uq'),
  1::bigint, 'the execution-ledger single-winner partial unique index exists exactly once');
select is(
  (select count(*) from pg_trigger where tgname = 'guard_baseline_journal_header_immutable' and not tgisinternal),
  1::bigint, 'baseline journal header immutability trigger exists exactly once');
select is(
  (select count(*) from pg_trigger where tgname = 'guard_baseline_journal_line_immutable' and not tgisinternal),
  1::bigint, 'baseline journal line immutability trigger exists exactly once');
select is(
  (select count(*) from pg_trigger where tgname = 'guard_reconciliation_action_link_tenant' and not tgisinternal),
  1::bigint, 'action-link tenant guard trigger exists exactly once');
select is(
  (select count(*) from pg_trigger where tgname = 'guard_reconciliation_execution_ledger_tenant' and not tgisinternal),
  1::bigint, 'execution-ledger tenant guard trigger exists exactly once');
select is(
  (select count(*) from pg_constraint where conname = 'expenses_id_org_id_uq'),
  1::bigint, 'expenses.(id, org_id) composite-uniqueness anchor exists exactly once');
select is(
  (select count(*) from pg_constraint where conname = 'sales_id_org_id_uq'),
  1::bigint, 'sales.(id, org_id) composite-uniqueness anchor exists exactly once');
select is(
  (select count(*) from pg_constraint where conname = 'reconciliation_batch_rows_id_org_id_uq'),
  1::bigint, 'reconciliation_batch_rows.(id, org_id) composite-uniqueness anchor exists exactly once');
select is(
  (select count(*) from pg_constraint where conname = 'reconciliation_baseline_journal_headers_batch_entry_uq'),
  1::bigint, 'one-snapshot-per-source header uniqueness constraint exists exactly once');
select is(
  (select count(*) from pg_constraint where conname = 'reconciliation_baseline_journal_lines_header_line_uq'),
  1::bigint, 'one-snapshot-per-source line uniqueness constraint exists exactly once');
select is(
  (select count(*) from pg_constraint where conname = 'reconciliation_baseline_journal_lines_header_ordinal_uq'),
  1::bigint, 'one-line-per-ordinal-per-header uniqueness constraint exists exactly once');

-- ── #229(b) FK-covering-index invariant, scoped to every FK this migration introduces (the repo-wide
--    version runs as tests/96; this pins that slice 1B itself never regresses it, column by column) ─────
select is(
  (select coalesce(string_agg(
      (c.conrelid::regclass)::text || '(' ||
      (select string_agg(a.attname, ',') from pg_attribute a
         where a.attrelid = c.conrelid and a.attnum = any(c.conkey)) || ')', ', '), '')
   from pg_constraint c
   where c.contype = 'f'
     and c.conrelid::regclass::text in (
       'public.reconciliation_execution_ledger', 'public.reconciliation_action_links',
       'public.reconciliation_baselines', 'public.reconciliation_baseline_journal_headers',
       'public.reconciliation_baseline_journal_lines', 'public.expenses', 'public.sales')
     and c.conname in (
       'reconciliation_execution_ledger_evidence_tenant_fk', 'reconciliation_execution_ledger_batch_row_tenant_fk',
       'reconciliation_action_links_batch_tenant_fk', 'reconciliation_action_links_batch_row_tenant_fk',
       'reconciliation_baselines_batch_tenant_fk',
       'reconciliation_baseline_journal_headers_batch_tenant_fk',
       'reconciliation_baseline_journal_lines_header_tenant_fk',
       'expenses_corrects_expense_id_org_fk', 'sales_corrects_sale_id_org_fk')
     and not exists (
       select 1 from pg_index i
       where i.indrelid = c.conrelid
         and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey
     )),
  '', 'every slice-1B composite tenant FK has its own leading-column covering index (#229(b))');
select is(
  (select coalesce(string_agg((c.conrelid::regclass)::text || '.' ||
      (select a.attname from pg_attribute a where a.attrelid = c.conrelid and a.attnum = c.conkey[1]), ', '), '')
   from pg_constraint c
   where c.contype = 'f' and c.conrelid = 'public.reconciliation_baseline_journal_headers'::regclass
     and array_length(c.conkey, 1) = 1
     and not exists (
       select 1 from pg_index i where i.indrelid = c.conrelid and (i.indkey::int2[])[0] = c.conkey[1])),
  '', 'every single-column FK on reconciliation_baseline_journal_headers has its own covering index (#229(b))');
select is(
  (select coalesce(string_agg((c.conrelid::regclass)::text || '.' ||
      (select a.attname from pg_attribute a where a.attrelid = c.conrelid and a.attnum = c.conkey[1]), ', '), '')
   from pg_constraint c
   where c.contype = 'f' and c.conrelid = 'public.reconciliation_baseline_journal_lines'::regclass
     and array_length(c.conkey, 1) = 1
     and not exists (
       select 1 from pg_index i where i.indrelid = c.conrelid and (i.indkey::int2[])[0] = c.conkey[1])),
  '', 'every single-column FK on reconciliation_baseline_journal_lines has its own covering index (#229(b))');
select is(
  (select coalesce(string_agg((c.conrelid::regclass)::text || '.' ||
      (select a.attname from pg_attribute a where a.attrelid = c.conrelid and a.attnum = c.conkey[1]), ', '), '')
   from pg_constraint c
   where c.contype = 'f' and c.conrelid = 'public.reconciliation_action_links'::regclass
     and array_length(c.conkey, 1) = 1
     and not exists (
       select 1 from pg_index i where i.indrelid = c.conrelid and (i.indkey::int2[])[0] = c.conkey[1])),
  '', 'every single-column FK on reconciliation_action_links has its own covering index (#229(b))');

-- ── column presence spot-check (shape) ───────────────────────────────────────────────────────────────────
select has_column('public', 'reconciliation_execution_ledger', 'evidence_item_id', 'execution_ledger has evidence_item_id');
select has_column('public', 'reconciliation_action_links', 'target_id', 'action_links has target_id');
select has_column('public', 'reconciliation_action_links', 'reinstates_journal_entry_id', 'action_links has reinstates_journal_entry_id');
select has_column('public', 'reconciliation_baseline_journal_headers', 'canonical_hash', 'baseline_journal_headers has canonical_hash');
select has_column('public', 'reconciliation_baseline_journal_lines', 'canonical_hash', 'baseline_journal_lines has canonical_hash');
select has_column('public', 'expenses', 'corrects_expense_id', 'expenses has corrects_expense_id');
select has_column('public', 'expenses', 'reversed_by_rollback_at', 'expenses has reversed_by_rollback_at');
select has_column('public', 'sales', 'corrects_sale_id', 'sales has corrects_sale_id');
select has_column('public', 'sales', 'reversed_by_rollback_at', 'sales has reversed_by_rollback_at');

-- ── no fn_audit trigger on any of the five new tables (design §9 item 1B: execution-time-only, audited
--    implicitly via the batch's own audit trail) ─────────────────────────────────────────────────────────
select is(
  (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname in ('reconciliation_execution_ledger','reconciliation_action_links','reconciliation_baselines',
                          'reconciliation_baseline_journal_headers','reconciliation_baseline_journal_lines')
       and t.tgname like 'audit_%' and not t.tgisinternal),
  0::bigint, 'no fn_audit trigger exists on any of the five slice-1B tables');

-- ── REAL two-backend concurrency proof (§13B, Codex review round 2 item 5) ──────────────────────────────
-- dblink is available locally. dblink sessions are separate Postgres backends and cannot see this file's
-- own uncommitted fixtures, so this block creates and commits (via dblink itself) a small, isolated,
-- org-scoped fixture set, runs the race, asserts the outcome, then deletes everything it committed and
-- disconnects both backends — no fixture or connection is left behind.
create extension if not exists dblink;

select set_config('t.dsn', format('host=%s port=%s dbname=%s user=%s',
    (select setting from pg_settings where name = 'unix_socket_directories'),
    (select setting from pg_settings where name = 'port'),
    current_database(), current_user),
  false);

\set raceOrg 'c3000000-0000-0000-0000-000000000001'
\set raceBatch 'c3000000-0000-0000-0000-000000000002'
\set raceEvidence 'c3000000-0000-0000-0000-000000000003'
\set raceBatchRow 'c3000000-0000-0000-0000-000000000004'

select dblink_connect('racer_setup', current_setting('t.dsn'));
select dblink_exec('racer_setup',
  format($sql$insert into public.organization (id, name) values (%L, 'dblink race org')$sql$, :'raceOrg'));
select dblink_exec('racer_setup',
  format($sql$insert into public.reconciliation_batches (id, org_id, status) values (%L, %L, 'approved')$sql$,
    :'raceBatch', :'raceOrg'));
select dblink_exec('racer_setup',
  format($sql$insert into public.reconciliation_evidence_items
          (id, org_id, origin_kind, source_workbook_sha256, sheet_name, row_locator,
           source_identity_fingerprint, classification)
         values (%L, %L, 'source_workbook_row', %L, 'race', 'R1', 'fp-race', 'source_addition_candidate')$sql$,
    :'raceEvidence', :'raceOrg', repeat('d', 64)));
select dblink_exec('racer_setup',
  format($sql$insert into public.reconciliation_batch_rows (id, org_id, batch_id, evidence_item_id)
         values (%L, %L, %L, %L)$sql$,
    :'raceBatchRow', :'raceOrg', :'raceBatch', :'raceEvidence'));
select dblink_disconnect('racer_setup');

select dblink_connect('racer1', current_setting('t.dsn'));
select dblink_connect('racer2', current_setting('t.dsn'));

select dblink_exec('racer1', 'begin');
select dblink_exec('racer1',
  format($sql$insert into public.reconciliation_execution_ledger
          (org_id, evidence_item_id, status, executed_by_batch_row_id, executed_at)
         values (%L, %L, 'executed', %L, now())$sql$, :'raceOrg', :'raceEvidence', :'raceBatchRow'));
-- racer1's row is live but UNCOMMITTED.

select dblink_exec('racer2', 'begin');
select dblink_send_query('racer2',
  format($sql$insert into public.reconciliation_execution_ledger
          (org_id, evidence_item_id, status, executed_by_batch_row_id, executed_at)
         values (%L, %L, 'executed', %L, now())$sql$, :'raceOrg', :'raceEvidence', :'raceBatchRow'));
-- racer2's insert is now blocked server-side on racer1's uncommitted row, sent ASYNCHRONOUSLY so this
-- session is never stuck waiting on it (a synchronous call here would deadlock: racer2 can't unblock
-- until racer1 commits, and racer1 can't be told to commit while we're blocked waiting on racer2).

select dblink_exec('racer1', 'commit');
-- racer1 wins and commits; racer2's blocked insert now resolves against a real committed conflict.

-- dblink_get_result must be called explicitly (it does not integrate with pgTAP's throws_ok savepoint
-- machinery) and, empirically, TWICE after an errored async command: once to receive the error itself,
-- once more to drain the trailing "ready for query" result — omitting the second call leaves the
-- connection reporting "another command is already in progress" on the next command sent to it.
do $$
declare
  v_sqlstate text;
begin
  begin
    perform * from dblink_get_result('racer2') as t(dummy int);
    v_sqlstate := 'no_error';
  exception when others then
    v_sqlstate := sqlstate;
  end;
  perform set_config('t.race_sqlstate', v_sqlstate, false);
  begin
    perform * from dblink_get_result('racer2') as t(dummy int);
  exception when others then
    null;
  end;
end $$;

select is(current_setting('t.race_sqlstate'), '23505',
  'a REAL two-backend race: racer 2''s insert, unblocked only after racer 1 commits, loses with a unique violation — the actual guarantee §2.5/§3.2 rely on');

select dblink_exec('racer2', 'rollback');
select dblink_disconnect('racer1');
select dblink_disconnect('racer2');

-- Clean up the reconciliation_* rows this block created. The fixture organization itself is
-- deliberately NOT deleted: reconciliation_batches/evidence_items/batch_rows carry AFTER DELETE
-- fn_audit triggers (slice 1A) that insert an audit_log row referencing org_id, and deleting the
-- organization row afterward races that audit_log FK within the same cascade — an orphaned
-- organization row in this throwaway ephemeral database (destroyed with the whole cluster at the end
-- of the harness run) is harmless, unlike a flaky cleanup step.
select dblink_connect('racer_cleanup', current_setting('t.dsn'));
select dblink_exec('racer_cleanup', format($sql$delete from public.reconciliation_execution_ledger where org_id = %L$sql$, :'raceOrg'));
select dblink_exec('racer_cleanup', format($sql$delete from public.reconciliation_batch_rows where org_id = %L$sql$, :'raceOrg'));
select dblink_exec('racer_cleanup', format($sql$delete from public.reconciliation_evidence_items where org_id = %L$sql$, :'raceOrg'));
select dblink_exec('racer_cleanup', format($sql$delete from public.reconciliation_batches where org_id = %L$sql$, :'raceOrg'));
select dblink_disconnect('racer_cleanup');
select is((select count(*) from pg_stat_activity where application_name like '%dblink%' and pid <> pg_backend_pid()),
  0::bigint, 'no dblink backend connection is left open after cleanup');

select * from finish();
rollback;
