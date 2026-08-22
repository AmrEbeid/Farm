-- Accounting reconciliation — the acceptance-report READ snapshot RPC
-- (migration "20260728120000 accounting reconciliation acceptance snapshot.sql").
--
-- What this pins:
--   * catalog contract — SECURITY INVOKER (not DEFINER), STABLE, search_path = '', and EXECUTE granted
--     to authenticated only (revoked from public/anon);
--   * authz — anon, a non-member of another org, and every non-finance role (farm_manager,
--     agri_engineer, supervisor, storekeeper) are refused 42501; owner and accountant are allowed;
--   * tenancy — a cross-org batch id is 'not_found', never readable, in EITHER direction;
--   * the happy path — the whole batch with its evidence and its readable dimension labels;
--   * EXACT DECIMALS — every numeric accounting field comes back as canonical decimal TEXT, digit for
--     digit, including values no IEEE double can hold;
--   * the fail-closed verdicts — 'empty' (zero rows), 'overflow' (> 1000 rows), 'incomplete' (a row
--     whose evidence is unreadable), and 'count_mismatch' for BOTH a disagreeing and a MALFORMED
--     staging record; count absence is allowed only for an exact, status-matched terminal verdict;
--   * READ-ONLY — no row of any reconciliation or financial table changes across the whole file.
--
-- Impersonation via request.jwt.claims + `set local role authenticated` (harness pattern from tests
-- 82/97/102/140). Run via test-shims/run-pgtap-local.sh.
--
-- HARNESS NOTE. The local shim runs as superuser, so RLS/FORCE RLS cannot be exercised directly; the
-- assertions below therefore impersonate `authenticated`, which DOES obey RLS. The one thing that
-- stays unverifiable locally is FORCE RLS against the table owner — the documented harness caveat,
-- checked against the remote project, not TODO-ed here.

begin;
select no_plan();

\set orgA '00000000-0000-0000-0000-000000000001'
\set orgB 'ac030001-0000-0000-0000-000000000002'
\set userB 'ac030002-0000-0000-0000-000000000002'
\set batchA 'ac030100-0000-0000-0000-000000000001'
\set batchEmpty 'ac030100-0000-0000-0000-000000000002'
\set batchB 'ac030100-0000-0000-0000-000000000003'
\set batchBig 'ac030100-0000-0000-0000-000000000004'

-- ── fixtures (superuser, RLS-bypassing) ──────────────────────────────────────────────────────────────
select set_config('t.owner', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'owner' limit 1), false);
select set_config('t.acct', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'accountant' limit 1), false);
select set_config('t.fm', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'farm_manager' limit 1), false);
select set_config('t.eng', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'agri_engineer' limit 1), false);
select set_config('t.sup', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'supervisor' limit 1), false);
select set_config('t.store', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'storekeeper' limit 1), false);

insert into public.organization (id, name) values (:'orgB', 'مزرعة أخرى — acceptance snapshot test');
insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
  values (:'userB', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());
insert into public.organization_member (org_id, user_id, role) values (:'orgB', :'userB', 'accountant');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create or replace function pg_temp.as_user_in_org(uid text, active_org text) returns void
language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', uid,
      'role', 'authenticated',
      'active_org_id', active_org
    )::text,
    true
  );
  execute 'set local role authenticated';
end $$;

-- Back to the RLS-bypassing fixture role. The claim is reset to an EMPTY JSON OBJECT, not to null:
-- set_config(..., null, ...) stores the empty string, and `''::json` raises in the audit/auth shims.
create or replace function pg_temp.as_superuser() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
end $$;

-- A same-org account/cost-center/supplier so the label joins have something real to resolve.
select set_config('t.account_id', (
  select a.id::text from public.accounts a
  where a.org_id = :'orgA' and a.active and a.kind = 'operating'
    and not exists (select 1 from public.accounts c
                    where c.org_id = a.org_id and c.parent_id = a.id and c.active)
  order by a.code limit 1), false);
select set_config('t.supplier_id', (
  select s.id::text from public.suppliers s where s.org_id = :'orgA' order by s.name limit 1), false);

-- ── batch A: two rows, one with an amount NO double can represent, one production orphan. ────────────
insert into public.reconciliation_batches (id, org_id, source_workbook_sha256, source_label, status, result_summary)
values (
  :'batchA', :'orgA', repeat('a', 64), 'دفتر اختبار القبول', 'staged',
  jsonb_build_object(
    'evidence_item_count', 2, 'batch_row_count', 2,
    'staging_manifest_sha256', repeat('b', 64),
    'tool_metadata', jsonb_build_object(
      'production_snapshot_sha256', repeat('c', 64),
      'exception_evidence_sha256', repeat('d', 64))));

