-- 103 — SPEC-0018 slice 2: payment-request lifecycle + derived totals.
-- Verifies: anon EXECUTE lockdown; the request.prepare / request.approve.op / request.approve.final gates;
-- request_no auto-increments per org; the implemented lifecycle state machine (draft→submitted→
-- approved_operational→approved_final, with wrong-state transitions rejected); and the cardinal money rule —
-- net_request = Σ(operating post_paid_unpaid in the request) + custody top-up, with paid_from_custody and
-- drawing/capex expenses EXCLUDED (no double-count). Impersonation via request.jwt.claims (harness pattern from
-- tests 36/82).
begin;
select plan(39);

-- (no trailing comments on \set lines — psql captures the rest of the line into the value)
\set org '00000000-0000-0000-0000-000000000001'
\set acct 'b0c0a000-0000-0000-0000-0000000000c0'
\set eA 'b0e00000-0000-0000-0000-00000000000a'
\set eB 'b0e00000-0000-0000-0000-00000000000b'
\set eD 'b0e00000-0000-0000-0000-00000000000d'
\set audit_sale 'spec0018 audit sale'
\set audit_expense 'spec0018 audit expense'
\set audit_custody 'spec0018 audit custody'
\set audit_payment 'spec0018 audit payment'
\set audit_generic 'spec0018 audit generic'

insert into public.custody_accounts (id, org_id, holder_label, target_float) values (:'acct', :'org', 'مدير المزرعة', 30000);
insert into public.expenses (id, org_id, date, category, description, total, status, payment_status, kind)
  values (:'eA', :'org', current_date, 'تسميد', 'بند آجل', 5000, 'approved', 'post_paid_unpaid', 'operating');
insert into public.expenses (id, org_id, date, category, description, total, status, kind)
  values (:'eB', :'org', current_date, 'صيانة وقطع غيار', 'بند نقدي', 2000, 'approved', 'operating');
insert into public.expenses (id, org_id, date, category, description, total, status, payment_status, kind)
  values (:'eD', :'org', current_date, 'مسحوبات المالك', 'مسحوبات اختبار', 9000, 'approved', 'post_paid_unpaid', 'drawing');
insert into public.audit_log(org_id, action, entity_type, entity_id, after)
values
  (:'org', 'INSERT', 'sale', :'audit_sale', '{}'::jsonb),
  (:'org', 'INSERT', 'expense', :'audit_expense', '{}'::jsonb),
  (:'org', 'INSERT', 'custody_account', :'audit_custody', '{}'::jsonb),
  (:'org', 'INSERT', 'payment_request', :'audit_payment', '{}'::jsonb),
  (:'org', 'INSERT', 'farm_event', :'audit_generic', '{}'::jsonb);
select set_config('test.org', :'org', false);
select set_config('test.acct_id', :'acct', false);
select set_config('test.eA', :'eA', false);
select set_config('test.eB', :'eB', false);
select set_config('test.eD', :'eD', false);
select set_config('test.audit_sale', :'audit_sale', false);
select set_config('test.audit_expense', :'audit_expense', false);
select set_config('test.audit_custody', :'audit_custody', false);
select set_config('test.audit_payment', :'audit_payment', false);
select set_config('test.audit_generic', :'audit_generic', false);
select set_config('test.accountant', (select user_id::text from public.organization_member where org_id=:'org' and role='accountant' limit 1), false);
select set_config('test.manager',    (select user_id::text from public.organization_member where org_id=:'org' and role='farm_manager' limit 1), false);
select set_config('test.owner',      (select user_id::text from public.organization_member where org_id=:'org' and role='owner' limit 1), false);
select set_config('test.supervisor', (select user_id::text from public.organization_member where org_id=:'org' and role='supervisor' limit 1), false);

-- 1) anon EXECUTE lockdown
select ok(not has_function_privilege('anon','public.fn_create_payment_request(uuid, date, date, uuid, text)','EXECUTE'),
  'anon cannot EXECUTE fn_create_payment_request');
