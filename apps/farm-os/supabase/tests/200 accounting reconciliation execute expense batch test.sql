-- Expense reconciliation execution: real posting, correction, rollback, replay,
-- frozen-payload, authorization, redaction, and cross-batch idempotency.

begin;
select no_plan();

\set orgA '00000000-0000-0000-0000-000000000001'

-- Single source for the fixture org. Every pg_temp helper takes `p_org` and falls back to
-- this setting, so no helper hard-codes a tenant id and each can be pointed at another org.
select set_config('t.org', :'orgA', false);

select set_config('t.owner', (
  select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'owner' limit 1
), false);
select set_config('t.acct', (
  select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'accountant' limit 1
), false);
select set_config('t.account', (
  select a.id::text
  from public.accounts a
  where a.org_id = :'orgA'
    and a.active
    and a.kind = 'operating'
    and not exists (
      select 1 from public.accounts child
      where child.org_id = a.org_id and child.parent_id = a.id and child.active
    )
  order by a.code limit 1
), false);

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';
end $$;

create or replace function pg_temp.make_batch(
  p_id uuid,
  p_status text default 'approved',
  p_org uuid default null
) returns uuid language plpgsql as $$
declare
  v_org uuid := coalesce(p_org, current_setting('t.org')::uuid);
begin
  insert into public.reconciliation_batches(
    id, org_id, source_workbook_sha256, source_label, status,
    created_by, approved_by, approved_at
  )
  values (
    p_id, v_org,
    repeat('a', 64), 'execution test', p_status,
    current_setting('t.acct')::uuid,
    case when p_status = 'approved' then current_setting('t.owner')::uuid end,
    case when p_status = 'approved' then now() end
  );
  return p_id;
end $$;

create or replace function pg_temp.add_expense_row(
  p_batch uuid,
  p_evidence uuid,
  p_row uuid,
  p_locator text,
  p_amount numeric,
  p_date date,
  p_account uuid,
  p_corrects_expense uuid default null,
  p_bad_hash boolean default false,
  p_org uuid default null
) returns uuid language plpgsql as $$
declare
  v_org uuid := coalesce(p_org, current_setting('t.org')::uuid);
begin
  insert into public.reconciliation_evidence_items(
    id, org_id, origin_kind, source_workbook_sha256, sheet_name,
    row_locator, source_identity_fingerprint, source_amount,
    source_date_text, source_date_parsed, classification,
    invalid_calendar_quality_flag, first_staged_batch_id, evidence_label
  )
  values (
    p_evidence, v_org,
    'source_workbook_row', repeat('a', 64),
    'execution test', p_locator, p_locator, p_amount,
    p_date::text, p_date,
    case when p_corrects_expense is null
      then case when p_amount = 0
        then 'zero_value_source_placeholder'
        else 'source_addition_candidate'
      end
      else 'amount_correction_candidate'
    end,
    false, p_batch, 'execution test evidence'
  );

  insert into public.reconciliation_batch_rows(
    id, org_id, batch_id, evidence_item_id, review_state, reviewer_id,
    review_reason, reviewed_at, target_table, disposition,
    expense_category, expense_description, expense_kind,
    expense_account_id, expense_payment_decision, corrects_expense_id
  )
  values (
    p_row, v_org,
    p_batch, p_evidence, 'reviewed',
    current_setting('t.acct')::uuid, 'approved synthetic execution test',
    now(), 'expenses', 'include', 'execution test', 'execution test',
    'operating', p_account, 'routed_now', p_corrects_expense
  );

  update public.reconciliation_batch_rows br
     set payload_hash = case when p_bad_hash then repeat('0', 64)
           else private.fn_reconciliation_execution_payload_hash(br) end,
         frozen = true,
         frozen_at = now(),
         review_state = 'frozen'
   where br.id = p_row;
  return p_row;
end $$;

create or replace function pg_temp.reuse_expense_evidence(
  p_batch uuid,
  p_evidence uuid,
  p_row uuid,
  p_org uuid default null
) returns uuid language plpgsql as $$
declare
  v_org uuid := coalesce(p_org, current_setting('t.org')::uuid);
begin
  insert into public.reconciliation_batch_rows(
    id, org_id, batch_id, evidence_item_id, review_state, reviewer_id,
    review_reason, reviewed_at, target_table, disposition,
    expense_category, expense_description, expense_kind,
    expense_account_id, expense_payment_decision
  )
  values (
    p_row, v_org,
    p_batch, p_evidence, 'reviewed',
    current_setting('t.acct')::uuid, 'approved replay test', now(),
    'expenses', 'include', 'execution test', 'execution test',
    'operating', current_setting('t.account')::uuid, 'routed_now'
  );
  update public.reconciliation_batch_rows br
     set payload_hash = private.fn_reconciliation_execution_payload_hash(br),
         frozen = true, frozen_at = now(), review_state = 'frozen'
   where br.id = p_row;
  return p_row;
end $$;