insert into public.reconciliation_evidence_items (
  id, org_id, origin_kind, source_workbook_sha256, sheet_name, row_locator,
  source_identity_fingerprint, source_amount, source_date_text, source_date_parsed,
  classification, invalid_calendar_quality_flag, first_staged_batch_id, evidence_label)
values (
  'ac030200-0000-0000-0000-000000000001', :'orgA', 'source_workbook_row', repeat('a', 64),
  'المصروفات', '12', 'fp-1',
  -- 26 significant digits: a JSON number would round this; ::text must not.
  12345678901234567890.123456::numeric,
  '2024-01-05', '2024-01-05', 'source_addition_candidate', false, :'batchA', 'سماد يوريا');

insert into public.reconciliation_evidence_items (
  id, org_id, origin_kind, production_snapshot_sha256, snapshot_target_table, snapshot_target_id,
  source_identity_fingerprint, classification, invalid_calendar_quality_flag,
  first_staged_batch_id, evidence_label)
values (
  'ac030200-0000-0000-0000-000000000002', :'orgA', 'production_snapshot_row', repeat('c', 64),
  'sales', 'ac030300-0000-0000-0000-000000000001', 'fp-2',
  'production_orphan_candidate', true, :'batchA', 'سطر إنتاج بلا مصدر');

insert into public.reconciliation_batch_rows (
  id, org_id, batch_id, evidence_item_id, review_state, target_table, disposition,
  expense_category, expense_description, expense_kind, expense_account_id, expense_supplier_id,
  expense_payment_decision, review_reason, reviewed_at)
values (
  'ac030400-0000-0000-0000-000000000001', :'orgA', :'batchA', 'ac030200-0000-0000-0000-000000000001',
  'reviewed', 'expenses', 'include', 'أسمدة', 'سماد يوريا', 'operating',
  current_setting('t.account_id')::uuid, nullif(current_setting('t.supplier_id'), '')::uuid,
  -- an included expense row must carry the routing decision (20260726150000's check constraint)
  'routed_now', 'مطابق للدفتر', now());

insert into public.reconciliation_batch_rows (
  id, org_id, batch_id, evidence_item_id, review_state, target_table, disposition, sale_quantity,
  sale_unit_price, sale_recorded_total)
values (
  'ac030400-0000-0000-0000-000000000002', :'orgA', :'batchA', 'ac030200-0000-0000-0000-000000000002',
  'unreviewed', null, 'hold', 12.500, 1500.25, 18753.125);

-- batch with NO rows, and a cross-org batch that org A must never see.
insert into public.reconciliation_batches (id, org_id, source_workbook_sha256, status, result_summary)
values (:'batchEmpty', :'orgA', repeat('e', 64), 'staged',
        jsonb_build_object('evidence_item_count', 0, 'batch_row_count', 0));
insert into public.reconciliation_batches (id, org_id, source_workbook_sha256, status)
values (:'batchB', :'orgB', repeat('f', 64), 'staged');

-- The healthy staging record, captured before any mutation, so the restores below really restore it.
select set_config('t.good_summary', (
  select result_summary::text from public.reconciliation_batches where id = :'batchA'), false);

-- capture the pre-flight baseline: this is a READ RPC and nothing below may change any of these.
select set_config('t.rb0',  (select count(*)::text from public.reconciliation_batches), false);
select set_config('t.rbr0', (select count(*)::text from public.reconciliation_batch_rows), false);
select set_config('t.rei0', (select count(*)::text from public.reconciliation_evidence_items), false);
select set_config('t.exp0', (select count(*)::text from public.expenses), false);
select set_config('t.sal0', (select count(*)::text from public.sales), false);
select set_config('t.je0',  (select count(*)::text from public.journal_entries), false);
select set_config('t.jl0',  (select count(*)::text from public.journal_lines), false);

-- ══ 1) Catalog contract ═════════════════════════════════════════════════════════════════════════════
select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'fn_reconciliation_acceptance_snapshot'),
  false,
  'acceptance snapshot: SECURITY INVOKER — it can never read a row the caller could not read');

select is(
  (select p.provolatile::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'fn_reconciliation_acceptance_snapshot'),
  's',
  'acceptance snapshot: STABLE — every statement in the body sees the calling query''s snapshot');

select ok(
  (select p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'fn_reconciliation_acceptance_snapshot')
  @> array['search_path=""']::text[],
  'acceptance snapshot: search_path is locked to the empty string');

