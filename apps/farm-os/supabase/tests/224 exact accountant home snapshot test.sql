-- Accountant home is active-org-only, accountant-role-only, exact, bounded, and reuses the
-- canonical month-close/custody/receivable contracts rather than re-deriving them.
begin;
select no_plan();

\set org '22400000-0000-0000-0000-0000000000a0'
\set org_b '22400000-0000-0000-0000-0000000000b0'
\set acct_row '22400000-0000-0000-0000-000000000010'
\set capex_acct '22400000-0000-0000-0000-000000000012'
\set cc_row '22400000-0000-0000-0000-000000000011'
\set custody1 '22400000-0000-0000-0000-000000000020'
\set custody2 '22400000-0000-0000-0000-000000000021'
\set buyer '22400000-0000-0000-0000-000000000030'

select set_config('test.cutover', '2026-07-01', false);
select set_config('test.today', ((pg_catalog.now() at time zone 'Africa/Cairo')::date)::text, false);
select set_config('test.month_start', (date_trunc('month', current_setting('test.today')::date))::text, false);
select set_config('test.owner', (select user_id::text from public.organization_member where role = 'owner' limit 1), false);
select set_config('test.accountant', (select user_id::text from public.organization_member where role = 'accountant' limit 1), false);
select set_config('test.manager', (select user_id::text from public.organization_member where role = 'farm_manager' limit 1), false);
select set_config('test.storekeeper', (select user_id::text from public.organization_member where role = 'storekeeper' limit 1), false);

insert into public.organization(id, name) values
  (:'org', 'Exact accountant home org'),
  (:'org_b', 'Exact accountant home foreign org');
insert into public.organization_member(org_id, user_id, role) values
  (:'org', current_setting('test.owner')::uuid, 'owner'),
  (:'org', current_setting('test.accountant')::uuid, 'accountant'),
  (:'org', current_setting('test.manager')::uuid, 'farm_manager'),
  (:'org', current_setting('test.storekeeper')::uuid, 'storekeeper'),
  (:'org_b', current_setting('test.owner')::uuid, 'owner');

-- Authority defaults to unverified when no row exists at all; start at 'partial' (the seeded default
-- for the demo org elsewhere in the app) to test the not-verified money-nulling branch first.
insert into public.data_authority_status(org_id, domain, status, notes)
values (:'org', 'finance_ledger', 'partial', 'test fixture: not yet verified');

insert into public.accounts(id, org_id, code, name_ar, account_type, normal_balance, kind) values
  (:'acct_row', :'org', '6000', 'حساب اختبار', 'expense', 'debit', 'operating'),
  (:'capex_acct', :'org', '1600', 'أصل اختبار', 'asset', 'debit', 'capex');
insert into public.cost_centers(id, org_id, code, name_ar) values
  (:'cc_row', :'org', 'CC-1', 'مركز اختبار');
insert into public.buyers(id, org_id, name) values (:'buyer', :'org', 'مشتري اختبار');

insert into public.accounting_periods(org_id, period_start, period_end, status) values
  (:'org', date_trunc('month', current_setting('test.today')::date)::date,
   (date_trunc('month', current_setting('test.today')::date) + interval '1 month' - interval '1 day')::date,
   'locked');

-- ── pending pricing: the canonical close predicate includes the zero-qty source gap too ─────────
insert into public.sales(id, org_id, crop, qty, buyer_id, price_status, payment_status, sale_date)
values
  ('22400000-0000-0000-0000-000000000101', :'org', 'برحي', 10, :'buyer', 'pending', 'unpaid', current_setting('test.today')::date),
  ('22400000-0000-0000-0000-000000000102', :'org', 'سمراء', 5, :'buyer', 'pending', 'unpaid', current_setting('test.today')::date - 1),
  ('22400000-0000-0000-0000-000000000103', :'org', 'زغلول', 0, :'buyer', 'pending', 'unpaid', current_setting('test.today')::date),
  ('22400000-0000-0000-0000-000000000104', :'org', 'زغلول', 8, :'buyer', 'pending', 'unpaid', current_setting('test.today')::date - 2);