select ok(
  not has_function_privilege(
    'anon', 'public.fn_execute_reconciliation_batch(uuid)', 'EXECUTE'
  ),
  'anon cannot execute expense reconciliation'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.fn_execute_reconciliation_batch(uuid)', 'EXECUTE'
  ),
  'authenticated reaches the owner-gated expense execution RPC'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.fn_reconciliation_execution_payload_hash(public.reconciliation_batch_rows)',
    'EXECUTE'
  ),
  'the execution hash helper is private'
);
select ok(
  not has_function_privilege(
    'authenticated', 'private.fn_ensure_general_treasury_account(uuid)', 'EXECUTE'
  ),
  'the treasury-account helper is private'
);
select ok(
  not has_function_privilege(
    'authenticated', 'private.fn_seed_general_treasury_account()', 'EXECUTE'
  ),
  'the treasury seed trigger function is private'
);
select ok(
  not has_function_privilege(
    'authenticated', 'private.fn_guard_historical_treasury_expense()', 'EXECUTE'
  ),
  'the historical-expense guard function is private'
);
select is(
  (select p.proconfig[1] from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fn_execute_reconciliation_batch'),
  'search_path=""',
  'the execution RPC pins an empty search path'
);

-- Non-owner and non-approved gates.
select pg_temp.make_batch('e0000000-0000-0000-0000-000000000001', 'approved');
select pg_temp.add_expense_row(
  'e0000000-0000-0000-0000-000000000001',
  'e1000000-0000-0000-0000-000000000001',
  'e2000000-0000-0000-0000-000000000001',
  'auth-row', 10, current_date, current_setting('t.account')::uuid
);
select pg_temp.as_user(current_setting('t.acct'));
select throws_ok(
  $$select public.fn_execute_reconciliation_batch(
    'e0000000-0000-0000-0000-000000000001'::uuid
  )$$,
  '42501', null, 'accountant cannot execute reconciliation money writes'
);
reset role;

select pg_temp.make_batch('e0000000-0000-0000-0000-000000000002', 'reviewed');
select pg_temp.as_user(current_setting('t.owner'));
select throws_ok(
  $$select public.fn_execute_reconciliation_batch(
    'e0000000-0000-0000-0000-000000000002'::uuid
  )$$,
  '22023', null, 'owner cannot execute a non-approved batch'
);
reset role;

insert into public.reconciliation_evidence_items(
  id, org_id, origin_kind, source_workbook_sha256, sheet_name,
  row_locator, source_identity_fingerprint, source_amount,
  source_date_text, source_date_parsed, classification,
  invalid_calendar_quality_flag, first_staged_batch_id
) values (
  'e1000000-0000-0000-0000-000000000002', :'orgA',
  'source_workbook_row', repeat('a', 64), 'execution test',
  'missing-payment-decision', 'missing-payment-decision', 1,
  current_date::text, current_date, 'source_addition_candidate',
  false, 'e0000000-0000-0000-0000-000000000002'
);
insert into public.reconciliation_batch_rows(
  id, org_id, batch_id, evidence_item_id
) values (
  'e2000000-0000-0000-0000-000000000002', :'orgA',
  'e0000000-0000-0000-0000-000000000002',
  'e1000000-0000-0000-0000-000000000002'
);
select throws_ok(
  $$update public.reconciliation_batch_rows
       set target_table = 'expenses',
           disposition = 'include',
           expense_category = 'missing decision',
           expense_kind = 'operating',
           expense_account_id = current_setting('t.account')::uuid
     where id = 'e2000000-0000-0000-0000-000000000002'$$,
  '23514', null,
  'an included expense cannot reach review/freeze without routed_now'
);

-- Addition and same-batch replay.
select pg_temp.make_batch('e0000000-0000-0000-0000-000000000010');
select pg_temp.add_expense_row(
  'e0000000-0000-0000-0000-000000000010',
  'e1000000-0000-0000-0000-000000000010',
  'e2000000-0000-0000-0000-000000000010',
  'addition-row', 12.34, current_date, current_setting('t.account')::uuid
);
select set_config('t.exp_before', (select count(*)::text from public.expenses), false);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch(
    'e0000000-0000-0000-0000-000000000010'
  ))->>'status',
  'executed', 'owner executes an approved expense addition'
);
reset role;
select is(
  (select count(*)::int from public.expenses) -
    current_setting('t.exp_before')::int,
  1, 'addition creates exactly one expense'
);
select is(
  (select e.total from public.expenses e
   join public.reconciliation_action_links al on al.target_id = e.id
   where al.batch_id = 'e0000000-0000-0000-0000-000000000010'
     and al.action_kind = 'addition'),
  12.34::numeric, 'addition preserves the reviewed amount exactly'
);
select is(
  (select e.payment_status from public.expenses e
   join public.reconciliation_action_links al on al.target_id = e.id
   where al.batch_id = 'e0000000-0000-0000-0000-000000000010'
     and al.action_kind = 'addition'),
  'historical_treasury',
  'addition is durably marked as a historical treasury posting'
);
select ok(
  (select je.source_type = 'expense' and je.source_id = al.target_id
     and je.status = 'posted'
   from public.reconciliation_action_links al
   join public.journal_entries je on je.id = al.journal_entry_id
   where al.batch_id = 'e0000000-0000-0000-0000-000000000010'
     and al.action_kind = 'addition'),
  'addition journal uses the new expense as its stable source'
);
select is(
  (select a.code
   from public.reconciliation_action_links al
   join public.journal_lines jl
     on jl.journal_entry_id = al.journal_entry_id and jl.credit > 0
   join public.accounts a on a.id = jl.account_id
   where al.batch_id = 'e0000000-0000-0000-0000-000000000010'
     and al.action_kind = 'addition'),
  '1010', 'historical expense credits general treasury cash'
);
select is(
  (select count(*)::int
   from public.reconciliation_action_links al
   join public.journal_lines jl on jl.journal_entry_id = al.journal_entry_id
   join public.accounts a on a.id = jl.account_id
   where al.batch_id = 'e0000000-0000-0000-0000-000000000010'
     and a.code = '1000'),
  0, 'historical expense never touches the field-custody imprest account'
);
select is(
  (select round(sum(jl.debit) - sum(jl.credit), 2)
   from public.journal_lines jl
   join public.reconciliation_action_links al
     on al.journal_entry_id = jl.journal_entry_id
   where al.batch_id = 'e0000000-0000-0000-0000-000000000010'),
  0::numeric, 'addition journal balances'
);
select is(
  (select status from public.reconciliation_execution_ledger
   where evidence_item_id = 'e1000000-0000-0000-0000-000000000010'),
  'executed', 'addition records the execution ledger'
);
select is(
  (select execution_result from public.reconciliation_batch_rows
   where id = 'e2000000-0000-0000-0000-000000000010'),
  'posted', 'addition marks its frozen row posted'
);
insert into public.expenses(
  id, org_id, date, category, description, total, kind, account_id
) values (
  'e5000000-0000-0000-0000-000000000010', :'orgA', current_date,
  'unposted historical guard', 'unposted historical guard', 10, 'operating',
  current_setting('t.account')::uuid
);
select throws_ok(
  $$update public.expenses
       set payment_status = 'historical_treasury'
     where id = 'e5000000-0000-0000-0000-000000000010'$$,
  '22023', null,
  'a privileged path cannot claim historical treasury status without a posted treasury journal'
);
select pg_temp.as_user(current_setting('t.owner'));
select throws_ok(
  $$select public.fn_set_expense_payment_status(
      (
        select target_id from public.reconciliation_action_links
         where batch_id = 'e0000000-0000-0000-0000-000000000010'
           and action_kind = 'addition'
      ),
      'post_paid_unpaid'
    )$$,
  '22023', null,
  'a historical treasury expense cannot be routed into a second money path'
);
select throws_ok(
  $$update public.expenses
       set date = date + 1
     where id = (
       select target_id
         from public.reconciliation_action_links
        where batch_id = 'e0000000-0000-0000-0000-000000000010'
          and action_kind = 'addition'
     )$$,
  '22023', null,
  'a posted historical expense date cannot diverge from its journal period'
);
reset role;
select set_config('t.je_after_add', (select count(*)::text from public.journal_entries), false);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch(
    'e0000000-0000-0000-0000-000000000010'
  ))->>'idempotent',
  'true', 'same-batch replay returns idempotently'
);
reset role;
select is(
  (select count(*)::int from public.journal_entries),
  current_setting('t.je_after_add')::int,
  'same-batch replay creates no second journal'
);

-- A new batch reviewing the same evidence skips it cross-batch.
select pg_temp.make_batch('e0000000-0000-0000-0000-000000000011');
select pg_temp.reuse_expense_evidence(
  'e0000000-0000-0000-0000-000000000011',
  'e1000000-0000-0000-0000-000000000010',
  'e2000000-0000-0000-0000-000000000011'
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch(
    'e0000000-0000-0000-0000-000000000011'
  ))->>'status',
  'executed', 'cross-batch replay completes without reposting'
);
reset role;
select is(
  (select execution_result from public.reconciliation_batch_rows
   where id = 'e2000000-0000-0000-0000-000000000011'),
  'skipped', 'cross-batch replay marks the new review row skipped'
);
select is(
  (select count(*)::int from public.reconciliation_action_links
   where batch_id = 'e0000000-0000-0000-0000-000000000011'),
  0, 'cross-batch replay creates no money action'
);

-- Zero-value evidence is acknowledged without creating financial rows.
select pg_temp.make_batch('e0000000-0000-0000-0000-000000000012');
select pg_temp.add_expense_row(
  'e0000000-0000-0000-0000-000000000012',
  'e1000000-0000-0000-0000-000000000012',
  'e2000000-0000-0000-0000-000000000012',
  'zero-value-row', 0, current_date, current_setting('t.account')::uuid
);
select set_config('t.exp_before_zero', (select count(*)::text from public.expenses), false);
select set_config('t.je_before_zero', (select count(*)::text from public.journal_entries), false);
select pg_temp.as_user(current_setting('t.owner'));
select set_config(
  't.zero_result',
  (public.fn_execute_reconciliation_batch(
    'e0000000-0000-0000-0000-000000000012'
  ))::text,
  false
);
reset role;
select is(
  current_setting('t.zero_result')::jsonb->>'status',
  'executed', 'zero-value evidence executes as an explicit no-op'
);
-- A zero-value ADDITION posts nothing, so it must be counted as skipped, never as executed:
-- an `executed_rows` that includes no-ops overstates what the batch actually did to the ledger.
select is(
  current_setting('t.zero_result')::jsonb->>'skipped_rows',
  '1', 'a zero-value addition is counted as skipped, not executed'
);
select is(
  current_setting('t.zero_result')::jsonb->>'executed_rows',
  '0', 'a zero-value addition contributes nothing to the executed count'
);
select is(
  (select execution_result from public.reconciliation_batch_rows
   where id = 'e2000000-0000-0000-0000-000000000012'),
  'skipped', 'a zero-value addition row records a durable skipped result'
);
select is(
  (select count(*)::int from public.reconciliation_batches
   where id = 'e0000000-0000-0000-0000-000000000012'
     and result_summary->>'skipped_rows' = '1'
     and result_summary->>'executed_rows' = '0'),
  1, 'the persisted batch summary matches the skipped zero-value addition'
);
select is(
  (select count(*)::int from public.expenses),
  current_setting('t.exp_before_zero')::int,
  'zero-value evidence creates no expense'
);
select is(
  (select count(*)::int from public.journal_entries),
  current_setting('t.je_before_zero')::int,
  'zero-value evidence creates no journal'
);
select is(
  (select action_kind from public.reconciliation_action_links
   where batch_id = 'e0000000-0000-0000-0000-000000000012'),
  'zero_value_noop', 'zero-value evidence records an auditable no-op link'
);
select is(
  (select status from public.reconciliation_execution_ledger
   where evidence_item_id = 'e1000000-0000-0000-0000-000000000012'),
  'executed', 'zero-value evidence is not eligible for a later duplicate execution'
);

-- Frozen payload drift fails closed and persists no row-level/private error.
select pg_temp.make_batch('e0000000-0000-0000-0000-000000000020');
select pg_temp.add_expense_row(
  'e0000000-0000-0000-0000-000000000020',
  'e1000000-0000-0000-0000-000000000020',
  'e2000000-0000-0000-0000-000000000020',
  'payload-drift-private-value', 20, current_date,
  current_setting('t.account')::uuid, null, true
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch(
    'e0000000-0000-0000-0000-000000000020'
  ))->>'failure_code',
  'integrity_check', 'frozen payload drift returns a redacted code'
);
reset role;
select is(
  (select status from public.reconciliation_batches
   where id = 'e0000000-0000-0000-0000-000000000020'),
  'failed', 'payload drift durably marks only the batch failed'
);
select is(
  (select execution_result from public.reconciliation_batch_rows
   where id = 'e2000000-0000-0000-0000-000000000020'),
  'pending', 'payload drift leaves the frozen row pending'
);
select ok(
  (select result_summary::text not like '%payload-drift-private-value%'
   from public.reconciliation_batches
   where id = 'e0000000-0000-0000-0000-000000000020'),
  'failure summary contains no private locator text'
);