select ok(
  has_function_privilege('authenticated',
    'public.fn_reconciliation_acceptance_snapshot(uuid, uuid)', 'EXECUTE'),
  'acceptance snapshot: authenticated may EXECUTE it');
select ok(
  not has_function_privilege('anon',
    'public.fn_reconciliation_acceptance_snapshot(uuid, uuid)', 'EXECUTE'),
  'acceptance snapshot: anon may NOT EXECUTE it');
select ok(
  not has_function_privilege('public',
    'public.fn_reconciliation_acceptance_snapshot(uuid, uuid)', 'EXECUTE'),
  'acceptance snapshot: PUBLIC holds no EXECUTE');

-- ══ 2) Authn / role / tenancy ═══════════════════════════════════════════════════════════════════════
-- anon: user_org_ids() is empty, so the active-org gate refuses before anything is read.
set local role anon;
select throws_ok(
  format('select public.fn_reconciliation_acceptance_snapshot(%L, %L)', :'orgA', :'batchA'),
  '42501',
  null,
  'acceptance snapshot: anon is refused (42501)');
reset role;

-- every non-finance role is refused: they are members, but finance.read is owner/accountant only.
select pg_temp.as_user(current_setting('t.fm'));
select throws_ok(
  format('select public.fn_reconciliation_acceptance_snapshot(%L, %L)', :'orgA', :'batchA'),
  '42501', null, 'acceptance snapshot: farm_manager is refused (42501)');
select pg_temp.as_superuser();

select pg_temp.as_user(current_setting('t.eng'));
select throws_ok(
  format('select public.fn_reconciliation_acceptance_snapshot(%L, %L)', :'orgA', :'batchA'),
  '42501', null, 'acceptance snapshot: agri_engineer is refused (42501)');
select pg_temp.as_superuser();

select pg_temp.as_user(current_setting('t.sup'));
select throws_ok(
  format('select public.fn_reconciliation_acceptance_snapshot(%L, %L)', :'orgA', :'batchA'),
  '42501', null, 'acceptance snapshot: supervisor is refused (42501)');
select pg_temp.as_superuser();

select pg_temp.as_user(current_setting('t.store'));
select throws_ok(
  format('select public.fn_reconciliation_acceptance_snapshot(%L, %L)', :'orgA', :'batchA'),
  '42501', null, 'acceptance snapshot: storekeeper is refused (42501)');
select pg_temp.as_superuser();

-- a member of org B asking for org A is refused before any read; asking for their OWN org and org A's
-- batch gets 'not_found' — cross-org is indistinguishable from missing, by design.
select pg_temp.as_user(:'userB');
select throws_ok(
  format('select public.fn_reconciliation_acceptance_snapshot(%L, %L)', :'orgA', :'batchA'),
  '42501', null, 'acceptance snapshot: a non-member asking for another org is refused (42501)');
select is(
  (select public.fn_reconciliation_acceptance_snapshot(:'orgB', :'batchA') ->> 'status'),
  'not_found',
  'acceptance snapshot: org A''s batch is not_found for org B');
select pg_temp.as_superuser();

-- …and the same in the other direction.
select pg_temp.as_user(current_setting('t.acct'));
select is(
  (select public.fn_reconciliation_acceptance_snapshot(:'orgA', :'batchB') ->> 'status'),
  'not_found',
  'acceptance snapshot: org B''s batch is not_found for org A');
select is(
  (select public.fn_reconciliation_acceptance_snapshot(:'orgA', 'ac039999-0000-0000-0000-000000000099') ->> 'status'),
  'not_found',
  'acceptance snapshot: an unknown batch id is not_found');
select throws_ok(
  format('select public.fn_reconciliation_acceptance_snapshot(null, %L)', :'batchA'),
  '22023', null, 'acceptance snapshot: a null organization is rejected');
select pg_temp.as_superuser();

-- A dual-member user is narrowed to the claimed active org, not merely to their membership set.
insert into public.organization_member (org_id, user_id, role)
values (:'orgB', current_setting('t.acct')::uuid, 'accountant');
select pg_temp.as_user_in_org(current_setting('t.acct'), :'orgA');
select throws_ok(
  format('select public.fn_reconciliation_acceptance_snapshot(%L, %L)', :'orgB', :'batchB'),
  '42501', null, 'acceptance snapshot: active org A blocks a dual-member request for org B');