-- ── receivables: one aged (cutover era, >30 days old, no posted journal needed for the aged def),
--    two recent + open (posted journal required by fn_open_sale_receivables) ──
insert into public.sales(id, org_id, crop, qty, buyer_id, total, unit_price, price_status, payment_status, sale_date)
values
  ('22400000-0000-0000-0000-000000000201', :'org', 'برحي', 100, :'buyer', 1000, 10, 'finalized', 'unpaid',
   current_setting('test.cutover')::date + 5),
  ('22400000-0000-0000-0000-000000000202', :'org', 'برحي', 50, :'buyer', 500, 10, 'finalized', 'unpaid',
   current_setting('test.today')::date - 5),
  ('22400000-0000-0000-0000-000000000203', :'org', 'برحي', 50, :'buyer', 500, 10, 'finalized', 'unpaid',
   current_setting('test.today')::date - 3);
insert into public.journal_entries(org_id, entry_date, source_type, source_id, status)
values
  (:'org', current_setting('test.today')::date - 5, 'sale', '22400000-0000-0000-0000-000000000202', 'posted'),
  (:'org', current_setting('test.today')::date - 3, 'sale', '22400000-0000-0000-0000-000000000203', 'posted');

-- ── close blockers: undated / unrouted / unclassified / unallocated, one row each ──
insert into public.expenses(id, org_id, date, category, description, total, status, payment_status, kind, account_id, cost_center_id)
values
  ('22400000-0000-0000-0000-000000000301', :'org', null, 'تشغيل', 'غير مؤرخ', 300, 'approved', 'paid_by_owner', 'operating', :'acct_row', :'cc_row'),
  ('22400000-0000-0000-0000-000000000302', :'org', current_setting('test.cutover')::date + 10, 'تشغيل', 'غير موجّه', 150, 'approved', null, 'operating', :'acct_row', :'cc_row'),
  ('22400000-0000-0000-0000-000000000303', :'org', current_setting('test.cutover')::date + 10, 'تشغيل', 'غير مصنّف', 200, 'approved', 'paid_by_owner', 'operating', null, :'cc_row'),
  ('22400000-0000-0000-0000-000000000304', :'org', current_setting('test.cutover')::date + 10, 'تشغيل', 'غير موزّع', 250, 'approved', 'paid_by_owner', 'operating', :'acct_row', null),
  ('22400000-0000-0000-0000-000000000305', :'org', current_setting('test.today')::date, 'تشغيل', 'مصروف تشغيل غير مسدد', 400, 'approved', 'post_paid_unpaid', 'operating', :'acct_row', :'cc_row'),
  ('22400000-0000-0000-0000-000000000306', :'org', current_setting('test.today')::date, 'مسحوبات', 'مسحوبات مالك غير مسددة', 999, 'approved', 'post_paid_unpaid', 'drawing', null, :'cc_row'),
  ('22400000-0000-0000-0000-000000000307', :'org', current_setting('test.today')::date, 'تشغيل', 'مصروف تشغيل مجهول القيمة', null, 'approved', 'post_paid_unpaid', 'operating', :'acct_row', :'cc_row'),
  ('22400000-0000-0000-0000-000000000308', :'org', current_setting('test.today')::date, 'رأسمالي', 'أصل غير مسدد', 700, 'approved', 'post_paid_unpaid', 'capex', :'capex_acct', :'cc_row'),
  ('22400000-0000-0000-0000-000000000309', :'org', current_setting('test.today')::date, 'رأسمالي', 'أصل مجهول القيمة', null, 'approved', 'post_paid_unpaid', 'capex', :'capex_acct', :'cc_row'),
  ('22400000-0000-0000-0000-000000000310', :'org', current_setting('test.today')::date + 1, 'تشغيل', 'مصروف مستقبلي', 888, 'approved', 'post_paid_unpaid', 'operating', :'acct_row', :'cc_row');

-- ── custody: two accounts, exact target float / closing balance ──
insert into public.custody_accounts(id, org_id, holder_label, target_float) values
  (:'custody1', :'org', 'محاسب أول', 1000),
  (:'custody2', :'org', 'محاسب ثانٍ', 500);
insert into public.custody_movements(org_id, custody_account_id, movement_type, amount_in, amount_out) values
  (:'org', :'custody1', 'استلام عهدة', 1000, 0),
  (:'org', :'custody2', 'استلام عهدة', 500, 0),
  (:'org', :'custody2', 'صرف نقدي', 0, 200);
insert into public.custody_movements(org_id, custody_account_id, occurred_at, movement_type, amount_in, amount_out) values
  (:'org', :'custody1', current_setting('test.today')::date + 1, 'صرف مستقبلي', 0, 1000);

