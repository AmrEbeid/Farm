-- Accounting reconciliation ROLLBACK: fn_rollback_reconciliation_batch.
--
-- Covers grants/privacy, the owner/auth/member/existence oracle, the mandatory reason, every
-- non-executed batch state, expense addition + correction + production-orphan rollback, the same
-- three for sales, mixed batches, EXACT dimensional reinstatement from the immutable baseline
-- snapshot, action links, execution-ledger transitions, domain lifecycle, the idempotent repeat,
-- atomic failure (nothing stranded), period locks on both the reversal and the reinstatement side,
-- concurrency (the batch row lock actually serializes), cross-org isolation, and proof that the
-- direct public-reversal bypass stays blocked for both domains after this slice.
--
-- Sections 20-21 cover the closed-chain extension of
-- private.fn_reconciliation_sale_has_exact_historical_journal: that a rolled-back sale is a legal
-- amount-correction target again (proved by actually executing a SECOND correction against one, and
-- a third cycle after that), and that every broken chain state -- an injected posted or unlinked
-- journal, a mis-targeted or missing reinstatement, a missing reversal link, a batch that is not
-- rolled_back, and any collection row -- fails the proof CLOSED.
--
-- Sections 24b, 26 and 27 cover the per-org accounting-period MUTEX ORDER. 24b pins, structurally,
-- that every money writer -- including fn_execute_reconciliation_batch, which 20260726170000 §0a
-- re-emits for exactly this -- takes the mutex BEFORE its first row lock and resolves the org it locks
-- through the caller's membership. 26 proves it on THREE real backends: with a rollback holding the
-- share and a close queued for the exclusive, the executor is caught in the mutex queue holding no row
-- lock and waiting on nothing else, so the executor -> close -> rollback ring has no third side; all
-- three then commit consistently with no 40P01. 27 proves the other half on real backends too: a
-- foreign journal uuid handed to the AUTHENTICATED public reversal never joins the foreign tenant's
-- mutex queue (proved while that mutex is held EXCLUSIVE) and still returns the unchanged 42501, a
-- nowhere uuid still returns the unchanged P0002 just as promptly, and a legitimate same-org reversal
-- does still take the mutex and does still block behind a close.
--
-- 27b extends that from the MUTEX to the JOURNAL ROW, which the reversal locks next and which an
-- unfiltered `for update` would let a foreign caller queue on before the membership check refuses
-- them -- foreign row-lock contention plus a sharper timing oracle, one that reports another
-- tenant's journal is being WRITTEN right now. A separate backend holds the foreign row itself with
-- `select ... for update` (no advisory lock anywhere, so the mutex filter alone cannot satisfy it),
-- a control backend is observed genuinely queueing on that row, and the authenticated foreign
-- reversal is never seen in that queue and returns the unchanged 42501 -- with a nowhere uuid
-- settling identically. 27c is its positive control: with the caller's OWN journal row held, a
-- legitimate reversal still queues on it and still completes once released, so the org predicate
-- narrowed the lock rather than removing it.

begin;
select plan(317);

\set orgA '00000000-0000-0000-0000-000000000001'

select set_config('t.org', :'orgA', false);
select set_config('t.owner', (
  select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'owner' limit 1
), false);
select set_config('t.acct', (
  select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'accountant' limit 1
), false);
select set_config('t.fmgr', (
  select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'farm_manager' limit 1
), false);
select set_config('t.account', (
  select a.id::text
  from public.accounts a
  where a.org_id = :'orgA'
    and a.active and a.kind = 'operating'
    and not exists (
      select 1 from public.accounts child
      where child.org_id = a.org_id and child.parent_id = a.id and child.active
    )
  order by a.code limit 1
), false);
select set_config('t.cash', (
  select a.id::text from public.accounts a where a.org_id = :'orgA' and a.code = '1010'
), false);
select set_config('t.rev4010', (
  select a.id::text from public.accounts a where a.org_id = :'orgA' and a.code = '4010'
), false);

-- A real typed dimension so "the reinstatement preserves typed dimensions" is a meaningful claim
-- rather than a null-vs-null comparison.
insert into public.cost_centers(id, org_id, code, name_ar)
values ('cc000000-0000-0000-0000-000000000001', :'orgA', 'RB-CC-1', 'مركز اختبار التراجع');
select set_config('t.cc', 'cc000000-0000-0000-0000-000000000001', false);

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
  p_id uuid, p_status text default 'approved', p_org uuid default null
) returns uuid language plpgsql as $$
declare v_org uuid := coalesce(p_org, current_setting('t.org')::uuid);
begin
  insert into public.reconciliation_batches(
    id, org_id, source_workbook_sha256, source_label, status,
    created_by, approved_by, approved_at
  ) values (
    p_id, v_org, repeat('c', 64), 'rollback test', p_status,
    current_setting('t.acct')::uuid,
    case when p_status = 'approved' then current_setting('t.owner')::uuid end,
    case when p_status = 'approved' then now() end
  );
  return p_id;
end $$;

create or replace function pg_temp.add_expense_row(
  p_batch uuid, p_evidence uuid, p_row uuid, p_locator text,
  p_amount numeric, p_date date, p_corrects_expense uuid default null,
  p_org uuid default null
) returns uuid language plpgsql as $$
declare v_org uuid := coalesce(p_org, current_setting('t.org')::uuid);
begin
  insert into public.reconciliation_evidence_items(
    id, org_id, origin_kind, source_workbook_sha256, sheet_name,
    row_locator, source_identity_fingerprint, source_amount,
    source_date_text, source_date_parsed, classification,
    invalid_calendar_quality_flag, first_staged_batch_id, evidence_label
  ) values (
    p_evidence, v_org, 'source_workbook_row', repeat('c', 64),
    'rollback test', p_locator, p_locator, p_amount, p_date::text, p_date,
    case when p_corrects_expense is null
      then case when p_amount = 0 then 'zero_value_source_placeholder'
                else 'source_addition_candidate' end
      else 'amount_correction_candidate' end,
    false, p_batch, 'rollback test evidence'
  );
  insert into public.reconciliation_batch_rows(
    id, org_id, batch_id, evidence_item_id, review_state, reviewer_id,
    review_reason, reviewed_at, target_table, disposition,
    expense_category, expense_description, expense_kind,
    expense_account_id, expense_payment_decision, corrects_expense_id
  ) values (
    p_row, v_org, p_batch, p_evidence, 'reviewed',
    current_setting('t.acct')::uuid, 'approved synthetic rollback test', now(),
    'expenses', 'include', 'rollback test', 'rollback test', 'operating',
    current_setting('t.account')::uuid, 'routed_now', p_corrects_expense
  );
  update public.reconciliation_batch_rows br
     set payload_hash = private.fn_reconciliation_execution_payload_hash(br),
         frozen = true, frozen_at = now(), review_state = 'frozen'
   where br.id = p_row;
  return p_row;
end $$;

create or replace function pg_temp.add_sale_row(
  p_batch uuid, p_evidence uuid, p_row uuid, p_locator text,
  p_amount numeric, p_date date, p_crop text default 'برحي',
  p_corrects_sale uuid default null, p_org uuid default null
) returns uuid language plpgsql as $$
declare v_org uuid := coalesce(p_org, current_setting('t.org')::uuid);
begin
  insert into public.reconciliation_evidence_items(
    id, org_id, origin_kind, source_workbook_sha256, sheet_name,
    row_locator, source_identity_fingerprint, source_amount,
    source_date_text, source_date_parsed, classification,
    invalid_calendar_quality_flag, first_staged_batch_id, evidence_label
  ) values (
    p_evidence, v_org, 'source_workbook_row', repeat('c', 64),
    'rollback test', p_locator, p_locator, p_amount, p_date::text, p_date,
    case when p_corrects_sale is null
      then case when p_amount = 0 then 'zero_value_source_placeholder'
                else 'source_addition_candidate' end
      else 'amount_correction_candidate' end,
    false, p_batch, 'rollback test evidence'
  );
  insert into public.reconciliation_batch_rows(
    id, org_id, batch_id, evidence_item_id, review_state, reviewer_id,
    review_reason, reviewed_at, target_table, disposition,
    sale_crop, sale_quantity, sale_unit, sale_unit_price, sale_recorded_total,
    sale_season, sale_delivery_date, sale_notes,
    sale_historical_date_decision, sale_effective_date, corrects_sale_id
  ) values (
    p_row, v_org, p_batch, p_evidence, 'reviewed',
    current_setting('t.acct')::uuid, 'approved synthetic rollback test', now(),
    'sales', 'include', p_crop, 1, 'كجم', p_amount, p_amount,
    'موسم الاختبار', p_date, 'سطر اختبار',
    'use_source_text_date', p_date, p_corrects_sale
  );
  update public.reconciliation_batch_rows br
     set payload_hash = private.fn_reconciliation_execution_payload_hash(br),
         frozen = true, frozen_at = now(), review_state = 'frozen'
   where br.id = p_row;
  return p_row;
end $$;

-- A pre-existing production expense with a proven historical journal carrying REAL typed dimensions
-- (cost centre + line description + expense_id), so the reinstatement proof is not vacuous.
create or replace function pg_temp.make_historical_expense(
  p_expense uuid, p_journal uuid, p_debit_line uuid, p_credit_line uuid,
  p_total numeric, p_date date
) returns uuid language plpgsql as $$
declare v_org uuid := current_setting('t.org')::uuid;
begin
  insert into public.expenses(
    id, org_id, date, category, description, total, kind, account_id, cost_center_id
  ) values (
    p_expense, v_org, p_date, 'أصل التصحيح', 'مصروف أصلي قابل للتصحيح', p_total,
    'operating', current_setting('t.account')::uuid, current_setting('t.cc')::uuid
  );
  insert into public.journal_entries(
    id, org_id, entry_date, source_type, source_id, source_sequence,
    description, status, posted_at
  ) values (
    p_journal, v_org, p_date, 'expense', p_expense, 1,
    'قيد المصروف الأصلي', 'posted', now()
  );
  insert into public.journal_lines(
    id, org_id, journal_entry_id, account_id, debit, credit, description,
    cost_center_id, expense_id
  ) values
    (p_debit_line, v_org, p_journal, current_setting('t.account')::uuid,
     p_total, 0, 'الطرف المدين الأصلي', current_setting('t.cc')::uuid, p_expense),
    (p_credit_line, v_org, p_journal, current_setting('t.cash')::uuid,
     0, p_total, 'الطرف الدائن الأصلي', current_setting('t.cc')::uuid, p_expense);
  update public.expenses set payment_status = 'historical_treasury' where id = p_expense;
  return p_expense;
end $$;

create or replace function pg_temp.make_historical_sale(
  p_sale uuid, p_journal uuid, p_debit_line uuid, p_credit_line uuid,
  p_total numeric, p_date date, p_crop text default 'برحي'
) returns uuid language plpgsql as $$
declare v_org uuid := current_setting('t.org')::uuid;
begin
  insert into public.sales(
    id, org_id, sale_date, crop, qty, unit, unit_price, total,
    price_status, price_finalized_at, payment_status
  ) values (
    p_sale, v_org, p_date, p_crop, 1, 'كجم', p_total, p_total,
    'finalized', now(), 'unpaid'
  );
  insert into public.journal_entries(
    id, org_id, entry_date, source_type, source_id, source_sequence,
    description, status, posted_at
  ) values (
    p_journal, v_org, p_date, 'sale', p_sale, 1, 'قيد البيع الأصلي', 'posted', now()
  );
  insert into public.journal_lines(
    id, org_id, journal_entry_id, account_id, debit, credit, description, cost_center_id
  ) values
    (p_debit_line, v_org, p_journal, current_setting('t.cash')::uuid,
     p_total, 0, 'خزينة البيع الأصلي', current_setting('t.cc')::uuid),
    (p_credit_line, v_org, p_journal, current_setting('t.rev4010')::uuid,
     0, p_total, 'إيراد البيع الأصلي', current_setting('t.cc')::uuid);
  update public.sales set payment_status = 'historical_treasury' where id = p_sale;
  return p_sale;
end $$;

create or replace function pg_temp.rollback_error(p_batch uuid, p_reason text default 'سبب اختباري')
returns text language plpgsql as $$
declare v_state text; v_msg text;
begin
  begin
    perform public.fn_rollback_reconciliation_batch(p_batch, p_reason);
    return 'no error';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    return v_state || '|' || v_msg;
  end;
end $$;

-- ── 1) grants, search_path, helper privacy ────────────────────────────────────────────────────────
select ok(
  not has_function_privilege('anon', 'public.fn_rollback_reconciliation_batch(uuid, text)', 'EXECUTE'),
  'anon cannot execute the reconciliation rollback RPC'
);
select ok(
  has_function_privilege('authenticated', 'public.fn_rollback_reconciliation_batch(uuid, text)', 'EXECUTE'),
  'authenticated reaches the owner-gated rollback RPC'
);
select ok(
  not has_function_privilege('public', 'public.fn_rollback_reconciliation_batch(uuid, text)', 'EXECUTE'),
  'PUBLIC carries no execute on the rollback RPC'
);
select ok(
  not has_function_privilege('authenticated', 'private.fn_reconciliation_reinstate_baseline_journal(uuid, uuid, uuid)', 'EXECUTE'),
  'the baseline reinstatement helper is private'
);
select ok(
  not has_function_privilege('authenticated', 'private.fn_reconciliation_rollback_reversed_proof(uuid, text, uuid)', 'EXECUTE'),
  'the rollback reversal proof helper is private'
);
select ok(
  not has_function_privilege('authenticated', 'private.fn_reconciliation_rollback_reinstated_proof(uuid, text, uuid)', 'EXECUTE'),
  'the rollback reinstatement proof helper is private'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.proname in (
        'fn_rollback_reconciliation_batch',
        'fn_reconciliation_reinstate_baseline_journal',
        'fn_reconciliation_rollback_reversed_proof',
        'fn_reconciliation_rollback_reinstated_proof',
        'fn_guard_historical_treasury_expense',
        'fn_guard_historical_treasury_sale',
        'fn_reconciliation_sale_restoration_chain_is_closed',
        'fn_reconciliation_sale_has_exact_historical_journal'
      )
      and p.proconfig[1] = 'search_path=""'),
  8, 'every function this slice emits or re-emits pins an empty search path'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.proname in (
        'fn_rollback_reconciliation_batch',
        'fn_reconciliation_reinstate_baseline_journal',
        'fn_reconciliation_rollback_reversed_proof',
        'fn_reconciliation_rollback_reinstated_proof',
        'fn_reconciliation_sale_restoration_chain_is_closed'
      )
      and p.prosecdef),
  5, 'every function this slice emits is SECURITY DEFINER'
);
-- The re-emitted guards must still be installed, with the same trigger names and timing.
select is(
  (select count(*)::int from pg_trigger
    where tgrelid = 'public.expenses'::regclass
      and tgname in ('guard_historical_treasury_expense', 'guard_historical_treasury_expense_delete')
      and not tgisinternal),
  2, 'the re-emitted expense guards are still installed on public.expenses'
);
select is(
  (select count(*)::int from pg_trigger
    where tgrelid = 'public.sales'::regclass
      and tgname in ('guard_historical_treasury_sale', 'guard_historical_treasury_sale_delete')
      and not tgisinternal),
  2, 'the re-emitted sale guards are still installed on public.sales'
);

-- ── 2) authorization + the existence oracle ───────────────────────────────────────────────────────
select pg_temp.make_batch('b0000000-0000-0000-0000-000000000001', 'approved');
select pg_temp.add_expense_row(
  'b0000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001',
  'b2000000-0000-0000-0000-000000000001', 'authz-row', 10, current_date
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch('b0000000-0000-0000-0000-000000000001'))->>'status',
  'executed', 'the authorization fixture batch executes first'
);
reset role;

select pg_temp.as_user(current_setting('t.acct'));
select is(
  pg_temp.rollback_error('b0000000-0000-0000-0000-000000000001'),
  '42501|forbidden: only an owner may roll back reconciliation',
  'an accountant cannot roll back reconciliation money writes'
);
reset role;
select pg_temp.as_user(current_setting('t.fmgr'));
select is(
  pg_temp.rollback_error('b0000000-0000-0000-0000-000000000001'),
  '42501|forbidden: only an owner may roll back reconciliation',
  'a farm manager cannot roll back reconciliation'
);
reset role;
-- A caller outside the org must not tell an EXISTING batch apart from a uuid that exists nowhere:
-- both are compared as full SQLSTATE|message pairs, not merely as "both errored".
select pg_temp.as_user('11111111-2222-3333-4444-555555555555');
select is(
  pg_temp.rollback_error('b0000000-0000-0000-0000-000000000001'),
  'P0002|reconciliation batch not found',
  'an existing batch outside the caller org is indistinguishable from a missing one'
);
select is(
  pg_temp.rollback_error('ffffffff-ffff-ffff-ffff-ffffffffffff'),
  'P0002|reconciliation batch not found',
  'a uuid that exists nowhere returns that same not-found response'
);
select is(
  pg_temp.rollback_error('b0000000-0000-0000-0000-000000000001'),
  pg_temp.rollback_error('ffffffff-ffff-ffff-ffff-ffffffffffff'),
  'the cross-org and nowhere responses are byte-identical, so no existence oracle leaks'
);
reset role;
select is(
  (select status from public.reconciliation_batches
    where id = 'b0000000-0000-0000-0000-000000000001'),
  'executed', 'every refused rollback attempt left the batch untouched'
);

-- ── 3) the mandatory reason ───────────────────────────────────────────────────────────────────────
select pg_temp.as_user(current_setting('t.owner'));
select throws_ok(
  $$select public.fn_rollback_reconciliation_batch('b0000000-0000-0000-0000-000000000001'::uuid, null)$$,
  '23502', 'rollback reason required', 'a null rollback reason is refused'
);
select throws_ok(
  $$select public.fn_rollback_reconciliation_batch('b0000000-0000-0000-0000-000000000001'::uuid, '')$$,
  '23502', 'rollback reason required', 'an empty rollback reason is refused'
);
select throws_ok(
  $$select public.fn_rollback_reconciliation_batch('b0000000-0000-0000-0000-000000000001'::uuid, '   ')$$,
  '23502', 'rollback reason required', 'a whitespace-only rollback reason is refused'
);
select is(
  pg_temp.rollback_error('b0000000-0000-0000-0000-000000000001', repeat('س', 501)),
  '22023|rollback reason is too long', 'an unbounded rollback reason is refused'
);
select throws_ok(
  $$select public.fn_rollback_reconciliation_batch(null, 'سبب')$$,
  '23502', 'batch id required', 'a null batch id is refused'
);
reset role;
select is(
  (select status from public.reconciliation_batches
    where id = 'b0000000-0000-0000-0000-000000000001'),
  'executed', 'a refused reason leaves the batch executed'
);

-- ── 4) every non-executed batch state fails closed ────────────────────────────────────────────────
select pg_temp.make_batch('b0000000-0000-0000-0000-000000000002', 'staged');
select pg_temp.make_batch('b0000000-0000-0000-0000-000000000003', 'reviewed');
select pg_temp.make_batch('b0000000-0000-0000-0000-000000000004', 'approved');
select pg_temp.make_batch('b0000000-0000-0000-0000-000000000005', 'failed');
select pg_temp.make_batch('b0000000-0000-0000-0000-000000000006', 'executing');
select pg_temp.as_user(current_setting('t.owner'));
select is(
  pg_temp.rollback_error('b0000000-0000-0000-0000-000000000002'),
  '22023|only an executed reconciliation batch may roll back',
  'a staged batch cannot roll back'
);
select is(
  pg_temp.rollback_error('b0000000-0000-0000-0000-000000000003'),
  '22023|only an executed reconciliation batch may roll back',
  'a frozen/reviewed batch cannot roll back'
);
select is(
  pg_temp.rollback_error('b0000000-0000-0000-0000-000000000004'),
  '22023|only an executed reconciliation batch may roll back',
  'an approved-but-unexecuted batch cannot roll back'
);
select is(
  pg_temp.rollback_error('b0000000-0000-0000-0000-000000000005'),
  '22023|only an executed reconciliation batch may roll back',
  'a failed batch cannot roll back (it already rolled itself back atomically)'
);
select is(
  pg_temp.rollback_error('b0000000-0000-0000-0000-000000000006'),
  '22023|only an executed reconciliation batch may roll back',
  'an in-flight executing batch cannot roll back'
);
reset role;