-- Invalidated dimension is rechecked at execution time.
insert into public.accounts(
  id, org_id, code, name_ar, account_type, normal_balance, kind, active
)
values (
  'e3000000-0000-0000-0000-000000000001', :'orgA',
  '5998', 'execution dimension', 'expense', 'debit', 'operating', true
);
select pg_temp.make_batch('e0000000-0000-0000-0000-000000000030');
select pg_temp.add_expense_row(
  'e0000000-0000-0000-0000-000000000030',
  'e1000000-0000-0000-0000-000000000030',
  'e2000000-0000-0000-0000-000000000030',
  'dimension-row', 30, current_date,
  'e3000000-0000-0000-0000-000000000001'
);
update public.accounts set active = false
where id = 'e3000000-0000-0000-0000-000000000001';
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch(
    'e0000000-0000-0000-0000-000000000030'
  ))->>'failure_code',
  'integrity_check', 'an invalidated account fails execution'
);
reset role;
select is(
  (select count(*)::int from public.reconciliation_action_links
   where batch_id = 'e0000000-0000-0000-0000-000000000030'),
  0, 'invalid dimension leaves no action links'
);

-- Locked period: the saved expense and every inner write roll back.
insert into public.accounting_periods(
  id, org_id, period_start, period_end, status, note
) values (
  'e4000000-0000-0000-0000-000000000001', :'orgA',
  '2099-01-01', '2099-01-31', 'locked', 'execution lock test'
);
select pg_temp.make_batch('e0000000-0000-0000-0000-000000000040');
select pg_temp.add_expense_row(
  'e0000000-0000-0000-0000-000000000040',
  'e1000000-0000-0000-0000-000000000040',
  'e2000000-0000-0000-0000-000000000040',
  'locked-private-row', 40, '2099-01-15',
  current_setting('t.account')::uuid
);
select set_config('t.exp_before_lock', (select count(*)::text from public.expenses), false);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch(
    'e0000000-0000-0000-0000-000000000040'
  ))->>'failure_code',
  'locked_period', 'locked period is returned as a redacted failure'
);
reset role;
select is(
  (select count(*)::int from public.expenses),
  current_setting('t.exp_before_lock')::int,
  'locked period rolls back the expense insert'
);
select is(
  (select count(*)::int from public.reconciliation_baselines
   where batch_id = 'e0000000-0000-0000-0000-000000000040'),
  0, 'locked period rolls back the baseline with all inner writes'
);
select is(
  (select execution_result from public.reconciliation_batch_rows
   where id = 'e2000000-0000-0000-0000-000000000040'),
  'pending', 'locked period leaves row execution state untouched'
);
select ok(
  (select result_summary::text not like '%locked-private-row%'
   from public.reconciliation_batches
   where id = 'e0000000-0000-0000-0000-000000000040'),
  'locked-period summary contains no private source text'
);

-- Later-row failure proves one batch-wide rollback boundary.
select pg_temp.make_batch('e0000000-0000-0000-0000-000000000050');
select pg_temp.add_expense_row(
  'e0000000-0000-0000-0000-000000000050',
  'e1000000-0000-0000-0000-000000000050',
  'e2000000-0000-0000-0000-000000000050',
  'first-valid-row', 5, current_date, current_setting('t.account')::uuid
);
select pg_temp.add_expense_row(
  'e0000000-0000-0000-0000-000000000050',
  'e1000000-0000-0000-0000-000000000051',
  'e2000000-0000-0000-0000-000000000051',
  'second-locked-row', 6, '2099-01-16', current_setting('t.account')::uuid
);
select set_config('t.exp_before_multi', (select count(*)::text from public.expenses), false);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch(
    'e0000000-0000-0000-0000-000000000050'
  ))->>'status',
  'failed', 'a later-row failure fails the batch normally'
);
reset role;
select is(
  (select count(*)::int from public.expenses),
  current_setting('t.exp_before_multi')::int,
  'later-row failure rolls back the earlier expense'
);
select is(
  (select count(*)::int from public.reconciliation_action_links
   where batch_id = 'e0000000-0000-0000-0000-000000000050'),
  0, 'later-row failure rolls back every action link'
);
select is(
  (select count(*)::int from public.reconciliation_execution_ledger
   where evidence_item_id in (
     'e1000000-0000-0000-0000-000000000050',
     'e1000000-0000-0000-0000-000000000051'
   )),
  0, 'later-row failure rolls back every execution-ledger row'
);
select is(
  (select count(*)::int from public.reconciliation_batch_rows
   where batch_id = 'e0000000-0000-0000-0000-000000000050'
     and execution_result = 'pending'),
  2, 'later-row failure leaves both frozen rows pending'
);

-- A failed attempt leaves its evidence unexecuted and retryable through a new approved batch.
update public.accounting_periods set status = 'open'
where id = 'e4000000-0000-0000-0000-000000000001';
select pg_temp.make_batch('e0000000-0000-0000-0000-000000000041');
select pg_temp.reuse_expense_evidence(
  'e0000000-0000-0000-0000-000000000041',
  'e1000000-0000-0000-0000-000000000040',
  'e2000000-0000-0000-0000-000000000041'
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch(
    'e0000000-0000-0000-0000-000000000041'
  ))->>'status',
  'executed', 'a new approved batch retries evidence after the failed attempt'
);
reset role;
select is(
  (select status from public.reconciliation_execution_ledger
   where evidence_item_id = 'e1000000-0000-0000-0000-000000000040'),
  'executed', 'the successful retry claims the previously unexecuted evidence'
);
select is(
  (select count(*)::int from public.reconciliation_action_links
   where batch_id in (
     'e0000000-0000-0000-0000-000000000040',
     'e0000000-0000-0000-0000-000000000041'
   )),
  1, 'failed attempt plus successful retry produce one financial action'
);

-- Correction: snapshot, reverse/cancel original, and create one linked replacement.
insert into public.expenses(
  id, org_id, date, category, description, total, kind, account_id
) values (
  'e5000000-0000-0000-0000-000000000001', :'orgA', current_date,
  'original', 'original correction target', 40, 'operating',
  current_setting('t.account')::uuid
);
insert into public.journal_entries(
  id, org_id, entry_date, source_type, source_id, source_sequence,
  description, status, posted_at
) values (
  'e6000000-0000-0000-0000-000000000001', :'orgA', current_date,
  'expense', 'e5000000-0000-0000-0000-000000000001', 1,
  'original correction journal', 'posted', now()
);
insert into public.journal_lines(
  id, org_id, journal_entry_id, account_id, debit, credit,
  expense_id
) values
  (
    'e7000000-0000-0000-0000-000000000001', :'orgA',
    'e6000000-0000-0000-0000-000000000001',
    current_setting('t.account')::uuid, 40, 0,
    'e5000000-0000-0000-0000-000000000001'
  ),
  (
    'e7000000-0000-0000-0000-000000000002', :'orgA',
    'e6000000-0000-0000-0000-000000000001',
    (select id from public.accounts where org_id = :'orgA' and code = '1010'),
    0, 40, 'e5000000-0000-0000-0000-000000000001'
  );
update public.expenses
   set payment_status = 'historical_treasury'
 where id = 'e5000000-0000-0000-0000-000000000001';
select pg_temp.make_batch('e0000000-0000-0000-0000-000000000060');
select pg_temp.add_expense_row(
  'e0000000-0000-0000-0000-000000000060',
  'e1000000-0000-0000-0000-000000000060',
  'e2000000-0000-0000-0000-000000000060',
  'correction-row', 55, current_date, current_setting('t.account')::uuid,
  'e5000000-0000-0000-0000-000000000001'
);
select pg_temp.as_user(current_setting('t.owner'));
select set_config(
  't.pnl_before_correction',
  (public.fn_owner_pnl_summary(:'orgA', current_date, current_date)
    ->>'operating_expenses'),
  false
);
select is(
  (public.fn_execute_reconciliation_batch(
    'e0000000-0000-0000-0000-000000000060'
  ))->>'status',
  'executed', 'correction executes atomically'
);
reset role;
select is(
  (select total from public.expenses
   where id = 'e5000000-0000-0000-0000-000000000001'),
  40::numeric, 'correction leaves the original expense amount untouched'
);
select is(
  (select payment_status from public.expenses
   where id = 'e5000000-0000-0000-0000-000000000001'),
  'historical_reversed',
  'correction durably excludes the reversed original expense from owner P&L'
);
select is(
  (select status from public.journal_entries
   where id = 'e6000000-0000-0000-0000-000000000001'),
  'reversed', 'correction reverses the original posted journal'
);
select is(
  (select count(*)::int from public.reconciliation_baseline_journal_headers
   where batch_id = 'e0000000-0000-0000-0000-000000000060'),
  1, 'correction snapshots the exact original journal header'
);
select is(
  (select count(*)::int from public.reconciliation_baseline_journal_lines bl
   join public.reconciliation_baseline_journal_headers bh
     on bh.id = bl.baseline_journal_header_id
   where bh.batch_id = 'e0000000-0000-0000-0000-000000000060'),
  2, 'correction snapshots every original journal line'
);
select is(
  (select total from public.expenses
   where corrects_expense_id = 'e5000000-0000-0000-0000-000000000001'),
  55::numeric, 'correction creates the reviewed replacement expense'
);
select is(
  (select payment_status from public.expenses
   where corrects_expense_id = 'e5000000-0000-0000-0000-000000000001'),
  'historical_treasury',
  'correction replacement is durably posted through general treasury'
);
select is(
  (select count(*)::int from public.reconciliation_action_links
   where batch_id = 'e0000000-0000-0000-0000-000000000060'
     and action_kind in ('correction_reversal', 'correction_replacement')),
  2, 'correction records explicit reversal and replacement links'
);
select ok(
  (select replacement_je.source_id = replacement.target_id
     and replacement_je.source_type = 'expense'
   from public.reconciliation_action_links replacement
   join public.journal_entries replacement_je
     on replacement_je.id = replacement.journal_entry_id
   where replacement.batch_id = 'e0000000-0000-0000-0000-000000000060'
     and replacement.action_kind = 'correction_replacement'),
  'correction replacement journal links to the replacement expense'
);
select pg_temp.as_user(current_setting('t.owner'));
select throws_ok(
  $$select public.fn_set_expense_payment_status(
    'e5000000-0000-0000-0000-000000000001'::uuid,
    'paid_by_owner'
  )$$,
  '22023', null,
  'a corrected original cannot be rerouted after its journal is reversed'
);
select is(
  (
    public.fn_owner_pnl_summary(:'orgA', current_date, current_date)
      ->>'operating_expenses'
  )::numeric,
  current_setting('t.pnl_before_correction')::numeric + 15,
  'owner P&L replaces 40 with 55 instead of double-counting both expenses'
);
reset role;