-- ── payment requests across every canonical stage ──
insert into public.payment_requests(id, org_id, request_no, status) values
  ('22400000-0000-0000-0000-000000000401', :'org', 1, 'draft'),
  ('22400000-0000-0000-0000-000000000402', :'org', 2, 'submitted'),
  ('22400000-0000-0000-0000-000000000403', :'org', 3, 'approved_operational'),
  ('22400000-0000-0000-0000-000000000404', :'org', 4, 'approved_final'),
  ('22400000-0000-0000-0000-000000000405', :'org', 5, 'paid'),
  ('22400000-0000-0000-0000-000000000406', :'org', 6, 'closed');

-- ── reconciliation: unreviewed / held-pending / failed / terminal(posted, excluded) ──
insert into public.reconciliation_batches(id, org_id, status) values
  ('22400000-0000-0000-0000-000000000501', :'org', 'staged'),
  ('22400000-0000-0000-0000-000000000502', :'org', 'executed'),
  ('22400000-0000-0000-0000-000000000503', :'org', 'reviewed'),
  ('22400000-0000-0000-0000-000000000504', :'org', 'failed');
insert into public.reconciliation_evidence_items(id, org_id, origin_kind, source_workbook_sha256, sheet_name, row_locator, classification)
select ('22400000-0000-0000-0000-' || lpad((600 + i)::text, 12, '0'))::uuid,
       :'org', 'source_workbook_row', repeat('a', 64), 'Sheet1', 'loc-' || i, 'source_addition_candidate'
from generate_series(1, 4) i;
insert into public.reconciliation_batch_rows(id, org_id, batch_id, evidence_item_id, review_state, disposition, execution_result)
values
  ('22400000-0000-0000-0000-000000000601', :'org', '22400000-0000-0000-0000-000000000501',
   '22400000-0000-0000-0000-000000000601', 'unreviewed', 'hold', 'pending'),
  ('22400000-0000-0000-0000-000000000602', :'org', '22400000-0000-0000-0000-000000000501',
   '22400000-0000-0000-0000-000000000602', 'reviewed', 'hold', 'pending'),
  ('22400000-0000-0000-0000-000000000603', :'org', '22400000-0000-0000-0000-000000000501',
   '22400000-0000-0000-0000-000000000603', 'reviewed', 'hold', 'failed');
insert into public.reconciliation_batch_rows(
  id, org_id, batch_id, evidence_item_id, review_state, target_table, disposition,
  expense_category, expense_kind, expense_account_id, expense_payment_decision, execution_result
) values (
  '22400000-0000-0000-0000-000000000604', :'org', '22400000-0000-0000-0000-000000000502',
  '22400000-0000-0000-0000-000000000604', 'executed', 'expenses', 'include',
  'تشغيل', 'operating', :'acct_row', 'routed_now', 'posted'
);

-- ── comparison: posted current/previous-month journal entries, cutover-scoped, plus a reversed
--    entry (excluded) and a pre-cutover entry (excluded by the cutover scope) ──
insert into public.journal_entries(org_id, entry_date, source_type, source_id, status) values
  (:'org', current_setting('test.today')::date, 'manual', gen_random_uuid(), 'posted'),
  (:'org', date_trunc('month', current_setting('test.today')::date)::date, 'manual', gen_random_uuid(), 'posted'),
  (:'org', current_setting('test.today')::date, 'manual', gen_random_uuid(), 'reversed'),
  (:'org', current_setting('test.today')::date + 1, 'manual', gen_random_uuid(), 'posted'),
  (:'org', current_setting('test.cutover')::date, 'manual', gen_random_uuid(), 'posted'),
  (:'org', current_setting('test.cutover')::date - 5, 'manual', gen_random_uuid(), 'posted');

-- ── grants / definition invariants ──────────────────────────────────────────────────────────────
select ok(not has_function_privilege('public',
  'public.fn_accountant_home_snapshot(uuid,date,date,integer)', 'EXECUTE'),
  'PUBLIC cannot execute the accountant home snapshot');
select ok(not has_function_privilege('anon',
  'public.fn_accountant_home_snapshot(uuid,date,date,integer)', 'EXECUTE'),
  'anon cannot execute the accountant home snapshot');
select ok(has_function_privilege('authenticated',
  'public.fn_accountant_home_snapshot(uuid,date,date,integer)', 'EXECUTE'),
  'authenticated reaches the internal accountant and active-org gates');
select ok(not (select prosecdef from pg_proc
  where oid = 'public.fn_accountant_home_snapshot(uuid,date,date,integer)'::regprocedure),
  'accountant home snapshot keeps caller RLS through SECURITY INVOKER');