select ok(not has_function_privilege('anon','public.fn_approve_request_final(uuid)','EXECUTE'),
  'anon cannot EXECUTE fn_approve_request_final');
select ok(not has_function_privilege('anon','public.fn_payment_request_totals(uuid)','EXECUTE'),
  'anon cannot EXECUTE fn_payment_request_totals');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role','authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- 2) permission gates
select pg_temp.as_user(current_setting('test.accountant'));
select is(public.authorize('request.prepare', :'org'), true,  'request.prepare: accountant HAS it');
reset role; select pg_temp.as_user(current_setting('test.manager'));
select is(public.authorize('request.prepare', :'org'), false, 'request.prepare: manager does NOT');
reset role; select pg_temp.as_user(current_setting('test.supervisor'));
select is(public.authorize('request.prepare', :'org'), false, 'request.prepare: supervisor does NOT');
reset role; select pg_temp.as_user(current_setting('test.accountant'));
select is(public.authorize('request.approve.op', :'org'), true,  'request.approve.op: accountant HAS it');
reset role; select pg_temp.as_user(current_setting('test.manager'));
select is(public.authorize('request.approve.op', :'org'), false, 'request.approve.op: manager does NOT');
reset role; select pg_temp.as_user(current_setting('test.owner'));
select is(public.authorize('request.approve.final', :'org'), true,  'request.approve.final: owner HAS it');
reset role; select pg_temp.as_user(current_setting('test.manager'));
select is(public.authorize('request.approve.final', :'org'), false, 'request.approve.final: manager does NOT');
reset role;

-- 3) accountant prepares: custody receipt 30,000 ; mark B paid_from_custody ; create request (no=1)
select pg_temp.as_user(current_setting('test.accountant'));
select lives_ok(format($$ select public.fn_record_custody_movement(%L,'استلام عهدة من المالك',30000,0) $$, current_setting('test.acct_id')),
  'accountant posts 30,000 custody receipt');
select lives_ok(format($$ select public.fn_set_expense_payment_status(%L,'paid_from_custody',%L) $$, current_setting('test.eB'), current_setting('test.acct_id')),
  'mark expense B paid_from_custody (posts a 2,000 out-movement)');
select lives_ok(format($$ select set_config('test.req', public.fn_create_payment_request(%L, null, null, %L, 'يونيو')::text, false) $$, current_setting('test.org'), current_setting('test.acct_id')),
  'accountant creates a payment request');
select lives_ok(format($$ select set_config('test.req_null', public.fn_create_payment_request(%L, null, null, null, 'طلب بلا عهدة')::text, false) $$, current_setting('test.org')),
  'accountant creates a payment request without a custody account');
select is((select request_no from public.payment_requests where id = current_setting('test.req')::uuid), 1, 'request_no auto-increments to 1');
-- add both expenses; submit
select lives_ok(format($$ select public.fn_add_expense_to_request(%L, %L) $$, current_setting('test.req'), current_setting('test.eA')),
  'add the post_paid_unpaid expense A to the request');
select throws_ok(format($$ update public.expenses set total = 6000 where id = %L $$, current_setting('test.eA')),
  '22023', null, 'reject amount edits after a post-paid expense is added to a request');
select throws_ok(format($$ select public.fn_set_expense_kind(%L, 'drawing') $$, current_setting('test.eA')),
  '22023', null, 'reject kind reclassification after a post-paid expense is added to a request');
select throws_ok(format($$ select public.fn_set_expense_payment_status(%L, 'paid_by_owner', null) $$, current_setting('test.eA')),
  '22023', null, 'reject payment-status rerouting after a post-paid expense is added to a request');
select lives_ok(format($$ select set_config('test.req2', public.fn_create_payment_request(%L, null, null, null, 'طلب ثان')::text, false) $$, current_setting('test.org')),
  'accountant creates a second payment request');
select throws_ok(format($$ select public.fn_add_expense_to_request(%L, %L) $$, current_setting('test.req2'), current_setting('test.eA')),
  '22023', null, 'reject adding the same expense to another payment request');
