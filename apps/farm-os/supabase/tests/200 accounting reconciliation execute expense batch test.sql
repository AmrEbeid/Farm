-- Expense reconciliation execution: real posting, correction, rollback, replay,
-- frozen-payload, authorization, redaction, and cross-batch idempotency.

begin;
select no_plan();

\set orgA '00000000-0000-0000-0000-000000000001'

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
  p_status text default 'approved'
) returns uuid language plpgsql as $$
begin
  insert into public.reconciliation_batches(
    id, org_id, source_workbook_sha256, source_label, status,
    created_by, approved_by, approved_at
  )
  values (
    p_id, '00000000-0000-0000-0000-000000000001'::uuid,
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
  p_bad_hash boolean default false
) returns uuid language plpgsql as $$
begin
  insert into public.reconciliation_evidence_items(
    id, org_id, origin_kind, source_workbook_sha256, sheet_name,
    row_locator, source_identity_fingerprint, source_amount,
    source_date_text, source_date_parsed, classification,
    invalid_calendar_quality_flag, first_staged_batch_id, evidence_label
  )
  values (
    p_evidence, '00000000-0000-0000-0000-000000000001'::uuid,
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
    p_row, '00000000-0000-0000-0000-000000000001'::uuid,
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
  p_row uuid
) returns uuid language plpgsql as $$
begin
  insert into public.reconciliation_batch_rows(
    id, org_id, batch_id, evidence_item_id, review_state, reviewer_id,
    review_reason, reviewed_at, target_table, disposition,
    expense_category, expense_description, expense_kind,
    expense_account_id, expense_payment_decision
  )
  values (
    p_row, '00000000-0000-0000-0000-000000000001'::uuid,
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
select is(
  (public.fn_execute_reconciliation_batch(
    'e0000000-0000-0000-0000-000000000012'
  ))->>'status',
  'executed', 'zero-value evidence executes as an explicit no-op'
);
reset role;
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
select is(
  (public.fn_execute_reconciliation_batch(
    'e0000000-0000-0000-0000-000000000063'
  ))->>'status',
  'executed', 'zero-valued correction executes as a full reversal'
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

-- Two different batches sharing one evidence item serialize and post once.
create extension if not exists dblink;
create or replace function pg_temp.wait_for_backend_lock(p_pid integer)
returns boolean
language plpgsql
as $$
begin
  for attempt in 1..200 loop
    if exists (
      select 1
        from pg_stat_activity
       where pid = p_pid
         and wait_event_type = 'Lock'
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
  pg_temp.wait_for_backend_lock(
    current_setting('t.expense_exec_racer_2_pid')::integer
  ),
  'race backend 2 reaches and waits on the shared treasury/account lock'
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
select dblink_connect('expense_exec_cleanup', current_setting('t.dsn'));
select dblink_exec(
  'expense_exec_cleanup',
  format(
    $$delete from public.organization_member
       where org_id = 'f0000000-0000-0000-0000-000000000001'
         and user_id = %L::uuid$$,
    current_setting('t.owner')
  )
);
select dblink_disconnect('expense_exec_cleanup');
select pg_temp.as_user(current_setting('t.owner'));
select throws_ok(
  $$select public.fn_execute_reconciliation_batch(
    'f0000000-0000-0000-0000-000000000002'::uuid
  )$$,
  '42501', null,
  'a user outside the organization cannot execute even a terminal batch'
);
reset role;
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

select * from finish();
rollback;