-- ── 5) EXPENSE ADDITION rollback ──────────────────────────────────────────────────────────────────
select pg_temp.make_batch('b0000000-0000-0000-0000-000000000010');
select pg_temp.add_expense_row(
  'b0000000-0000-0000-0000-000000000010', 'b1000000-0000-0000-0000-000000000010',
  'b2000000-0000-0000-0000-000000000010', 'expense-addition', 250, '2024-03-05'
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch('b0000000-0000-0000-0000-000000000010'))->>'status',
  'executed', 'the expense addition executes'
);
reset role;
select set_config('t.exp_added', (
  select target_id::text from public.reconciliation_action_links
   where batch_id = 'b0000000-0000-0000-0000-000000000010' and action_kind = 'addition'
), false);
select set_config('t.exp_added_journal', (
  select journal_entry_id::text from public.reconciliation_action_links
   where batch_id = 'b0000000-0000-0000-0000-000000000010' and action_kind = 'addition'
), false);
select set_config('t.expenses_before_rb', (select count(*)::text from public.expenses), false);
select set_config('t.links_before_rb', (select count(*)::text from public.reconciliation_action_links), false);
select pg_temp.as_user(current_setting('t.owner'));
select set_config('t.pnl_before_rb', (
  public.fn_owner_pnl_summary(:'orgA', '2024-03-05', '2024-03-05')->>'operating_expenses'
), false);
select set_config('t.rb_result', (
  public.fn_rollback_reconciliation_batch(
    'b0000000-0000-0000-0000-000000000010', '  تصحيح خطأ ترحيل  ')::text
), false);
select is(
  current_setting('t.rb_result')::jsonb->>'status', 'rolled_back',
  'the owner rolls back an executed expense addition'
);
select is(
  current_setting('t.rb_result')::jsonb->>'reversed_journals', '1',
  'the rollback reports exactly one reversed journal'
);
select is(
  current_setting('t.rb_result')::jsonb->>'reinstated_journals', '0',
  'an addition-only rollback reinstates nothing'
);
select is(
  public.fn_owner_pnl_summary(:'orgA', '2024-03-05', '2024-03-05')->>'operating_expenses',
  current_setting('t.pnl_before_rb')::numeric - 250 || '',
  'the rolled-back expense leaves owner P&L exactly as it was before execution'
);
reset role;
select is(
  (select status from public.reconciliation_batches
    where id = 'b0000000-0000-0000-0000-000000000010'),
  'rolled_back', 'the batch is durably rolled_back'
);
select is(
  (select status from public.journal_entries
    where id = current_setting('t.exp_added_journal')::uuid),
  'reversed', 'the created expense journal is reversed, not deleted'
);
select is(
  (select count(*)::int from public.journal_entries
    where reversal_of = current_setting('t.exp_added_journal')::uuid and status = 'reversed'),
  1, 'exactly one reversing entry was appended for the created journal'
);
select is(
  (select round(sum(jl.debit) - sum(jl.credit), 2) from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
   where je.reversal_of = current_setting('t.exp_added_journal')::uuid),
  0::numeric, 'the rollback reversal journal balances'
);
-- Exact inverse: every debit becomes a credit on the same account, and nothing else changed.
select is(
  (select count(*)::int from (
     (select account_id, credit as debit, debit as credit, cost_center_id, expense_id
        from public.journal_lines where journal_entry_id = current_setting('t.exp_added_journal')::uuid
      except all
      select account_id, debit, credit, cost_center_id, expense_id
        from public.journal_lines
       where journal_entry_id = (select id from public.journal_entries
                                  where reversal_of = current_setting('t.exp_added_journal')::uuid))
   ) diff),
  0, 'the rollback reversal is the exact inverse of the created entry'
);
select is(
  (select payment_status from public.expenses where id = current_setting('t.exp_added')::uuid),
  'historical_reversed', 'the reconciliation-created expense moves to historical_reversed'
);
select ok(
  (select reversed_by_rollback_at is not null from public.expenses
    where id = current_setting('t.exp_added')::uuid),
  'the reconciliation-created expense is stamped reversed_by_rollback_at'
);
select is(
  (select count(*)::int from public.expenses) - current_setting('t.expenses_before_rb')::int,
  0, 'the rollback deletes no expense row — the created row survives, reversed'
);
select is(
  (select status from public.reconciliation_execution_ledger
    where evidence_item_id = 'b1000000-0000-0000-0000-000000000010'),
  'reversed', 'the execution ledger row transitions executed -> reversed'
);
select ok(
  (select reversed_at is not null and executed_at is not null
      and executed_by_batch_row_id is not null
     from public.reconciliation_execution_ledger
    where evidence_item_id = 'b1000000-0000-0000-0000-000000000010'),
  'the reversed ledger row keeps its full execution bookkeeping'
);
select is(
  (select execution_result from public.reconciliation_batch_rows
    where id = 'b2000000-0000-0000-0000-000000000010'),
  'reversed', 'the batch row execution_result truthfully reports the rollback'
);
select is(
  (select review_state from public.reconciliation_batch_rows
    where id = 'b2000000-0000-0000-0000-000000000010'),
  'frozen', 'the frozen row is otherwise untouched — the immutability guard still holds'
);
select ok(
  (select result_summary ? 'rollback_reason' and result_summary ? 'rolled_back_at'
     from public.reconciliation_batches where id = 'b0000000-0000-0000-0000-000000000010'),
  'the batch result_summary records the rollback audit'
);
select is(
  (select result_summary->>'rollback_reason' from public.reconciliation_batches
    where id = 'b0000000-0000-0000-0000-000000000010'),
  'تصحيح خطأ ترحيل', 'the audited reason is trimmed exactly as supplied'
);
select is(
  (select count(*)::int from public.reconciliation_action_links)
    - current_setting('t.links_before_rb')::int,
  0, 'an addition rollback appends no reinstatement link and deletes none'
);

-- ── 6) the idempotent repeat writes nothing ───────────────────────────────────────────────────────
select set_config('t.j_before_repeat', (select count(*)::text from public.journal_entries), false);
select set_config('t.l_before_repeat', (select count(*)::text from public.journal_lines), false);
select set_config('t.al_before_repeat', (select count(*)::text from public.reconciliation_action_links), false);
select set_config('t.sum_before_repeat', (
  select result_summary::text from public.reconciliation_batches
   where id = 'b0000000-0000-0000-0000-000000000010'
), false);
select pg_temp.as_user(current_setting('t.owner'));
select set_config('t.repeat_result', (
  public.fn_rollback_reconciliation_batch(
    'b0000000-0000-0000-0000-000000000010', 'محاولة ثانية')::text
), false);
select is(
  current_setting('t.repeat_result')::jsonb->>'status', 'rolled_back',
  'a repeat rollback returns the terminal state'
);
select is(
  current_setting('t.repeat_result')::jsonb->>'idempotent', 'true',
  'the repeat is explicitly reported as idempotent'
);
reset role;
select is(
  (select count(*)::int from public.journal_entries), current_setting('t.j_before_repeat')::int,
  'the repeat posts no journal entry'
);
select is(
  (select count(*)::int from public.journal_lines), current_setting('t.l_before_repeat')::int,
  'the repeat posts no journal line'
);
select is(
  (select count(*)::int from public.reconciliation_action_links),
  current_setting('t.al_before_repeat')::int, 'the repeat appends no action link'
);
select is(
  (select result_summary::text from public.reconciliation_batches
    where id = 'b0000000-0000-0000-0000-000000000010'),
  current_setting('t.sum_before_repeat'),
  'the repeat does not overwrite the original rollback audit with a second reason'
);

-- ── 7) EXPENSE CORRECTION rollback — exact dimensional reinstatement ──────────────────────────────
select pg_temp.make_historical_expense(
  'b5000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000001',
  'b7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000002',
  400, '2024-04-08'
);
select pg_temp.make_batch('b0000000-0000-0000-0000-000000000020');
select pg_temp.add_expense_row(
  'b0000000-0000-0000-0000-000000000020', 'b1000000-0000-0000-0000-000000000020',
  'b2000000-0000-0000-0000-000000000020', 'expense-correction', 555, '2024-04-08',
  'b5000000-0000-0000-0000-000000000001'
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch('b0000000-0000-0000-0000-000000000020'))->>'status',
  'executed', 'the expense correction executes'
);
reset role;
select is(
  (select payment_status from public.expenses where id = 'b5000000-0000-0000-0000-000000000001'),
  'historical_reversed', 'execution reverses the original expense'
);
select set_config('t.exp_replacement', (
  select target_id::text from public.reconciliation_action_links
   where batch_id = 'b0000000-0000-0000-0000-000000000020'
     and action_kind = 'correction_replacement'
), false);
select set_config('t.expenses_before_corr_rb', (select count(*)::text from public.expenses), false);
select set_config('t.baseline_lines_before', (
  select count(*)::text from public.reconciliation_baseline_journal_lines l
    join public.reconciliation_baseline_journal_headers h on h.id = l.baseline_journal_header_id
   where h.batch_id = 'b0000000-0000-0000-0000-000000000020'
), false);
select pg_temp.as_user(current_setting('t.owner'));
select set_config('t.corr_rb', (
  public.fn_rollback_reconciliation_batch(
    'b0000000-0000-0000-0000-000000000020', 'إلغاء تصحيح غير صحيح')::text
), false);
select is(
  current_setting('t.corr_rb')::jsonb->>'status', 'rolled_back',
  'the owner rolls back an executed expense correction'
);
select is(
  current_setting('t.corr_rb')::jsonb->>'reversed_journals', '1',
  'the correction rollback reverses exactly the replacement journal'
);
select is(
  current_setting('t.corr_rb')::jsonb->>'reinstated_journals', '1',
  'the correction rollback reinstates exactly the original journal'
);
reset role;
select is(
  (select payment_status from public.expenses where id = 'b5000000-0000-0000-0000-000000000001'),
  'historical_treasury', 'the original expense is restored to historical_treasury'
);
select ok(
  (select reversed_by_rollback_at is null from public.expenses
    where id = 'b5000000-0000-0000-0000-000000000001'),
  'the reinstated original is NOT stamped reversed_by_rollback_at — its journal was reinstated, not reversed'
);
select is(
  (select payment_status from public.expenses where id = current_setting('t.exp_replacement')::uuid),
  'historical_reversed', 'the replacement expense is reversed'
);
select is(
  (select total from public.expenses where id = 'b5000000-0000-0000-0000-000000000001'),
  400::numeric, 'the reinstatement never touches the original expense amount'
);
select is(
  (select count(*)::int from public.expenses) - current_setting('t.expenses_before_corr_rb')::int,
  0, 'the correction rollback deletes no expense row'
);
select is(
  (select count(*)::int from public.reconciliation_baseline_journal_lines l
     join public.reconciliation_baseline_journal_headers h on h.id = l.baseline_journal_header_id
    where h.batch_id = 'b0000000-0000-0000-0000-000000000020'),
  current_setting('t.baseline_lines_before')::int,
  'the immutable baseline snapshot survives the rollback untouched'
);
select set_config('t.reinstated_je', (
  select journal_entry_id::text from public.reconciliation_action_links
   where batch_id = 'b0000000-0000-0000-0000-000000000020'
     and action_kind = 'correction_reversal_reinstatement'
), false);
select ok(
  current_setting('t.reinstated_je', true) is not null
    and current_setting('t.reinstated_je') <> '',
  'a correction_reversal_reinstatement action link is appended'
);
select is(
  (select reinstates_journal_entry_id::text from public.reconciliation_action_links
    where batch_id = 'b0000000-0000-0000-0000-000000000020'
      and action_kind = 'correction_reversal_reinstatement'),
  'b6000000-0000-0000-0000-000000000001',
  'the reinstatement link names the exact original journal it reinstates'
);
select is(
  (select target_id::text from public.reconciliation_action_links
    where batch_id = 'b0000000-0000-0000-0000-000000000020'
      and action_kind = 'correction_reversal_reinstatement'),
  'b5000000-0000-0000-0000-000000000001',
  'the reinstatement link targets the original expense row'
);
select is(
  (select status from public.journal_entries
    where id = current_setting('t.reinstated_je')::uuid),
  'posted', 'the reinstated journal is posted'
);
select is(
  (select entry_date from public.journal_entries
    where id = current_setting('t.reinstated_je')::uuid),
  '2024-04-08'::date, 'the reinstated journal carries the ORIGINAL entry date, not the rollback date'
);
select is(
  (select description from public.journal_entries
    where id = current_setting('t.reinstated_je')::uuid),
  'قيد المصروف الأصلي',
  'the reinstated journal carries the original description verbatim — not a reversal-of-a-reversal text'
);
select is(
  (select source_sequence from public.journal_entries
    where id = current_setting('t.reinstated_je')::uuid),
  3, 'the reinstatement takes the deterministic next source sequence (original 1, reversal 2)'
);
select ok(
  (select reversal_of is null from public.journal_entries
    where id = current_setting('t.reinstated_je')::uuid),
  'the reinstatement is a fresh posting, not a reversal entry'
);
select is(
  (select status from public.journal_entries where id = 'b6000000-0000-0000-0000-000000000001'),
  'reversed', 'the original journal stays reversed — history is appended to, never rewritten'
);
-- THE dimensional proof: every typed column of every line matches the immutable snapshot exactly.
select is(
  (select count(*)::int from (
     (select l.account_id, l.debit, l.credit, l.description, l.cost_center_id,
             l.custody_account_id, l.custody_movement_id, l.expense_id, l.payment_request_id
        from public.reconciliation_baseline_journal_lines l
        join public.reconciliation_baseline_journal_headers h on h.id = l.baseline_journal_header_id
       where h.batch_id = 'b0000000-0000-0000-0000-000000000020'
      except all
      select account_id, debit, credit, description, cost_center_id,
             custody_account_id, custody_movement_id, expense_id, payment_request_id
        from public.journal_lines
       where journal_entry_id = current_setting('t.reinstated_je')::uuid)
     union all
     (select account_id, debit, credit, description, cost_center_id,
             custody_account_id, custody_movement_id, expense_id, payment_request_id
        from public.journal_lines
       where journal_entry_id = current_setting('t.reinstated_je')::uuid
      except all
      select l.account_id, l.debit, l.credit, l.description, l.cost_center_id,
             l.custody_account_id, l.custody_movement_id, l.expense_id, l.payment_request_id
        from public.reconciliation_baseline_journal_lines l
        join public.reconciliation_baseline_journal_headers h on h.id = l.baseline_journal_header_id
       where h.batch_id = 'b0000000-0000-0000-0000-000000000020')
   ) diff),
  0, 'the reinstated lines are an EXACT multiset copy of the immutable snapshot, dimensions included'
);
select is(
  (select count(*)::int from public.journal_lines jl
    where jl.journal_entry_id = current_setting('t.reinstated_je')::uuid
      and jl.cost_center_id = current_setting('t.cc')::uuid),
  2, 'the reinstatement preserves the typed cost-centre dimension on every line'
);
select is(
  (select count(*)::int from public.journal_lines jl
    where jl.journal_entry_id = current_setting('t.reinstated_je')::uuid
      and jl.expense_id = 'b5000000-0000-0000-0000-000000000001'),
  2, 'the reinstatement preserves the typed expense dimension on every line'
);
select is(
  (select round(sum(jl.debit) - sum(jl.credit), 2) from public.journal_lines jl
    where jl.journal_entry_id = current_setting('t.reinstated_je')::uuid),
  0::numeric, 'the reinstated journal balances'
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  public.fn_owner_pnl_summary(:'orgA', '2024-04-08', '2024-04-08')->>'operating_expenses',
  '400', 'after rollback the P&L reports the ORIGINAL expense and nothing else'
);
reset role;

-- ── 8) SALE ADDITION rollback ─────────────────────────────────────────────────────────────────────
select pg_temp.make_batch('b0000000-0000-0000-0000-000000000030');
select pg_temp.add_sale_row(
  'b0000000-0000-0000-0000-000000000030', 'b1000000-0000-0000-0000-000000000030',
  'b2000000-0000-0000-0000-000000000030', 'sale-addition', 900, '2024-06-11'
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch('b0000000-0000-0000-0000-000000000030'))->>'status',
  'executed', 'the sale addition executes'
);
reset role;
select set_config('t.sale_added', (
  select target_id::text from public.reconciliation_action_links
   where batch_id = 'b0000000-0000-0000-0000-000000000030' and action_kind = 'addition'
), false);
select set_config('t.sales_before_rb', (select count(*)::text from public.sales), false);
select pg_temp.as_user(current_setting('t.owner'));
select set_config('t.rev_after_exec', (
  public.fn_revenue_sales_report(:'orgA', '2024-06-01', '2024-06-30', '2024-06-30')
    ->>'finalized_revenue'
), false);
select is(
  (public.fn_rollback_reconciliation_batch(
     'b0000000-0000-0000-0000-000000000030', 'إلغاء بيع مضاف بالخطأ'))->>'status',
  'rolled_back', 'the owner rolls back an executed sale addition'
);
select is(
  public.fn_revenue_sales_report(:'orgA', '2024-06-01', '2024-06-30', '2024-06-30')
    ->>'finalized_revenue',
  (current_setting('t.rev_after_exec')::numeric - 900)::text,
  'the rolled-back sale leaves the revenue report exactly as it was before execution'
);
reset role;
select is(
  (select payment_status from public.sales where id = current_setting('t.sale_added')::uuid),
  'historical_reversed', 'the reconciliation-created sale moves to historical_reversed'
);
select ok(
  (select reversed_by_rollback_at is not null from public.sales
    where id = current_setting('t.sale_added')::uuid),
  'the reconciliation-created sale is stamped reversed_by_rollback_at'
);
select is(
  (select count(*)::int from public.sales) - current_setting('t.sales_before_rb')::int,
  0, 'the rollback deletes no sale row'
);
select is(
  (select status from public.journal_entries je
     join public.reconciliation_action_links al on al.journal_entry_id = je.id
    where al.batch_id = 'b0000000-0000-0000-0000-000000000030' and al.action_kind = 'addition'),
  'reversed', 'the created sale journal is reversed'
);
select is(
  (select status from public.reconciliation_execution_ledger
    where evidence_item_id = 'b1000000-0000-0000-0000-000000000030'),
  'reversed', 'the sale addition ledger row transitions to reversed'
);

-- ── 9) SALE CORRECTION rollback — exact reinstatement of a typed historical sale journal ──────────
select pg_temp.make_historical_sale(
  'b5000000-0000-0000-0000-000000000002', 'b6000000-0000-0000-0000-000000000002',
  'b7000000-0000-0000-0000-000000000003', 'b7000000-0000-0000-0000-000000000004',
  700, '2024-07-09'
);
select pg_temp.make_batch('b0000000-0000-0000-0000-000000000040');
select pg_temp.add_sale_row(
  'b0000000-0000-0000-0000-000000000040', 'b1000000-0000-0000-0000-000000000040',
  'b2000000-0000-0000-0000-000000000040', 'sale-correction', 850, '2024-07-09',
  'برحي', 'b5000000-0000-0000-0000-000000000002'
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch('b0000000-0000-0000-0000-000000000040'))->>'status',
  'executed', 'the sale correction executes'
);
select is(
  (public.fn_rollback_reconciliation_batch(
     'b0000000-0000-0000-0000-000000000040', 'إلغاء تصحيح بيع'))->>'reinstated_journals',
  '1', 'the sale correction rollback reinstates exactly one journal'
);
reset role;
select is(
  (select payment_status from public.sales where id = 'b5000000-0000-0000-0000-000000000002'),
  'historical_treasury', 'the original sale is restored to historical_treasury'
);
select set_config('t.sale_reinstated_je', (
  select journal_entry_id::text from public.reconciliation_action_links
   where batch_id = 'b0000000-0000-0000-0000-000000000040'
     and action_kind = 'correction_reversal_reinstatement'
), false);
select is(
  (select entry_date from public.journal_entries
    where id = current_setting('t.sale_reinstated_je')::uuid),
  '2024-07-09'::date, 'the reinstated sale journal carries the ORIGINAL entry date'
);
select is(
  (select description from public.journal_entries
    where id = current_setting('t.sale_reinstated_je')::uuid),
  'قيد البيع الأصلي', 'the reinstated sale journal carries the original description verbatim'
);
select is(
  (select a.code from public.journal_lines jl join public.accounts a on a.id = jl.account_id
    where jl.journal_entry_id = current_setting('t.sale_reinstated_je')::uuid and jl.debit > 0),
  '1010', 'the reinstated sale journal debits general treasury 1010, exactly as the original did'
);
select is(
  (select a.code from public.journal_lines jl join public.accounts a on a.id = jl.account_id
    where jl.journal_entry_id = current_setting('t.sale_reinstated_je')::uuid and jl.credit > 0),
  '4010', 'the reinstated sale journal credits the same typed revenue leaf the original used'
);
select is(
  (select count(*)::int from (
     (select l.account_id, l.debit, l.credit, l.description, l.cost_center_id
        from public.reconciliation_baseline_journal_lines l
        join public.reconciliation_baseline_journal_headers h on h.id = l.baseline_journal_header_id
       where h.batch_id = 'b0000000-0000-0000-0000-000000000040'
      except all
      select account_id, debit, credit, description, cost_center_id
        from public.journal_lines
       where journal_entry_id = current_setting('t.sale_reinstated_je')::uuid)
     union all
     (select account_id, debit, credit, description, cost_center_id
        from public.journal_lines
       where journal_entry_id = current_setting('t.sale_reinstated_je')::uuid
      except all
      select l.account_id, l.debit, l.credit, l.description, l.cost_center_id
        from public.reconciliation_baseline_journal_lines l
        join public.reconciliation_baseline_journal_headers h on h.id = l.baseline_journal_header_id
       where h.batch_id = 'b0000000-0000-0000-0000-000000000040')
   ) diff),
  0, 'the reinstated sale lines are an EXACT multiset copy of the immutable snapshot'
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  public.fn_revenue_sales_report(:'orgA', '2024-07-01', '2024-07-31', '2024-07-31')
    ->>'finalized_revenue',
  '700', 'after rollback the revenue report shows the ORIGINAL sale only'
);
select is(
  public.fn_revenue_sales_report(:'orgA', '2024-07-01', '2024-07-31', '2024-07-31')
    ->>'outstanding_total',
  '0', 'the restored historical sale still opens no receivable'
);
reset role;

-- ── 10) PRODUCTION-ORPHAN reversal rollback ───────────────────────────────────────────────────────
-- No executor path emits `orphan_reversal` yet, so the evidence is constructed directly here — the
-- rollback must handle it exactly as it handles a correction reversal, including emitting the
-- `orphan_reversal_reinstatement` kind the schema reserves for it.
select pg_temp.make_historical_expense(
  'b5000000-0000-0000-0000-000000000003', 'b6000000-0000-0000-0000-000000000003',
  'b7000000-0000-0000-0000-000000000005', 'b7000000-0000-0000-0000-000000000006',
  310, '2024-08-14'
);
select pg_temp.make_batch('b0000000-0000-0000-0000-000000000050');
select pg_temp.add_expense_row(
  'b0000000-0000-0000-0000-000000000050', 'b1000000-0000-0000-0000-000000000050',
  'b2000000-0000-0000-0000-000000000050', 'orphan-row', 310, '2024-08-14',
  'b5000000-0000-0000-0000-000000000003'
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch('b0000000-0000-0000-0000-000000000050'))->>'status',
  'executed', 'the orphan fixture batch executes (producing the baseline snapshot and the reversal)'
);
reset role;
-- Relabel the execution's correction_reversal link as the orphan_reversal kind the design reserves,
-- keeping every other column identical. This is the exact shape a production-orphan reversal has.
--
-- The append-only guard now refuses this relabel outright — asserted FIRST, because that refusal is
-- the production behaviour — so the fixture is built with the guard off. That is legitimate here and
-- only here: no executor can emit `orphan_reversal` yet, so there is no other way to reach the state
-- this section exists to cover, and the rollback must still handle it if the executor ever does.
select throws_ok(
  $orph$update public.reconciliation_action_links
           set action_kind = 'orphan_reversal'
         where batch_id = 'b0000000-0000-0000-0000-000000000050'
           and action_kind = 'correction_reversal'$orph$,
  '22023', 'reconciliation_action_links: rows are append-only and cannot be updated',
  'the append-only guard refuses the orphan relabel in production — the fixture below needs it off'
);
set local session_replication_role = replica;
update public.reconciliation_action_links
   set action_kind = 'orphan_reversal'
 where batch_id = 'b0000000-0000-0000-0000-000000000050'
   and action_kind = 'correction_reversal';
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_rollback_reconciliation_batch(
     'b0000000-0000-0000-0000-000000000050', 'إلغاء عكس سطر إنتاج'))->>'reinstated_journals',
  '1', 'a production-orphan reversal is reinstated by the rollback'
);
reset role;
select is(
  (select count(*)::int from public.reconciliation_action_links
    where batch_id = 'b0000000-0000-0000-0000-000000000050'
      and action_kind = 'orphan_reversal_reinstatement'),
  1, 'the orphan path records the orphan_reversal_reinstatement kind, not the correction kind'
);
select is(
  (select payment_status from public.expenses where id = 'b5000000-0000-0000-0000-000000000003'),
  'historical_treasury', 'the orphaned original expense is restored'
);
select is(
  (select reinstates_journal_entry_id::text from public.reconciliation_action_links
    where batch_id = 'b0000000-0000-0000-0000-000000000050'
      and action_kind = 'orphan_reversal_reinstatement'),
  'b6000000-0000-0000-0000-000000000003',
  'the orphan reinstatement names the exact original journal'
);