select is((select provolatile::text from pg_proc
  where oid = 'public.fn_accountant_home_snapshot(uuid,date,date,integer)'::regprocedure),
  's', 'accountant home snapshot is stable');
select is((select proconfig[1] from pg_proc
  where oid = 'public.fn_accountant_home_snapshot(uuid,date,date,integer)'::regprocedure),
  'search_path=""', 'accountant home snapshot has an empty search_path');

create or replace function pg_temp.as_user(uid text, active_org uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when active_org is null then json_build_object('sub', uid, 'role', 'authenticated')
         else json_build_object('sub', uid, 'role', 'authenticated', 'active_org_id', active_org) end::text,
    true);
  execute 'set local role authenticated';
end $$;

-- ── positive path, authority = partial → money nulled, exact counts/queues remain ──────────────
select pg_temp.as_user(current_setting('test.accountant'), :'org');
select set_config('test.snapshot', public.fn_accountant_home_snapshot(
  :'org', current_setting('test.today')::date, current_setting('test.cutover')::date, 2)::text, false);

select is(current_setting('test.snapshot')::jsonb->>'version', 'farm-os.accountant-home.v1',
  'snapshot version is pinned');
select is(current_setting('test.snapshot')::jsonb->>'org_id', :'org',
  'snapshot is bound to the active organization');
select is(current_setting('test.snapshot')::jsonb->>'as_of', current_setting('test.today'),
  'snapshot as_of matches the Cairo business date');
select is(current_setting('test.snapshot')::jsonb->>'cutover', current_setting('test.cutover'),
  'snapshot cutover matches the canonical live-entry cutover');
select is(current_setting('test.snapshot')::jsonb->>'month_start',
  (date_trunc('month', current_setting('test.today')::date))::date::text,
  'snapshot month_start is the Cairo calendar month start');
select is(current_setting('test.snapshot')::jsonb->>'month_end',
  (date_trunc('month', current_setting('test.today')::date) + interval '1 month')::date::text,
  'snapshot month_end is the exclusive next-month boundary');
select is(current_setting('test.snapshot')::jsonb->>'authority', 'partial',
  'snapshot carries the finance_ledger authority status');
select is((current_setting('test.snapshot')::jsonb->>'money_available')::boolean, false,
  'money is withheld while finance_ledger authority is partial');
select is(jsonb_typeof(current_setting('test.snapshot')::jsonb->'detail_limit'), 'number',
  'detail_limit is the only numeric field');
select ok(not jsonb_path_exists(
  current_setting('test.snapshot')::jsonb - 'detail_limit',
  '$.** ? (@.type() == "number")'
), 'all payload numbers other than detail_limit transport as exact text');
select is(jsonb_typeof(current_setting('test.snapshot')::jsonb->'queues'->'close_blockers'->'pending_price_count'), 'string',
  'exact counts transport as strings');

-- equality with the canonical month-close contract
select set_config('test.close', public.fn_month_close_summary(
  :'org', current_setting('test.cutover')::date, current_setting('test.today')::date)::text, false);
select is(current_setting('test.snapshot')::jsonb->'queues'->'close_blockers'->>'pending_price_count',
  current_setting('test.close')::jsonb->>'pending_price_count', 'pending price count matches fn_month_close_summary');
select is(current_setting('test.snapshot')::jsonb->'queues'->'pending_pricing'->>'count',
  current_setting('test.close')::jsonb->>'pending_price_count',
  'pending pricing queue count cannot hide an unpriceable zero-qty close blocker');
select is(current_setting('test.snapshot')::jsonb->'queues'->'close_blockers'->>'undated_expense_count',
  current_setting('test.close')::jsonb->>'undated_expense_count', 'undated expense count matches fn_month_close_summary');
select is(current_setting('test.snapshot')::jsonb->'queues'->'close_blockers'->>'unrouted_count',
  current_setting('test.close')::jsonb->>'unrouted_count', 'unrouted count matches fn_month_close_summary');
select is(current_setting('test.snapshot')::jsonb->'queues'->'close_blockers'->>'unclassified_count',
  current_setting('test.close')::jsonb->>'unclassified_count', 'unclassified count matches fn_month_close_summary');
select is(current_setting('test.snapshot')::jsonb->'queues'->'close_blockers'->>'unallocated_count',
  current_setting('test.close')::jsonb->>'unallocated_count', 'unallocated count matches fn_month_close_summary');