-- A zero-valued correction reverses/cancels the original without a replacement.
insert into public.expenses(
  id, org_id, date, category, description, total, kind, account_id
) values (
  'e5000000-0000-0000-0000-000000000003', :'orgA', current_date,
  'zero correction target', 'zero correction target', 25, 'operating',
  current_setting('t.account')::uuid
);
insert into public.journal_entries(
  id, org_id, entry_date, source_type, source_id, source_sequence,
  description, status, posted_at
) values (
  'e6000000-0000-0000-0000-000000000003', :'orgA', current_date,
  'expense', 'e5000000-0000-0000-0000-000000000003', 1,
  'zero correction journal', 'posted', now()
);
insert into public.journal_lines(
  id, org_id, journal_entry_id, account_id, debit, credit, expense_id
) values
  (
    'e7000000-0000-0000-0000-000000000031', :'orgA',
    'e6000000-0000-0000-0000-000000000003',
    current_setting('t.account')::uuid, 25, 0,
    'e5000000-0000-0000-0000-000000000003'
  ),
  (
    'e7000000-0000-0000-0000-000000000032', :'orgA',
    'e6000000-0000-0000-0000-000000000003',
    (select id from public.accounts where org_id = :'orgA' and code = '1010'),
    0, 25, 'e5000000-0000-0000-0000-000000000003'
  );
select pg_temp.make_batch('e0000000-0000-0000-0000-000000000063');
select pg_temp.add_expense_row(
  'e0000000-0000-0000-0000-000000000063',
  'e1000000-0000-0000-0000-000000000063',
  'e2000000-0000-0000-0000-000000000063',
  'zero-correction-row', 0, current_date, current_setting('t.account')::uuid,
  'e5000000-0000-0000-0000-000000000003'
);
select pg_temp.as_user(current_setting('t.owner'));
select set_config(
  't.pnl_before_zero_correction',
  (public.fn_owner_pnl_summary(:'orgA', current_date, current_date)
    ->>'operating_expenses'),
  false
);
select set_config(
  't.zero_correction_result',
  (public.fn_execute_reconciliation_batch(
    'e0000000-0000-0000-0000-000000000063'
  ))::text,
  false
);
select is(
  current_setting('t.zero_correction_result')::jsonb->>'status',
  'executed', 'zero-valued correction executes as a full reversal'
);
-- The mirror of the addition case: a zero-value CORRECTION still reverses a real posted
-- journal, so it is genuine executed work and must not be demoted to `skipped`.
select is(
  current_setting('t.zero_correction_result')::jsonb->>'executed_rows',
  '1', 'a zero-value correction stays counted as executed'
);
select is(
  current_setting('t.zero_correction_result')::jsonb->>'skipped_rows',
  '0', 'a zero-value correction is never counted as skipped'
);
select is(
  (
    public.fn_owner_pnl_summary(:'orgA', current_date, current_date)
      ->>'operating_expenses'
  )::numeric,
  current_setting('t.pnl_before_zero_correction')::numeric - 25,
  'zero-valued correction removes the original amount from owner P&L'
);
reset role;
select is(
  (select payment_status from public.expenses
   where id = 'e5000000-0000-0000-0000-000000000003'),
  'historical_reversed',
  'zero-valued correction durably reverses the original expense'
);
select is(
  (select status from public.journal_entries
   where id = 'e6000000-0000-0000-0000-000000000003'),
  'reversed', 'zero-valued correction reverses the original journal'
);
select is(
  (select count(*)::int from public.expenses
   where corrects_expense_id = 'e5000000-0000-0000-0000-000000000003'),
  0, 'zero-valued correction creates no replacement expense'
);
select is(
  (select count(*)::int from public.reconciliation_action_links
   where batch_id = 'e0000000-0000-0000-0000-000000000063'
     and action_kind = 'correction_reversal'),
  1, 'zero-valued correction records exactly one reversal action'
);
select is(
  (select execution_result from public.reconciliation_batch_rows
   where id = 'e2000000-0000-0000-0000-000000000063'),
  'reversed', 'a zero-value correction row records reversed, not skipped'
);

-- ── Historical reconciliation expenses are delete-proof accounting evidence. ────────────────────────
-- A posted (`historical_treasury`) or reversed (`historical_reversed`) expense is the evidence
-- behind a posted journal. Deleting it would orphan that journal silently, so DELETE is refused
-- for both states; undoing a reconciliation is a rollback (a new reversing entry), not a delete.
-- The single documented exception on the UPDATE path is `reversed_by_rollback_at` bookkeeping.
select ok(
  not has_function_privilege(
    'authenticated',
    'private.fn_guard_historical_treasury_expense_delete()',
    'EXECUTE'
  ),
  'the historical-expense delete guard function is private'
);
select is(
  (select count(*)::int from pg_trigger
    where tgrelid = 'public.expenses'::regclass
      and tgname = 'guard_historical_treasury_expense_delete'
      and not tgisinternal),
  1, 'the historical-expense delete guard is installed on public.expenses'
);
select throws_ok(
  $$delete from public.expenses
     where id = 'e5000000-0000-0000-0000-000000000003'::uuid$$,
  '22023', null,
  'a historical_reversed expense cannot be deleted'
);
select throws_ok(
  $$delete from public.expenses
     where corrects_expense_id = 'e5000000-0000-0000-0000-000000000001'::uuid$$,
  '22023', null,
  'a historical_treasury expense cannot be deleted'
);
select is(
  (select count(*)::int from public.expenses
    where id = 'e5000000-0000-0000-0000-000000000003'),
  1, 'the refused delete leaves the reversed evidence expense in place'
);
-- The one permitted write on a reversed historical expense: the rollback bookkeeping stamp.
select lives_ok(
  $$update public.expenses
       set reversed_by_rollback_at = now()
     where id = 'e5000000-0000-0000-0000-000000000003'::uuid$$,
  'reversed_by_rollback_at is the one permitted update on a reversed historical expense'
);
select ok(
  (select reversed_by_rollback_at is not null from public.expenses
    where id = 'e5000000-0000-0000-0000-000000000003'),
  'the rollback bookkeeping stamp is durably persisted'
);
select throws_ok(
  $$update public.expenses
       set description = 'tampered', reversed_by_rollback_at = now()
     where id = 'e5000000-0000-0000-0000-000000000003'::uuid$$,
  '22023', null,
  'the rollback stamp does not open a general edit path on a reversed expense'
);
-- `date` is deliberately a column no other expense guard is scoped to, so this proves the
-- reconciliation guard itself (not a neighbouring immutability trigger) refuses the edit.
select throws_ok(
  $$update public.expenses
       set date = current_date - 1
     where id = 'e5000000-0000-0000-0000-000000000003'::uuid$$,
  '22023', null,
  'a reversed historical expense stays immutable in every other column'
);
-- An ordinary expense is untouched by the delete guard.
insert into public.expenses(
  id, org_id, date, category, description, total, kind, account_id
) values (
  'e5000000-0000-0000-0000-000000000009', :'orgA', current_date,
  'deletable', 'deletable', 5, 'operating',
  current_setting('t.account')::uuid
);
select lives_ok(
  $$delete from public.expenses
     where id = 'e5000000-0000-0000-0000-000000000009'::uuid$$,
  'the delete guard leaves ordinary expenses deletable'
);

