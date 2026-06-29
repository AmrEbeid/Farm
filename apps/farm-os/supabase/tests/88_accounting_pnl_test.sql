-- 88 — STAGE 7 (SPEC-0004): accounting framework — sales + the #6 drawings classification (migration 0088).
-- Verifies: budget.write gates sales + expense-kind writes (owner/accountant only); the CRUD RPCs;
-- that an expense can be classified operating/drawing/capex (#6 — drawings separable); the cross-org
-- sector guard; non-negative amounts; the soft-delete posture; and that sales are audited.
-- The P&L math (drawings excluded from the operating P&L) is proven in lib/pnl.test.ts.
-- Impersonation via request.jwt.claims. Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(24);

\set org '00000000-0000-0000-0000-000000000001'
select set_config('test.acct', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'accountant' limit 1), false);
select set_config('test.sup', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'supervisor' limit 1), false);
-- a synthetic expense to classify (superuser insert bypasses RLS — deterministic fixture).
with ins as (
  insert into public.expenses(org_id, category, total, kind)
  values (:'org', 'اختبار', 100, 'operating')
  returning id
)
select set_config('test.exp', (select id::text from ins), false);

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- ===== 1) budget.write = owner/accountant only =====
select pg_temp.as_user(current_setting('test.acct'));
select is(public.authorize('budget.write', :'org'), true, 'budget.write: accountant HAS it');
reset role;
select pg_temp.as_user(current_setting('test.sup'));
select is(public.authorize('budget.write', :'org'), false, 'budget.write: supervisor does NOT');
reset role;

-- ===== 2) accountant creates a sale; a non-financial role cannot (RPC + direct REST) =====
select pg_temp.as_user(current_setting('test.acct'));
select lives_ok(
  format($$ select set_config('test.s1',
    (public.fn_save_sale(null, %L, '2026-06-01', 'برحي', null, 100, 'kg', 50, 5000, 'تاجر', '2026'))->>'id', false) $$, :'org'),
  'fn_save_sale: accountant can record revenue');
select isnt(current_setting('test.s1'), '', 'create returned a sale id');
reset role;

select pg_temp.as_user(current_setting('test.sup'));
select throws_ok(
  format($$ select public.fn_save_sale(null, %L, null, 'x', null, null, null, null, 1) $$, :'org'),
  '42501', null, 'fn_save_sale: a supervisor (no budget.write) is FORBIDDEN');
select throws_ok(
  format($$ insert into public.sales(org_id, total) values (%L, 50) $$, :'org'),
  '42501', null, 'direct-REST: a supervisor cannot INSERT a sale (budget.write RLS gate)');
reset role;

-- ===== 2b) revenue READ is owner/accountant only — must NOT leak to other org members =====
-- (SPEC-0004 §3: financial rows visible to owner/accountant only; RLS read gate, not just app pages.)
select pg_temp.as_user(current_setting('test.acct'));
select cmp_ok(
  (select count(*)::int from public.sales where id = current_setting('test.s1')::uuid),
  '>=', 1, 'direct-REST: accountant (budget.write) CAN read a sale');
reset role;
select pg_temp.as_user(current_setting('test.sup'));
select is(
  (select count(*)::int from public.sales where org_id = :'org'),
  0, 'direct-REST: a supervisor (no budget.write) reads ZERO sales (revenue read-leak gate)');
reset role;

-- ===== 3) #6: classify an expense as a DRAWING (separable from operating) =====
select pg_temp.as_user(current_setting('test.acct'));
select lives_ok(
  format($$ select public.fn_set_expense_kind(%L, 'drawing') $$, current_setting('test.exp')),
  'fn_set_expense_kind: accountant can classify an expense as a drawing (#6)');
select is(
  (select kind from public.expenses where id = current_setting('test.exp')::uuid),
  'drawing', 'the expense is now kind=drawing (excluded from the operating P&L)');
reset role;
select pg_temp.as_user(current_setting('test.sup'));
select throws_ok(
  format($$ select public.fn_set_expense_kind(%L, 'capex') $$, current_setting('test.exp')),
  '42501', null, 'fn_set_expense_kind: a supervisor (no budget.write) is FORBIDDEN');
reset role;