select is(current_setting('test.snapshot')::jsonb->'queues'->'receivables'->>'aged_count',
  current_setting('test.close')::jsonb->>'aged_receivable_count', 'aged receivable count matches fn_month_close_summary');
select is(current_setting('test.snapshot')::jsonb->'queues'->'close_blockers'->>'undated_expense_known_total', null,
  'blocker money is nulled while authority is partial');
select is((current_setting('test.snapshot')::jsonb->'attention'->>'close_blocker_count')::integer,
  (current_setting('test.close')::jsonb->>'pending_price_count')::integer
  + (current_setting('test.close')::jsonb->>'undated_expense_count')::integer
  + (current_setting('test.close')::jsonb->>'unrouted_count')::integer
  + (current_setting('test.close')::jsonb->>'unclassified_count')::integer
  + (current_setting('test.close')::jsonb->>'unallocated_count')::integer,
  'the five blocker predicates sum to the attention badge (matches fn_close_accounting_period math)');
select is((current_setting('test.snapshot')::jsonb->'attention'->>'ledger_gap_count')::integer,
  (current_setting('test.close')::jsonb->>'undated_expense_count')::integer
  + (current_setting('test.close')::jsonb->>'unrouted_count')::integer
  + (current_setting('test.close')::jsonb->>'unclassified_count')::integer
  + (current_setting('test.close')::jsonb->>'unallocated_count')::integer,
  'the ledger-gap badge excludes the separately presented pending-pricing queue');

-- equality with the canonical open-receivables contract
select pg_temp.as_user(current_setting('test.accountant'), :'org');
select set_config('test.open_ar', public.fn_open_sale_receivables(:'org', 200)::text, false);
select is((current_setting('test.snapshot')::jsonb->'queues'->'receivables'->>'open_count')::integer,
  jsonb_array_length(current_setting('test.open_ar')::jsonb),
  'open receivable count matches fn_open_sale_receivables');
select is(current_setting('test.snapshot')::jsonb->'queues'->'receivables'->>'open_total', null,
  'open receivable money is nulled while authority is partial');

-- exact reconciliation / payment-obligation / custody state
select is((current_setting('test.snapshot')::jsonb->'queues'->'reconciliation'->>'staged_batch_count')::integer, 1,
  'reconciliation staged-batch count is exact');
select is((current_setting('test.snapshot')::jsonb->'queues'->'reconciliation'->>'owner_waiting_count')::integer, 1,
  'reconciliation owner-waiting count is exact');
select is((current_setting('test.snapshot')::jsonb->'queues'->'reconciliation'->>'failed_batch_count')::integer, 1,
  'reconciliation failed-batch count is exact');
select is((current_setting('test.snapshot')::jsonb->'attention'->>'reconciliation_actionable_count')::integer, 1,
  'reconciliation actionable badge counts staged batches the accountant can work');
select is((current_setting('test.snapshot')::jsonb->'queues'->'payment_obligations'->>'accountant_actionable_count')::integer, 4,
  'accountant-actionable payment requests are draft/submitted/approved_final/paid');
select is((current_setting('test.snapshot')::jsonb->'queues'->'payment_obligations'->>'owner_blocked_count')::integer, 1,
  'owner-blocked payment requests are exactly approved_operational');
select is((current_setting('test.snapshot')::jsonb->'queues'->'payment_obligations'->>'drawing_excluded_count')::integer, 1,
  'the unpaid drawing expense is counted but excluded from operating obligations');
select is((current_setting('test.snapshot')::jsonb->'queues'->'payment_obligations'->>'operating_unpaid_unknown_count')::integer, 1,
  'unknown operating obligation amounts remain explicit');
select is((current_setting('test.snapshot')::jsonb->'queues'->'payment_obligations'->>'capex_unpaid_count')::integer, 2,
  'CAPEX obligations remain separate from operating expenses');
select is((current_setting('test.snapshot')::jsonb->'queues'->'payment_obligations'->>'capex_unpaid_unknown_count')::integer, 1,
  'unknown CAPEX obligation amounts remain explicit');
select is(current_setting('test.snapshot')::jsonb->'queues'->'payment_obligations'->>'operating_unpaid_total', null,
  'payment obligation money is nulled while authority is partial');
select is((current_setting('test.snapshot')::jsonb->'state'->'custody'->>'account_count')::integer, 2,
  'custody account count is exact');
select is(current_setting('test.snapshot')::jsonb->'state'->'custody'->>'total_closing_balance', null,
  'custody money is nulled while authority is partial');