-- A correction target with a second payment journal is rejected without partial reversal.
insert into public.expenses(
  id, org_id, date, category, description, total, kind, account_id
) values (
  'e5000000-0000-0000-0000-000000000004', :'orgA', current_date,
  'multi-path target', 'multi-path target', 30, 'operating',
  current_setting('t.account')::uuid
);
insert into public.journal_entries(
  id, org_id, entry_date, source_type, source_id, source_sequence,
  description, status, posted_at
) values
  (
    'e6000000-0000-0000-0000-000000000004', :'orgA', current_date,
    'expense', 'e5000000-0000-0000-0000-000000000004', 1,
    'multi-path original journal', 'posted', now()
  ),
  (
    'e6000000-0000-0000-0000-000000000005', :'orgA', current_date,
    'expense_payment', 'e5000000-0000-0000-0000-000000000004', 1,
    'multi-path custody journal', 'posted', now()
  );
insert into public.journal_lines(
  id, org_id, journal_entry_id, account_id, debit, credit, expense_id
) values
  (
    'e7000000-0000-0000-0000-000000000041', :'orgA',
    'e6000000-0000-0000-0000-000000000004',
    current_setting('t.account')::uuid, 30, 0,
    'e5000000-0000-0000-0000-000000000004'
  ),
  (
    'e7000000-0000-0000-0000-000000000042', :'orgA',
    'e6000000-0000-0000-0000-000000000004',
    (select id from public.accounts where org_id = :'orgA' and code = '1010'),
    0, 30, 'e5000000-0000-0000-0000-000000000004'
  ),
  (
    'e7000000-0000-0000-0000-000000000043', :'orgA',
    'e6000000-0000-0000-0000-000000000005',
    current_setting('t.account')::uuid, 30, 0,
    'e5000000-0000-0000-0000-000000000004'
  ),
  (
    'e7000000-0000-0000-0000-000000000044', :'orgA',
    'e6000000-0000-0000-0000-000000000005',
    (select id from public.accounts where org_id = :'orgA' and code = '1000'),
    0, 30, 'e5000000-0000-0000-0000-000000000004'
  );
select pg_temp.make_batch('e0000000-0000-0000-0000-000000000064');
select pg_temp.add_expense_row(
  'e0000000-0000-0000-0000-000000000064',
  'e1000000-0000-0000-0000-000000000064',
  'e2000000-0000-0000-0000-000000000064',
  'multi-path-correction', 35, current_date,
  current_setting('t.account')::uuid,
  'e5000000-0000-0000-0000-000000000004'
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch(
    'e0000000-0000-0000-0000-000000000064'
  ))->>'failure_code',
  'integrity_check',
  'correction rejects a target that already has a second payment journal'
);
reset role;
select is(
  (select count(*)::int from public.journal_entries
   where id in (
     'e6000000-0000-0000-0000-000000000004',
     'e6000000-0000-0000-0000-000000000005'
   ) and status = 'posted'),
  2, 'rejected multi-path correction leaves both original journals posted'
);
select is(
  (select count(*)::int from public.reconciliation_action_links
   where batch_id = 'e0000000-0000-0000-0000-000000000064'),
  0, 'rejected multi-path correction leaves no partial action'
);

-- A correction target whose expense total and posted journal differ is rejected.
insert into public.expenses(
  id, org_id, date, category, description, total, kind, account_id
) values (
  'e5000000-0000-0000-0000-000000000006', :'orgA', current_date,
  'journal mismatch target', 'journal mismatch target', 40, 'operating',
  current_setting('t.account')::uuid
);
insert into public.journal_entries(
  id, org_id, entry_date, source_type, source_id, source_sequence,
  description, status, posted_at
) values (
  'e6000000-0000-0000-0000-000000000006', :'orgA', current_date,
  'expense', 'e5000000-0000-0000-0000-000000000006', 1,
  'journal mismatch original', 'posted', now()
);
insert into public.journal_lines(
  id, org_id, journal_entry_id, account_id, debit, credit, expense_id
) values
  (
    'e7000000-0000-0000-0000-000000000061', :'orgA',
    'e6000000-0000-0000-0000-000000000006',
    current_setting('t.account')::uuid, 30, 0,
    'e5000000-0000-0000-0000-000000000006'
  ),
  (
    'e7000000-0000-0000-0000-000000000062', :'orgA',
    'e6000000-0000-0000-0000-000000000006',
    (select id from public.accounts where org_id = :'orgA' and code = '1010'),
    0, 30, 'e5000000-0000-0000-0000-000000000006'
  );
select pg_temp.make_batch('e0000000-0000-0000-0000-000000000066');
select pg_temp.add_expense_row(
  'e0000000-0000-0000-0000-000000000066',
  'e1000000-0000-0000-0000-000000000066',
  'e2000000-0000-0000-0000-000000000066',
  'journal-mismatch-correction', 55, current_date,
  current_setting('t.account')::uuid,
  'e5000000-0000-0000-0000-000000000006'
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch(
    'e0000000-0000-0000-0000-000000000066'
  ))->>'failure_code',
  'integrity_check',
  'correction rejects an expense total that differs from its posted journal'
);
reset role;
select is(
  (select status from public.journal_entries
   where id = 'e6000000-0000-0000-0000-000000000006'),
  'posted', 'journal-mismatch rejection leaves the original journal posted'
);
select is(
  (select payment_status from public.expenses
   where id = 'e5000000-0000-0000-0000-000000000006'),
  null, 'journal-mismatch rejection leaves the original expense active'
);
select is(
  (select count(*)::int from public.reconciliation_action_links
   where batch_id = 'e0000000-0000-0000-0000-000000000066'),
  0, 'journal-mismatch rejection leaves no partial action'
);

-- ── The reviewed payment decision is narrowed fail-closed to `routed_now`. ──────────────────────────
-- The constraint is added NOT VALID so a legacy `unrouted` review row is never silently relabelled,
-- then VALIDATEd only when nothing violates it. The test fixture is clean, so on this database it
-- must end up fully validated; a dirty database would
-- leave it visibly `convalidated = false` instead of failing the migration.
select ok(
  (select convalidated from pg_constraint
    where conrelid = 'public.reconciliation_batch_rows'::regclass
      and conname =
        'reconciliation_batch_rows_expense_payment_decision_check'),
  'the narrowed payment-decision constraint is VALIDATED on a clean database'
);
-- An UNFROZEN row, so the check constraint (not the frozen-row immutability trigger) is what
-- rejects the write, and the rejection is provably the narrowing rather than the freeze.
select pg_temp.make_batch('e0000000-0000-0000-0000-000000000080', 'reviewed');
insert into public.reconciliation_evidence_items(
  id, org_id, origin_kind, source_workbook_sha256, sheet_name,
  row_locator, source_identity_fingerprint, source_amount,
  source_date_text, source_date_parsed, classification,
  invalid_calendar_quality_flag, first_staged_batch_id
) values (
  'e1000000-0000-0000-0000-000000000080', :'orgA',
  'source_workbook_row', repeat('a', 64), 'execution test',
  'decision-narrowing', 'decision-narrowing', 4,
  current_date::text, current_date, 'source_addition_candidate',
  false, 'e0000000-0000-0000-0000-000000000080'
);
insert into public.reconciliation_batch_rows(
  id, org_id, batch_id, evidence_item_id, review_state, reviewer_id,
  review_reason, reviewed_at, target_table, disposition,
  expense_category, expense_description, expense_kind,
  expense_account_id, expense_payment_decision
) values (
  'e2000000-0000-0000-0000-000000000080', :'orgA',
  'e0000000-0000-0000-0000-000000000080',
  'e1000000-0000-0000-0000-000000000080', 'reviewed',
  current_setting('t.acct')::uuid, 'narrowing test', now(),
  'expenses', 'include', 'narrowing', 'narrowing', 'operating',
  current_setting('t.account')::uuid, 'routed_now'
);
select throws_ok(
  $$update public.reconciliation_batch_rows
       set expense_payment_decision = 'unrouted'
     where id = 'e2000000-0000-0000-0000-000000000080'::uuid$$,
  '23514', null,
  'the narrowed constraint rejects the retired `unrouted` decision outright'
);
select throws_ok(
  $$update public.reconciliation_batch_rows
       set expense_payment_decision = null
     where id = 'e2000000-0000-0000-0000-000000000080'::uuid$$,
  '23514', null,
  'an included expense row cannot drop back to no payment decision'
);
select throws_ok(
  $$insert into public.reconciliation_batch_rows(
      id, org_id, batch_id, evidence_item_id, target_table, disposition,
      expense_payment_decision
    ) values (
      'e2000000-0000-0000-0000-000000000081',
      '00000000-0000-0000-0000-000000000001',
      'e0000000-0000-0000-0000-000000000080',
      'e1000000-0000-0000-0000-000000000080', 'expenses', 'include',
      'unrouted'
    )$$,
  '23514', null,
  'a NEW included expense row can never be inserted with a legacy decision'
);