-- ── 11) ZERO-VALUE no-op rollback: no financial write, clean ledger transition ────────────────────
select pg_temp.make_batch('b0000000-0000-0000-0000-000000000060');
select pg_temp.add_expense_row(
  'b0000000-0000-0000-0000-000000000060', 'b1000000-0000-0000-0000-000000000060',
  'b2000000-0000-0000-0000-000000000060', 'zero-row', 0, '2024-09-02'
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch('b0000000-0000-0000-0000-000000000060'))->>'status',
  'executed', 'the zero-value batch executes'
);
reset role;
select set_config('t.j_before_zero_rb', (select count(*)::text from public.journal_entries), false);
select set_config('t.e_before_zero_rb', (select count(*)::text from public.expenses), false);
select pg_temp.as_user(current_setting('t.owner'));
select set_config('t.zero_rb', (
  public.fn_rollback_reconciliation_batch(
    'b0000000-0000-0000-0000-000000000060', 'إلغاء سطر صفري')::text
), false);
select is(
  current_setting('t.zero_rb')::jsonb->>'status', 'rolled_back',
  'a zero-value-only batch rolls back'
);
select is(
  current_setting('t.zero_rb')::jsonb->>'zero_value_rows', '1',
  'the rollback reports the zero-value no-op row'
);
select is(
  current_setting('t.zero_rb')::jsonb->>'reversed_journals', '0',
  'a zero-value no-op reverses no journal'
);
reset role;
select is(
  (select count(*)::int from public.journal_entries), current_setting('t.j_before_zero_rb')::int,
  'the zero-value rollback writes no journal at all'
);
select is(
  (select count(*)::int from public.expenses), current_setting('t.e_before_zero_rb')::int,
  'the zero-value rollback writes no domain row at all'
);
select is(
  (select status from public.reconciliation_execution_ledger
    where evidence_item_id = 'b1000000-0000-0000-0000-000000000060'),
  'reversed', 'the zero-value ledger row still transitions cleanly to reversed'
);

-- ── 12) MIXED expense + sale batch ────────────────────────────────────────────────────────────────
select pg_temp.make_historical_sale(
  'b5000000-0000-0000-0000-000000000004', 'b6000000-0000-0000-0000-000000000004',
  'b7000000-0000-0000-0000-000000000007', 'b7000000-0000-0000-0000-000000000008',
  120, '2024-10-03'
);
select pg_temp.make_batch('b0000000-0000-0000-0000-000000000070');
select pg_temp.add_expense_row(
  'b0000000-0000-0000-0000-000000000070', 'b1000000-0000-0000-0000-000000000070',
  'b2000000-0000-0000-0000-000000000070', 'mixed-expense', 60, '2024-10-03'
);
select pg_temp.add_sale_row(
  'b0000000-0000-0000-0000-000000000070', 'b1000000-0000-0000-0000-000000000071',
  'b2000000-0000-0000-0000-000000000071', 'mixed-sale', 130, '2024-10-03',
  'برحي', 'b5000000-0000-0000-0000-000000000004'
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch('b0000000-0000-0000-0000-000000000070'))->>'status',
  'executed', 'a mixed expense + sale batch executes'
);
select set_config('t.mixed_rb', (
  public.fn_rollback_reconciliation_batch(
    'b0000000-0000-0000-0000-000000000070', 'إلغاء دفعة مختلطة')::text
), false);
select is(
  current_setting('t.mixed_rb')::jsonb->>'status', 'rolled_back',
  'a mixed expense + sale batch rolls back'
);
select is(
  current_setting('t.mixed_rb')::jsonb->>'reversed_journals', '2',
  'the mixed rollback reverses both created postings (expense addition + sale replacement)'
);
select is(
  current_setting('t.mixed_rb')::jsonb->>'reinstated_journals', '1',
  'the mixed rollback reinstates the one production journal the batch reversed'
);
select is(
  current_setting('t.mixed_rb')::jsonb->>'ledger_rows_reversed', '2',
  'both mixed-batch ledger rows transition to reversed'
);
reset role;
select is(
  (select payment_status from public.sales where id = 'b5000000-0000-0000-0000-000000000004'),
  'historical_treasury', 'the mixed batch restores its original sale'
);
select is(
  (select count(*)::int from public.reconciliation_batch_rows
    where batch_id = 'b0000000-0000-0000-0000-000000000070'
      and execution_result = 'reversed'),
  2, 'every mixed-batch row reports a reversed execution result'
);
select is(
  (select count(*)::int from public.reconciliation_action_links al
     join public.journal_entries je on je.id = al.journal_entry_id
    where al.batch_id = 'b0000000-0000-0000-0000-000000000070'
      and al.action_kind in ('addition', 'correction_replacement')
      and je.status <> 'reversed'),
  0, 'no created journal of the mixed batch is left posted'
);

-- ── 13) period locks, both sides ──────────────────────────────────────────────────────────────────
-- Reversal side: the created posting's own period is locked, so the rollback cannot reverse it.
select pg_temp.make_batch('b0000000-0000-0000-0000-000000000080');
select pg_temp.add_expense_row(
  'b0000000-0000-0000-0000-000000000080', 'b1000000-0000-0000-0000-000000000080',
  'b2000000-0000-0000-0000-000000000080', 'locked-reversal', 75, '2023-02-10'
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch('b0000000-0000-0000-0000-000000000080'))->>'status',
  'executed', 'the period-lock fixture batch executes before the period is locked'
);
reset role;
insert into public.accounting_periods(id, org_id, period_start, period_end, status, note)
values ('bc000000-0000-0000-0000-000000000001', :'orgA',
        '2023-02-01', '2023-02-28', 'locked', 'rollback period lock test');
select pg_temp.as_user(current_setting('t.owner'));
select is(
  pg_temp.rollback_error('b0000000-0000-0000-0000-000000000080'),
  '55000|cannot reverse a journal entry from a locked accounting period',
  'a rollback refuses to reverse a created posting out of a locked period'
);
reset role;
select is(
  (select status from public.reconciliation_batches
    where id = 'b0000000-0000-0000-0000-000000000080'),
  'executed', 'the period-locked rollback left the batch executed, never half-rolled-back'
);
select is(
  (select payment_status from public.expenses e
     join public.reconciliation_action_links al
       on al.target_id = e.id and al.target_table = 'expenses'
    where al.batch_id = 'b0000000-0000-0000-0000-000000000080'),
  'historical_treasury', 'the period-locked rollback changed no domain row'
);
delete from public.accounting_periods where id = 'bc000000-0000-0000-0000-000000000001';

-- Reinstatement side: the ORIGINAL journal's own period is locked, so it cannot be reinstated.
select pg_temp.make_historical_expense(
  'b5000000-0000-0000-0000-000000000005', 'b6000000-0000-0000-0000-000000000005',
  'b7000000-0000-0000-0000-000000000009', 'b7000000-0000-0000-0000-00000000000a',
  95, '2023-03-15'
);
select pg_temp.make_batch('b0000000-0000-0000-0000-000000000090');
select pg_temp.add_expense_row(
  'b0000000-0000-0000-0000-000000000090', 'b1000000-0000-0000-0000-000000000090',
  'b2000000-0000-0000-0000-000000000090', 'locked-reinstatement', 105, '2023-03-15',
  'b5000000-0000-0000-0000-000000000005'
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch('b0000000-0000-0000-0000-000000000090'))->>'status',
  'executed', 'the reinstatement period-lock fixture batch executes'
);
reset role;
-- Lock ONLY the original's period; the created replacement posted on the same date, so the reversal
-- side would trip first. Prove the reinstatement guard by unlocking nothing and asserting the message
-- the reversal raises is the period-lock one, then re-run with the replacement moved out of the lock.
select set_config('t.replacement_je', (
  select journal_entry_id::text from public.reconciliation_action_links
   where batch_id = 'b0000000-0000-0000-0000-000000000090'
     and action_kind = 'correction_replacement'
), false);
update public.journal_entries set entry_date = '2023-06-15'
 where id = current_setting('t.replacement_je')::uuid;
insert into public.accounting_periods(id, org_id, period_start, period_end, status, note)
values ('bc000000-0000-0000-0000-000000000002', :'orgA',
        '2023-03-01', '2023-03-31', 'locked', 'rollback reinstatement lock test');
select pg_temp.as_user(current_setting('t.owner'));
select is(
  pg_temp.rollback_error('b0000000-0000-0000-0000-000000000090'),
  '55000|cannot reinstate a journal entry into a locked accounting period',
  'a rollback refuses to reinstate an original journal into a locked period'
);
reset role;
select is(
  (select status from public.reconciliation_batches
    where id = 'b0000000-0000-0000-0000-000000000090'),
  'executed', 'the reinstatement period lock left the batch executed'
);
select is(
  (select payment_status from public.expenses where id = 'b5000000-0000-0000-0000-000000000005'),
  'historical_reversed', 'the reinstatement period lock restored no domain row'
);
select is(
  (select count(*)::int from public.reconciliation_action_links
    where batch_id = 'b0000000-0000-0000-0000-000000000090'
      and action_kind in ('correction_reversal_reinstatement', 'orphan_reversal_reinstatement')),
  0, 'the failed rollback appended no reinstatement link'
);
delete from public.accounting_periods where id = 'bc000000-0000-0000-0000-000000000002';

-- ── 14) atomic failure: a rollback that fails mid-flight strands nothing ──────────────────────────
-- The batch above already proves the whole-transaction abort for a mixed (reverse-then-reinstate)
-- rollback: pass 1 reversed a real journal before pass 2 hit the locked period, yet nothing survived.
select is(
  (select count(*)::int from public.journal_entries je
    where je.reversal_of = current_setting('t.replacement_je')::uuid),
  0, 'the failed rollback left no reversing entry behind from its completed first pass'
);
select is(
  (select status from public.journal_entries
    where id = current_setting('t.replacement_je')::uuid),
  'posted', 'the created replacement journal is still posted after the failed rollback'
);
select is(
  (select status from public.reconciliation_execution_ledger
    where evidence_item_id = 'b1000000-0000-0000-0000-000000000090'),
  'executed', 'the failed rollback left the execution ledger claim intact'
);
select is(
  (select execution_result from public.reconciliation_batch_rows
    where id = 'b2000000-0000-0000-0000-000000000090'),
  'reversed', 'the failed rollback left the batch row execution result as execution wrote it'
);

-- ── 15) the lifecycle guards were EXTENDED, not weakened ──────────────────────────────────────────
-- A bare status flip with no rollback evidence behind it is still refused, in both domains and both
-- directions. These are the exact transitions the rollback performs; without its append-only proof
-- they must remain impossible even to a privileged path.
select pg_temp.make_historical_expense(
  'b5000000-0000-0000-0000-000000000006', 'b6000000-0000-0000-0000-000000000006',
  'b7000000-0000-0000-0000-00000000000b', 'b7000000-0000-0000-0000-00000000000c',
  50, '2024-11-01'
);
select throws_ok(
  $$update public.expenses set payment_status = 'historical_reversed'
     where id = 'b5000000-0000-0000-0000-000000000006'$$,
  '22023', 'historical reversed status requires a verified reconciliation reversal',
  'an unproven expense treasury -> reversed flip is still refused'
);
select throws_ok(
  $$update public.expenses set payment_status = 'historical_treasury'
     where id = current_setting('t.exp_added')::uuid$$,
  '22023', 'reversed historical expense is immutable',
  'an unproven expense reversed -> treasury restore is still refused'
);
select throws_ok(
  $$update public.sales set payment_status = 'historical_treasury'
     where id = current_setting('t.sale_added')::uuid$$,
  '22023', 'reversed historical sale is immutable',
  'an unproven sale reversed -> treasury restore is still refused'
);
-- `description` rather than `total`: a routed expense's amount/kind is already frozen by an EARLIER
-- guard, so an amount edit would prove that guard, not this one. A descriptive field reaches the
-- historical guard and proves the restored row is frozen in EVERY field, not just the money ones.
select throws_ok(
  $$update public.expenses set description = 'تعديل بعد الاستعادة'
     where id = 'b5000000-0000-0000-0000-000000000001'$$,
  '22023', 'posted historical treasury expense is immutable',
  'a restored historical expense is immutable again after the rollback'
);
select throws_ok(
  $$update public.sales set total = 999
     where id = 'b5000000-0000-0000-0000-000000000002'$$,
  '22023', 'posted historical treasury sale is immutable',
  'a restored historical sale is immutable again after the rollback'
);
select throws_ok(
  $$update public.expenses set category = 'مُعاد التصنيف'
     where id = current_setting('t.exp_added')::uuid$$,
  '22023', 'reversed historical expense is immutable',
  'a rolled-back expense stays frozen in every field but its rollback stamp'
);
select throws_ok(
  $$delete from public.expenses where id = current_setting('t.exp_added')::uuid$$,
  '22023', 'historical reconciliation expense cannot be deleted',
  'a rolled-back expense still cannot be deleted'
);
select throws_ok(
  $$delete from public.sales where id = current_setting('t.sale_added')::uuid$$,
  '22023', 'historical reconciliation sale cannot be deleted',
  'a rolled-back sale still cannot be deleted'
);
select throws_ok(
  $$insert into public.sales(id, org_id, sale_date, crop, qty, unit, unit_price, total, payment_status)
    values ('b5000000-0000-0000-0000-0000000000ff', '00000000-0000-0000-0000-000000000001',
            current_date, 'برحي', 1, 'كجم', 1, 1, 'historical_treasury')$$,
  '22023', 'a historical reconciliation sale state cannot be claimed on insert',
  'the insert-time historical claim guard survives the re-emit'
);

-- ── 16) the direct public reversal bypass stays blocked, both domains ─────────────────────────────
select pg_temp.as_user(current_setting('t.owner'));
select throws_ok(
  format(
    $$select public.fn_reverse_journal_entry(%L::uuid, 'محاولة التفاف')$$,
    'b6000000-0000-0000-0000-000000000001'
  ),
  '42501', 'forbidden: a historical reconciliation expense journal is reversed only through reconciliation',
  'a restored historical EXPENSE journal still cannot be reversed on the public path'
);
select throws_ok(
  format(
    $$select public.fn_reverse_journal_entry(%L::uuid, 'محاولة التفاف')$$,
    'b6000000-0000-0000-0000-000000000002'
  ),
  '42501', 'forbidden: a historical reconciliation sale journal is reversed only through reconciliation',
  'a restored historical SALE journal still cannot be reversed on the public path'
);
select throws_ok(
  format(
    $$select public.fn_reverse_journal_entry(%L::uuid, 'محاولة التفاف')$$,
    current_setting('t.reinstated_je')
  ),
  '42501', 'forbidden: a historical reconciliation expense journal is reversed only through reconciliation',
  'even the REINSTATED journal is protected from the public reversal path'
);
reset role;

-- ── 17) cross-org isolation ───────────────────────────────────────────────────────────────────────
insert into public.organization(id, name) values
  ('0c000000-0000-0000-0000-000000000001', 'منظمة تراجع أخرى');
insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
  values ('9c000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
          'authenticated', 'authenticated', now(), now());
insert into public.organization_member(org_id, user_id, role) values
  ('0c000000-0000-0000-0000-000000000001', '9c000000-0000-0000-0000-000000000001', 'owner');
select pg_temp.make_batch('b0000000-0000-0000-0000-0000000000a1', 'executed',
  '0c000000-0000-0000-0000-000000000001');
select pg_temp.as_user(current_setting('t.owner'));
select is(
  pg_temp.rollback_error('b0000000-0000-0000-0000-0000000000a1'),
  'P0002|reconciliation batch not found',
  'org A''s owner cannot even see org B''s executed batch, let alone roll it back'
);
reset role;
select pg_temp.as_user('9c000000-0000-0000-0000-000000000001');
select is(
  pg_temp.rollback_error('b0000000-0000-0000-0000-000000000010'),
  'P0002|reconciliation batch not found',
  'org B''s owner cannot roll back org A''s batch'
);
reset role;
select is(
  (select status from public.reconciliation_batches
    where id = 'b0000000-0000-0000-0000-0000000000a1'),
  'executed', 'the cross-org batch is untouched by either attempt'
);

-- ── 18) concurrency: the batch row lock is really taken ───────────────────────────────────────────
-- The harness is single-session, so the observable proof is that the rollback declares FOR UPDATE on
-- the batch row it reads — asserted against the function's own definition rather than simulated.
select ok(
  (select pg_get_functiondef(p.oid) like '%from public.reconciliation_batches b%for update%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'fn_rollback_reconciliation_batch'),
  'the rollback locks its batch row FOR UPDATE, so two rollbacks serialize'
);
select ok(
  (select pg_get_functiondef(p.oid) like '%and a.code = ''1010''%for update%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'fn_rollback_reconciliation_batch'),
  'the rollback takes cash 1010 at the executor''s own serialization point'
);
select ok(
  (select pg_get_functiondef(p.oid) not like '%delete from%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'fn_rollback_reconciliation_batch'),
  'the rollback contains no DELETE at all — the undo is append-only'
);
select ok(
  (select pg_get_functiondef(p.oid) not like '%delete from%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'fn_reconciliation_reinstate_baseline_journal'),
  'the reinstatement helper contains no DELETE either'
);

-- ── 19) whole-run audit invariant: no reconciliation evidence was destroyed ───────────────────────
select is(
  (select count(*)::int from public.reconciliation_baseline_journal_headers
    where batch_id in (
      'b0000000-0000-0000-0000-000000000020',
      'b0000000-0000-0000-0000-000000000040',
      'b0000000-0000-0000-0000-000000000050'
    )),
  3, 'every rolled-back batch keeps its immutable baseline header'
);
select is(
  (select count(*)::int from public.reconciliation_action_links
    where batch_id = 'b0000000-0000-0000-0000-000000000020'),
  3, 'the correction batch keeps its reversal + replacement links and gains the reinstatement link'
);
select is(
  (select count(*)::int from public.reconciliation_execution_ledger
    where status = 'executed'
      and executed_by_batch_row_id in (
        select id from public.reconciliation_batch_rows
         where batch_id in (
           'b0000000-0000-0000-0000-000000000010',
           'b0000000-0000-0000-0000-000000000020',
           'b0000000-0000-0000-0000-000000000030',
           'b0000000-0000-0000-0000-000000000040',
           'b0000000-0000-0000-0000-000000000050',
           'b0000000-0000-0000-0000-000000000060',
           'b0000000-0000-0000-0000-000000000070'
         ))),
  0, 'no rolled-back batch leaves an execution ledger claim behind'
);

-- ── 20) A ROLLED-BACK SALE IS CORRECTABLE AGAIN — the closed-chain exact-history proof ────────────
-- The behaviour this whole section exists for: before the chain proof, a restored sale carried three
-- journals and private.fn_reconciliation_sale_has_exact_historical_journal (which demanded exactly
-- ONE, in any status) stopped certifying it, so a SECOND correction failed closed forever. The
-- eligibility is proved the only way that is not circular: by actually staging and EXECUTING a second
-- correction batch against the restored sale, then rolling that one back too.
select pg_temp.make_historical_sale(
  'b5000000-0000-0000-0000-0000000000a1', 'b6000000-0000-0000-0000-0000000000a1',
  'b7000000-0000-0000-0000-0000000000a2', 'b7000000-0000-0000-0000-0000000000a3',
  900, '2024-08-05'
);
select pg_temp.make_batch('b0000000-0000-0000-0000-0000000000d1');
select pg_temp.add_sale_row(
  'b0000000-0000-0000-0000-0000000000d1', 'b1000000-0000-0000-0000-0000000000a1',
  'b2000000-0000-0000-0000-0000000000a1', 'sale-correction-cycle-1', 950, '2024-08-05',
  'برحي', 'b5000000-0000-0000-0000-0000000000a1'
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch('b0000000-0000-0000-0000-0000000000d1'))->>'status',
  'executed', 'cycle 1: the first sale correction executes'
);
select is(
  (public.fn_rollback_reconciliation_batch(
     'b0000000-0000-0000-0000-0000000000d1', 'إلغاء التصحيح الأول'))->>'status',
  'rolled_back', 'cycle 1: the first correction rolls back'
);
reset role;
select is(
  (select payment_status from public.sales where id = 'b5000000-0000-0000-0000-0000000000a1'),
  'historical_treasury', 'cycle 1: the original sale is restored'
);
select is(
  (select count(*)::int from public.journal_entries
    where source_type = 'sale' and source_id = 'b5000000-0000-0000-0000-0000000000a1'),
  3, 'cycle 1: the restored sale carries three journals — original, reversal, reinstatement'
);
select is(
  (select count(*)::int from public.journal_entries
    where source_type = 'sale' and source_id = 'b5000000-0000-0000-0000-0000000000a1'
      and status = 'posted'),
  1, 'cycle 1: exactly one of those three is CURRENT posted'
);
select set_config('t.chain_sale_je', (
  select id::text from public.journal_entries
   where source_type = 'sale' and source_id = 'b5000000-0000-0000-0000-0000000000a1'
     and status = 'posted'
), false);
select ok(
  private.fn_reconciliation_sale_restoration_chain_is_closed(
    'b5000000-0000-0000-0000-0000000000a1', current_setting('t.chain_sale_je')::uuid),
  'cycle 1: the restoration chain certifies as complete and internally consistent'
);
select ok(
  private.fn_reconciliation_sale_has_exact_historical_journal('b5000000-0000-0000-0000-0000000000a1'),
  'cycle 1: the exact-history proof certifies the restored sale (the release blocker)'
);

-- The real proof of eligibility: a SECOND correction batch actually executes against the restored row.
select pg_temp.make_batch('b0000000-0000-0000-0000-0000000000d2');
select pg_temp.add_sale_row(
  'b0000000-0000-0000-0000-0000000000d2', 'b1000000-0000-0000-0000-0000000000a2',
  'b2000000-0000-0000-0000-0000000000a2', 'sale-correction-cycle-2', 990, '2024-08-05',
  'برحي', 'b5000000-0000-0000-0000-0000000000a1'
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch('b0000000-0000-0000-0000-0000000000d2'))->>'status',
  'executed', 'cycle 2: a SECOND correction against the rolled-back sale executes'
);
reset role;
select is(
  (select payment_status from public.sales where id = 'b5000000-0000-0000-0000-0000000000a1'),
  'historical_reversed', 'cycle 2: the restored sale is reversed again by the second correction'
);
select is(
  (select count(*)::int from public.sales
    where corrects_sale_id = 'b5000000-0000-0000-0000-0000000000a1'),
  2, 'cycle 2: both corrections left their own replacement sale — nothing was overwritten'
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_rollback_reconciliation_batch(
     'b0000000-0000-0000-0000-0000000000d2', 'إلغاء التصحيح الثاني'))->>'reinstated_journals',
  '1', 'cycle 2: the second correction rolls back and reinstates exactly one journal'
);
reset role;
select is(
  (select count(*)::int from public.journal_entries
    where source_type = 'sale' and source_id = 'b5000000-0000-0000-0000-0000000000a1'),
  5, 'cycle 2: the twice-restored sale carries five journals — two complete cycles plus the current one'
);
select set_config('t.chain_sale_je', (
  select id::text from public.journal_entries
   where source_type = 'sale' and source_id = 'b5000000-0000-0000-0000-0000000000a1'
     and status = 'posted'
), false);
select ok(
  private.fn_reconciliation_sale_has_exact_historical_journal('b5000000-0000-0000-0000-0000000000a1'),
  'cycle 2: the proof still certifies after a SECOND correction->rollback cycle (repeatable, not one-shot)'
);
select is(
  (select entry_date from public.journal_entries
    where id = current_setting('t.chain_sale_je')::uuid),
  '2024-08-05'::date, 'cycle 2: the current posted journal still carries the sale''s own economic date'
);
select is(
  (select count(*)::int from public.journal_lines
    where journal_entry_id = current_setting('t.chain_sale_je')::uuid),
  2, 'cycle 2: the current posted journal is still exactly two lines'
);
select is(
  (select a.code from public.journal_lines jl join public.accounts a on a.id = jl.account_id
    where jl.journal_entry_id = current_setting('t.chain_sale_je')::uuid and jl.debit = 900),
  '1010', 'cycle 2: it still debits treasury 1010 for the ORIGINAL total, not a corrected one'
);
select is(
  (select a.code from public.journal_lines jl join public.accounts a on a.id = jl.account_id
    where jl.journal_entry_id = current_setting('t.chain_sale_je')::uuid and jl.credit = 900),
  '4010', 'cycle 2: it still credits the same typed revenue leaf for the original total'
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  public.fn_revenue_sales_report(:'orgA', '2024-08-01', '2024-08-31', '2024-08-31')
    ->>'finalized_revenue',
  '900', 'cycle 2: after both rollbacks the revenue report shows the ORIGINAL sale only'
);
reset role;