select is((current_setting('test.snapshot')::jsonb->'state'->'period'->>'locked_count')::integer, 1,
  'locked accounting period count is exact');
select is((current_setting('test.snapshot')::jsonb->'state'->'period'->>'as_of_locked')::boolean, true,
  'the as-of date is reported locked when a covering locked period exists');

-- caps and deterministic order (detail_limit = 2 above)
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'drivers'->'pending_pricing'), 2,
  'pending pricing drivers obey the detail limit');
select is(current_setting('test.snapshot')::jsonb->'drivers'->'pending_pricing'->0->>'id',
  '22400000-0000-0000-0000-000000000101', 'pending pricing drivers are ordered by sale_date desc then id');
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'drivers'->'receivables'), 2,
  'receivable drivers obey the detail limit');
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'drivers'->'reconciliation'), 1,
  'reconciliation drivers include only staged batches the accountant can work');
select is(current_setting('test.snapshot')::jsonb->'drivers'->'reconciliation'->0->>'execution_result',
  null, 'reconciliation drivers do not expose row execution state as accountant actionability');
select is(current_setting('test.snapshot')::jsonb->'drivers'->'reconciliation'->0->>'id',
  '22400000-0000-0000-0000-000000000501', 'the staged reconciliation batch is the actionable driver');
select is(current_setting('test.snapshot')::jsonb->'drivers'->'reconciliation'->0->>'unreviewed_count',
  '1', 'the staged reconciliation driver carries its exact unreviewed-row count');

-- comparison gate: not comparable while authority is partial
select is((current_setting('test.snapshot')::jsonb->'comparison'->>'comparable')::boolean, false,
  'comparison is not comparable while finance_ledger authority is partial');
select is(current_setting('test.snapshot')::jsonb->'comparison'->>'current_month_posted_count', null,
  'comparison counts are null while not comparable');
select ok(current_setting('test.snapshot')::jsonb->'comparison'->>'reason' is not null,
  'comparison carries an explicit reason while not comparable');
reset role;

-- ── authority = verified → money and comparison populate exactly ───────────────────────────────
set local session_replication_role = replica;
update public.data_authority_status set status = 'verified',
  source_label = 'test fixture', record_count = 1, notes = 'verified for test', verified_at = now()
 where org_id = :'org' and domain = 'finance_ledger';
set local session_replication_role = origin;

select pg_temp.as_user(current_setting('test.accountant'), :'org');
select set_config('test.snapshot_v', public.fn_accountant_home_snapshot(
  :'org', current_setting('test.today')::date, current_setting('test.cutover')::date, 8)::text, false);
select is(current_setting('test.snapshot_v')::jsonb->>'authority', 'verified',
  'snapshot reflects the verified finance_ledger authority');
select is((current_setting('test.snapshot_v')::jsonb->>'money_available')::boolean, true,
  'money is available once finance_ledger authority is verified');
select is(current_setting('test.snapshot_v')::jsonb->'queues'->'close_blockers'->>'undated_expense_known_total',
  '300', 'blocker money is exact decimal text once verified');
select is(current_setting('test.snapshot_v')::jsonb->'state'->'custody'->>'total_closing_balance',
  '1300', 'custody closing balance is exact once verified (1000 + 500 - 200)');
select is(current_setting('test.snapshot_v')::jsonb->'queues'->'payment_obligations'->>'operating_unpaid_total',
  '400', 'operating unpaid total excludes CAPEX, drawings, and future expenses');
select is(current_setting('test.snapshot_v')::jsonb->'queues'->'payment_obligations'->>'capex_unpaid_total',
  '700', 'CAPEX unpaid total is separately exact');

-- A future receipt may already have changed the mutable sale status, but it cannot reduce today's AR.
reset role;
insert into public.sale_collections(org_id, sale_id, amount, occurred_at)
values (:'org', '22400000-0000-0000-0000-000000000202', 500, current_setting('test.today')::date + 1);
update public.sales set payment_status = 'collected'
 where id = '22400000-0000-0000-0000-000000000202' and org_id = :'org';
select pg_temp.as_user(current_setting('test.accountant'), :'org');
select set_config('test.snapshot_future_collection', public.fn_accountant_home_snapshot(
  :'org', current_setting('test.today')::date, current_setting('test.cutover')::date, 8)::text, false);
select is(current_setting('test.snapshot_future_collection')::jsonb->'queues'->'receivables'->>'open_count',
  '2', 'a future collection and current collected status do not remove a receivable from the as-of snapshot');