-- ── One definition of "the general treasury account": the private helper, reused by the backfill. ───
select is(
  (select count(*)::int from public.accounts custody
    where custody.code = '1000'
      and not exists (
        select 1 from public.accounts treasury
         where treasury.org_id = custody.org_id
           and treasury.code = '1010'
      )),
  0,
  'the helper-driven backfill left no eligible organization without treasury 1010'
);
select is(
  (select count(*)::int from public.accounts
    where org_id = :'orgA' and code = '1010'),
  1, 'exactly one general treasury account exists per organization'
);
select lives_ok(
  $$select private.fn_ensure_general_treasury_account(
    '00000000-0000-0000-0000-000000000001'::uuid
  )$$,
  'the treasury helper can be re-run against an already-seeded organization'
);
select is(
  (select count(*)::int from public.accounts
    where org_id = :'orgA' and code = '1010'),
  1,
  'the treasury helper is idempotent, so backfill and trigger cannot duplicate 1010'
);

-- Two different batches sharing one evidence item serialize and post once.
create extension if not exists dblink;
-- Wait for the racer to block on THE SHARED TREASURY ACCOUNT ROW, not merely on "some lock".
-- A bare `wait_event_type = 'Lock'` would pass if the backend stalled on any unrelated object and
-- would silently stop proving the serialization point this race exists to prove. While a backend
-- waits for a row locked by another transaction it holds a heavyweight `tuple` lock on that exact
-- ctid and then waits on the holder's transaction id, so the tuple entry identifies the row.
-- The poll is bounded at 10 seconds (1000 x 10ms) and returns false on timeout, so a race that
-- never reaches the lock fails the assertion loudly instead of hanging the harness.
create or replace function pg_temp.wait_for_treasury_row_lock(
  p_pid integer,
  p_org uuid
)
returns boolean
language plpgsql
as $$
declare
  v_ctid tid;
begin
  select a.ctid into v_ctid
    from public.accounts a
   where a.org_id = p_org
     and a.code = '1010'
     and a.active;
  if v_ctid is null then
    return false;
  end if;

  for attempt in 1..1000 loop
    if exists (
      select 1
        from pg_stat_activity sa
        join pg_locks l on l.pid = sa.pid
       where sa.pid = p_pid
         and sa.wait_event_type = 'Lock'
         and l.locktype = 'tuple'
         and l.relation = 'public.accounts'::regclass
         and l.page = (v_ctid::text::point)[0]::integer
         and l.tuple = (v_ctid::text::point)[1]::smallint
    ) then
      return true;
    end if;
    perform pg_sleep(0.01);
  end loop;
  return false;
end;
$$;
select set_config('t.dsn', format(
  'host=%s port=%s dbname=%s user=%s',
  (select setting from pg_settings where name = 'unix_socket_directories'),
  (select setting from pg_settings where name = 'port'),
  current_database(), current_user
), false);

select dblink_connect('expense_exec_setup', current_setting('t.dsn'));
select dblink_exec(
  'expense_exec_setup',
  $$insert into public.organization(
      id, name
    ) values (
      'f0000000-0000-0000-0000-000000000001', 'expense execution race org'
    )$$
);
select dblink_exec(
  'expense_exec_setup',
  format(
    $$insert into public.organization_member(org_id, user_id, role)
      values (
        'f0000000-0000-0000-0000-000000000001',
        %L::uuid, 'owner'
      )$$,
    current_setting('t.owner')
  )
);
select dblink_exec(
  'expense_exec_setup',
  format(
    $$insert into public.reconciliation_batches(
        id, org_id, source_workbook_sha256, source_label, status,
        created_by, approved_by, approved_at
      ) values (
        'f0000000-0000-0000-0000-000000000002',
        'f0000000-0000-0000-0000-000000000001',
        %L, 'expense execution race', 'approved',
        %L::uuid, %L::uuid, now()
      ), (
        'f0000000-0000-0000-0000-000000000005',
        'f0000000-0000-0000-0000-000000000001',
        %L, 'expense execution race replay', 'approved',
        %L::uuid, %L::uuid, now()
      )$$,
    repeat('f', 64), current_setting('t.owner'), current_setting('t.owner'),
    repeat('f', 64), current_setting('t.owner'), current_setting('t.owner')
  )
);
select dblink_exec(
  'expense_exec_setup',
  format(
    $$insert into public.reconciliation_evidence_items(
        id, org_id, origin_kind, source_workbook_sha256, sheet_name,
        row_locator, source_identity_fingerprint, source_amount,
        source_date_text, source_date_parsed, classification,
        invalid_calendar_quality_flag, first_staged_batch_id
      ) values (
        'f0000000-0000-0000-0000-000000000003',
        'f0000000-0000-0000-0000-000000000001',
        'source_workbook_row', %L, 'race', 'race-row',
        'expense-execution-race', 9, current_date::text, current_date,
        'source_addition_candidate', false,
        'f0000000-0000-0000-0000-000000000002'
      )$$,
    repeat('f', 64)
  )
);
select dblink_exec(
  'expense_exec_setup',
  format(
    $$insert into public.reconciliation_batch_rows(
        id, org_id, batch_id, evidence_item_id, review_state, reviewer_id,
        review_reason, reviewed_at, target_table, disposition,
        expense_category, expense_description, expense_kind,
        expense_account_id, expense_payment_decision
      ) values (
        'f0000000-0000-0000-0000-000000000004',
        'f0000000-0000-0000-0000-000000000001',
        'f0000000-0000-0000-0000-000000000002',
        'f0000000-0000-0000-0000-000000000003',
        'reviewed', %L::uuid, 'race review', now(), 'expenses', 'include',
        'race expense', 'race expense', 'operating',
        (
          select a.id from public.accounts a
           where a.org_id = 'f0000000-0000-0000-0000-000000000001'
             and a.active and a.kind = 'operating'
             and not exists (
               select 1 from public.accounts child
                where child.org_id = a.org_id
                  and child.parent_id = a.id and child.active
             )
           order by a.code limit 1
        ),
        'routed_now'
      ), (
        'f0000000-0000-0000-0000-000000000006',
        'f0000000-0000-0000-0000-000000000001',
        'f0000000-0000-0000-0000-000000000005',
        'f0000000-0000-0000-0000-000000000003',
        'reviewed', %L::uuid, 'race replay review', now(),
        'expenses', 'include', 'race expense', 'race expense', 'operating',
        (
          select a.id from public.accounts a
           where a.org_id = 'f0000000-0000-0000-0000-000000000001'
             and a.active and a.kind = 'operating'
             and not exists (
               select 1 from public.accounts child
                where child.org_id = a.org_id
                  and child.parent_id = a.id and child.active
             )
           order by a.code limit 1
        ),
        'routed_now'
      );
      update public.reconciliation_batch_rows row_to_freeze
         set payload_hash =
               private.fn_reconciliation_execution_payload_hash(row_to_freeze),
             frozen = true, frozen_at = now(), review_state = 'frozen'
       where row_to_freeze.id in (
         'f0000000-0000-0000-0000-000000000004',
         'f0000000-0000-0000-0000-000000000006'
       )$$,
    current_setting('t.owner'), current_setting('t.owner')
  )
);
select dblink_disconnect('expense_exec_setup');

select dblink_connect('expense_exec_racer_1', current_setting('t.dsn'));
select dblink_connect('expense_exec_racer_2', current_setting('t.dsn'));
select dblink_exec(
  'expense_exec_racer_1',
  format('set request.jwt.claims = %L',
    json_build_object(
      'sub', current_setting('t.owner'), 'role', 'authenticated'
    )::text)
);
select dblink_exec('expense_exec_racer_1', 'set role authenticated');
select dblink_exec(
  'expense_exec_racer_2',
  format('set request.jwt.claims = %L',
    json_build_object(
      'sub', current_setting('t.owner'), 'role', 'authenticated'
    )::text)
);
select dblink_exec('expense_exec_racer_2', 'set role authenticated');
select set_config(
  't.expense_exec_racer_2_pid',
  (
    select pid::text
      from dblink(
        'expense_exec_racer_2', 'select pg_backend_pid()'
      ) as backend(pid integer)
  ),
  false
);

select dblink_exec('expense_exec_racer_1', 'begin');
select is(
  (
    select result->>'status'
      from dblink(
        'expense_exec_racer_1',
        $$select public.fn_execute_reconciliation_batch(
          'f0000000-0000-0000-0000-000000000002'
        )$$
      ) as race_one(result jsonb)
  ),
  'executed', 'race backend 1 executes while retaining the batch lock'
);
select is(
  dblink_send_query(
    'expense_exec_racer_2',
    $$select public.fn_execute_reconciliation_batch(
      'f0000000-0000-0000-0000-000000000005'
    )$$
  ),
  1, 'race backend 2 dispatches the concurrent execution'
);
select ok(
  pg_temp.wait_for_treasury_row_lock(
    current_setting('t.expense_exec_racer_2_pid')::integer,
    'f0000000-0000-0000-0000-000000000001'
  ),
  'race backend 2 blocks on the shared treasury 1010 account row itself'
);
select dblink_exec('expense_exec_racer_1', 'commit');

do $$
declare
  v_result jsonb;