-- ── 21) the chain proof FAILS CLOSED — injected, unlinked, broken and open-cycle states ───────────
-- One fresh single-cycle restored sale, mutated one way at a time and repaired after each, so every
-- refusal is attributable to exactly the state under test.
select pg_temp.make_historical_sale(
  'b5000000-0000-0000-0000-0000000000b1', 'b6000000-0000-0000-0000-0000000000b1',
  'b7000000-0000-0000-0000-0000000000b2', 'b7000000-0000-0000-0000-0000000000b3',
  640, '2024-09-11'
);
select pg_temp.make_batch('b0000000-0000-0000-0000-0000000000b1');
select pg_temp.add_sale_row(
  'b0000000-0000-0000-0000-0000000000b1', 'b1000000-0000-0000-0000-0000000000b1',
  'b2000000-0000-0000-0000-0000000000b1', 'sale-correction-negatives', 700, '2024-09-11',
  'برحي', 'b5000000-0000-0000-0000-0000000000b1'
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch('b0000000-0000-0000-0000-0000000000b1'))->>'status',
  'executed', 'negatives fixture: the correction executes'
);
select is(
  (public.fn_rollback_reconciliation_batch(
     'b0000000-0000-0000-0000-0000000000b1', 'تجهيز حالات الرفض'))->>'status',
  'rolled_back', 'negatives fixture: the correction rolls back'
);
reset role;
select set_config('t.neg_je', (
  select id::text from public.journal_entries
   where source_type = 'sale' and source_id = 'b5000000-0000-0000-0000-0000000000b1'
     and status = 'posted'
), false);
select ok(
  private.fn_reconciliation_sale_has_exact_historical_journal('b5000000-0000-0000-0000-0000000000b1'),
  'negatives baseline: the untouched restored sale certifies'
);

-- (a) a second POSTED journal — ambiguity is still fatal, exactly as it was before this slice.
insert into public.journal_entries(
  id, org_id, entry_date, source_type, source_id, source_sequence, description, status, posted_at)
values ('b6000000-0000-0000-0000-0000000000b9', :'orgA', '2024-09-11', 'sale',
        'b5000000-0000-0000-0000-0000000000b1', 90, 'قيد مدسوس', 'posted', now());
insert into public.journal_lines(org_id, journal_entry_id, account_id, debit, credit)
values (:'orgA', 'b6000000-0000-0000-0000-0000000000b9', current_setting('t.cash')::uuid, 640, 0),
       (:'orgA', 'b6000000-0000-0000-0000-0000000000b9', current_setting('t.rev4010')::uuid, 0, 640);
select ok(
  not private.fn_reconciliation_sale_has_exact_historical_journal('b5000000-0000-0000-0000-0000000000b1'),
  'an injected SECOND posted journal fails the proof closed'
);
-- (b) the same entry demoted to `reversed`: still unlinked, still unexplained by any cycle.
update public.journal_entries set status = 'reversed'
 where id = 'b6000000-0000-0000-0000-0000000000b9';
select ok(
  not private.fn_reconciliation_sale_restoration_chain_is_closed(
    'b5000000-0000-0000-0000-0000000000b1', current_setting('t.neg_je')::uuid),
  'an injected UNLINKED reversed journal fails the chain proof closed'
);
delete from public.journal_lines where journal_entry_id = 'b6000000-0000-0000-0000-0000000000b9';
delete from public.journal_entries where id = 'b6000000-0000-0000-0000-0000000000b9';
select ok(
  private.fn_reconciliation_sale_has_exact_historical_journal('b5000000-0000-0000-0000-0000000000b1'),
  'removing the injected journal restores certification — the refusals above were attributable'
);

-- (c) the reinstatement link repointed at ANOTHER sale''s reversed journal: the current posted entry
--     is no longer provably the reinstatement of this row''s own history.
select set_config('t.neg_reinstate_link', (
  select id::text from public.reconciliation_action_links
   where batch_id = 'b0000000-0000-0000-0000-0000000000b1'
     and action_kind = 'correction_reversal_reinstatement'
), false);
select set_config('t.neg_reinstates', (
  select reinstates_journal_entry_id::text from public.reconciliation_action_links
   where id = current_setting('t.neg_reinstate_link')::uuid
), false);
-- The append-only guard (§0b of the migration) makes every mutation below IMPOSSIBLE in production —
-- asserted here once — so it is switched off for the rest of this section. That is the whole point:
-- the chain proof is the SECOND, independent line of defence, and it has to be exercised against
-- states the first line of defence would never let exist.
select throws_ok(
  $chain$update public.reconciliation_action_links
            set reinstates_journal_entry_id = 'b6000000-0000-0000-0000-0000000000a1'
          where id = current_setting('t.neg_reinstate_link')::uuid$chain$,
  '22023', 'reconciliation_action_links: rows are append-only and cannot be updated',
  'every forged chain state below is unreachable in production — the guard refuses it first'
);
set local session_replication_role = replica;
update public.reconciliation_action_links
   set reinstates_journal_entry_id = 'b6000000-0000-0000-0000-0000000000a1'
 where id = current_setting('t.neg_reinstate_link')::uuid;
select ok(
  not private.fn_reconciliation_sale_has_exact_historical_journal('b5000000-0000-0000-0000-0000000000b1'),
  'a reinstatement link naming ANOTHER sale''s journal fails the proof closed'
);
update public.reconciliation_action_links
   set reinstates_journal_entry_id = current_setting('t.neg_reinstates')::uuid
 where id = current_setting('t.neg_reinstate_link')::uuid;
select ok(
  private.fn_reconciliation_sale_has_exact_historical_journal('b5000000-0000-0000-0000-0000000000b1'),
  'repairing the reinstatement link restores certification'
);

-- (d) an UNMATCHED reinstatement: the link is gone, so a reversed original is left unexplained.
select set_config('t.neg_reinstate_kind', (
  select action_kind from public.reconciliation_action_links
   where id = current_setting('t.neg_reinstate_link')::uuid
), false);
select set_config('t.neg_reinstate_je', (
  select journal_entry_id::text from public.reconciliation_action_links
   where id = current_setting('t.neg_reinstate_link')::uuid
), false);
select set_config('t.neg_reinstate_row', (
  select batch_row_id::text from public.reconciliation_action_links
   where id = current_setting('t.neg_reinstate_link')::uuid
), false);
delete from public.reconciliation_action_links
 where id = current_setting('t.neg_reinstate_link')::uuid;
select ok(
  not private.fn_reconciliation_sale_has_exact_historical_journal('b5000000-0000-0000-0000-0000000000b1'),
  'a reversed original with NO reinstatement link fails the proof closed'
);
insert into public.reconciliation_action_links(
  id, org_id, batch_id, batch_row_id, action_kind, target_table, target_id,
  journal_entry_id, reinstates_journal_entry_id)
values (
  current_setting('t.neg_reinstate_link')::uuid, :'orgA',
  'b0000000-0000-0000-0000-0000000000b1', current_setting('t.neg_reinstate_row')::uuid,
  current_setting('t.neg_reinstate_kind'), 'sales', 'b5000000-0000-0000-0000-0000000000b1',
  current_setting('t.neg_reinstate_je')::uuid, current_setting('t.neg_reinstates')::uuid);
select ok(
  private.fn_reconciliation_sale_has_exact_historical_journal('b5000000-0000-0000-0000-0000000000b1'),
  'restoring the reinstatement link restores certification'
);

-- (e) an UNMATCHED reversal: the reversal link is gone, so the arithmetic no longer closes.
select set_config('t.neg_reversal_link', (
  select id::text from public.reconciliation_action_links
   where batch_id = 'b0000000-0000-0000-0000-0000000000b1'
     and action_kind = 'correction_reversal'
     and target_id = 'b5000000-0000-0000-0000-0000000000b1'
), false);
select set_config('t.neg_reversal_je', (
  select journal_entry_id::text from public.reconciliation_action_links
   where id = current_setting('t.neg_reversal_link')::uuid
), false);
select set_config('t.neg_reversal_row', (
  select batch_row_id::text from public.reconciliation_action_links
   where id = current_setting('t.neg_reversal_link')::uuid
), false);
delete from public.reconciliation_action_links
 where id = current_setting('t.neg_reversal_link')::uuid;
select ok(
  not private.fn_reconciliation_sale_has_exact_historical_journal('b5000000-0000-0000-0000-0000000000b1'),
  'a reversal entry with NO reversal link fails the proof closed'
);
insert into public.reconciliation_action_links(
  id, org_id, batch_id, batch_row_id, action_kind, target_table, target_id, journal_entry_id)
values (
  current_setting('t.neg_reversal_link')::uuid, :'orgA',
  'b0000000-0000-0000-0000-0000000000b1', current_setting('t.neg_reversal_row')::uuid,
  'correction_reversal', 'sales', 'b5000000-0000-0000-0000-0000000000b1',
  current_setting('t.neg_reversal_je')::uuid);
select ok(
  private.fn_reconciliation_sale_has_exact_historical_journal('b5000000-0000-0000-0000-0000000000b1'),
  'restoring the reversal link restores certification'
);

-- (f) a batch that is NOT rolled_back — an OPEN cycle can never certify a restoration.
update public.reconciliation_batches set status = 'executed'
 where id = 'b0000000-0000-0000-0000-0000000000b1';
select ok(
  not private.fn_reconciliation_sale_has_exact_historical_journal('b5000000-0000-0000-0000-0000000000b1'),
  'a chain whose batch is not rolled_back fails the proof closed'
);
update public.reconciliation_batches set status = 'rolled_back'
 where id = 'b0000000-0000-0000-0000-0000000000b1';
select ok(
  private.fn_reconciliation_sale_has_exact_historical_journal('b5000000-0000-0000-0000-0000000000b1'),
  'restoring the rolled_back batch status restores certification'
);

-- (g) a WRONG-TARGET link: the reinstatement points at a different row, so this sale has none.
update public.reconciliation_action_links
   set target_id = 'b5000000-0000-0000-0000-0000000000a1'
 where id = current_setting('t.neg_reinstate_link')::uuid;
select ok(
  not private.fn_reconciliation_sale_has_exact_historical_journal('b5000000-0000-0000-0000-0000000000b1'),
  'a reinstatement link whose target_id names another sale fails the proof closed'
);
update public.reconciliation_action_links
   set target_id = 'b5000000-0000-0000-0000-0000000000b1'
 where id = current_setting('t.neg_reinstate_link')::uuid;
select ok(
  private.fn_reconciliation_sale_has_exact_historical_journal('b5000000-0000-0000-0000-0000000000b1'),
  'repairing the link target restores certification — so the next refusal is attributable too'
);
set local session_replication_role = origin;

-- (h) ANY collection row disqualifies a restored sale, exactly as it does a pristine one. The
--     lifecycle guard normally makes such a row impossible to write at all — asserted first — so the
--     trigger is disabled only to prove the PROOF itself is the second, independent line of defence.
select throws_ok(
  $ins$insert into public.sale_collections(org_id, sale_id, amount)
       values ('00000000-0000-0000-0000-000000000001',
               'b5000000-0000-0000-0000-0000000000b1', 10)$ins$,
  '22023',
  'a historical reconciliation sale is already settled and cannot be collected',
  'the collection guard refuses a collection against a restored historical sale'
);
set local session_replication_role = replica;
insert into public.sale_collections(id, org_id, sale_id, amount)
values ('bd000000-0000-0000-0000-0000000000b1', :'orgA',
        'b5000000-0000-0000-0000-0000000000b1', 10);
set local session_replication_role = origin;
select ok(
  not private.fn_reconciliation_sale_has_exact_historical_journal('b5000000-0000-0000-0000-0000000000b1'),
  'a collection row against a restored sale fails the proof closed, independently of the guard'
);
set local session_replication_role = replica;
delete from public.sale_collections where id = 'bd000000-0000-0000-0000-0000000000b1';
set local session_replication_role = origin;

-- (i) the chain helper answers false — never null, never true — for a sale that does not exist and
--     for a journal that is not the sale''s current posted entry.
select ok(
  not private.fn_reconciliation_sale_restoration_chain_is_closed(
    'b5000000-0000-0000-0000-0000000000fe', current_setting('t.neg_je')::uuid),
  'the chain helper refuses an unknown sale id rather than returning null'
);
select ok(
  not private.fn_reconciliation_sale_restoration_chain_is_closed(
    'b5000000-0000-0000-0000-0000000000b1', 'b6000000-0000-0000-0000-0000000000b1'),
  'the chain helper refuses when asked about a journal that is not the current reinstated entry'
);

-- (j) a PRISTINE historical sale still certifies through shape (a) and has no chain at all, so the
--     original single-journal predicate is provably not weakened by the new branch.
select pg_temp.make_historical_sale(
  'b5000000-0000-0000-0000-0000000000c1', 'b6000000-0000-0000-0000-0000000000c1',
  'b7000000-0000-0000-0000-0000000000c2', 'b7000000-0000-0000-0000-0000000000c3',
  310, '2024-10-02'
);
select ok(
  private.fn_reconciliation_sale_has_exact_historical_journal('b5000000-0000-0000-0000-0000000000c1'),
  'a pristine single-journal historical sale still certifies unchanged'
);
select ok(
  not private.fn_reconciliation_sale_restoration_chain_is_closed(
    'b5000000-0000-0000-0000-0000000000c1', 'b6000000-0000-0000-0000-0000000000c1'),
  'a pristine sale has no restoration chain — it certifies through shape (a), never through (b)'
);

-- (k) the new helper is private: no client role may reach it.
select ok(
  not has_function_privilege('authenticated',
    'private.fn_reconciliation_sale_restoration_chain_is_closed(uuid,uuid)', 'execute'),
  'authenticated cannot execute the restoration chain helper'
);
select is(
  (select p.proconfig[1] from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname = 'fn_reconciliation_sale_restoration_chain_is_closed'),
  'search_path=""', 'the restoration chain helper pins an empty search_path'
);

-- ── 22) the action links are APPEND-ONLY and one-per-(row, kind) ──────────────────────────────────
-- The rollback reads these links as the authoritative record of what the execution did, and releases
-- the evidence claim for every executed row whether or not a link is found. So the links must be
-- unforgeable at the storage layer, not merely un-granted.
select is(
  (select count(*)::int from pg_trigger
    where tgrelid = 'public.reconciliation_action_links'::regclass
      and tgname = 'guard_reconciliation_action_link_append_only'
      and not tgisinternal),
  1, 'the append-only guard trigger is installed on reconciliation_action_links'
);
select ok(
  (select i.indisunique
     from pg_class c join pg_index i on i.indexrelid = c.oid
    where c.relname = 'reconciliation_action_links_row_kind_uq'),
  'one action of each kind per batch row is enforced by a UNIQUE index, not by a proof'
);
select is(
  (select p.proconfig[1] from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'fn_guard_reconciliation_action_link_append_only'),
  'search_path=""', 'the append-only guard pins an empty search_path'
);
select ok(
  not has_function_privilege('authenticated',
    'public.fn_guard_reconciliation_action_link_append_only()', 'execute'),
  'no client role may execute the append-only guard function'
);
select ok(
  not has_function_privilege('authenticated',
    'private.fn_reconciliation_rollback_assert_action_bundle(uuid,uuid)', 'execute'),
  'the execution-evidence preflight helper is private'
);
select is(
  (select p.proconfig[1] from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'fn_reconciliation_rollback_assert_action_bundle'),
  'search_path=""', 'the execution-evidence preflight helper pins an empty search_path'
);

-- ── 23) EVERY BROKEN OR FORGED ACTION-LINK STATE ABORTS THE ROLLBACK ──────────────────────────────
-- Each case builds its own executed batch, breaks exactly one thing, and then proves BOTH halves:
-- the rollback refuses, AND nothing moved — the batch is still `executed`, the created journal is
-- still `posted`, the created row is still `historical_treasury` and unstamped, the ledger claim is
-- still `executed`, and the batch row still reports `posted`.

create or replace function pg_temp.execute_as_owner(p_batch uuid) returns text
language plpgsql as $$
declare v_status text;
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';
  v_status := (public.fn_execute_reconciliation_batch(p_batch))->>'status';
  execute 'reset role';
  if v_status is distinct from 'executed' then
    raise exception 'negative-case fixture batch % did not execute (%)', p_batch, v_status;
  end if;
  return v_status;
end $$;

-- The single "nothing moved" oracle every negative case asserts against.
create or replace function pg_temp.execution_state(
  p_batch uuid, p_expense uuid, p_journal uuid, p_row uuid
) returns text language sql stable as $$
  select (select b.status from public.reconciliation_batches b where b.id = p_batch)
    || '|' || (select je.status from public.journal_entries je where je.id = p_journal)
    || '|' || (select e.payment_status from public.expenses e where e.id = p_expense)
    || '|' || coalesce(
                (select e.reversed_by_rollback_at::text from public.expenses e where e.id = p_expense),
                'unstamped')
    || '|' || coalesce(
                (select l.status from public.reconciliation_execution_ledger l
                  where l.executed_by_batch_row_id = p_row), 'none')
    || '|' || (select br.execution_result from public.reconciliation_batch_rows br where br.id = p_row);
$$;

-- (a) ADDITION fixture with its only link DELETED — a ledger claim with no action at all.
select pg_temp.make_batch('bf000000-0000-0000-0000-000000000001', 'approved');
select pg_temp.add_expense_row(
  'bf000000-0000-0000-0000-000000000001', 'bf100000-0000-0000-0000-000000000001',
  'bf200000-0000-0000-0000-000000000001', 'neg-missing-link', 41, current_date
);
select pg_temp.execute_as_owner('bf000000-0000-0000-0000-000000000001');
select set_config('t.n1_exp', (
  select al.target_id::text from public.reconciliation_action_links al
   where al.batch_id = 'bf000000-0000-0000-0000-000000000001' and al.action_kind = 'addition'
), false);
select set_config('t.n1_je', (
  select al.journal_entry_id::text from public.reconciliation_action_links al
   where al.batch_id = 'bf000000-0000-0000-0000-000000000001' and al.action_kind = 'addition'
), false);

-- The DELETE itself is refused, from the table-owner/superuser session this test runs in: the guard
-- lives in a trigger, so no privilege gets past it.
select throws_ok(
  $del$delete from public.reconciliation_action_links
        where batch_id = 'bf000000-0000-0000-0000-000000000001'$del$,
  '22023', 'reconciliation_action_links: rows are append-only and cannot be deleted',
  'an action link cannot be DELETED, even by the owner of the table'
);
-- Relabelling is refused for the same reason — this is the "quietly change what the execution did"
-- attack, and it never reaches the rollback at all.
select throws_ok(
  $upd$update public.reconciliation_action_links
          set action_kind = 'orphan_reversal'
        where batch_id = 'bf000000-0000-0000-0000-000000000001'$upd$,
  '22023', 'reconciliation_action_links: rows are append-only and cannot be updated',
  'an action link cannot be RELABELLED, even by the owner of the table'
);
-- A second link of the SAME kind on the same batch row is refused by the unique index.
select throws_ok(
  format(
    $dup$insert into public.reconciliation_action_links(
           org_id, batch_id, batch_row_id, action_kind, target_table, target_id, journal_entry_id
         ) values (%L, 'bf000000-0000-0000-0000-000000000001',
                   'bf200000-0000-0000-0000-000000000001', 'addition', 'expenses', %L, %L)$dup$,
    current_setting('t.org'), current_setting('t.n1_exp'), current_setting('t.n1_je')
  ),
  '23505',
  'duplicate key value violates unique constraint "reconciliation_action_links_row_kind_uq"',
  'a duplicate action link of the same kind on the same batch row is rejected by the unique index'
);

-- Now break it for real. The guards are silenced with `session_replication_role`, NOT with
-- `alter table ... disable trigger`: ALTER TABLE would hold ACCESS EXCLUSIVE on the table for the
-- rest of this file's transaction and deadlock the real-backend races in section 25.
set local session_replication_role = replica;
delete from public.reconciliation_action_links
 where batch_id = 'bf000000-0000-0000-0000-000000000001';