-- ===== 3b) DB-side P&L summary is uncapped by page row limits and keeps #6 separation =====
insert into public.expenses(org_id, category, total, kind) values
  (:'org', 'أسمدة', 100, 'operating'),
  (:'org', 'أسمدة', 25, 'operating'),
  (:'org', 'عمالة', 50, 'operating'),
  (:'org', 'أصول', 200, 'capex');
insert into public.sales(org_id, crop, total, archived) values
  (:'org', 'برحي', 1000, false),
  (:'org', 'برحي', 999, true);

select pg_temp.as_user(current_setting('test.acct'));
select lives_ok(
  format($$ select set_config('test.pnl_summary', public.fn_accounting_pnl_summary(%L)::text, false) $$, :'org'),
  'fn_accounting_pnl_summary: accountant can read the DB-side aggregate');
select is(
  (current_setting('test.pnl_summary')::jsonb->>'revenue')::numeric,
  6000::numeric, 'P&L summary: revenue excludes archived sales and is aggregated in the DB');
select is(
  (current_setting('test.pnl_summary')::jsonb->>'operatingExpenses')::numeric,
  175::numeric, 'P&L summary: operating expenses include operating rows only');
select is(
  (current_setting('test.pnl_summary')::jsonb->>'drawings')::numeric,
  100::numeric, 'P&L summary: drawings are reported separately');
select is(
  (current_setting('test.pnl_summary')::jsonb->>'capex')::numeric,
  200::numeric, 'P&L summary: capex is reported separately');
select is(
  (current_setting('test.pnl_summary')::jsonb->>'netOperating')::numeric,
  5825::numeric, 'P&L summary: net operating excludes drawings and capex');
select ok(
  (current_setting('test.pnl_summary')::jsonb->'byCategory') @> '[{"category":"أسمدة","operating":125}]'::jsonb,
  'P&L summary: category totals include operating rows only');
reset role;
select pg_temp.as_user(current_setting('test.sup'));
select throws_ok(
  format($$ select public.fn_accounting_pnl_summary(%L) $$, :'org'),
  '42501', null, 'fn_accounting_pnl_summary: a supervisor (no budget.write) is FORBIDDEN');
reset role;

-- ===== 4) validation: non-negative amounts; cross-org sector guard =====
select pg_temp.as_user(current_setting('test.acct'));
select throws_ok(
  format($$ select public.fn_save_sale(null, %L, null, 'x', null, null, null, null, -5) $$, :'org'),
  '22023', null, 'fn_save_sale: a negative total is rejected');
reset role;

\set orgB 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
insert into public.organization (id, name) values (:'orgB', 'مزرعة ب') on conflict (id) do nothing;
insert into public.farms (id, org_id, name, code)
  values ('b0000000-0000-0000-0000-0000000000f1', :'orgB', 'مزرعة ب', 'FB2') on conflict (id) do nothing;
insert into public.sectors (id, org_id, farm_id, name, code)
  values ('b0000000-0000-0000-0000-0000000000c1', :'orgB', 'b0000000-0000-0000-0000-0000000000f1', 'قطاع ب', 'SB2') on conflict (id) do nothing;
select pg_temp.as_user(current_setting('test.acct'));
select throws_ok(
  format($$ select public.fn_save_sale(null, %L, null, 'x', 'b0000000-0000-0000-0000-0000000000c1', null, null, null, 1) $$, :'org'),
  '42501', null, 'fn_save_sale: a sale cannot reference a sector from ANOTHER org');

-- ===== 5) soft-delete posture + audit (delete asserted under authenticated) =====
select throws_ok(
  $$ delete from public.sales where true $$,
  '42501', null, 'sales: hard DELETE is revoked from clients (soft-delete only)');
reset role;
select cmp_ok(
  (select count(*)::int from public.audit_log where entity_type = 'sale' and entity_id = current_setting('test.s1')),
  '>=', 1, 'a sale writes an audit_log row');
-- the audit MIRROR must honor the same read gate: a supervisor cannot read the revenue row out of
-- audit_log either (else the SELECT gate above is moot — the #270 H2 audit-leak class for `sale`).
select pg_temp.as_user(current_setting('test.sup'));
select is(
  (select count(*)::int from public.audit_log where entity_type = 'sale' and org_id = :'org'),
  0, 'audit-mirror: a supervisor reads ZERO sale audit rows (audit_read budget.write gate)');
reset role;

select * from finish();
rollback;