select lives_ok(format($$ select public.fn_add_expense_to_request(%L, %L) $$, current_setting('test.req'), current_setting('test.eB')),
  'add a paid_from_custody expense to the request for reporting/replenishment');
select lives_ok(format($$ select public.fn_add_expense_to_request(%L, %L) $$, current_setting('test.req'), current_setting('test.eD')),
  'add owner drawing expense D to the request while keeping it separate from operating P&L');
select lives_ok(format($$ select public.fn_submit_payment_request(%L) $$, current_setting('test.req')),
  'accountant submits the request');
reset role;

-- 4) lifecycle gates: final approval before operational is rejected; correct order works
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format($$ select public.fn_approve_request_final(%L) $$, current_setting('test.req')),
  '22023', null, 'final approval is rejected before operational approval');
reset role; select pg_temp.as_user(current_setting('test.manager'));
select throws_ok(format($$ select public.fn_approve_request_operational(%L) $$, current_setting('test.req')),
  '42501', null, 'manager cannot operationally approve finance-only payment requests');
reset role; select pg_temp.as_user(current_setting('test.accountant'));
select lives_ok(format($$ select public.fn_approve_request_operational(%L) $$, current_setting('test.req')),
  'accountant operationally approves');
reset role; select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(format($$ select public.fn_approve_request_final(%L) $$, current_setting('test.req')),
  'owner finally approves');

-- 5) the cardinal money rule (read totals as the owner — RLS-scoped)
select is((public.fn_payment_request_totals(current_setting('test.req')::uuid) ->> 'operating_unpaid')::numeric, 5000::numeric,
  'totals: operating unpaid stays separate from drawings');
select is((public.fn_payment_request_totals(current_setting('test.req')::uuid) ->> 'drawing_unpaid')::numeric, 9000::numeric,
  'totals: owner drawing is included for cash request but separated from operating P&L');
select is((public.fn_payment_request_totals(current_setting('test.req')::uuid) ->> 'post_paid_unpaid')::numeric, 14000::numeric,
  'totals: all unpaid request lines count; paid_from_custody B is reported but not double-counted as unpaid');
select is((public.fn_payment_request_totals(current_setting('test.req')::uuid) ->> 'net_request')::numeric, 16000::numeric,
  'totals: net_request = 14,000 unpaid + 2,000 custody top-up (30,000 target - 28,000 balance)');
select is((public.fn_payment_request_totals(current_setting('test.req_null')::uuid) ->> 'net_request')::numeric, 0::numeric,
  'totals: request without a custody account has zero top-up instead of erroring');
reset role;

-- 6) non-finance org members cannot read the request tables or derived totals
select pg_temp.as_user(current_setting('test.accountant'));
select is((select count(*)::int from public.audit_log where entity_id in (
    current_setting('test.audit_sale'),
    current_setting('test.audit_expense'),
    current_setting('test.audit_custody'),
    current_setting('test.audit_payment')
  )), 4, 'accountant can read restricted accounting and finance audit mirrors');
reset role;
select pg_temp.as_user(current_setting('test.supervisor'));
select throws_ok(format($$ select public.fn_payment_request_totals(%L) $$, current_setting('test.req')),
  '42501', null, 'supervisor without finance.read cannot call fn_payment_request_totals');
select is((select count(*)::int from public.payment_requests where id = current_setting('test.req')::uuid), 0,
  'supervisor cannot read payment_requests rows');
select is((select count(*)::int from public.payment_request_lines where payment_request_id = current_setting('test.req')::uuid), 0,
  'supervisor cannot read payment_request_lines rows');
select is((select count(*)::int from public.audit_log where entity_id = current_setting('test.audit_generic')), 1,
  'supervisor can still read generic same-org audit rows');
select is((select count(*)::int from public.audit_log where entity_id in (
    current_setting('test.audit_sale'),
    current_setting('test.audit_expense'),
    current_setting('test.audit_custody'),
    current_setting('test.audit_payment')
  )), 0, 'supervisor cannot read restricted accounting or finance audit mirrors');
reset role;

select * from finish();
rollback;