set local session_replication_role = origin;

select is(
  pg_temp.rollback_error('bf000000-0000-0000-0000-000000000001'),
  '23514|reconciliation rollback preflight: the action links for an executed batch row are not the exact bundle its frozen row and evidence require',
  'an executed ledger row with NO action link aborts the rollback before anything moves'
);
select is(
  pg_temp.execution_state(
    'bf000000-0000-0000-0000-000000000001', current_setting('t.n1_exp')::uuid,
    current_setting('t.n1_je')::uuid, 'bf200000-0000-0000-0000-000000000001'),
  'executed|posted|historical_treasury|unstamped|executed|posted',
  'the missing-link batch is left exactly as the execution left it — no money, no status, moved'
);

-- (b) ADDITION fixture with an EXTRA link of another kind bolted on.
select pg_temp.make_batch('bf000000-0000-0000-0000-000000000002', 'approved');
select pg_temp.add_expense_row(
  'bf000000-0000-0000-0000-000000000002', 'bf100000-0000-0000-0000-000000000002',
  'bf200000-0000-0000-0000-000000000002', 'neg-extra-link', 42, current_date
);
select pg_temp.execute_as_owner('bf000000-0000-0000-0000-000000000002');
select set_config('t.n2_exp', (
  select al.target_id::text from public.reconciliation_action_links al
   where al.batch_id = 'bf000000-0000-0000-0000-000000000002' and al.action_kind = 'addition'
), false);
select set_config('t.n2_je', (
  select al.journal_entry_id::text from public.reconciliation_action_links al
   where al.batch_id = 'bf000000-0000-0000-0000-000000000002' and al.action_kind = 'addition'
), false);
insert into public.reconciliation_action_links(
  org_id, batch_id, batch_row_id, action_kind, target_table, target_id, journal_entry_id
) values (
  current_setting('t.org')::uuid, 'bf000000-0000-0000-0000-000000000002',
  'bf200000-0000-0000-0000-000000000002', 'correction_reversal', 'expenses',
  current_setting('t.n2_exp')::uuid, current_setting('t.n2_je')::uuid
);
select is(
  pg_temp.rollback_error('bf000000-0000-0000-0000-000000000002'),
  '23514|reconciliation rollback preflight: the action links for an executed batch row are not the exact bundle its frozen row and evidence require',
  'an EXTRA action link a plain addition can never have justified aborts the rollback'
);
select is(
  pg_temp.execution_state(
    'bf000000-0000-0000-0000-000000000002', current_setting('t.n2_exp')::uuid,
    current_setting('t.n2_je')::uuid, 'bf200000-0000-0000-0000-000000000002'),
  'executed|posted|historical_treasury|unstamped|executed|posted',
  'the extra-link batch is left exactly as the execution left it'
);

-- (c) ADDITION fixture whose link is REPOINTED at a different, real, same-org row.
select pg_temp.make_batch('bf000000-0000-0000-0000-000000000003', 'approved');
select pg_temp.add_expense_row(
  'bf000000-0000-0000-0000-000000000003', 'bf100000-0000-0000-0000-000000000003',
  'bf200000-0000-0000-0000-000000000003', 'neg-wrong-row', 43, current_date
);
select pg_temp.execute_as_owner('bf000000-0000-0000-0000-000000000003');
select set_config('t.n3_exp', (
  select al.target_id::text from public.reconciliation_action_links al
   where al.batch_id = 'bf000000-0000-0000-0000-000000000003' and al.action_kind = 'addition'
), false);
select set_config('t.n3_je', (
  select al.journal_entry_id::text from public.reconciliation_action_links al
   where al.batch_id = 'bf000000-0000-0000-0000-000000000003' and al.action_kind = 'addition'
), false);
-- A real, posted, same-org historical expense that this batch did NOT create.
select pg_temp.make_historical_expense(
  'bf300000-0000-0000-0000-000000000003', 'bf400000-0000-0000-0000-000000000003',
  'bf500000-0000-0000-0000-000000000003', 'bf600000-0000-0000-0000-000000000003',
  77, current_date
);
set local session_replication_role = replica;
update public.reconciliation_action_links
   set target_id = 'bf300000-0000-0000-0000-000000000003'
 where batch_id = 'bf000000-0000-0000-0000-000000000003';
set local session_replication_role = origin;
select is(
  pg_temp.rollback_error('bf000000-0000-0000-0000-000000000003'),
  '23514|reconciliation rollback preflight: a created-expense link does not name this batch row''s own posted historical expense',
  'a link repointed at a real but unrelated same-org row aborts the rollback'
);
select is(
  pg_temp.execution_state(
    'bf000000-0000-0000-0000-000000000003', current_setting('t.n3_exp')::uuid,
    current_setting('t.n3_je')::uuid, 'bf200000-0000-0000-0000-000000000003'),
  'executed|posted|historical_treasury|unstamped|executed|posted',
  'the mis-targeted-link batch leaves the row it really created untouched'
);
select is(
  (select payment_status from public.expenses where id = 'bf300000-0000-0000-0000-000000000003'),
  'historical_treasury',
  'and the unrelated row the forged link pointed at is untouched too'
);

-- (d) ADDITION fixture whose ledger claim has been detached from the link.
select pg_temp.make_batch('bf000000-0000-0000-0000-000000000004', 'approved');
select pg_temp.add_expense_row(
  'bf000000-0000-0000-0000-000000000004', 'bf100000-0000-0000-0000-000000000004',
  'bf200000-0000-0000-0000-000000000004', 'neg-no-ledger', 44, current_date
);
select pg_temp.execute_as_owner('bf000000-0000-0000-0000-000000000004');
select set_config('t.n4_exp', (
  select al.target_id::text from public.reconciliation_action_links al
   where al.batch_id = 'bf000000-0000-0000-0000-000000000004' and al.action_kind = 'addition'
), false);
select set_config('t.n4_je', (
  select al.journal_entry_id::text from public.reconciliation_action_links al
   where al.batch_id = 'bf000000-0000-0000-0000-000000000004' and al.action_kind = 'addition'
), false);
update public.reconciliation_execution_ledger
   set status = 'reversed', reversed_at = now()
 where executed_by_batch_row_id = 'bf200000-0000-0000-0000-000000000004';
select is(
  pg_temp.rollback_error('bf000000-0000-0000-0000-000000000004'),
  '23514|reconciliation rollback preflight: an execution action link does not map to exactly one owned executed ledger row',
  'an action link whose owned executed ledger claim is gone aborts the rollback'
);
select is(
  pg_temp.execution_state(
    'bf000000-0000-0000-0000-000000000004', current_setting('t.n4_exp')::uuid,
    current_setting('t.n4_je')::uuid, 'bf200000-0000-0000-0000-000000000004'),
  'executed|posted|historical_treasury|unstamped|reversed|posted',
  'the detached-claim batch keeps its posted journal and historical row — nothing was undone'
);

-- (e) CORRECTION fixture (two links) with ONE of the pair deleted — the case where a partial undo
--     would leave a production journal reversed and never reinstated.
select pg_temp.make_historical_expense(
  'bf300000-0000-0000-0000-000000000005', 'bf400000-0000-0000-0000-000000000005',
  'bf500000-0000-0000-0000-000000000005', 'bf600000-0000-0000-0000-000000000005',
  120, current_date
);
select pg_temp.make_batch('bf000000-0000-0000-0000-000000000005', 'approved');
select pg_temp.add_expense_row(
  'bf000000-0000-0000-0000-000000000005', 'bf100000-0000-0000-0000-000000000005',
  'bf200000-0000-0000-0000-000000000005', 'neg-half-correction', 140, current_date,
  'bf300000-0000-0000-0000-000000000005'
);
select pg_temp.execute_as_owner('bf000000-0000-0000-0000-000000000005');
select set_config('t.n5_exp', (
  select al.target_id::text from public.reconciliation_action_links al
   where al.batch_id = 'bf000000-0000-0000-0000-000000000005'
     and al.action_kind = 'correction_replacement'
), false);
select set_config('t.n5_je', (
  select al.journal_entry_id::text from public.reconciliation_action_links al
   where al.batch_id = 'bf000000-0000-0000-0000-000000000005'
     and al.action_kind = 'correction_replacement'
), false);
select is(
  (select count(*)::int from public.reconciliation_action_links
    where batch_id = 'bf000000-0000-0000-0000-000000000005'),
  2, 'the correction fixture really executed the two-link bundle a positive correction requires'
);
set local session_replication_role = replica;
delete from public.reconciliation_action_links
 where batch_id = 'bf000000-0000-0000-0000-000000000005'
   and action_kind = 'correction_replacement';
set local session_replication_role = origin;
select is(
  pg_temp.rollback_error('bf000000-0000-0000-0000-000000000005'),
  '23514|reconciliation rollback preflight: the action links for an executed batch row are not the exact bundle its frozen row and evidence require',
  'half a correction bundle aborts the rollback — the replacement journal can never be silently left posted'
);
select is(
  pg_temp.execution_state(
    'bf000000-0000-0000-0000-000000000005', current_setting('t.n5_exp')::uuid,
    current_setting('t.n5_je')::uuid, 'bf200000-0000-0000-0000-000000000005'),
  'executed|posted|historical_treasury|unstamped|executed|reversed',
  'the half-correction batch keeps its replacement posted and its ledger claim held'
);
select is(
  (select payment_status from public.expenses where id = 'bf300000-0000-0000-0000-000000000005'),
  'historical_reversed',
  'and the corrected original stays reversed — the rollback did not half-reinstate it'
);

-- (f) The reinstatement kinds may never PRE-EXIST an untouched execution: only this rollback writes
--     them, and only once per batch.
select pg_temp.make_batch('bf000000-0000-0000-0000-000000000006', 'approved');
select pg_temp.add_expense_row(
  'bf000000-0000-0000-0000-000000000006', 'bf100000-0000-0000-0000-000000000006',
  'bf200000-0000-0000-0000-000000000006', 'neg-preexisting-reinstatement', 46, current_date
);
select pg_temp.execute_as_owner('bf000000-0000-0000-0000-000000000006');
select set_config('t.n6_exp', (
  select al.target_id::text from public.reconciliation_action_links al
   where al.batch_id = 'bf000000-0000-0000-0000-000000000006' and al.action_kind = 'addition'
), false);
select set_config('t.n6_je', (
  select al.journal_entry_id::text from public.reconciliation_action_links al
   where al.batch_id = 'bf000000-0000-0000-0000-000000000006' and al.action_kind = 'addition'
), false);
insert into public.reconciliation_action_links(
  org_id, batch_id, batch_row_id, action_kind, target_table, target_id,
  journal_entry_id, reinstates_journal_entry_id
) values (
  current_setting('t.org')::uuid, 'bf000000-0000-0000-0000-000000000006',
  'bf200000-0000-0000-0000-000000000006', 'correction_reversal_reinstatement', 'expenses',
  current_setting('t.n6_exp')::uuid, current_setting('t.n6_je')::uuid,
  current_setting('t.n6_je')::uuid
);
select is(
  pg_temp.rollback_error('bf000000-0000-0000-0000-000000000006'),
  '23514|reconciliation rollback preflight: a reinstatement action link already exists for this batch',
  'a pre-planted reinstatement link aborts the rollback before the batch status moves'
);
select is(
  pg_temp.execution_state(
    'bf000000-0000-0000-0000-000000000006', current_setting('t.n6_exp')::uuid,
    current_setting('t.n6_je')::uuid, 'bf200000-0000-0000-0000-000000000006'),
  'executed|posted|historical_treasury|unstamped|executed|posted',
  'the pre-planted-reinstatement batch is left exactly as the execution left it'
);

-- (g) A link that belongs to no batch row of this batch at all — the "detached link" shape the
--     reverse map exists to catch, built by moving the link onto ANOTHER batch's row.
select pg_temp.make_batch('bf000000-0000-0000-0000-000000000007', 'approved');
select pg_temp.add_expense_row(
  'bf000000-0000-0000-0000-000000000007', 'bf100000-0000-0000-0000-000000000007',
  'bf200000-0000-0000-0000-000000000007', 'neg-detached-link', 47, current_date
);
select pg_temp.execute_as_owner('bf000000-0000-0000-0000-000000000007');
select set_config('t.n7_exp', (
  select al.target_id::text from public.reconciliation_action_links al
   where al.batch_id = 'bf000000-0000-0000-0000-000000000007' and al.action_kind = 'addition'
), false);
select set_config('t.n7_je', (
  select al.journal_entry_id::text from public.reconciliation_action_links al
   where al.batch_id = 'bf000000-0000-0000-0000-000000000007' and al.action_kind = 'addition'
), false);
-- Both guards have to come off for this one: the tenant guard already refuses a batch_row_id that
-- belongs to another batch, and the append-only guard refuses the UPDATE outright. That belt and
-- braces is the production behaviour; the point here is that even if BOTH were somehow bypassed, the
-- rollback's own preflight still refuses to act on the result.
set local session_replication_role = replica;
update public.reconciliation_action_links
   set batch_row_id = 'bf200000-0000-0000-0000-000000000005'
 where batch_id = 'bf000000-0000-0000-0000-000000000007';
set local session_replication_role = origin;
select is(
  pg_temp.rollback_error('bf000000-0000-0000-0000-000000000007'),
  '23514|reconciliation rollback preflight: an execution action link does not map to exactly one owned executed ledger row',
  'a link detached onto another batch''s row aborts the rollback'
);
select is(
  pg_temp.execution_state(
    'bf000000-0000-0000-0000-000000000007', current_setting('t.n7_exp')::uuid,
    current_setting('t.n7_je')::uuid, 'bf200000-0000-0000-0000-000000000007'),
  'executed|posted|historical_treasury|unstamped|executed|posted',
  'the detached-link batch is left exactly as the execution left it'
);

-- (h) The positive control: an untampered addition batch rolls back cleanly through the very same
--     preflight, so none of the above is passing merely because the preflight refuses everything.
select pg_temp.make_batch('bf000000-0000-0000-0000-000000000008', 'approved');
select pg_temp.add_expense_row(
  'bf000000-0000-0000-0000-000000000008', 'bf100000-0000-0000-0000-000000000008',
  'bf200000-0000-0000-0000-000000000008', 'neg-control', 48, current_date
);
select pg_temp.execute_as_owner('bf000000-0000-0000-0000-000000000008');
select set_config('t.n8_exp', (
  select al.target_id::text from public.reconciliation_action_links al
   where al.batch_id = 'bf000000-0000-0000-0000-000000000008' and al.action_kind = 'addition'
), false);
select set_config('t.n8_je', (
  select al.journal_entry_id::text from public.reconciliation_action_links al
   where al.batch_id = 'bf000000-0000-0000-0000-000000000008' and al.action_kind = 'addition'
), false);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_rollback_reconciliation_batch(
    'bf000000-0000-0000-0000-000000000008', 'ضبط مرجعي'))->>'status',
  'rolled_back', 'an intact execution bundle still rolls back normally through the new preflight'
);
reset role;
select is(
  pg_temp.execution_state(
    'bf000000-0000-0000-0000-000000000008', current_setting('t.n8_exp')::uuid,
    current_setting('t.n8_je')::uuid, 'bf200000-0000-0000-0000-000000000008'),
  'rolled_back|reversed|historical_reversed|'
    || (select reversed_by_rollback_at::text from public.expenses
         where id = current_setting('t.n8_exp')::uuid)
    || '|reversed|reversed',
  'and the control batch really did undo everything the negatives proved it must not undo partially'
);

-- ── 24) THE PER-ORG ACCOUNTING-PERIOD MUTEX ───────────────────────────────────────────────────────
select ok(
  not has_function_privilege('authenticated',
    'private.fn_accounting_period_mutex_key(uuid)', 'execute'),
  'the period mutex key helper is private'
);
select is(
  private.fn_accounting_period_mutex_key(current_setting('t.org')::uuid),
  private.fn_accounting_period_mutex_key(current_setting('t.org')::uuid),
  'the mutex key is deterministic for one organization'
);
select isnt(
  private.fn_accounting_period_mutex_key(current_setting('t.org')::uuid),
  private.fn_accounting_period_mutex_key('00000000-0000-0000-0000-0000000000ff'::uuid),
  'the mutex key separates organizations, so one tenant''s close never blocks another''s posting'
);
-- The four re-emitted functions keep their exact client surface (the re-emit footgun: a re-emit that
-- silently changed a grant would be a privilege regression, not just a lock change).
select ok(
  has_function_privilege('authenticated',
    'public.fn_close_accounting_period(uuid, date, date, text)', 'execute')
  and has_function_privilege('authenticated',
    'public.fn_reopen_accounting_period(uuid, uuid)', 'execute'),
  're-emitting close/reopen preserved their authenticated EXECUTE grants'
);
select ok(
  not has_function_privilege('authenticated',
    'public.fn_post_two_line_journal(uuid, date, text, uuid, text, uuid, uuid, numeric, text, text, uuid, uuid, uuid, uuid)',
    'execute')
  and not has_function_privilege('authenticated',
    'private.fn_reverse_journal_entry_internal(uuid, text, date, boolean)', 'execute'),
  're-emitting the posting choke point and the private reversal preserved their revokes'
);
-- Behavioural re-emit proofs: the cost-center dimension and the source_sequence repost semantics the
-- CURRENT definitions carry must survive the re-emit. Both are asserted against real postings the
-- fixtures above produced, not against the function source.
select is(
  (select jl.cost_center_id
     from public.journal_lines jl
     join public.expenses e on e.id = jl.expense_id
    where jl.journal_entry_id = current_setting('t.n1_je')::uuid
      and jl.debit > 0),
  (select cost_center_id from public.expenses where id = current_setting('t.n1_exp')::uuid),
  're-emitted fn_post_two_line_journal still stamps the expense cost centre on the debit line'
);
select is(
  (select je.source_sequence from public.journal_entries je
    where je.id = current_setting('t.n1_je')::uuid),
  1, 're-emitted fn_post_two_line_journal still assigns source_sequence from max + 1'
);
select is(
  (select count(*)::int from public.journal_entries je
    where je.org_id = current_setting('t.org')::uuid
      and je.source_type = 'expense'
      and je.source_id = current_setting('t.n8_exp')::uuid),
  2, 're-emitted reversal still appends a second sequenced entry rather than editing the first'
);

-- ── 24b) MUTEX-FIRST IS A PROPERTY OF EVERY MONEY WRITER, INCLUDING THE EXECUTOR ──────────────────
-- §0's contract is "the money writers take the mutex BEFORE their own row locks". That is only true if
-- it holds for ALL of them: a writer that locks rows first and reaches the mutex later sits in the
-- share queue behind a pending close WHILE HOLDING ROWS, which is exactly the edge a three-party cycle
-- needs. `public.fn_execute_reconciliation_batch` was inherited from 20260726160000 §8 on the wrong
-- side of that line and is re-emitted by §0a; these are the structural pins that keep every writer on
-- the right side of it. The behavioural proof is §26, on three real backends.
-- These read the function's CODE, with every `--` comment stripped first. That stripping is not
-- cosmetic: each of these definitions carries a prose block that legitimately names both the mutex and
-- the `for update` it is ordered against, and comparing raw text would let the prose decide the answer
-- instead of the statements.
create or replace function pg_temp.function_code(p_schema text, p_name text)
returns text language sql as $$
  select string_agg(regexp_replace(l, '--.*$', ''), E'\n')
    from regexp_split_to_table(
      (select pg_get_functiondef(p.oid)
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = p_schema and p.proname = p_name), E'\n') as l
$$;
create or replace function pg_temp.mutex_before_first_row_lock(p_schema text, p_name text)
returns boolean language sql as $$
  select strpos(d, 'pg_advisory_xact_lock') > 0
     and strpos(d, 'for update') > 0
     and strpos(d, 'pg_advisory_xact_lock') < strpos(d, 'for update')
    from (select pg_temp.function_code(p_schema, p_name) as d) s
$$;
-- The org a lock key is derived from must be resolved THROUGH the caller's membership, otherwise an
-- authenticated caller can take (and time) another tenant's mutex with a uuid they merely guessed.
create or replace function pg_temp.membership_filter_before_mutex(p_schema text, p_name text)
returns boolean language sql as $$
  select strpos(d, 'user_org_ids') > 0
     and strpos(d, 'user_org_ids') < strpos(d, 'pg_advisory_xact_lock')
    from (select pg_temp.function_code(p_schema, p_name) as d) s
$$;
-- …and the ROW the reversal locks must be narrowed to that same membership-resolved org. Filtering
-- only the mutex read leaves the `for update` itself unfiltered, so a foreign uuid still queues on
-- another tenant's journal row before the membership check refuses it. The behavioural proof is §27b.
create or replace function pg_temp.org_scoped_first_row_lock(p_schema text, p_name text)
returns boolean language sql as $$
  select strpos(d, 'org_id = v_lock_org') > 0
     and strpos(d, 'for update') > 0
     and strpos(d, 'org_id = v_lock_org') < strpos(d, 'for update')
    from (select pg_temp.function_code(p_schema, p_name) as d) s
$$;
create or replace function pg_temp.execute_error(p_batch uuid)
returns text language plpgsql as $$
declare v_state text; v_msg text;
begin
  begin
    perform public.fn_execute_reconciliation_batch(p_batch);
    return 'no error';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    return v_state || '|' || v_msg;
  end;
end $$;
create or replace function pg_temp.reverse_error(p_entry uuid)
returns text language plpgsql as $$
declare v_state text; v_msg text;
begin
  begin
    perform public.fn_reverse_journal_entry(p_entry, 'سبب اختباري');
    return 'no error';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    return v_state || '|' || v_msg;
  end;
end $$;

select ok(
  has_function_privilege('authenticated', 'public.fn_execute_reconciliation_batch(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.fn_execute_reconciliation_batch(uuid)', 'execute'),
  're-emitting the EXECUTOR preserved its authenticated-only EXECUTE grant'
);
select ok(
  pg_temp.mutex_before_first_row_lock('public', 'fn_execute_reconciliation_batch'),
  'the executor takes the per-org period mutex BEFORE its first row lock'
);
select ok(
  pg_temp.membership_filter_before_mutex('public', 'fn_execute_reconciliation_batch'),
  'the executor resolves the org it locks through the caller''s membership, never from a bare uuid'
);
select ok(
  pg_temp.mutex_before_first_row_lock('private', 'fn_reverse_journal_entry_internal'),
  'the private reversal takes the mutex before it locks the journal row'
);
select ok(
  pg_temp.membership_filter_before_mutex('private', 'fn_reverse_journal_entry_internal'),
  'the private reversal resolves the journal''s org through membership before it computes a lock key'
);
select ok(
  pg_temp.org_scoped_first_row_lock('private', 'fn_reverse_journal_entry_internal'),
  'the private reversal locks the journal row only within the membership-approved org'
);
select ok(
  pg_temp.mutex_before_first_row_lock('public', 'fn_rollback_reconciliation_batch'),
  'the rollback still takes the mutex before its own lock ladder'
);