select pg_temp.as_superuser();
select pg_temp.as_user_in_org(current_setting('t.acct'), :'orgB');
select throws_ok(
  format('select public.fn_reconciliation_acceptance_snapshot(%L, %L)', :'orgA', :'batchA'),
  '42501', null, 'acceptance snapshot: switching the active claim to org B blocks org A');
select pg_temp.as_superuser();
delete from public.organization_member
 where org_id = :'orgB' and user_id = current_setting('t.acct')::uuid;

-- ══ 3) Happy path — owner AND accountant, whole batch, labels, exact decimals ═══════════════════════
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (select public.fn_reconciliation_acceptance_snapshot(:'orgA', :'batchA') ->> 'status'),
  'ok', 'acceptance snapshot: owner reads the batch');
select pg_temp.as_superuser();

select pg_temp.as_user(current_setting('t.acct'));
select set_config('t.snap',
  (select public.fn_reconciliation_acceptance_snapshot(:'orgA', :'batchA')::text), false);

select is(current_setting('t.snap')::jsonb ->> 'status', 'ok',
  'acceptance snapshot: accountant reads the batch');
select is(current_setting('t.snap')::jsonb ->> 'version',
  'farm-os.reconciliation-acceptance-snapshot.v1',
  'acceptance snapshot: the payload names its contract version');
select is((current_setting('t.snap')::jsonb ->> 'max_rows')::int, 1000,
  'acceptance snapshot: the bound the app pins is the bound the DB enforces');
select is((current_setting('t.snap')::jsonb ->> 'row_count')::int, 2,
  'acceptance snapshot: both rows came back');
select is((current_setting('t.snap')::jsonb ->> 'evidence_item_count')::int, 2,
  'acceptance snapshot: the distinct evidence count is reported too');
select is(jsonb_array_length(current_setting('t.snap')::jsonb -> 'rows'), 2,
  'acceptance snapshot: the rows array holds the whole batch');
select is(current_setting('t.snap')::jsonb -> 'batch' ->> 'source_label', 'دفتر اختبار القبول',
  'acceptance snapshot: the batch identity comes back');
select ok(not (current_setting('t.snap')::jsonb -> 'batch' ? 'org_id'),
  'acceptance snapshot: org_id is not echoed back into the payload');
select is(
  current_setting('t.snap')::jsonb -> 'batch' -> 'result_summary'
    -> 'tool_metadata' ->> 'exception_evidence_sha256',
  repeat('d', 64),
  'acceptance snapshot: the COMPLETE result_summary provenance is returned, nested fields included');

-- EXACT DECIMALS: text, digit for digit. A JSON number would have rounded this at the 17th digit.
select set_config('t.row1',
  (select r::text from jsonb_array_elements(current_setting('t.snap')::jsonb -> 'rows') r
    where r ->> 'id' = 'ac030400-0000-0000-0000-000000000001'), false);
select set_config('t.row2',
  (select r::text from jsonb_array_elements(current_setting('t.snap')::jsonb -> 'rows') r
    where r ->> 'id' = 'ac030400-0000-0000-0000-000000000002'), false);

select is(
  jsonb_typeof(current_setting('t.row1')::jsonb -> 'evidence' -> 'source_amount'),
  'string',
  'acceptance snapshot: source_amount leaves PostgreSQL as TEXT, never as a JSON number');
select is(
  current_setting('t.row1')::jsonb -> 'evidence' ->> 'source_amount',
  '12345678901234567890.123456',
  'acceptance snapshot: a 26-digit amount keeps every digit (no double ever touched it)');
select is(
  array[
    jsonb_typeof(current_setting('t.row2')::jsonb -> 'sale_quantity'),
    jsonb_typeof(current_setting('t.row2')::jsonb -> 'sale_unit_price'),
    jsonb_typeof(current_setting('t.row2')::jsonb -> 'sale_recorded_total')],
  array['string', 'string', 'string'],
  'acceptance snapshot: every sale numeric leaves as TEXT too');
select is(
  array[
    current_setting('t.row2')::jsonb ->> 'sale_quantity',
    current_setting('t.row2')::jsonb ->> 'sale_unit_price',
    current_setting('t.row2')::jsonb ->> 'sale_recorded_total'],
  array['12.500', '1500.25', '18753.125'],
  'acceptance snapshot: the sale numerics keep their exact recorded scale');

-- Readable dimension labels, resolved in the same call.
select is(
  current_setting('t.row1')::jsonb -> 'expense_account' ->> 'code',
  (select code from public.accounts where id = current_setting('t.account_id')::uuid),
  'acceptance snapshot: the expense account label is joined in the same call');
select ok(
  current_setting('t.row1')::jsonb -> 'expense_account' ? 'name_ar',
  'acceptance snapshot: the account label carries its Arabic name');