select is(current_setting('test.snapshot_future_collection')::jsonb->'queues'->'receivables'->>'open_total',
  '1000', 'a future collection does not reduce the as-of receivable total');
reset role;
delete from public.sale_collections
 where sale_id = '22400000-0000-0000-0000-000000000202' and occurred_at = current_setting('test.today')::date + 1;
update public.sales set payment_status = 'unpaid'
 where id = '22400000-0000-0000-0000-000000000202' and org_id = :'org';
select pg_temp.as_user(current_setting('test.accountant'), :'org');

select set_config('test.current_expected', (
  select count(*)::text from public.journal_entries j
   where j.org_id = :'org' and j.status = 'posted'
     and j.entry_date >= greatest(date_trunc('month', current_setting('test.today')::date)::date, current_setting('test.cutover')::date)
     and j.entry_date < least(
       (date_trunc('month', current_setting('test.today')::date) + interval '1 month')::date,
       current_setting('test.today')::date + 1
     )
), false);
select set_config('test.previous_expected', (
  select count(*)::text from public.journal_entries j
   where j.org_id = :'org' and j.status = 'posted'
     and j.entry_date >= greatest((date_trunc('month', current_setting('test.today')::date) - interval '1 month')::date, current_setting('test.cutover')::date)
     and j.entry_date < date_trunc('month', current_setting('test.today')::date)::date
), false);
select is((current_setting('test.snapshot_v')::jsonb->'comparison'->>'comparable')::boolean, true,
  'comparison is comparable once finance_ledger authority is verified');
select is(current_setting('test.snapshot_v')::jsonb->'comparison'->>'current_month_posted_count',
  current_setting('test.current_expected'), 'current month posted count matches the cutover-scoped predicate exactly');
select is(current_setting('test.snapshot_v')::jsonb->'comparison'->>'previous_month_posted_count',
  current_setting('test.previous_expected'), 'previous month posted count is cutover-scoped and excludes the pre-cutover entry');
select is(current_setting('test.snapshot_v')::jsonb->'comparison'->>'reason', null,
  'comparison carries no reason once comparable');
reset role;

-- ── authority = unverified (row removed) → money nulls again ───────────────────────────────────
set local session_replication_role = replica;
delete from public.data_authority_status where org_id = :'org' and domain = 'finance_ledger';
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.accountant'), :'org');
select set_config('test.snapshot_u', public.fn_accountant_home_snapshot(
  :'org', current_setting('test.today')::date, current_setting('test.cutover')::date, 8)::text, false);
select is(current_setting('test.snapshot_u')::jsonb->>'authority', 'unverified',
  'missing authority status defaults to unverified');
select is((current_setting('test.snapshot_u')::jsonb->>'money_available')::boolean, false,
  'money is withheld again once authority is unverified');
select is(current_setting('test.snapshot_u')::jsonb->'state'->'custody'->>'total_closing_balance', null,
  'custody money is nulled while unverified');
reset role;

-- ── role denial: owner / manager / other role cannot read the accountant-only snapshot ─────────
select pg_temp.as_user(current_setting('test.owner'), :'org');
select throws_ok(format($$select public.fn_accountant_home_snapshot(%L, %L::date, %L::date, 8)$$,
  :'org', current_setting('test.today'), current_setting('test.cutover')), '42501', null,
  'owner membership cannot read the accountant-only snapshot');
reset role;

select pg_temp.as_user(current_setting('test.manager'), :'org');
select throws_ok(format($$select public.fn_accountant_home_snapshot(%L, %L::date, %L::date, 8)$$,
  :'org', current_setting('test.today'), current_setting('test.cutover')), '42501', null,
  'farm_manager membership cannot read the accountant-only snapshot');
reset role;

select pg_temp.as_user(current_setting('test.storekeeper'), :'org');
select throws_ok(format($$select public.fn_accountant_home_snapshot(%L, %L::date, %L::date, 8)$$,
  :'org', current_setting('test.today'), current_setting('test.cutover')), '42501', null,
  'storekeeper membership cannot read the accountant-only snapshot');
reset role;

-- ── claim rejection ──────────────────────────────────────────────────────────────────────────
select pg_temp.as_user(current_setting('test.accountant'));
select throws_ok(format($$select public.fn_accountant_home_snapshot(%L, %L::date, %L::date, 8)$$,
  :'org', current_setting('test.today'), current_setting('test.cutover')), '42501', null,
  'missing active organization claim fails closed');