begin
  select result into v_result
    from dblink_get_result('expense_exec_racer_2') as race_two(result jsonb);
  perform set_config(
    't.expense_race_result',
    coalesce(v_result::text, '{"status":"missing"}'),
    false
  );
  begin
    perform * from dblink_get_result('expense_exec_racer_2') as drained(result jsonb);
  exception when others then
    null;
  end;
end $$;

select is(
  current_setting('t.expense_race_result')::jsonb->>'status',
  'executed', 'race backend 2 completes its distinct approved batch'
);
select is(
  current_setting('t.expense_race_result')::jsonb->>'skipped_rows',
  '1', 'race backend 2 skips evidence claimed by the first batch'
);
select is(
  (
    select count(*)::integer
      from public.reconciliation_action_links
     where batch_id in (
       'f0000000-0000-0000-0000-000000000002',
       'f0000000-0000-0000-0000-000000000005'
     )
  ),
  1, 'the two concurrent batches create exactly one financial action'
);
select is(
  (select execution_result from public.reconciliation_batch_rows
   where id = 'f0000000-0000-0000-0000-000000000006'),
  'skipped', 'the losing batch row records a durable skipped result'
);
select is(
  (
    select count(*)::integer
      from public.reconciliation_execution_ledger
     where evidence_item_id =
           'f0000000-0000-0000-0000-000000000003'
       and status = 'executed'
  ),
  1, 'the concurrent execution records exactly one executed ledger claim'
);

select dblink_disconnect('expense_exec_racer_1');
select dblink_disconnect('expense_exec_racer_2');

-- ── Self-cleaning teardown of everything this race COMMITTED on side connections. ──────────────────
-- These rows are committed by other backends, so the outer `rollback` at the end of this file cannot
-- remove them: without an explicit teardown they leak into every later test file in the same
-- ephemeral cluster. Deleted here in FK-dependency order, on a fresh connection.
--
-- `session_replication_role = replica` is set for the teardown because the race deliberately posts a
-- `historical_treasury` expense and a posted journal, and the production guards this slice adds
-- refuse to delete exactly those. Disabling the guards per-SESSION is the only lock-free way to undo
-- a test fixture: `alter table ... disable trigger` would need ACCESS EXCLUSIVE on public.expenses,
-- which this file's own open transaction already holds a conflicting lock on, and would self-deadlock.
select dblink_connect('expense_exec_cleanup', current_setting('t.dsn'));
-- Revoke membership first, while the batch rows still exist, so the cross-org gate below is
-- exercised against a REAL terminal batch rather than a missing one.
select dblink_exec(
  'expense_exec_cleanup',
  format(
    $$delete from public.organization_member
       where org_id = 'f0000000-0000-0000-0000-000000000001'
         and user_id = %L::uuid$$,
    current_setting('t.owner')
  )
);

select pg_temp.as_user(current_setting('t.owner'));
select throws_ok(
  $$select public.fn_execute_reconciliation_batch(
    'f0000000-0000-0000-0000-000000000002'::uuid
  )$$,
  '42501', null,
  'a user outside the organization cannot execute even a terminal batch'
);
reset role;

select dblink_exec('expense_exec_cleanup', 'set session_replication_role = replica');
select dblink_exec(
  'expense_exec_cleanup',
  $$delete from public.reconciliation_action_links
     where org_id = 'f0000000-0000-0000-0000-000000000001'$$
);
select dblink_exec(
  'expense_exec_cleanup',
  $$delete from public.reconciliation_baseline_journal_lines
     where org_id = 'f0000000-0000-0000-0000-000000000001'$$
);
select dblink_exec(
  'expense_exec_cleanup',
  $$delete from public.reconciliation_baseline_journal_headers
     where org_id = 'f0000000-0000-0000-0000-000000000001'$$
);
select dblink_exec(
  'expense_exec_cleanup',
  $$delete from public.reconciliation_baselines
     where org_id = 'f0000000-0000-0000-0000-000000000001'$$
);
select dblink_exec(
  'expense_exec_cleanup',
  $$delete from public.reconciliation_execution_ledger
     where org_id = 'f0000000-0000-0000-0000-000000000001'$$
);
select dblink_exec(
  'expense_exec_cleanup',
  $$delete from public.reconciliation_batch_rows
     where org_id = 'f0000000-0000-0000-0000-000000000001'$$
);
select dblink_exec(
  'expense_exec_cleanup',
  $$delete from public.reconciliation_evidence_items
     where org_id = 'f0000000-0000-0000-0000-000000000001'$$
);
select dblink_exec(
  'expense_exec_cleanup',
  $$delete from public.reconciliation_batches
     where org_id = 'f0000000-0000-0000-0000-000000000001'$$
);
select dblink_exec(
  'expense_exec_cleanup',
  $$delete from public.journal_lines
     where org_id = 'f0000000-0000-0000-0000-000000000001'$$
);
select dblink_exec(
  'expense_exec_cleanup',
  $$delete from public.journal_entries
     where org_id = 'f0000000-0000-0000-0000-000000000001'$$
);
select dblink_exec(
  'expense_exec_cleanup',
  $$delete from public.expenses
     where org_id = 'f0000000-0000-0000-0000-000000000001'$$
);
select dblink_exec(
  'expense_exec_cleanup',
  $$delete from public.audit_log
     where org_id = 'f0000000-0000-0000-0000-000000000001'$$
);
select dblink_exec(
  'expense_exec_cleanup',
  $$delete from public.cost_centers
     where org_id = 'f0000000-0000-0000-0000-000000000001'$$
);
select dblink_exec(
  'expense_exec_cleanup',
  $$delete from public.accounts
     where org_id = 'f0000000-0000-0000-0000-000000000001'$$
);
select dblink_exec(
  'expense_exec_cleanup',
  $$delete from public.organization
     where id = 'f0000000-0000-0000-0000-000000000001'$$
);
select dblink_exec('expense_exec_cleanup', 'set session_replication_role = origin');
select dblink_disconnect('expense_exec_cleanup');

-- Prove the teardown, so a future edit that adds a committed side-effect fails here instead of
-- silently polluting later test files.
select is(
  (select count(*)::int from public.expenses
    where org_id = 'f0000000-0000-0000-0000-000000000001'),
  0, 'the race leaves behind no committed expense'
);
select is(
  (select count(*)::int from public.journal_entries
    where org_id = 'f0000000-0000-0000-0000-000000000001'),
  0, 'the race leaves behind no committed journal entry'
);
select is(
  (select count(*)::int from public.journal_lines
    where org_id = 'f0000000-0000-0000-0000-000000000001'),
  0, 'the race leaves behind no committed journal line'
);
select is(
  (
    (select count(*) from public.reconciliation_batches
      where org_id = 'f0000000-0000-0000-0000-000000000001')
    + (select count(*) from public.reconciliation_batch_rows
        where org_id = 'f0000000-0000-0000-0000-000000000001')
    + (select count(*) from public.reconciliation_evidence_items
        where org_id = 'f0000000-0000-0000-0000-000000000001')
    + (select count(*) from public.reconciliation_execution_ledger
        where org_id = 'f0000000-0000-0000-0000-000000000001')
    + (select count(*) from public.reconciliation_action_links
        where org_id = 'f0000000-0000-0000-0000-000000000001')
    + (select count(*) from public.reconciliation_baselines
        where org_id = 'f0000000-0000-0000-0000-000000000001')
  )::int,
  0, 'the race leaves behind no committed reconciliation row'
);

select is(
  (select count(*)::int from public.accounts
    where org_id = 'f0000000-0000-0000-0000-000000000001'),
  0, 'the race leaves behind no auto-seeded account'
);
select is(
  (select count(*)::int from public.cost_centers
    where org_id = 'f0000000-0000-0000-0000-000000000001'),
  0, 'the race leaves behind no auto-seeded cost center'
);
select is(
  (select count(*)::int from public.audit_log
    where org_id = 'f0000000-0000-0000-0000-000000000001'),
  0, 'the race leaves behind no audit row'
);
select is(
  (select count(*)::int from public.organization
    where id = 'f0000000-0000-0000-0000-000000000001'),
  0, 'the race leaves behind no fixture organization'
);
select is(
  (
    select count(*) from pg_stat_activity
     where application_name like '%dblink%'
       and pid <> pg_backend_pid()
  ),
  0::bigint, 'no dblink backend remains after the execution race'
);

-- Equal-total journal substitution is detected by snapshot postflight and rolls back.
insert into public.expenses(
  id, org_id, date, category, description, total, kind, account_id
) values (
  'e5000000-0000-0000-0000-000000000002', :'orgA', current_date,
  'tamper target', 'tamper target', 60, 'operating',
  current_setting('t.account')::uuid
);
insert into public.journal_entries(
  id, org_id, entry_date, source_type, source_id, source_sequence,
  description, status, posted_at
) values (
  'e6000000-0000-0000-0000-000000000002', :'orgA', current_date,
  'expense', 'e5000000-0000-0000-0000-000000000002', 1,
  'tamper target journal', 'posted', now()
);
insert into public.journal_lines(
  id, org_id, journal_entry_id, account_id, debit, credit, expense_id
) values
  (
    'e7000000-0000-0000-0000-000000000011', :'orgA',
    'e6000000-0000-0000-0000-000000000002',
    current_setting('t.account')::uuid, 60, 0,
    'e5000000-0000-0000-0000-000000000002'
  ),
  (
    'e7000000-0000-0000-0000-000000000012', :'orgA',
    'e6000000-0000-0000-0000-000000000002',
    (select id from public.accounts where org_id = :'orgA' and code = '1010'),
    0, 60, 'e5000000-0000-0000-0000-000000000002'
  );