select is(
  jsonb_typeof(current_setting('t.row2')::jsonb -> 'expense_account'), 'null',
  'acceptance snapshot: an unset dimension is an explicit null, not a missing key');
select ok(
  current_setting('t.row2')::jsonb ? 'sale_hawsha'
  and current_setting('t.row2')::jsonb ? 'sale_farm'
  and current_setting('t.row2')::jsonb ? 'sale_buyer',
  'acceptance snapshot: every label key is always present, so a missing one can be detected');

-- Evidence is present and complete on every row.
select is(
  current_setting('t.row1')::jsonb -> 'evidence' ->> 'evidence_label', 'سماد يوريا',
  'acceptance snapshot: each row carries its own evidence');
select is(
  (current_setting('t.row2')::jsonb -> 'evidence' ->> 'invalid_calendar_quality_flag')::boolean,
  true,
  'acceptance snapshot: the evidence quality flag comes back as a real boolean');
select is(
  jsonb_typeof(current_setting('t.row2')::jsonb -> 'evidence' -> 'source_amount'), 'null',
  'acceptance snapshot: a production orphan''s absent amount is null, never 0');

-- UTC timestamps, so two reads cannot differ by session timezone.
select ok(
  current_setting('t.snap')::jsonb -> 'batch' ->> 'created_at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$',
  'acceptance snapshot: created_at is explicit UTC ISO-8601 with a literal Z');
select ok(
  current_setting('t.row1')::jsonb ->> 'reviewed_at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$',
  'acceptance snapshot: reviewed_at is explicit UTC ISO-8601 too');

-- The same call under a non-UTC session TimeZone must produce the SAME timestamp text.
set local timezone to 'Asia/Riyadh';
select is(
  (select public.fn_reconciliation_acceptance_snapshot(:'orgA', :'batchA')
     -> 'batch' ->> 'created_at'),
  (current_setting('t.snap')::jsonb -> 'batch' ->> 'created_at'),
  'acceptance snapshot: the timestamp text does not follow the session TimeZone');
set local timezone to 'UTC';
select pg_temp.as_superuser();

-- ══ 4) Zero rows is never 'ok' ══════════════════════════════════════════════════════════════════════
select pg_temp.as_user(current_setting('t.acct'));
select is(
  (select public.fn_reconciliation_acceptance_snapshot(:'orgA', :'batchEmpty') ->> 'status'),
  'empty',
  'acceptance snapshot: a batch with no rows is REFUSED — a report of zeros is not an acceptance');
select ok(
  not (public.fn_reconciliation_acceptance_snapshot(:'orgA', :'batchEmpty') ? 'rows'),
  'acceptance snapshot: the empty verdict carries no rows array to render');
select pg_temp.as_superuser();

-- ══ 5) The staging record: disagreement AND damage are both refusals ════════════════════════════════
-- (a) a recorded count that disagrees with what is stored.
update public.reconciliation_batches
   set result_summary = jsonb_set(result_summary, '{batch_row_count}', '3'::jsonb)
 where id = :'batchA';
select pg_temp.as_user(current_setting('t.acct'));
select is(
  (select public.fn_reconciliation_acceptance_snapshot(:'orgA', :'batchA') ->> 'status'),
  'count_mismatch',
  'acceptance snapshot: a staged row count that disagrees with the stored rows is refused');
select is(
  (select public.fn_reconciliation_acceptance_snapshot(:'orgA', :'batchA') ->> 'staged_counts_state'),
  'recorded',
  'acceptance snapshot: the disagreement verdict says the record was readable but wrong');
select pg_temp.as_superuser();

update public.reconciliation_batches
   set result_summary = jsonb_set(result_summary, '{batch_row_count}', '2'::jsonb)
 where id = :'batchA';
update public.reconciliation_batches
   set result_summary = jsonb_set(result_summary, '{evidence_item_count}', '5'::jsonb)
 where id = :'batchA';
select pg_temp.as_user(current_setting('t.acct'));
select is(
  (select public.fn_reconciliation_acceptance_snapshot(:'orgA', :'batchA') ->> 'status'),
  'count_mismatch',
  'acceptance snapshot: a staged EVIDENCE count that disagrees is refused as well');
select pg_temp.as_superuser();

-- (b) damage: a present-but-unreadable record must never be treated as an absent one.
-- (the healthy record was captured BEFORE the mutations above, so restoring it really does restore it)