-- The redaction contract is unchanged by the resolving reads either side of the mutex: a batch that
-- does not exist and a batch that belongs to someone else remain byte-identical refusals.
select pg_temp.as_user(current_setting('t.owner'));
select is(
  pg_temp.execute_error('ffffffff-ffff-ffff-ffff-fffffffffffe'),
  'P0002|reconciliation batch not found',
  'the executor''s membership-filtered resolution still redacts a uuid that exists nowhere'
);
select is(
  pg_temp.execute_error('b0000000-0000-0000-0000-0000000000a1'),
  'P0002|reconciliation batch not found',
  'and redacts another tenant''s real batch to exactly the same refusal'
);
select is(
  pg_temp.execute_error('b0000000-0000-0000-0000-0000000000a1'),
  pg_temp.execute_error('ffffffff-ffff-ffff-ffff-fffffffffffe'),
  'the executor''s two responses are byte-identical, so the new read leaks no existence oracle'
);
reset role;

-- Same for the public reversal: a missing entry is P0002, a foreign one is 42501 — the pre-existing
-- contract, preserved exactly, with the mutex now on the safe side of it.
insert into public.journal_entries(
  id, org_id, entry_date, source_type, source_id, source_sequence, description, status)
values (
  'e0000000-0000-0000-0000-0000000000a1', '0c000000-0000-0000-0000-000000000001', current_date,
  'expense', 'e1000000-0000-0000-0000-0000000000a1', 1, 'قيد منظمة أخرى', 'posted');
select pg_temp.as_user(current_setting('t.owner'));
select is(
  pg_temp.reverse_error('ffffffff-ffff-ffff-ffff-fffffffffffd'),
  'P0002|journal entry ffffffff-ffff-ffff-ffff-fffffffffffd not found',
  'a journal uuid that exists nowhere still raises the same P0002'
);
select is(
  pg_temp.reverse_error('e0000000-0000-0000-0000-0000000000a1'),
  '42501|forbidden: cross-org journal reversal',
  'another tenant''s journal still raises the same 42501 — and now without taking their mutex first'
);
reset role;

-- ── 25) TWO REAL BACKENDS: the mutex is exercised, not inspected ──────────────────────────────────
-- Everything above runs in one session, where a lock can only ever be read off a function definition.
-- These three races run on genuine concurrent backends through dblink and assert the WAIT itself out
-- of pg_locks, so "the shared lock blocks a close" is observed rather than asserted from source.
--
--   race 1  rollback vs rollback — two backends undo the SAME batch; the loser blocks on the batch
--           row and, when it proceeds, finds the terminal state and writes nothing.
--   race 2  rollback (SHARED) blocks a concurrent period close until the rollback commits — and the
--           close then observes a consistent, fully-undone batch.
--   race 3  period close (EXCLUSIVE) blocks a concurrent rollback; once the close commits, the
--           rollback proceeds and fails closed with 55000 instead of posting into a closed period.
--
-- Everything these backends write is COMMITTED, so it survives this file's outer rollback and is torn
-- down explicitly at the end (and the teardown is itself asserted).
create extension if not exists dblink;

-- Wait for a backend to be blocked on the batch row itself, not merely on "some lock": while a
-- backend waits for a row locked by another transaction it holds a heavyweight `tuple` lock on that
-- exact ctid. Bounded at 10 seconds so a race that never blocks fails loudly instead of hanging.
create or replace function pg_temp.wait_for_batch_row_lock(p_pid integer, p_batch uuid)
returns boolean language plpgsql as $$
declare v_ctid tid;
begin
  select b.ctid into v_ctid from public.reconciliation_batches b where b.id = p_batch;
  if v_ctid is null then
    return false;
  end if;
  for attempt in 1..1000 loop
    -- pg_stat_activity is snapshot-CACHED for the whole transaction (stats_fetch_consistency), and
    -- this file's transaction is long-lived, so without an explicit clear every later poll would
    -- re-read a snapshot taken before these backends even existed.
    perform pg_stat_clear_snapshot();
    if exists (
      select 1
        from pg_stat_activity sa
        join pg_locks l on l.pid = sa.pid
       where sa.pid = p_pid
         and sa.wait_event_type = 'Lock'
         and l.locktype = 'tuple'
         and l.relation = 'public.reconciliation_batches'::regclass
         and l.page = (v_ctid::text::point)[0]::integer
         and l.tuple = (v_ctid::text::point)[1]::smallint
    ) then
      return true;
    end if;
    perform pg_sleep(0.01);
  end loop;
  return false;
end $$;

-- Wait for a backend to be blocked on THIS ORGANIZATION'S period mutex specifically: the advisory
-- lock's (classid, objid) pair is the 64-bit key split in half, so matching both proves it is our key
-- and not some other advisory-lock user in the same cluster.
create or replace function pg_temp.wait_for_period_mutex(p_pid integer, p_org uuid)
returns boolean language plpgsql as $$
declare
  v_key     bigint := private.fn_accounting_period_mutex_key(p_org);
  v_classid oid    := (((private.fn_accounting_period_mutex_key(p_org)) >> 32) & 4294967295)::oid;
  v_objid   oid    := ((private.fn_accounting_period_mutex_key(p_org)) & 4294967295)::oid;
begin
  if v_key is null then
    return false;
  end if;
  for attempt in 1..1000 loop
    -- see wait_for_batch_row_lock: the per-transaction stats snapshot must be cleared each poll.
    perform pg_stat_clear_snapshot();
    if exists (
      select 1
        from pg_stat_activity sa
        join pg_locks l on l.pid = sa.pid
       where sa.pid = p_pid
         and sa.wait_event_type = 'Lock'
         and l.locktype = 'advisory'
         and not l.granted
         and l.classid = v_classid
         and l.objid = v_objid
         and l.objsubid = 1
    ) then
      return true;
    end if;
    perform pg_sleep(0.01);
  end loop;
  -- Diagnose rather than merely fail: on timeout, report what the backend WAS doing, so a future
  -- change to the lock contract is attributable instead of just red.
  raise warning 'period mutex wait timed out for pid % (key %/%): %',
    p_pid, v_classid, v_objid,
    (select coalesce(string_agg(format('[%s %s/%s/%s granted=%s wait=%s state=%s]',
              l.locktype, l.classid, l.objid, l.objsubid, l.granted,
              coalesce(sa.wait_event_type, '-'), coalesce(sa.state, '-')), ' '), 'no locks')
       from pg_locks l left join pg_stat_activity sa on sa.pid = l.pid
      where l.pid = p_pid);
  return false;
end $$;

select set_config('t.dsn', format(
  'host=%s port=%s dbname=%s user=%s',
  (select setting from pg_settings where name = 'unix_socket_directories'),
  (select setting from pg_settings where name = 'port'),
  current_database(), current_user
), false);
select set_config('t.raceorg', 'd0000000-0000-0000-0000-000000000001', false);

select dblink_connect('mutex_setup', current_setting('t.dsn'));
select dblink_exec(
  'mutex_setup',
  $$insert into public.organization(id, name)
    values ('d0000000-0000-0000-0000-000000000001', 'rollback mutex race org')$$
);
select dblink_exec(
  'mutex_setup',
  format(
    $fx$insert into public.organization_member(org_id, user_id, role)
        values ('d0000000-0000-0000-0000-000000000001', %L::uuid, 'owner')$fx$,
    current_setting('t.owner')
  )
);
select dblink_exec(
  'mutex_setup',
  format(
    $fx$insert into public.reconciliation_batches(
          id, org_id, source_workbook_sha256, source_label, status,
          created_by, approved_by, approved_at
        )
        select b.id, 'd0000000-0000-0000-0000-000000000001', %L, b.label, 'approved',
               %L::uuid, %L::uuid, now()
          from (values
            ('d0000000-0000-0000-0000-000000000011'::uuid, 'mutex race — rollback vs rollback'),
            ('d0000000-0000-0000-0000-000000000012'::uuid, 'mutex race — rollback blocks close'),
            ('d0000000-0000-0000-0000-000000000013'::uuid, 'mutex race — close blocks rollback')
          ) as b(id, label)$fx$,
    repeat('d', 64), current_setting('t.owner'), current_setting('t.owner')
  )
);
select dblink_exec(
  'mutex_setup',
  format(
    $fx$insert into public.reconciliation_evidence_items(
          id, org_id, origin_kind, source_workbook_sha256, sheet_name,
          row_locator, source_identity_fingerprint, source_amount,
          source_date_text, source_date_parsed, classification,
          invalid_calendar_quality_flag, first_staged_batch_id, evidence_label
        )
        select e.id, 'd0000000-0000-0000-0000-000000000001', 'source_workbook_row', %L,
               'mutex race', e.locator, e.locator, e.amount,
               current_date::text, current_date, 'source_addition_candidate',
               false, e.batch_id, 'mutex race evidence'
          from (values
            ('d1000000-0000-0000-0000-000000000011'::uuid, 'mutex-race-1', 61::numeric,
             'd0000000-0000-0000-0000-000000000011'::uuid),
            ('d1000000-0000-0000-0000-000000000012'::uuid, 'mutex-race-2', 62::numeric,
             'd0000000-0000-0000-0000-000000000012'::uuid),
            ('d1000000-0000-0000-0000-000000000013'::uuid, 'mutex-race-3', 63::numeric,
             'd0000000-0000-0000-0000-000000000013'::uuid)
          ) as e(id, locator, amount, batch_id)$fx$,
    repeat('d', 64)
  )
);
select dblink_exec(
  'mutex_setup',
  format(
    $fx$insert into public.reconciliation_batch_rows(
          id, org_id, batch_id, evidence_item_id, review_state, reviewer_id,
          review_reason, reviewed_at, target_table, disposition,
          expense_category, expense_description, expense_kind,
          expense_account_id, expense_cost_center_id, expense_payment_decision
        )
        select r.id, 'd0000000-0000-0000-0000-000000000001', r.batch_id, r.evidence_id,
               'reviewed', %L::uuid, 'mutex race review', now(), 'expenses', 'include',
               'mutex race', 'mutex race', 'operating',
               (select a.id from public.accounts a
                 where a.org_id = 'd0000000-0000-0000-0000-000000000001'
                   and a.active and a.kind = 'operating'
                   and not exists (
                     select 1 from public.accounts child
                      where child.org_id = a.org_id and child.parent_id = a.id and child.active
                   )
                 order by a.code limit 1),
               (select cc.id from public.cost_centers cc
                 where cc.org_id = 'd0000000-0000-0000-0000-000000000001' and cc.active
                 order by cc.code limit 1),
               'routed_now'
          from (values
            ('d2000000-0000-0000-0000-000000000011'::uuid,
             'd0000000-0000-0000-0000-000000000011'::uuid,
             'd1000000-0000-0000-0000-000000000011'::uuid),
            ('d2000000-0000-0000-0000-000000000012'::uuid,
             'd0000000-0000-0000-0000-000000000012'::uuid,
             'd1000000-0000-0000-0000-000000000012'::uuid),
            ('d2000000-0000-0000-0000-000000000013'::uuid,
             'd0000000-0000-0000-0000-000000000013'::uuid,
             'd1000000-0000-0000-0000-000000000013'::uuid)
          ) as r(id, batch_id, evidence_id);
        update public.reconciliation_batch_rows br
           set payload_hash = private.fn_reconciliation_execution_payload_hash(br),
               frozen = true, frozen_at = now(), review_state = 'frozen'
         where br.org_id = 'd0000000-0000-0000-0000-000000000001'$fx$,
    current_setting('t.owner')
  )
);
select dblink_exec(
  'mutex_setup',
  format('set request.jwt.claims = %L',
    json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text)
);
select dblink_exec('mutex_setup', 'set role authenticated');
select is(
  (select r->>'status' from dblink('mutex_setup',
    $$select public.fn_execute_reconciliation_batch('d0000000-0000-0000-0000-000000000011')$$
  ) as t(r jsonb)),
  'executed', 'mutex race fixture batch 1 executes on a committed side connection'
);
select is(
  (select r->>'status' from dblink('mutex_setup',
    $$select public.fn_execute_reconciliation_batch('d0000000-0000-0000-0000-000000000012')$$
  ) as t(r jsonb)),
  'executed', 'mutex race fixture batch 2 executes on a committed side connection'
);
select is(
  (select r->>'status' from dblink('mutex_setup',
    $$select public.fn_execute_reconciliation_batch('d0000000-0000-0000-0000-000000000013')$$
  ) as t(r jsonb)),
  'executed', 'mutex race fixture batch 3 executes on a committed side connection'
);
select dblink_disconnect('mutex_setup');

-- ── race 1: rollback vs rollback ──────────────────────────────────────────────────────────────────
select dblink_connect('mutex_a1', current_setting('t.dsn'));
select dblink_connect('mutex_b1', current_setting('t.dsn'));
select dblink_exec('mutex_a1', format('set request.jwt.claims = %L',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text));
select dblink_exec('mutex_a1', 'set role authenticated');
select dblink_exec('mutex_b1', format('set request.jwt.claims = %L',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text));
select dblink_exec('mutex_b1', 'set role authenticated');
select set_config('t.pid_b1', (
  select pid::text from dblink('mutex_b1', 'select pg_backend_pid()') as backend(pid integer)
), false);

select dblink_exec('mutex_a1', 'begin');
select is(
  (select r->>'status' from dblink('mutex_a1',
    $$select public.fn_rollback_reconciliation_batch(
        'd0000000-0000-0000-0000-000000000011', 'سباق التراجع')$$
  ) as t(r jsonb)),
  'rolled_back', 'race 1 backend A rolls the batch back while holding its transaction open'
);
select is(
  dblink_send_query('mutex_b1',
    $$select public.fn_rollback_reconciliation_batch(
        'd0000000-0000-0000-0000-000000000011', 'سباق التراجع الثاني')$$),
  1, 'race 1 backend B dispatches a concurrent rollback of the SAME batch'
);
select ok(
  pg_temp.wait_for_batch_row_lock(
    current_setting('t.pid_b1')::integer, 'd0000000-0000-0000-0000-000000000011'),
  'race 1 backend B blocks on the batch row itself — two rollbacks really serialize'
);
select dblink_exec('mutex_a1', 'commit');
do $$
declare v_result jsonb;
begin
  select r into v_result from dblink_get_result('mutex_b1') as t(r jsonb);
  perform set_config('t.race1', coalesce(v_result::text, '{"status":"missing"}'), false);
  begin
    perform * from dblink_get_result('mutex_b1') as drained(r jsonb);
  exception when others then null;
  end;
end $$;
select is(
  current_setting('t.race1')::jsonb->>'status',
  'rolled_back', 'race 1 backend B finds the terminal state once backend A commits'
);
select is(
  current_setting('t.race1')::jsonb->>'idempotent',
  'true', 'race 1 backend B writes NOTHING — it returns the idempotent repeat'
);
select is(
  (select count(*)::int from public.journal_entries reversal
     join public.reconciliation_action_links al on al.journal_entry_id = reversal.reversal_of
    where al.batch_id = 'd0000000-0000-0000-0000-000000000011'
      and al.action_kind = 'addition'),
  1, 'race 1 leaves exactly ONE reversing entry — the double rollback did not double-reverse'
);
select is(
  (select l.status from public.reconciliation_execution_ledger l
    where l.executed_by_batch_row_id = 'd2000000-0000-0000-0000-000000000011'),
  'reversed', 'race 1 releases the evidence claim exactly once'
);
select dblink_disconnect('mutex_a1');
select dblink_disconnect('mutex_b1');

-- ── race 2: a rollback's SHARED mutex blocks a concurrent period close ─────────────────────────────
select dblink_connect('mutex_a2', current_setting('t.dsn'));
select dblink_connect('mutex_b2', current_setting('t.dsn'));
select dblink_exec('mutex_a2', format('set request.jwt.claims = %L',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text));
select dblink_exec('mutex_a2', 'set role authenticated');
select dblink_exec('mutex_b2', format('set request.jwt.claims = %L',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text));
select dblink_exec('mutex_b2', 'set role authenticated');
select set_config('t.pid_b2', (
  select pid::text from dblink('mutex_b2', 'select pg_backend_pid()') as backend(pid integer)
), false);

select dblink_exec('mutex_a2', 'begin');
select is(
  (select r->>'status' from dblink('mutex_a2',
    $$select public.fn_rollback_reconciliation_batch(
        'd0000000-0000-0000-0000-000000000012', 'تراجع يحجب الإقفال')$$
  ) as t(r jsonb)),
  'rolled_back', 'race 2 backend A rolls back and keeps its transaction (and its SHARED mutex) open'
);
-- A period that does NOT contain the rollback's own dates, so the ONLY thing that can make this close
-- wait is the mutex itself.
select is(
  dblink_send_query('mutex_b2',
    $$select public.fn_close_accounting_period(
        'd0000000-0000-0000-0000-000000000001', date '2019-01-01', date '2019-12-31',
        'إقفال متزامن')$$),
  1, 'race 2 backend B dispatches a concurrent period close'
);
select ok(
  pg_temp.wait_for_period_mutex(
    current_setting('t.pid_b2')::integer, 'd0000000-0000-0000-0000-000000000001'),
  'race 2 backend B blocks on THIS org''s period mutex — the close cannot commit mid-rollback'
);
select dblink_exec('mutex_a2', 'commit');
do $$
declare v_id uuid;
begin
  select r into v_id from dblink_get_result('mutex_b2') as t(r uuid);
  perform set_config('t.race2', coalesce(v_id::text, 'none'), false);
  begin
    perform * from dblink_get_result('mutex_b2') as drained(r uuid);
  exception when others then null;
  end;
end $$;
select isnt(
  current_setting('t.race2'), 'none',
  'race 2 backend B completes its close as soon as the rollback commits'
);
-- "Observes state consistently": the close and the FULLY undone batch coexist. Backend B could not
-- have seen a batch that was half rolled back, because it never ran while the rollback was open.
select is(
  (select b.status from public.reconciliation_batches b
    where b.id = 'd0000000-0000-0000-0000-000000000012')
  || '|' || (select je.status from public.journal_entries je
              join public.reconciliation_action_links al on al.journal_entry_id = je.id
             where al.batch_id = 'd0000000-0000-0000-0000-000000000012'
               and al.action_kind = 'addition')
  || '|' || (select l.status from public.reconciliation_execution_ledger l
              where l.executed_by_batch_row_id = 'd2000000-0000-0000-0000-000000000012'),
  'rolled_back|reversed|reversed',
  'race 2 leaves a WHOLE rollback, not a sliced one, visible to the close that waited for it'
);
select is(
  (select p.status from public.accounting_periods p
    where p.id = current_setting('t.race2')::uuid),
  'locked', 'race 2 really did close the period once it was allowed to'
);
select dblink_disconnect('mutex_a2');
select dblink_disconnect('mutex_b2');

-- ── race 3: a period close's EXCLUSIVE mutex blocks a concurrent rollback, which then fails 55000 ──
select dblink_connect('mutex_a3', current_setting('t.dsn'));
select dblink_connect('mutex_b3', current_setting('t.dsn'));
select dblink_exec('mutex_a3', format('set request.jwt.claims = %L',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text));
select dblink_exec('mutex_a3', 'set role authenticated');
select dblink_exec('mutex_b3', format('set request.jwt.claims = %L',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text));
select dblink_exec('mutex_b3', 'set role authenticated');
select set_config('t.pid_b3', (
  select pid::text from dblink('mutex_b3', 'select pg_backend_pid()') as backend(pid integer)
), false);

select dblink_exec('mutex_a3', 'begin');
select isnt(
  (select r::text from dblink('mutex_a3', format(
    $fx$select public.fn_close_accounting_period(
        'd0000000-0000-0000-0000-000000000001', %L::date, %L::date, 'إقفال يحجب التراجع')$fx$,
    current_date - 5, current_date
  )) as t(r uuid)),
  null, 'race 3 backend A closes the batch''s own period and keeps its transaction open'
);
select is(
  dblink_send_query('mutex_b3',
    $$select public.fn_rollback_reconciliation_batch(
        'd0000000-0000-0000-0000-000000000013', 'تراجع محجوب بالإقفال')$$),
  1, 'race 3 backend B dispatches a concurrent rollback'
);
select ok(
  pg_temp.wait_for_period_mutex(
    current_setting('t.pid_b3')::integer, 'd0000000-0000-0000-0000-000000000001'),
  'race 3 backend B blocks on the close''s EXCLUSIVE period mutex before it can touch any money'
);
select dblink_exec('mutex_a3', 'commit');
do $$
declare v_state text;
begin
  begin
    perform * from dblink_get_result('mutex_b3') as t(r jsonb);
    perform set_config('t.race3', 'no error', false);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    perform set_config('t.race3', v_state, false);
  end;
  begin
    perform * from dblink_get_result('mutex_b3') as drained(r jsonb);
  exception when others then null;
  end;
end $$;
select is(
  current_setting('t.race3'), '55000',
  'race 3 backend B fails CLOSED once the close commits — it never posts into the closed period'
);
select is(
  (select b.status from public.reconciliation_batches b
    where b.id = 'd0000000-0000-0000-0000-000000000013'),
  'executed', 'race 3 leaves the blocked batch exactly `executed`, ready for the owner to retry'
);
select is(
  (select je.status from public.journal_entries je
     join public.reconciliation_action_links al on al.journal_entry_id = je.id
    where al.batch_id = 'd0000000-0000-0000-0000-000000000013'
      and al.action_kind = 'addition'),
  'posted', 'race 3 undid nothing at all — the created journal is still posted'
);
select dblink_disconnect('mutex_a3');
select dblink_disconnect('mutex_b3');