reset role;

select pg_temp.as_user(current_setting('test.accountant'), :'org_b');
select throws_ok(format($$select public.fn_accountant_home_snapshot(%L, %L::date, %L::date, 8)$$,
  :'org', current_setting('test.today'), current_setting('test.cutover')), '42501', null,
  'active organization mismatch fails closed');
reset role;

-- ── bounds rejection ─────────────────────────────────────────────────────────────────────────
select pg_temp.as_user(current_setting('test.accountant'), :'org');
select throws_ok(format($$select public.fn_accountant_home_snapshot(%L, %L::date, %L::date, 0)$$,
  :'org', current_setting('test.today'), current_setting('test.cutover')), '22023', null,
  'zero detail limit is rejected');
select throws_ok(format($$select public.fn_accountant_home_snapshot(%L, %L::date, %L::date, 21)$$,
  :'org', current_setting('test.today'), current_setting('test.cutover')), '22023', null,
  'detail limit above the contract is rejected');
select throws_ok(format($$select public.fn_accountant_home_snapshot(%L, (%L::date - 1), %L::date, 8)$$,
  :'org', current_setting('test.today'), current_setting('test.cutover')), '22007', null,
  'stale as-of date is rejected');
select throws_ok(format($$select public.fn_accountant_home_snapshot(%L, %L::date, (%L::date + 1), 8)$$,
  :'org', current_setting('test.today'), current_setting('test.cutover')), '22023', null,
  'a cutover other than the canonical live-entry cutover is rejected');
select throws_ok(format($$select public.fn_accountant_home_snapshot(null, %L::date, %L::date, 8)$$,
  current_setting('test.today'), current_setting('test.cutover')), '23502', null,
  'a null organization is rejected');
reset role;

-- ── canonical receivable corruption validation is not weakened by SECURITY INVOKER RLS ─────────
set local session_replication_role = replica;
insert into public.sale_collections(org_id, sale_id, amount, occurred_at)
values (:'org', '22400000-0000-0000-0000-000000000201', 1001, current_setting('test.today')::date);
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.accountant'), :'org');
select throws_ok(format($$select public.fn_accountant_home_snapshot(%L, %L::date, %L::date, 8)$$,
  :'org', current_setting('test.today'), current_setting('test.cutover')), '23514', null,
  'over-collected receivable corruption fails closed through the canonical definer validation');
reset role;
set local session_replication_role = replica;
delete from public.sale_collections
 where sale_id = '22400000-0000-0000-0000-000000000201' and amount = 1001;
set local session_replication_role = origin;

-- ── cross-org corruption fails closed ───────────────────────────────────────────────────────────
set local session_replication_role = replica;
insert into public.custody_accounts(id, org_id, holder_label, target_float) values
  ('22400000-0000-0000-0000-000000000999', :'org_b', 'عهدة أجنبية', 0);
insert into public.custody_movements(org_id, custody_account_id, movement_type, amount_in, amount_out) values
  (:'org', '22400000-0000-0000-0000-000000000999', 'استلام عهدة', 1, 0);
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.accountant'), :'org');
select throws_ok(format($$select public.fn_accountant_home_snapshot(%L, %L::date, %L::date, 8)$$,
  :'org', current_setting('test.today'), current_setting('test.cutover')), '23514', null,
  'cross-organization custody movement corruption fails closed');
reset role;

set local session_replication_role = replica;
delete from public.custody_movements where custody_account_id = '22400000-0000-0000-0000-000000000999';
delete from public.custody_accounts where id = '22400000-0000-0000-0000-000000000999';
insert into public.expenses(id, org_id, date, category, total, status, kind)
values ('22400000-0000-0000-0000-000000000998', :'org_b', current_setting('test.today')::date, 'تشغيل', 1, 'approved', 'operating');
insert into public.payment_requests(id, org_id, request_no, status) values
  ('22400000-0000-0000-0000-000000000997', :'org', 99, 'draft');
insert into public.payment_request_lines(org_id, payment_request_id, expense_id) values
  (:'org', '22400000-0000-0000-0000-000000000997', '22400000-0000-0000-0000-000000000998');
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.accountant'), :'org');
select throws_ok(format($$select public.fn_accountant_home_snapshot(%L, %L::date, %L::date, 8)$$,
  :'org', current_setting('test.today'), current_setting('test.cutover')), '23514', null,
  'cross-organization payment-request line corruption fails closed');
reset role;

select * from finish();
rollback;