create or replace function pg_temp.status_with_summary(p_status text, p_summary jsonb) returns text
language plpgsql as $$
declare v_status text;
begin
  update public.reconciliation_batches set status = p_status, result_summary = p_summary
   where id = 'ac030100-0000-0000-0000-000000000001';
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('t.acct'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.fn_reconciliation_acceptance_snapshot(
    '00000000-0000-0000-0000-000000000001', 'ac030100-0000-0000-0000-000000000001') ->> 'status'
    into v_status;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  return v_status;
end $$;

select is(
  pg_temp.status_with_summary('staged', jsonb_build_object('batch_row_count', 2)),
  'count_mismatch',
  'acceptance snapshot: batch_row_count WITHOUT evidence_item_count is damage, not absence');
select is(
  pg_temp.status_with_summary('staged', jsonb_build_object('evidence_item_count', 2)),
  'count_mismatch',
  'acceptance snapshot: evidence_item_count WITHOUT batch_row_count is damage, not absence');
select is(
  pg_temp.status_with_summary('staged', jsonb_build_object('evidence_item_count', 2, 'batch_row_count', '2')),
  'count_mismatch',
  'acceptance snapshot: a staged count sent as a STRING is refused');
select is(
  pg_temp.status_with_summary('staged', jsonb_build_object('evidence_item_count', 2, 'batch_row_count', 2.5)),
  'count_mismatch',
  'acceptance snapshot: a non-integer staged count is refused');
select is(
  pg_temp.status_with_summary('staged', jsonb_build_object('evidence_item_count', 2, 'batch_row_count', -2)),
  'count_mismatch',
  'acceptance snapshot: a negative staged count is refused');
select is(
  pg_temp.status_with_summary('staged', jsonb_build_object('evidence_item_count', 2, 'batch_row_count', 12345678901)),
  'count_mismatch',
  'acceptance snapshot: an out-of-range staged count is refused, and does not raise on the ::int cast');
select is(
  pg_temp.status_with_summary('staged', jsonb_build_object('evidence_item_count', 2, 'batch_row_count', null)),
  'count_mismatch',
  'acceptance snapshot: a null staged count is refused');

-- (c) absence is forbidden before a terminal lifecycle verdict.
select is(
  pg_temp.status_with_summary('staged', jsonb_build_object('executed_rows', 2, 'skipped_rows', 0)),
  'count_mismatch',
  'acceptance snapshot: a staged batch cannot masquerade as an execution outcome');
select is(
  pg_temp.status_with_summary('staged', null),
  'count_mismatch',
  'acceptance snapshot: a staged batch with null result_summary is damaged, not exempt');
select is(
  pg_temp.status_with_summary('executing', null),
  'count_mismatch',
  'acceptance snapshot: a transient executing batch has no final outcome to accept');

-- (d) exact, status-matched terminal verdicts are the only legitimate absence.
update public.reconciliation_batch_rows
   set execution_result = 'posted'
 where id = 'ac030400-0000-0000-0000-000000000001';
select is(
  pg_temp.status_with_summary('executed', jsonb_build_object('executed_rows', 1, 'skipped_rows', 0)),
  'ok',
  'acceptance snapshot: an exact executed verdict legitimately replaces staging counts');
select is(
  pg_temp.status_with_summary('executed', jsonb_build_object('executed_rows', 0, 'skipped_rows', 1)),
  'count_mismatch',
  'acceptance snapshot: executed verdict counts must match row-level execution results');
update public.reconciliation_batch_rows
   set execution_result = 'pending'
 where id = 'ac030400-0000-0000-0000-000000000001';
select is(
  pg_temp.status_with_summary('executed', jsonb_build_object('executed_rows', 1, 'skipped_rows', 0)),
  'count_mismatch',
  'acceptance snapshot: an included pending row prevents an executed acceptance verdict');
update public.reconciliation_batch_rows
   set execution_result = 'failed'
 where id = 'ac030400-0000-0000-0000-000000000001';
select is(
  pg_temp.status_with_summary('executed', jsonb_build_object('executed_rows', 1, 'skipped_rows', 0)),
  'count_mismatch',
  'acceptance snapshot: an included failed row prevents an executed acceptance verdict');
update public.reconciliation_batch_rows
   set execution_result = 'reversed'
 where id = 'ac030400-0000-0000-0000-000000000001';
select is(
  pg_temp.status_with_summary('executed', jsonb_build_object('executed_rows', 1, 'skipped_rows', 0)),
  'ok',
  'acceptance snapshot: a reversed included row counts as an executed money action');
update public.reconciliation_batch_rows
   set execution_result = 'skipped'
 where id = 'ac030400-0000-0000-0000-000000000001';
select is(
  pg_temp.status_with_summary('executed', jsonb_build_object('executed_rows', 0, 'skipped_rows', 1)),
  'ok',
  'acceptance snapshot: a skipped included row is recognized separately from executed money actions');
select is(
  pg_temp.status_with_summary(
    'failed',
    jsonb_build_object('failure_code', 'integrity_check', 'safe_locator', 'sheet:12')),
  'ok',
  'acceptance snapshot: an exact failed verdict legitimately replaces staging counts');
select is(
  pg_temp.status_with_summary(
    'rolled_back',
    jsonb_build_object(
      'rolled_back_at', '2026-07-28T10:00:00Z',
      'rollback_reason', 'اختبار',
      'reversed_journals', 1,
      'reinstated_journals', 0,
      'zero_value_rows', 0,
      'ledger_rows_reversed', 2,
      'rows_marked_reversed', 2)),
  'ok',
  'acceptance snapshot: an exact rollback verdict legitimately replaces staging counts');
select is(
  pg_temp.status_with_summary(
    'executed',
    jsonb_build_object('executed_rows', 1, 'skipped_rows', 0, 'unexpected', true)),
  'count_mismatch',
  'acceptance snapshot: an executed verdict with an unrecognized field is refused');
select is(
  pg_temp.status_with_summary('failed', jsonb_build_object('failure_code', 'integrity_check')),
  'count_mismatch',
  'acceptance snapshot: a partial failed verdict is refused');

-- restore the healthy record.
update public.reconciliation_batch_rows
   set execution_result = 'pending'
 where id = 'ac030400-0000-0000-0000-000000000001';
select pg_temp.status_with_summary('staged', current_setting('t.good_summary')::jsonb);

-- ══ 6) Incomplete: a row whose evidence cannot be read ══════════════════════════════════════════════
-- The evidence row is moved out of the caller's org, so the SECURITY INVOKER read cannot see it. The
-- LEFT join keeps the batch row (an INNER join would have made it vanish silently) and the verdict
-- refuses the whole report.
alter table public.reconciliation_batch_rows disable trigger guard_reconciliation_batch_row_tenant;
alter table public.reconciliation_evidence_items
  drop constraint reconciliation_evidence_items_first_batch_tenant_fk;