-- ── 26) THREE REAL BACKENDS: executor + rollback + period close cannot form the prior cycle ───────
--
-- THE CYCLE THIS PINS SHUT. Before §0a, `public.fn_execute_reconciliation_batch` locked its batch row,
-- its batch rows, cash 1010 and its domain/journal rows FIRST and only reached the per-org period mutex
-- much later, indirectly, inside the posting/reversal helpers. Postgres queues a later SHARE request
-- behind an already-pending EXCLUSIVE one (writer anti-starvation), so three ordinary transactions on
-- ONE organization closed a ring:
--
--   rollback  holds SHARE (it takes the mutex first) and holds/needs a row the executor has
--   close     wants EXCLUSIVE, queued behind that SHARE
--   executor  HOLDS a row the rollback wants, then asks for SHARE — queued behind the close
--
-- The third line is the whole defect: it is only reachable if the executor can be in the mutex queue
-- WHILE HOLDING ROW LOCKS. §0a makes that state unrepresentable by moving the acquisition ahead of the
-- first `for update`, and this race observes exactly that on three genuine backends: the executor is
-- caught in the mutex queue and is then shown to hold no row lock at all and to be waiting for nothing
-- else. With no row-lock edge out of the executor, the ring has no third side and cannot close.
--
-- Every backend carries a bounded `lock_timeout`/`statement_timeout`, so a regression to the old order
-- surfaces as a loud 40P01 (the deadlock detector) or a 55P03/57014 timeout — never as a hung harness.
-- Everything these backends write is COMMITTED and is torn down with the other race fixtures below.
select set_config('t.cycleorg', 'd0000000-0000-0000-0000-000000000003', false);

-- Every heavyweight lock a backend HOLDS on a money or reconciliation table in a mode stronger than a
-- plain read. AccessShareLock is deliberately excluded: it conflicts with nothing a rollback or a close
-- takes, so it can never be an edge in a wait cycle. Anything else IS such an edge.
create or replace function pg_temp.row_locks_held(p_pid integer)
returns text language sql as $$
  select coalesce(string_agg(distinct format('%s/%s', l.relation::regclass::text, l.mode), ', '), '')
    from pg_locks l
   where l.pid = p_pid
     and l.granted
     and l.locktype = 'relation'
     and l.mode <> 'AccessShareLock'
     and l.relation in (
       'public.reconciliation_batches'::regclass,
       'public.reconciliation_batch_rows'::regclass,
       'public.reconciliation_execution_ledger'::regclass,
       'public.reconciliation_action_links'::regclass,
       'public.accounts'::regclass,
       'public.journal_entries'::regclass,
       'public.journal_lines'::regclass,
       'public.expenses'::regclass,
       'public.sales'::regclass)
$$;
-- Anything the backend is WAITING for that is not an advisory lock — i.e. a row or table lock. Under
-- the old order the executor would be waiting on a `tuple` lock here; under the fixed one it waits on
-- the mutex and nothing else.
create or replace function pg_temp.non_advisory_waits(p_pid integer)
returns integer language sql as $$
  select count(*)::integer from pg_locks l
   where l.pid = p_pid and not l.granted and l.locktype <> 'advisory'
$$;
create or replace function pg_temp.is_lock_blocked(p_pid integer)
returns boolean language sql as $$
  select exists (select 1 from pg_locks l where l.pid = p_pid and not l.granted)
$$;

select dblink_connect('cycle_setup', current_setting('t.dsn'));
select dblink_exec(
  'cycle_setup',
  $$insert into public.organization(id, name)
    values ('d0000000-0000-0000-0000-000000000003', 'rollback lock-cycle race org')$$
);
select dblink_exec(
  'cycle_setup',
  format(
    $fx$insert into public.organization_member(org_id, user_id, role)
        values ('d0000000-0000-0000-0000-000000000003', %L::uuid, 'owner')$fx$,
    current_setting('t.owner')
  )
);
select dblink_exec(
  'cycle_setup',
  format(
    $fx$insert into public.reconciliation_batches(
          id, org_id, source_workbook_sha256, source_label, status,
          created_by, approved_by, approved_at
        )
        select b.id, 'd0000000-0000-0000-0000-000000000003', %L, b.label, 'approved',
               %L::uuid, %L::uuid, now()
          from (values
            ('d0000000-0000-0000-0000-000000000031'::uuid, 'lock-cycle race — rolled back'),
            ('d0000000-0000-0000-0000-000000000032'::uuid, 'lock-cycle race — executed under contention')
          ) as b(id, label)$fx$,
    repeat('e', 64), current_setting('t.owner'), current_setting('t.owner')
  )
);
select dblink_exec(
  'cycle_setup',
  format(
    $fx$insert into public.reconciliation_evidence_items(
          id, org_id, origin_kind, source_workbook_sha256, sheet_name,
          row_locator, source_identity_fingerprint, source_amount,
          source_date_text, source_date_parsed, classification,
          invalid_calendar_quality_flag, first_staged_batch_id, evidence_label
        )
        select e.id, 'd0000000-0000-0000-0000-000000000003', 'source_workbook_row', %L,
               'lock cycle race', e.locator, e.locator, e.amount,
               current_date::text, current_date, 'source_addition_candidate',
               false, e.batch_id, 'lock cycle race evidence'
          from (values
            ('d1000000-0000-0000-0000-000000000031'::uuid, 'cycle-race-1', 71::numeric,
             'd0000000-0000-0000-0000-000000000031'::uuid),
            ('d1000000-0000-0000-0000-000000000032'::uuid, 'cycle-race-2', 72::numeric,
             'd0000000-0000-0000-0000-000000000032'::uuid)
          ) as e(id, locator, amount, batch_id)$fx$,
    repeat('e', 64)
  )
);
select dblink_exec(
  'cycle_setup',
  format(
    $fx$insert into public.reconciliation_batch_rows(
          id, org_id, batch_id, evidence_item_id, review_state, reviewer_id,
          review_reason, reviewed_at, target_table, disposition,
          expense_category, expense_description, expense_kind,
          expense_account_id, expense_payment_decision
        )
        select r.id, 'd0000000-0000-0000-0000-000000000003', r.batch_id, r.evidence_id,
               'reviewed', %L::uuid, 'lock cycle race review', now(), 'expenses', 'include',
               'lock cycle race', 'lock cycle race', 'operating',
               (select a.id from public.accounts a
                 where a.org_id = 'd0000000-0000-0000-0000-000000000003'
                   and a.active and a.kind = 'operating'
                   and not exists (
                     select 1 from public.accounts child
                      where child.org_id = a.org_id and child.parent_id = a.id and child.active
                   )
                 order by a.code limit 1),
               'routed_now'
          from (values
            ('d2000000-0000-0000-0000-000000000031'::uuid,
             'd0000000-0000-0000-0000-000000000031'::uuid,
             'd1000000-0000-0000-0000-000000000031'::uuid),
            ('d2000000-0000-0000-0000-000000000032'::uuid,
             'd0000000-0000-0000-0000-000000000032'::uuid,
             'd1000000-0000-0000-0000-000000000032'::uuid)
          ) as r(id, batch_id, evidence_id);
        update public.reconciliation_batch_rows br
           set payload_hash = private.fn_reconciliation_execution_payload_hash(br),
               frozen = true, frozen_at = now(), review_state = 'frozen'
         where br.org_id = 'd0000000-0000-0000-0000-000000000003'$fx$,
    current_setting('t.owner')
  )
);
select dblink_exec(
  'cycle_setup',
  format('set request.jwt.claims = %L',
    json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text)
);
select dblink_exec('cycle_setup', 'set role authenticated');
-- Batch 31 is executed so it can be ROLLED BACK in the race; batch 32 stays `approved` so it is the
-- one the executor runs while the close is queued.
select is(
  (select r->>'status' from dblink('cycle_setup',
    $$select public.fn_execute_reconciliation_batch('d0000000-0000-0000-0000-000000000031')$$
  ) as t(r jsonb)),
  'executed', 'lock-cycle fixture: batch 31 executes on a committed side connection'
);
select dblink_disconnect('cycle_setup');

select dblink_connect('cycle_rollback', current_setting('t.dsn'));
select dblink_connect('cycle_close', current_setting('t.dsn'));
select dblink_connect('cycle_execute', current_setting('t.dsn'));
select dblink_exec('cycle_rollback', format('set request.jwt.claims = %L',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text));
select dblink_exec('cycle_close', format('set request.jwt.claims = %L',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text));
select dblink_exec('cycle_execute', format('set request.jwt.claims = %L',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text));
select dblink_exec('cycle_rollback', $$set lock_timeout = '45s'$$);
select dblink_exec('cycle_close', $$set lock_timeout = '45s'$$);
select dblink_exec('cycle_execute', $$set lock_timeout = '45s'$$);
select dblink_exec('cycle_rollback', $$set statement_timeout = '90s'$$);
select dblink_exec('cycle_close', $$set statement_timeout = '90s'$$);
select dblink_exec('cycle_execute', $$set statement_timeout = '90s'$$);
select dblink_exec('cycle_rollback', 'set role authenticated');
select dblink_exec('cycle_close', 'set role authenticated');
select dblink_exec('cycle_execute', 'set role authenticated');
select set_config('t.pid_cycle_r', (
  select pid::text from dblink('cycle_rollback', 'select pg_backend_pid()') as backend(pid integer)
), false);
select set_config('t.pid_cycle_c', (
  select pid::text from dblink('cycle_close', 'select pg_backend_pid()') as backend(pid integer)
), false);
select set_config('t.pid_cycle_e', (
  select pid::text from dblink('cycle_execute', 'select pg_backend_pid()') as backend(pid integer)
), false);

-- 1. the ROLLBACK takes the SHARED mutex and the whole row ladder, and keeps its transaction open.
select dblink_exec('cycle_rollback', 'begin');
select is(
  (select r->>'status' from dblink('cycle_rollback',
    $$select public.fn_rollback_reconciliation_batch(
        'd0000000-0000-0000-0000-000000000031', 'حلقة الأقفال')$$
  ) as t(r jsonb)),
  'rolled_back',
  'cycle race: the rollback holds the SHARED mutex and its full row ladder open'
);
-- 2. the CLOSE asks for the EXCLUSIVE mutex and queues behind that share. A period that contains none
--    of the batch dates, so the ONLY thing that can make it wait is the mutex.
select is(
  dblink_send_query('cycle_close',
    $$select public.fn_close_accounting_period(
        'd0000000-0000-0000-0000-000000000003', date '2017-01-01', date '2017-12-31',
        'إقفال في حلقة الأقفال')$$),
  1, 'cycle race: the period close is dispatched'
);
select ok(
  pg_temp.wait_for_period_mutex(
    current_setting('t.pid_cycle_c')::integer, current_setting('t.cycleorg')::uuid),
  'cycle race: the close is queued for the EXCLUSIVE mutex behind the rollback''s SHARE'
);
-- 3. the EXECUTOR now runs a DIFFERENT approved batch in the SAME org — the third party.
select is(
  dblink_send_query('cycle_execute',
    $$select public.fn_execute_reconciliation_batch('d0000000-0000-0000-0000-000000000032')$$),
  1, 'cycle race: an execution of a second approved batch in the same org is dispatched'
);
select ok(
  pg_temp.wait_for_period_mutex(
    current_setting('t.pid_cycle_e')::integer, current_setting('t.cycleorg')::uuid),
  'cycle race: the executor queues on the SAME mutex — it asks for the lock before touching a row'
);
-- 4. THE REGRESSION ASSERTIONS. While queued behind the pending exclusive request, the executor holds
--    no lock anything else can wait on, and is itself waiting for nothing but the mutex. Under the old
--    rows-first order it would be holding RowShareLock on reconciliation_batches and accounts and
--    waiting on a `tuple` lock — the exact edge that closed the ring.
select is(
  pg_temp.row_locks_held(current_setting('t.pid_cycle_e')::integer),
  '',
  'cycle race: the queued executor holds NO row lock — the rollback has nothing of its to wait for'
);
select is(
  pg_temp.non_advisory_waits(current_setting('t.pid_cycle_e')::integer),
  0,
  'cycle race: the queued executor waits on the mutex and on nothing else — no row-lock edge exists'
);
select ok(
  not pg_temp.is_lock_blocked(current_setting('t.pid_cycle_r')::integer),
  'cycle race: the rollback is blocked on nothing at all, so the ring has no third side'
);
-- 5. release the rollback: close, then executor, both proceed to a real outcome. No 40P01 anywhere.
select dblink_exec('cycle_rollback', 'commit');
do $$
declare v_state text; v_id uuid;
begin
  begin
    select r into v_id from dblink_get_result('cycle_close') as t(r uuid);
    perform set_config('t.cycle_c_state', 'no error', false);
    perform set_config('t.cycle_c_period', coalesce(v_id::text, 'none'), false);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    perform set_config('t.cycle_c_state', v_state, false);
    perform set_config('t.cycle_c_period', 'none', false);
  end;
  begin
    perform * from dblink_get_result('cycle_close') as drained(r uuid);
  exception when others then null;
  end;
end $$;
do $$
declare v_state text; v_result jsonb;
begin
  begin
    select r into v_result from dblink_get_result('cycle_execute') as t(r jsonb);
    perform set_config('t.cycle_e_state', 'no error', false);
    perform set_config('t.cycle_e_result', coalesce(v_result::text, '{"status":"missing"}'), false);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    perform set_config('t.cycle_e_state', v_state, false);
    perform set_config('t.cycle_e_result', '{"status":"missing"}', false);
  end;
  begin
    perform * from dblink_get_result('cycle_execute') as drained(r jsonb);
  exception when others then null;
  end;
end $$;
select is(
  current_setting('t.cycle_c_state'), 'no error',
  'cycle race: the close completes cleanly — no deadlock, no lock timeout'
);
select isnt(
  current_setting('t.cycle_c_period'), 'none',
  'cycle race: the close really produced a period once the rollback let go'
);
select is(
  current_setting('t.cycle_e_state'), 'no error',
  'cycle race: the execution completes cleanly — no 40P01, no 55P03, no 57014'
);
select is(
  current_setting('t.cycle_e_result')::jsonb->>'status', 'executed',
  'cycle race: the execution really executed once it reached the front of the mutex queue'
);
-- 6. outcome consistency: all three transactions committed a whole, mutually consistent result.
select is(
  (select b.status from public.reconciliation_batches
     b where b.id = 'd0000000-0000-0000-0000-000000000031')
  || '|' || (select b.status from public.reconciliation_batches b
              where b.id = 'd0000000-0000-0000-0000-000000000032'),
  'rolled_back|executed',
  'cycle race: the rolled-back batch and the executed batch both reached their terminal state'
);
select is(
  (select p.status from public.accounting_periods p
    where p.org_id = 'd0000000-0000-0000-0000-000000000003'
      and p.period_start = date '2017-01-01'),
  'locked', 'cycle race: the period that waited for the mutex is genuinely locked'
);
select is(
  (select l.status from public.reconciliation_execution_ledger l
    where l.executed_by_batch_row_id = 'd2000000-0000-0000-0000-000000000031')
  || '|' || (select l.status from public.reconciliation_execution_ledger l
              where l.executed_by_batch_row_id = 'd2000000-0000-0000-0000-000000000032'),
  'reversed|executed',
  'cycle race: the evidence ledger agrees with both outcomes — nothing was left half-applied'
);
select dblink_disconnect('cycle_rollback');
select dblink_disconnect('cycle_close');
select dblink_disconnect('cycle_execute');

-- ── 27) THE PUBLIC REVERSAL NEVER QUEUES ON A FOREIGN TENANT'S MUTEX ──────────────────────────────
--
-- `private.fn_reverse_journal_entry_internal` is handed an ENTRY, not an org, so it must resolve the
-- org before it can compute a lock key — and it is reachable from the AUTHENTICATED wrapper
-- `public.fn_reverse_journal_entry`, which will accept any uuid a caller types. If that resolving read
-- were unfiltered, a foreign journal uuid would make an ordinary member take ANOTHER TENANT'S period
-- mutex before this function's own membership check ever ran: a lock they have no right to (it blocks
-- that tenant's close for the length of their transaction) and a timing oracle on top of it (a foreign
-- uuid would BLOCK while a nonexistent one returned at once, splitting apart two verdicts the SQLSTATE
-- contract deliberately keeps distinct-but-uninformative).
--
-- The proof is concurrent and observational, not a source inspection. A separate backend holds the
-- FOREIGN org's mutex EXCLUSIVE for the whole test, so ANY attempt to take it shared MUST block —
-- which makes "the call came back promptly, and was never once seen in that lock's queue" conclusive.
-- The positive control is the other half of the same claim: with the CALLER'S OWN org mutex held by a
-- real period close, a legitimate same-org public reversal does block, and completes only afterwards.
select set_config('t.revorg', 'd0000000-0000-0000-0000-000000000004', false);
select set_config('t.foreignorg', 'd0000000-0000-0000-0000-000000000005', false);

-- Returns 'queued' the moment the backend is seen holding OR waiting on this org's period mutex,
-- 'settled' as soon as its dispatched query finishes without ever having been seen there, and
-- 'timeout' if neither happens within 5 seconds. The mutex is held EXCLUSIVE throughout, so a call
-- that asked for it could never reach 'settled'.
create or replace function pg_temp.settle_without_period_mutex(
  p_conn text, p_pid integer, p_org uuid)
returns text language plpgsql as $$
declare
  v_classid oid := (((private.fn_accounting_period_mutex_key(p_org)) >> 32) & 4294967295)::oid;
  v_objid   oid := ((private.fn_accounting_period_mutex_key(p_org)) & 4294967295)::oid;
begin
  for attempt in 1..500 loop
    perform pg_stat_clear_snapshot();
    if exists (
      select 1 from pg_locks l
       where l.pid = p_pid
         and l.locktype = 'advisory'
         and l.classid = v_classid
         and l.objid = v_objid
         and l.objsubid = 1
    ) then
      return 'queued';
    end if;
    if dblink_is_busy(p_conn) = 0 then
      return 'settled';
    end if;
    perform pg_sleep(0.01);
  end loop;
  return 'timeout';
end $$;
create or replace function pg_temp.period_mutex_backends(p_org uuid)
returns integer language sql as $$
  select count(*)::integer
    from pg_locks l
   where l.locktype = 'advisory'
     and l.classid = (((private.fn_accounting_period_mutex_key(p_org)) >> 32) & 4294967295)::oid
     and l.objid = ((private.fn_accounting_period_mutex_key(p_org)) & 4294967295)::oid
     and l.objsubid = 1
$$;

select dblink_connect('rev_setup', current_setting('t.dsn'));
select dblink_exec(
  'rev_setup',
  $$insert into public.organization(id, name) values
    ('d0000000-0000-0000-0000-000000000004', 'public reversal mutex org'),
    ('d0000000-0000-0000-0000-000000000005', 'public reversal FOREIGN org')$$
);
-- The caller is an owner of org 4 ONLY. Org 5 is a tenant they have no relationship with at all.
select dblink_exec(
  'rev_setup',
  format(
    $fx$insert into public.organization_member(org_id, user_id, role)
        values ('d0000000-0000-0000-0000-000000000004', %L::uuid, 'owner')$fx$,
    current_setting('t.owner')
  )
);
-- One ordinary posted journal per org — NOT a reconciliation-historical one, so the public reversal
-- path is genuinely open for the same-org case and the only thing that can refuse the foreign case is
-- the membership check this test is about.
select dblink_exec(
  'rev_setup',
  $$insert into public.journal_entries(
      id, org_id, entry_date, source_type, source_id, source_sequence, description, status)
    values
      ('d3000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000004', current_date,
       'expense', 'd4000000-0000-0000-0000-000000000004', 1, 'قيد عادي للعكس', 'posted'),
      ('d3000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000005', current_date,
       'expense', 'd4000000-0000-0000-0000-000000000005', 1, 'قيد المستأجر الآخر', 'posted'),
      ('d3000000-0000-0000-0000-000000000006', 'd0000000-0000-0000-0000-000000000004', current_date,
       'expense', 'd4000000-0000-0000-0000-000000000006', 1, 'قيد عادي لقفل الصف', 'posted')$$
);
select dblink_exec(
  'rev_setup',
  $$insert into public.journal_lines(org_id, journal_entry_id, account_id, debit, credit, description)
    select o.org, o.je,
           (select a.id from public.accounts a
             where a.org_id = o.org and a.active and a.kind = 'operating'
               and not exists (select 1 from public.accounts child
                                where child.org_id = a.org_id and child.parent_id = a.id and child.active)
             order by a.code limit 1),
           37, 0, 'مدين'
      from (values
        ('d0000000-0000-0000-0000-000000000004'::uuid, 'd3000000-0000-0000-0000-000000000004'::uuid),
        ('d0000000-0000-0000-0000-000000000005'::uuid, 'd3000000-0000-0000-0000-000000000005'::uuid),
        ('d0000000-0000-0000-0000-000000000004'::uuid, 'd3000000-0000-0000-0000-000000000006'::uuid)
      ) as o(org, je);
    insert into public.journal_lines(org_id, journal_entry_id, account_id, debit, credit, description)
    select o.org, o.je,
           (select a.id from public.accounts a where a.org_id = o.org and a.code = '1010'),
           0, 37, 'دائن'
      from (values
        ('d0000000-0000-0000-0000-000000000004'::uuid, 'd3000000-0000-0000-0000-000000000004'::uuid),
        ('d0000000-0000-0000-0000-000000000005'::uuid, 'd3000000-0000-0000-0000-000000000005'::uuid),
        ('d0000000-0000-0000-0000-000000000004'::uuid, 'd3000000-0000-0000-0000-000000000006'::uuid)
      ) as o(org, je)$$
);
select dblink_disconnect('rev_setup');

select is(
  (select count(*)::integer from public.organization_member m
    where m.org_id = 'd0000000-0000-0000-0000-000000000005'
      and m.user_id = current_setting('t.owner')::uuid),
  0, 'foreign-mutex proof: the caller is not a member of the foreign organization'
);

-- ── negative half: a FOREIGN journal uuid takes no foreign lock and does not wait for one ─────────
select dblink_connect('foreign_holder', current_setting('t.dsn'));
select dblink_connect('foreign_caller', current_setting('t.dsn'));
select dblink_exec('foreign_caller', format('set request.jwt.claims = %L',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text));
select dblink_exec('foreign_caller', $$set lock_timeout = '45s'$$);
select dblink_exec('foreign_caller', $$set statement_timeout = '90s'$$);
select dblink_exec('foreign_caller', 'set role authenticated');
select set_config('t.pid_foreign_caller', (
  select pid::text from dblink('foreign_caller', 'select pg_backend_pid()') as backend(pid integer)
), false);

-- The holder takes the FOREIGN org's mutex in EXCLUSIVE mode — the same lock, on the same key, that
-- `public.fn_close_accounting_period` takes for that tenant. Taking it directly rather than through a
-- close keeps the test about the lock and nothing else, and needs no membership in that tenant at all.
select dblink_exec('foreign_holder', 'begin');
select held from dblink('foreign_holder',
  $$select 1 from (select pg_catalog.pg_advisory_xact_lock(
      private.fn_accounting_period_mutex_key('d0000000-0000-0000-0000-000000000005'))) taken$$
) as t(held integer);
select is(
  pg_temp.period_mutex_backends(current_setting('t.foreignorg')::uuid),
  1, 'foreign-mutex proof: exactly one backend holds the foreign tenant''s mutex, EXCLUSIVE'
);