select pg_temp.make_batch('e0000000-0000-0000-0000-000000000061');
select pg_temp.add_expense_row(
  'e0000000-0000-0000-0000-000000000061',
  'e1000000-0000-0000-0000-000000000061',
  'e2000000-0000-0000-0000-000000000061',
  'equal-total-substitution', 65, current_date,
  current_setting('t.account')::uuid,
  'e5000000-0000-0000-0000-000000000002'
);

create or replace function pg_temp.swap_original_journal_accounts()
returns trigger language plpgsql as $$
declare
  v_expense_account uuid;
  v_cash_account uuid;
begin
  if new.batch_id = 'e0000000-0000-0000-0000-000000000061'
     and new.action_kind = 'correction_replacement' then
    select account_id into v_expense_account
      from public.journal_lines
     where id = 'e7000000-0000-0000-0000-000000000011';
    select account_id into v_cash_account
      from public.journal_lines
     where id = 'e7000000-0000-0000-0000-000000000012';
    update public.journal_lines
       set account_id = case id
         when 'e7000000-0000-0000-0000-000000000011'::uuid
           then v_cash_account
         else v_expense_account
       end
     where id in (
       'e7000000-0000-0000-0000-000000000011',
       'e7000000-0000-0000-0000-000000000012'
     );
  end if;
  return new;
end $$;
create trigger test_equal_total_substitution
  after insert on public.reconciliation_action_links
  for each row execute function pg_temp.swap_original_journal_accounts();

select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch(
    'e0000000-0000-0000-0000-000000000061'
  ))->>'failure_code',
  'integrity_check',
  'equal-total account substitution fails the snapshot postflight'
);
reset role;
drop trigger test_equal_total_substitution
  on public.reconciliation_action_links;
select is(
  (select status from public.journal_entries
   where id = 'e6000000-0000-0000-0000-000000000002'),
  'posted', 'failed substitution rolls back the original journal reversal'
);
select is(
  (select account_id from public.journal_lines
   where id = 'e7000000-0000-0000-0000-000000000011'),
  current_setting('t.account')::uuid,
  'failed substitution restores the original journal account'
);
select is(
  (select count(*)::int from public.reconciliation_action_links
   where batch_id = 'e0000000-0000-0000-0000-000000000061'),
  0, 'failed substitution leaves no correction action'
);
select is(
  (select count(*)::int from public.reconciliation_baselines
   where batch_id = 'e0000000-0000-0000-0000-000000000061'),
  0, 'failed substitution rolls back every baseline snapshot'
);

-- ── Retryable concurrency SQLSTATEs are re-raised, never persisted as a terminal failure. ───────────
-- 40001 (serialization failure), 40P01 (deadlock) and 55P03 (lock not available) are transient
-- conflicts, not a verdict on the batch. Persisting one as `failed` would strand a perfectly valid
-- approved batch on a retryable error, so the RPC re-raises: the WHOLE transaction — including its
-- own `status = 'executing'` write and every financial write already made — rolls back, and the
-- batch is left `approved` for the owner to simply retry.
--
-- The conflict is injected on `reconciliation_action_links`, i.e. AFTER the row's expense and
-- journal have already been written, so these assertions also prove the financial rollback.
create or replace function pg_temp.raise_injected_sqlstate()
returns trigger language plpgsql as $$
begin
  if new.batch_id::text = current_setting('t.inject_batch') then
    raise exception 'injected conflict'
      using errcode = current_setting('t.inject_code');
  end if;
  return new;
end $$;
create trigger test_injected_sqlstate
  before insert on public.reconciliation_action_links
  for each row execute function pg_temp.raise_injected_sqlstate();

select set_config('t.exp_before_retry', (select count(*)::text from public.expenses), false);
select set_config('t.je_before_retry', (select count(*)::text from public.journal_entries), false);

-- 40001 — serialization failure.
select pg_temp.make_batch('e0000000-0000-0000-0000-000000000070');
select pg_temp.add_expense_row(
  'e0000000-0000-0000-0000-000000000070',
  'e1000000-0000-0000-0000-000000000070',
  'e2000000-0000-0000-0000-000000000070',
  'retryable-40001', 17, current_date, current_setting('t.account')::uuid
);
select set_config('t.inject_batch', 'e0000000-0000-0000-0000-000000000070', false);
select set_config('t.inject_code', '40001', false);
select pg_temp.as_user(current_setting('t.owner'));
select throws_ok(
  $$select public.fn_execute_reconciliation_batch(
    'e0000000-0000-0000-0000-000000000070'::uuid
  )$$,
  '40001', null,
  'a serialization failure propagates out instead of being swallowed as failed'
);
reset role;
select is(
  (select status from public.reconciliation_batches
   where id = 'e0000000-0000-0000-0000-000000000070'),
  'approved',
  'a re-raised serialization failure leaves the batch approved for retry'
);
select is(
  (select count(*)::int from public.expenses),
  current_setting('t.exp_before_retry')::int,
  're-raising rolls back every expense written before the conflict'
);
select is(
  (select count(*)::int from public.journal_entries),
  current_setting('t.je_before_retry')::int,
  're-raising rolls back every journal written before the conflict'
);
select is(
  (select execution_result from public.reconciliation_batch_rows
   where id = 'e2000000-0000-0000-0000-000000000070'),
  'pending',
  'a re-raised batch leaves its rows unexecuted rather than half-marked'
);

-- 40P01 — deadlock detected.
select pg_temp.make_batch('e0000000-0000-0000-0000-000000000071');
select pg_temp.add_expense_row(
  'e0000000-0000-0000-0000-000000000071',
  'e1000000-0000-0000-0000-000000000071',
  'e2000000-0000-0000-0000-000000000071',
  'retryable-40P01', 18, current_date, current_setting('t.account')::uuid
);
select set_config('t.inject_batch', 'e0000000-0000-0000-0000-000000000071', false);
select set_config('t.inject_code', '40P01', false);
select pg_temp.as_user(current_setting('t.owner'));
select throws_ok(
  $$select public.fn_execute_reconciliation_batch(
    'e0000000-0000-0000-0000-000000000071'::uuid
  )$$,
  '40P01', null, 'a deadlock propagates out instead of being swallowed as failed'
);
reset role;
select is(
  (select status from public.reconciliation_batches
   where id = 'e0000000-0000-0000-0000-000000000071'),
  'approved', 'a re-raised deadlock leaves the batch approved for retry'
);

-- 55P03 — lock not available.
select pg_temp.make_batch('e0000000-0000-0000-0000-000000000072');
select pg_temp.add_expense_row(
  'e0000000-0000-0000-0000-000000000072',
  'e1000000-0000-0000-0000-000000000072',
  'e2000000-0000-0000-0000-000000000072',
  'retryable-55P03', 19, current_date, current_setting('t.account')::uuid
);
select set_config('t.inject_batch', 'e0000000-0000-0000-0000-000000000072', false);
select set_config('t.inject_code', '55P03', false);
select pg_temp.as_user(current_setting('t.owner'));
select throws_ok(
  $$select public.fn_execute_reconciliation_batch(
    'e0000000-0000-0000-0000-000000000072'::uuid
  )$$,
  '55P03', null,
  'a lock timeout propagates out instead of being swallowed as failed'
);
reset role;
select is(
  (select status from public.reconciliation_batches
   where id = 'e0000000-0000-0000-0000-000000000072'),
  'approved', 'a re-raised lock timeout leaves the batch approved for retry'
);

-- Contrast at the SAME injection point: a NON-retryable code still fails closed and terminal,
-- so the discrimination is provably by SQLSTATE and not by where the error happened.
select pg_temp.make_batch('e0000000-0000-0000-0000-000000000073');
select pg_temp.add_expense_row(
  'e0000000-0000-0000-0000-000000000073',
  'e1000000-0000-0000-0000-000000000073',
  'e2000000-0000-0000-0000-000000000073',
  'non-retryable-23514', 21, current_date, current_setting('t.account')::uuid
);
select set_config('t.inject_batch', 'e0000000-0000-0000-0000-000000000073', false);
select set_config('t.inject_code', '23514', false);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch(
    'e0000000-0000-0000-0000-000000000073'
  ))->>'failure_code',
  'integrity_check',
  'a non-retryable conflict at the same point is still persisted as a terminal failure'
);
reset role;
select is(
  (select status from public.reconciliation_batches
   where id = 'e0000000-0000-0000-0000-000000000073'),
  'failed', 'a non-retryable conflict durably marks the batch failed'
);
drop trigger test_injected_sqlstate on public.reconciliation_action_links;

select * from finish();
rollback;