alter table public.reconciliation_batch_rows
  drop constraint reconciliation_batch_rows_evidence_tenant_fk;
update public.reconciliation_evidence_items set org_id = :'orgB'
 where id = 'ac030200-0000-0000-0000-000000000002';

select pg_temp.as_user(current_setting('t.acct'));
select is(
  (select public.fn_reconciliation_acceptance_snapshot(:'orgA', :'batchA') ->> 'status'),
  'incomplete',
  'acceptance snapshot: a row whose evidence is unreadable refuses the WHOLE report');
select is(
  (select (public.fn_reconciliation_acceptance_snapshot(:'orgA', :'batchA')
            ->> 'rows_missing_evidence')::int),
  1,
  'acceptance snapshot: the unreadable-evidence row is COUNTED, not dropped');
select pg_temp.as_superuser();

update public.reconciliation_evidence_items set org_id = :'orgA'
 where id = 'ac030200-0000-0000-0000-000000000002';
alter table public.reconciliation_batch_rows
  add constraint reconciliation_batch_rows_evidence_tenant_fk
  foreign key (evidence_item_id, org_id) references public.reconciliation_evidence_items(id, org_id);
alter table public.reconciliation_evidence_items
  add constraint reconciliation_evidence_items_first_batch_tenant_fk
  foreign key (first_staged_batch_id, org_id) references public.reconciliation_batches(id, org_id);
alter table public.reconciliation_batch_rows enable trigger guard_reconciliation_batch_row_tenant;

select pg_temp.as_user(current_setting('t.acct'));
select is(
  (select public.fn_reconciliation_acceptance_snapshot(:'orgA', :'batchA') ->> 'status'),
  'ok', 'acceptance snapshot: the batch reads clean again once its evidence is readable');
select pg_temp.as_superuser();

-- ══ 7) Overflow: MORE than the bound is refused, never truncated to it ══════════════════════════════
insert into public.reconciliation_batches (id, org_id, source_workbook_sha256, status)
values (:'batchBig', :'orgA', repeat('9', 64), 'staged');

insert into public.reconciliation_evidence_items (
  id, org_id, origin_kind, source_workbook_sha256, sheet_name, row_locator,
  classification, invalid_calendar_quality_flag, first_staged_batch_id, source_amount)