select is(
  dblink_send_query('foreign_caller',
    $$select public.fn_reverse_journal_entry(
        'd3000000-0000-0000-0000-000000000005', 'محاولة عبر المستأجرين')$$),
  1, 'foreign-mutex proof: an authenticated caller aims the public reversal at a foreign journal'
);
select is(
  pg_temp.settle_without_period_mutex(
    'foreign_caller', current_setting('t.pid_foreign_caller')::integer,
    current_setting('t.foreignorg')::uuid),
  'settled',
  'foreign-mutex proof: it never appears in the foreign mutex queue and returns while the lock is held'
);
do $$
declare v_state text;
begin
  begin
    perform * from dblink_get_result('foreign_caller') as t(r uuid);
    perform set_config('t.foreign_verdict', 'no error', false);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    perform set_config('t.foreign_verdict', v_state, false);
  end;
  begin
    perform * from dblink_get_result('foreign_caller') as drained(r uuid);
  exception when others then null;
  end;
end $$;
select is(
  current_setting('t.foreign_verdict'), '42501',
  'foreign-mutex proof: the verdict is still the unchanged cross-org 42501'
);

-- The same must hold for a uuid that exists nowhere: identical promptness, so the wait cannot be used
-- to tell "another tenant's journal" apart from "no journal at all".
select is(
  dblink_send_query('foreign_caller',
    $$select public.fn_reverse_journal_entry(
        'ffffffff-ffff-ffff-ffff-fffffffffffc', 'محاولة على معرف غير موجود')$$),
  1, 'foreign-mutex proof: the same caller aims the public reversal at a uuid that exists nowhere'
);
select is(
  pg_temp.settle_without_period_mutex(
    'foreign_caller', current_setting('t.pid_foreign_caller')::integer,
    current_setting('t.foreignorg')::uuid),
  'settled',
  'foreign-mutex proof: the nowhere uuid settles just as promptly — no timing oracle between them'
);
do $$
declare v_state text;
begin
  begin
    perform * from dblink_get_result('foreign_caller') as t(r uuid);
    perform set_config('t.missing_verdict', 'no error', false);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    perform set_config('t.missing_verdict', v_state, false);
  end;
  begin
    perform * from dblink_get_result('foreign_caller') as drained(r uuid);
  exception when others then null;
  end;
end $$;
select is(
  current_setting('t.missing_verdict'), 'P0002',
  'foreign-mutex proof: the nowhere uuid still raises the unchanged P0002'
);
select is(
  pg_temp.period_mutex_backends(current_setting('t.foreignorg')::uuid),
  1, 'foreign-mutex proof: still exactly one backend on that mutex — the caller never joined it'
);
select dblink_exec('foreign_holder', 'rollback');
select dblink_disconnect('foreign_holder');
select dblink_disconnect('foreign_caller');

-- ── 27b) THE PUBLIC REVERSAL NEVER QUEUES ON A FOREIGN TENANT'S JOURNAL ROW EITHER ────────────────
--
-- Filtering the org-RESOLVING read (above) is only half the ordering. The function then locks the
-- journal itself, and if THAT read is `where id = p_entry for update` with no org predicate, the
-- foreign caller still queues — one level lower down, on the row rather than on the mutex — before
-- the membership check refuses them. The consequences are the same two:
--
--   * FOREIGN ROW-LOCK CONTENTION: a caller with no relationship to that tenant joins the queue on
--     that tenant's journal row and waits there for the tenant's own writer, for as long as that
--     writer runs; and
--   * a cross-tenant ACTIVITY TIMING ORACLE strictly sharper than the mutex one — it reports not
--     just that a foreign journal exists, but that someone is writing it AT THIS MOMENT, while a
--     uuid that exists nowhere returns instantly. The redacted 42501/P0002 pair is designed to keep
--     those indistinguishable; a wait re-separates them.
--
-- This is proved the same way §27 proves the mutex half, and it is deliberately NOT a source read:
-- a separate backend holds the FOREIGN journal ROW ITSELF with `select ... for update` for the whole
-- sub-section — no advisory lock anywhere, so the mutex fix alone cannot make this pass — and the
-- authenticated foreign call must never be seen in that row's wait queue. Note that the foreign
-- org's period mutex is NOT held here (§27's holder rolled back above), so the ONLY thing that can
-- make this call wait is the row lock this section is about.
create or replace function pg_temp.row_lock_waiters(p_holder_pid integer)
returns integer language sql as $$
  select count(*)::integer
    from pg_locks w
   where w.pid <> p_holder_pid
     and not w.granted
     and w.locktype = 'transactionid'
     and exists (
       select 1 from pg_locks h
        where h.pid = p_holder_pid
          and h.locktype = 'transactionid'
          and h.granted
          and h.transactionid = w.transactionid)
$$;
-- Returns 'queued' the moment the backend is seen contending for a row of `p_relation` held by
-- `p_holder_pid` — either as an ungranted wait on that holder's transaction id (the shape a
-- `for update` behind another `for update` actually takes) or as a tuple lock on the relation —
-- 'settled' as soon as its dispatched query finishes without ever having been seen there, and
-- 'timeout' if neither happens within 5 seconds. The row is held for the whole window, so a call
-- that asked to lock it could never reach 'settled'.
create or replace function pg_temp.settle_without_row_lock(
  p_conn text, p_pid integer, p_holder_pid integer, p_relation regclass)
returns text language plpgsql as $$
begin
  for attempt in 1..500 loop
    perform pg_stat_clear_snapshot();
    if exists (
      select 1 from pg_locks l
       where l.pid = p_pid
         and (
           (l.locktype = 'tuple' and l.relation = p_relation)
           or (
             l.locktype = 'transactionid'
             and not l.granted
             and exists (
               select 1 from pg_locks h
                where h.pid = p_holder_pid
                  and h.locktype = 'transactionid'
                  and h.granted
                  and h.transactionid = l.transactionid)
           )
         )
    ) then
      return 'queued';
    end if;
    if dblink_is_busy(p_conn) = 0 then
      return 'settled';
    end if;
    perform pg_sleep(0.01);
  end loop;
  return 'timeout';
end $$;

select dblink_connect('row_holder', current_setting('t.dsn'));
select dblink_connect('row_prober', current_setting('t.dsn'));
select dblink_connect('row_caller', current_setting('t.dsn'));
select dblink_exec('row_caller', format('set request.jwt.claims = %L',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text));
select dblink_exec('row_caller', $$set lock_timeout = '45s'$$);
select dblink_exec('row_caller', $$set statement_timeout = '90s'$$);
select dblink_exec('row_caller', 'set role authenticated');
-- The prober is the DETECTOR's control: a short lock_timeout so it gives up on its own, since it is
-- meant to be seen waiting, not to succeed.
select dblink_exec('row_prober', $$set lock_timeout = '2s'$$);
select set_config('t.pid_row_holder', (
  select pid::text from dblink('row_holder', 'select pg_backend_pid()') as backend(pid integer)
), false);
select set_config('t.pid_row_prober', (
  select pid::text from dblink('row_prober', 'select pg_backend_pid()') as backend(pid integer)
), false);
select set_config('t.pid_row_caller', (
  select pid::text from dblink('row_caller', 'select pg_backend_pid()') as backend(pid integer)
), false);

-- The holder takes the FOREIGN tenant's journal ROW — the exact row `public.fn_reverse_journal_entry`
-- would lock — in the exact mode it would take it. Nothing else is locked.
select dblink_exec('row_holder', 'begin');
select held from dblink('row_holder',
  $$select 1 from public.journal_entries
     where id = 'd3000000-0000-0000-0000-000000000005' for update$$
) as t(held integer);
select ok(
  exists (select 1 from pg_locks h
           where h.pid = current_setting('t.pid_row_holder')::integer
             and h.locktype = 'transactionid' and h.granted),
  'foreign-row proof: a separate backend really holds the foreign tenant''s journal row FOR UPDATE'
);

-- Detector control: a backend that DOES contend for that row is seen in the queue, so 'settled'
-- below is a real observation and not a blind spot in `settle_without_row_lock`.
select is(
  dblink_send_query('row_prober',
    $$select 1 from public.journal_entries
       where id = 'd3000000-0000-0000-0000-000000000005' for update$$),
  1, 'foreign-row proof: a control backend contends for the very same foreign journal row'
);
select is(
  pg_temp.settle_without_row_lock(
    'row_prober', current_setting('t.pid_row_prober')::integer,
    current_setting('t.pid_row_holder')::integer, 'public.journal_entries'::regclass),
  'queued',
  'foreign-row proof: the control IS seen queued on that row — the detector and the lock are real'
);
do $$
declare v_state text;
begin
  begin
    perform * from dblink_get_result('row_prober') as t(r integer);
    perform set_config('t.prober_verdict', 'no error', false);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    perform set_config('t.prober_verdict', v_state, false);
  end;
  begin
    perform * from dblink_get_result('row_prober') as drained(r integer);
  exception when others then null;
  end;
end $$;
select is(
  current_setting('t.prober_verdict'), '55P03',
  'foreign-row proof: the control waited on that row until its own lock_timeout fired'
);

-- The regression itself: the authenticated foreign reversal, aimed at the held foreign row.
select is(
  dblink_send_query('row_caller',
    $$select public.fn_reverse_journal_entry(
        'd3000000-0000-0000-0000-000000000005', 'محاولة عبر المستأجرين على صف مقفول')$$),
  1, 'foreign-row proof: an authenticated caller aims the public reversal at the HELD foreign journal'
);
select is(
  pg_temp.settle_without_row_lock(
    'row_caller', current_setting('t.pid_row_caller')::integer,
    current_setting('t.pid_row_holder')::integer, 'public.journal_entries'::regclass),
  'settled',
  'foreign-row proof: it never joins that row''s queue and returns while the row is still held'
);
do $$
declare v_state text;
begin
  begin
    perform * from dblink_get_result('row_caller') as t(r uuid);
    perform set_config('t.foreign_row_verdict', 'no error', false);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    perform set_config('t.foreign_row_verdict', v_state, false);
  end;
  begin
    perform * from dblink_get_result('row_caller') as drained(r uuid);
  exception when others then null;
  end;
end $$;
select is(
  current_setting('t.foreign_row_verdict'), '42501',
  'foreign-row proof: the verdict is still the unchanged cross-org 42501, and it arrives promptly'
);

-- Parity: a uuid that exists nowhere settles identically, so the wait cannot separate "another
-- tenant's journal, being written right now" from "no journal at all".
select is(
  dblink_send_query('row_caller',
    $$select public.fn_reverse_journal_entry(
        'ffffffff-ffff-ffff-ffff-fffffffffffb', 'محاولة على معرف غير موجود بينما الصف مقفول')$$),
  1, 'foreign-row proof: the same caller aims the public reversal at a uuid that exists nowhere'
);
select is(
  pg_temp.settle_without_row_lock(
    'row_caller', current_setting('t.pid_row_caller')::integer,
    current_setting('t.pid_row_holder')::integer, 'public.journal_entries'::regclass),
  'settled',
  'foreign-row proof: the nowhere uuid settles just as promptly — no activity oracle between them'
);
do $$
declare v_state text;
begin
  begin
    perform * from dblink_get_result('row_caller') as t(r uuid);
    perform set_config('t.missing_row_verdict', 'no error', false);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    perform set_config('t.missing_row_verdict', v_state, false);
  end;
  begin
    perform * from dblink_get_result('row_caller') as drained(r uuid);
  exception when others then null;
  end;
end $$;
select is(
  current_setting('t.missing_row_verdict'), 'P0002',
  'foreign-row proof: the nowhere uuid still raises the unchanged P0002'
);
select is(
  pg_temp.row_lock_waiters(current_setting('t.pid_row_holder')::integer),
  0, 'foreign-row proof: nothing is left waiting on that row — the caller never joined it'
);
select dblink_exec('row_holder', 'rollback');
select dblink_disconnect('row_holder');
select dblink_disconnect('row_prober');
select dblink_disconnect('row_caller');

-- ── 27c) positive control: the SAME-ORG reversal still takes that row lock, and still waits for it ─
--
-- The org predicate on the `for update` must narrow the lock to the caller's own organization, not
-- weaken it. With a backend holding the caller's OWN journal row, a legitimate reversal of that row
-- must queue exactly as it always did, and complete the moment the row is released — otherwise the
-- fix would have bought tenant isolation by dropping the concurrency guarantee the row lock exists
-- for. Journal ...006 is used so the §27 same-org close/reversal control below still reverses a
-- pristine ...004.
select dblink_connect('own_row_holder', current_setting('t.dsn'));
select dblink_connect('own_row_reverser', current_setting('t.dsn'));
select dblink_exec('own_row_reverser', format('set request.jwt.claims = %L',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text));
select dblink_exec('own_row_reverser', $$set lock_timeout = '45s'$$);
select dblink_exec('own_row_reverser', $$set statement_timeout = '90s'$$);
select dblink_exec('own_row_reverser', 'set role authenticated');
select set_config('t.pid_own_row_holder', (
  select pid::text from dblink('own_row_holder', 'select pg_backend_pid()') as backend(pid integer)
), false);
select set_config('t.pid_own_row_reverser', (
  select pid::text from dblink('own_row_reverser', 'select pg_backend_pid()') as backend(pid integer)
), false);

select dblink_exec('own_row_holder', 'begin');
select held from dblink('own_row_holder',
  $$select 1 from public.journal_entries
     where id = 'd3000000-0000-0000-0000-000000000006' for update$$
) as t(held integer);
select is(
  dblink_send_query('own_row_reverser',
    $$select public.fn_reverse_journal_entry(
        'd3000000-0000-0000-0000-000000000006', 'عكس مشروع لصف مقفول داخل نفس المنظمة')$$),
  1, 'same-org row control: a legitimate reversal of the caller''s own HELD journal is dispatched'
);
select is(
  pg_temp.settle_without_row_lock(
    'own_row_reverser', current_setting('t.pid_own_row_reverser')::integer,
    current_setting('t.pid_own_row_holder')::integer, 'public.journal_entries'::regclass),
  'queued',
  'same-org row control: it DOES queue on its own org''s journal row — the lock is still taken'
);
select dblink_exec('own_row_holder', 'rollback');
do $$
declare v_id uuid;
begin
  select r into v_id from dblink_get_result('own_row_reverser') as t(r uuid);
  perform set_config('t.own_row_reversal', coalesce(v_id::text, 'none'), false);
  begin
    perform * from dblink_get_result('own_row_reverser') as drained(r uuid);
  exception when others then null;
  end;
end $$;
select isnt(
  current_setting('t.own_row_reversal'), 'none',
  'same-org row control: the reversal completes as soon as the row is released'
);
select is(
  (select je.status from public.journal_entries je
    where je.id = 'd3000000-0000-0000-0000-000000000006'),
  'reversed', 'same-org row control: the caller''s own journal really was reversed'
);
select is(
  (select count(*)::integer from public.journal_entries je
    where je.reversal_of = 'd3000000-0000-0000-0000-000000000006'),
  1, 'same-org row control: exactly one reversing entry was appended'
);
select dblink_disconnect('own_row_holder');
select dblink_disconnect('own_row_reverser');

-- ── positive control: a SAME-ORG public reversal still takes the mutex and blocks behind a close ──
select dblink_connect('own_closer', current_setting('t.dsn'));
select dblink_connect('own_reverser', current_setting('t.dsn'));
select dblink_exec('own_closer', format('set request.jwt.claims = %L',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text));
select dblink_exec('own_reverser', format('set request.jwt.claims = %L',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text));
select dblink_exec('own_closer', $$set lock_timeout = '45s'$$);
select dblink_exec('own_reverser', $$set lock_timeout = '45s'$$);
select dblink_exec('own_closer', $$set statement_timeout = '90s'$$);
select dblink_exec('own_reverser', $$set statement_timeout = '90s'$$);
select dblink_exec('own_closer', 'set role authenticated');
select dblink_exec('own_reverser', 'set role authenticated');
select set_config('t.pid_own_reverser', (
  select pid::text from dblink('own_reverser', 'select pg_backend_pid()') as backend(pid integer)
), false);

select dblink_exec('own_closer', 'begin');
select isnt(
  (select r::text from dblink('own_closer',
    $$select public.fn_close_accounting_period(
        'd0000000-0000-0000-0000-000000000004', date '2017-01-01', date '2017-12-31',
        'إقفال يحجب العكس')$$) as t(r uuid)),
  null, 'same-org control: the caller''s OWN org close takes the EXCLUSIVE mutex and stays open'
);
select is(
  dblink_send_query('own_reverser',
    $$select public.fn_reverse_journal_entry(
        'd3000000-0000-0000-0000-000000000004', 'عكس مشروع داخل نفس المنظمة')$$),
  1, 'same-org control: a legitimate public reversal of the caller''s own journal is dispatched'
);
select ok(
  pg_temp.wait_for_period_mutex(
    current_setting('t.pid_own_reverser')::integer, current_setting('t.revorg')::uuid),
  'same-org control: it DOES queue on its own org''s mutex — the lock is still taken where it belongs'
);
select dblink_exec('own_closer', 'commit');
do $$
declare v_id uuid;
begin
  select r into v_id from dblink_get_result('own_reverser') as t(r uuid);
  perform set_config('t.own_reversal', coalesce(v_id::text, 'none'), false);
  begin
    perform * from dblink_get_result('own_reverser') as drained(r uuid);
  exception when others then null;
  end;
end $$;
select isnt(
  current_setting('t.own_reversal'), 'none',
  'same-org control: the reversal completes as soon as the close commits'
);
select is(
  (select je.status from public.journal_entries je
    where je.id = 'd3000000-0000-0000-0000-000000000004'),
  'reversed', 'same-org control: the original journal really was reversed'
);
select is(
  (select count(*)::integer from public.journal_entries je
    where je.reversal_of = 'd3000000-0000-0000-0000-000000000004'),
  1, 'same-org control: exactly one reversing entry was appended'
);
select dblink_disconnect('own_closer');
select dblink_disconnect('own_reverser');

-- ── teardown of everything the races COMMITTED, and proof of the teardown ─────────────────────────
-- These rows live in other backends' committed state, so this file's outer `rollback` cannot remove
-- them. `session_replication_role = replica` is required because the races deliberately leave posted
-- historical rows, reversed journals and action links behind, and the production guards this slice
-- adds — including the new append-only guard — refuse to delete exactly those.
select dblink_connect('mutex_cleanup', current_setting('t.dsn'));
select dblink_exec('mutex_cleanup', 'set session_replication_role = replica');
select dblink_exec('mutex_cleanup',
  $$delete from public.accounting_periods where org_id in (
      'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003',
      'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000005')$$);
select dblink_exec('mutex_cleanup',
  $$delete from public.reconciliation_action_links where org_id in (
      'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003',
      'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000005')$$);
select dblink_exec('mutex_cleanup',
  $$delete from public.reconciliation_baseline_journal_lines where org_id in (
      'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003',
      'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000005')$$);
select dblink_exec('mutex_cleanup',
  $$delete from public.reconciliation_baseline_journal_headers where org_id in (
      'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003',
      'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000005')$$);
select dblink_exec('mutex_cleanup',
  $$delete from public.reconciliation_baselines where org_id in (
      'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003',
      'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000005')$$);
select dblink_exec('mutex_cleanup',
  $$delete from public.reconciliation_execution_ledger where org_id in (
      'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003',
      'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000005')$$);
select dblink_exec('mutex_cleanup',
  $$delete from public.reconciliation_batch_rows where org_id in (
      'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003',
      'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000005')$$);
select dblink_exec('mutex_cleanup',
  $$delete from public.reconciliation_evidence_items where org_id in (
      'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003',
      'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000005')$$);
select dblink_exec('mutex_cleanup',
  $$delete from public.reconciliation_batches where org_id in (
      'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003',
      'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000005')$$);
select dblink_exec('mutex_cleanup',
  $$delete from public.journal_lines where org_id in (
      'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003',
      'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000005')$$);
select dblink_exec('mutex_cleanup',
  $$delete from public.journal_entries where org_id in (
      'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003',
      'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000005')$$);
select dblink_exec('mutex_cleanup',
  $$delete from public.expenses where org_id in (
      'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003',
      'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000005')$$);
select dblink_exec('mutex_cleanup',
  $$delete from public.audit_log where org_id in (
      'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003',
      'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000005')$$);
select dblink_exec('mutex_cleanup',
  $$delete from public.organization_member where org_id in (
      'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003',
      'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000005')$$);
select dblink_exec('mutex_cleanup',
  $$delete from public.cost_centers where org_id in (
      'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003',
      'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000005')$$);
select dblink_exec('mutex_cleanup',
  $$delete from public.accounts where org_id in (
      'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003',
      'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000005')$$);
select dblink_exec('mutex_cleanup',
  $$delete from public.organization where id in (
      'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003',
      'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000005')$$);
select dblink_exec('mutex_cleanup', 'set session_replication_role = origin');
select dblink_disconnect('mutex_cleanup');

select is(
  (
    (select count(*) from public.reconciliation_batches where org_id in (
      'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003',
      'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000005'))
    + (select count(*) from public.reconciliation_batch_rows where org_id in (
      'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003',
      'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000005'))
    + (select count(*) from public.reconciliation_evidence_items where org_id in (
      'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003',
      'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000005'))
    + (select count(*) from public.reconciliation_execution_ledger where org_id in (
      'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003',
      'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000005'))
    + (select count(*) from public.reconciliation_action_links where org_id in (
      'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003',
      'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000005'))
    + (select count(*) from public.reconciliation_baselines where org_id in (
      'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003',
      'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000005'))
  )::int,
  0, 'the mutex races leave behind no committed reconciliation row'
);
select is(
  (
    (select count(*) from public.journal_entries where org_id in (
      'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003',
      'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000005'))
    + (select count(*) from public.journal_lines where org_id in (
      'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003',
      'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000005'))
    + (select count(*) from public.expenses where org_id in (
      'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003',
      'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000005'))
    + (select count(*) from public.organization where id in (
      'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003',
      'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000005'))
  )::int,
  0, 'the mutex races leave behind no committed journal, expense or organization'
);
select is(
  (select count(*)::int from public.accounting_periods
    where org_id in (
      'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003',
      'd0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000005')),
  0, 'the mutex races leave behind no committed accounting period'
);
select is(
  (select count(*) from pg_stat_activity
    where application_name like '%dblink%' and pid <> pg_backend_pid()),
  0::bigint, 'no dblink backend remains after the mutex races'
);

select finish();
rollback;