select
  ('ac031000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, :'orgA', 'source_workbook_row',
  repeat('9', 64), 'المصروفات', g::text, 'source_addition_candidate', false, :'batchBig', 1.00
from generate_series(1, 1001) g;

insert into public.reconciliation_batch_rows (id, org_id, batch_id, evidence_item_id, review_state, disposition)
select
  ('ac032000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, :'orgA', :'batchBig',
  ('ac031000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'unreviewed', 'hold'
from generate_series(1, 1001) g;

select pg_temp.as_user(current_setting('t.acct'));
select is(
  (select public.fn_reconciliation_acceptance_snapshot(:'orgA', :'batchBig') ->> 'status'),
  'overflow',
  'acceptance snapshot: 1001 rows is refused, not truncated to the 1000-row bound');
select ok(
  not (public.fn_reconciliation_acceptance_snapshot(:'orgA', :'batchBig') ? 'rows'),
  'acceptance snapshot: the overflow verdict carries no partial rows array');
select pg_temp.as_superuser();

-- …and exactly AT the bound still reads.
delete from public.reconciliation_batch_rows
 where id = 'ac032000-0000-4000-8000-000000001001';
delete from public.reconciliation_evidence_items
 where id = 'ac031000-0000-4000-8000-000000001001';
update public.reconciliation_batches
   set result_summary = jsonb_build_object(
     'evidence_item_count', 1000,
     'batch_row_count', 1000)
 where id = :'batchBig';

select pg_temp.as_user(current_setting('t.acct'));
select is(
  (select public.fn_reconciliation_acceptance_snapshot(:'orgA', :'batchBig') ->> 'status'),
  'ok', 'acceptance snapshot: exactly 1000 rows still reads in full');
select is(
  (select (public.fn_reconciliation_acceptance_snapshot(:'orgA', :'batchBig') ->> 'row_count')::int),
  1000, 'acceptance snapshot: all 1000 rows come back, none dropped');
select pg_temp.as_superuser();

-- ══ 8) READ-ONLY: nothing above changed a single row of any reconciliation or financial table ═══════
select is(
  (select count(*)::text from public.reconciliation_batch_rows
    where batch_id = 'ac030100-0000-0000-0000-000000000001'),
  '2', 'acceptance snapshot: reading batch A left its rows untouched');
select is(
  (select count(*)::text from public.expenses), current_setting('t.exp0'),
  'acceptance snapshot: no expense was created or removed');
select is(
  (select count(*)::text from public.sales), current_setting('t.sal0'),
  'acceptance snapshot: no sale was created or removed');
select is(
  (select count(*)::text from public.journal_entries), current_setting('t.je0'),
  'acceptance snapshot: no journal entry was created or removed');
select is(
  (select count(*)::text from public.journal_lines), current_setting('t.jl0'),
  'acceptance snapshot: no journal line was created or removed');
select is(
  (select count(*)::text from public.reconciliation_batch_rows
    where batch_id <> 'ac030100-0000-0000-0000-000000000004'),
  current_setting('t.rbr0'),
  'acceptance snapshot: no pre-existing batch row was created or removed');
select is(
  (select status from public.reconciliation_batches where id = 'ac030100-0000-0000-0000-000000000001'),
  'staged',
  'acceptance snapshot: reading a batch never advances its status');
select is(
  (select result_summary::text from public.reconciliation_batches
    where id = 'ac030100-0000-0000-0000-000000000001'),
  current_setting('t.good_summary'),
  'acceptance snapshot: provenance/result_summary is byte-for-byte unchanged after every read');
select is(
  (select string_agg(
     review_state || '|' || disposition || '|' || execution_result || '|' || frozen::text,
     ',' order by id)
   from public.reconciliation_batch_rows
   where batch_id = 'ac030100-0000-0000-0000-000000000001'),
  'reviewed|include|pending|false,unreviewed|hold|pending|false',
  'acceptance snapshot: decisions, dispositions and execution bookkeeping stay unchanged');
select is(
  (select count(*)::int from public.reconciliation_evidence_items
    where first_staged_batch_id = 'ac030100-0000-0000-0000-000000000001'
      and org_id = '00000000-0000-0000-0000-000000000001'),
  2,
  'acceptance snapshot: evidence ownership and provenance stay unchanged');
select is(
  (select count(*)::int from public.reconciliation_batch_rows
    where batch_id = 'ac030100-0000-0000-0000-000000000001' and (frozen or review_state = 'frozen')),
  0, 'acceptance snapshot: reading a batch never freezes a row');

select finish();
rollback;
