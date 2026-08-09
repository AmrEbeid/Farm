-- Historical SALE reconciliation execution: the proven direct-treasury cash-in contract
-- (Dr 1010 / Cr typed revenue leaf), the crop -> leaf mapping, correction eligibility, the
-- historical sale lifecycle guards, revenue/A-R report correctness, mixed expense+sale batches,
-- expense-path regression, replay/idempotency, rollback, and redaction. The public-reversal privilege
-- boundary is covered for BOTH domains: a historical reconciliation sale OR expense journal (in either
-- historical state) is refused on the public RPC, ordinary operational sale and ordinary expense
-- reversals still succeed there, and the owner-only executor still corrects both.

begin;
select plan(348);

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
select set_config('t.expense_account', (
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
  select a.id::text from public.accounts a
  where a.org_id = :'orgA' and a.code = '1010'
), false);
select set_config('t.rev4010', (
  select a.id::text from public.accounts a
  where a.org_id = :'orgA' and a.code = '4010'
), false);
select set_config('t.rev4090', (
  select a.id::text from public.accounts a
  where a.org_id = :'orgA' and a.code = '4090'
), false);
select set_config('t.rev4000', (
  select a.id::text from public.accounts a
  where a.org_id = :'orgA' and a.code = '4000'
), false);
select set_config('t.farm', (
  select id::text from public.farms where org_id = :'orgA' order by code limit 1
), false);
select set_config('t.sector', (
  select id::text from public.sectors
  where org_id = :'orgA' and farm_id = current_setting('t.farm')::uuid
  order by code limit 1
), false);
select set_config('t.hawsha', (
  select id::text from public.hawshat
  where org_id = :'orgA' and sector_id = current_setting('t.sector')::uuid
  order by code limit 1
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
    p_id, v_org, repeat('b', 64), 'sale execution test', p_status,
    current_setting('t.acct')::uuid,
    case when p_status = 'approved' then current_setting('t.owner')::uuid end,
    case when p_status = 'approved' then now() end
  );
  return p_id;
end $$;

-- One reviewed+frozen SALE row. Every reviewed field is explicit so an adversarial case can vary
-- exactly one of them.
create or replace function pg_temp.add_sale_row(
  p_batch uuid,
  p_evidence uuid,
  p_row uuid,
  p_locator text,
  p_amount numeric,
  p_date date,
  p_crop text default 'برحي',
  p_corrects_sale uuid default null,
  p_qty numeric default null,
  p_unit_price numeric default null,
  p_recorded_total numeric default null,
  p_effective_date date default null,
  p_date_decision text default 'use_source_text_date',
  p_buyer uuid default null,
  p_cost_center uuid default null,
  p_farm uuid default null,
  p_sector uuid default null,
  p_hawsha uuid default null,
  p_bad_hash boolean default false,
  p_review_reason text default 'approved synthetic sale execution test',
  p_source_date_parsed date default null,
  p_invalid_calendar boolean default false,
  p_org uuid default null
) returns uuid language plpgsql as $$
declare
  v_org uuid := coalesce(p_org, current_setting('t.org')::uuid);
  v_qty numeric := coalesce(p_qty, 1);
  v_price numeric := coalesce(p_unit_price, p_amount);
begin
  insert into public.reconciliation_evidence_items(
    id, org_id, origin_kind, source_workbook_sha256, sheet_name,
    row_locator, source_identity_fingerprint, source_amount,
    source_date_text, source_date_parsed, classification,
    invalid_calendar_quality_flag, first_staged_batch_id, evidence_label
  )
  values (
    p_evidence, v_org, 'source_workbook_row', repeat('b', 64),
    'sale execution test', p_locator, p_locator, p_amount,
    p_date::text,
    case when p_invalid_calendar then null
         else coalesce(p_source_date_parsed, p_date) end,
    case when p_corrects_sale is null
      then case when p_amount = 0
        then 'zero_value_source_placeholder'
        else 'source_addition_candidate' end
      else 'amount_correction_candidate'
    end,
    p_invalid_calendar, p_batch, 'sale execution test evidence'
  );

  insert into public.reconciliation_batch_rows(
    id, org_id, batch_id, evidence_item_id, review_state, reviewer_id,
    review_reason, reviewed_at, target_table, disposition,
    sale_crop, sale_quantity, sale_unit, sale_unit_price, sale_recorded_total,
    sale_buyer_id, sale_cost_center_id, sale_farm_id, sale_sector_id, sale_hawsha_id,
    sale_season, sale_delivery_date, sale_notes,
    sale_historical_date_decision, sale_effective_date, corrects_sale_id
  )
  values (
    p_row, v_org, p_batch, p_evidence, 'reviewed',
    current_setting('t.acct')::uuid, p_review_reason, now(),
    'sales', 'include',
    p_crop, v_qty, 'كجم', v_price, coalesce(p_recorded_total, p_amount),
    p_buyer, p_cost_center, p_farm, p_sector, p_hawsha,
    'موسم الاختبار', p_date, 'سطر اختبار',
    p_date_decision, coalesce(p_effective_date, p_date), p_corrects_sale
  );

  update public.reconciliation_batch_rows br
     set payload_hash = case when p_bad_hash then repeat('0', 64)
           else private.fn_reconciliation_execution_payload_hash(br) end,
         frozen = true, frozen_at = now(), review_state = 'frozen'
   where br.id = p_row;
  return p_row;
end $$;

create or replace function pg_temp.add_expense_row(
  p_batch uuid, p_evidence uuid, p_row uuid, p_locator text,
  p_amount numeric, p_date date, p_corrects_expense uuid default null
) returns uuid language plpgsql as $$
declare v_org uuid := current_setting('t.org')::uuid;
begin
  insert into public.reconciliation_evidence_items(
    id, org_id, origin_kind, source_workbook_sha256, sheet_name,
    row_locator, source_identity_fingerprint, source_amount,
    source_date_text, source_date_parsed, classification,
    invalid_calendar_quality_flag, first_staged_batch_id, evidence_label
  ) values (
    p_evidence, v_org, 'source_workbook_row', repeat('b', 64),
    'sale execution test', p_locator, p_locator, p_amount,
    p_date::text, p_date,
    case when p_corrects_expense is null then 'source_addition_candidate'
         else 'amount_correction_candidate' end,
    false, p_batch, 'mixed batch expense evidence'
  );
  insert into public.reconciliation_batch_rows(
    id, org_id, batch_id, evidence_item_id, review_state, reviewer_id,
    review_reason, reviewed_at, target_table, disposition,
    expense_category, expense_description, expense_kind,
    expense_account_id, expense_payment_decision, corrects_expense_id
  ) values (
    p_row, v_org, p_batch, p_evidence, 'reviewed',
    current_setting('t.acct')::uuid, 'mixed batch expense', now(),
    'expenses', 'include', 'mixed batch', 'mixed batch', 'operating',
    current_setting('t.expense_account')::uuid, 'routed_now', p_corrects_expense
  );
  update public.reconciliation_batch_rows br
     set payload_hash = private.fn_reconciliation_execution_payload_hash(br),
         frozen = true, frozen_at = now(), review_state = 'frozen'
   where br.id = p_row;
  return p_row;
end $$;

-- An EXACT proven historical direct-treasury sale, built the way the 7-year backfill built one:
-- Dr 1010 / Cr <typed revenue leaf>, one posted two-line journal, on the sale's economic date,
-- with no collection row. Claiming `historical_treasury` on it exercises the lifecycle guard.
create or replace function pg_temp.make_historical_sale(
  p_sale uuid, p_journal uuid, p_debit_line uuid, p_credit_line uuid,
  p_total numeric, p_date date,
  p_crop text default 'برحي',
  p_revenue_account uuid default null,
  p_debit_account uuid default null,
  p_journal_total numeric default null,
  p_entry_date date default null,
  p_claim_status boolean default true
) returns uuid language plpgsql as $$
declare
  v_org uuid := current_setting('t.org')::uuid;
  v_rev uuid := coalesce(p_revenue_account, current_setting('t.rev4010')::uuid);
  v_dr  uuid := coalesce(p_debit_account, current_setting('t.cash')::uuid);
  v_amt numeric := coalesce(p_journal_total, p_total);
begin
  insert into public.sales(
    id, org_id, sale_date, crop, qty, unit, unit_price, total,
    price_status, price_finalized_at, payment_status
  ) values (
    p_sale, v_org, p_date, p_crop, 1, 'كجم', p_total, p_total,
    'finalized', now(), 'collected'
  );
  insert into public.journal_entries(
    id, org_id, entry_date, source_type, source_id, source_sequence,
    description, status, posted_at
  ) values (
    p_journal, v_org, coalesce(p_entry_date, p_date), 'sale', p_sale, 1,
    p_crop, 'posted', now()
  );
  insert into public.journal_lines(
    id, org_id, journal_entry_id, account_id, debit, credit
  ) values
    (p_debit_line, v_org, p_journal, v_dr, v_amt, 0),
    (p_credit_line, v_org, p_journal, v_rev, 0, v_amt);
  if p_claim_status then
    update public.sales set payment_status = 'historical_treasury' where id = p_sale;
  end if;
  return p_sale;
end $$;

-- ── grants, search_path, and helper privacy ───────────────────────────────────────────────────────
select ok(
  not has_function_privilege('anon', 'public.fn_execute_reconciliation_batch(uuid)', 'EXECUTE'),
  'anon cannot execute sale reconciliation'
);
select ok(
  has_function_privilege('authenticated', 'public.fn_execute_reconciliation_batch(uuid)', 'EXECUTE'),
  'authenticated reaches the owner-gated execution RPC'
);
select ok(
  not has_function_privilege('anon', 'public.fn_revenue_sales_report(uuid, date, date, date)', 'EXECUTE'),
  'anon cannot read the revenue report'
);
select ok(
  has_function_privilege('authenticated', 'public.fn_revenue_sales_report(uuid, date, date, date)', 'EXECUTE'),
  'authenticated retains the finance-gated revenue report grant'
);
select ok(
  not has_function_privilege('authenticated', 'private.fn_reconciliation_historical_revenue_codes()', 'EXECUTE'),
  'the typed revenue-leaf helper is private'
);
select ok(
  not has_function_privilege('authenticated', 'private.fn_reconciliation_historical_sale_revenue_code(text)', 'EXECUTE'),
  'the crop mapping helper is private'
);
select ok(
  not has_function_privilege('authenticated', 'private.fn_reconciliation_sale_has_exact_historical_journal(uuid)', 'EXECUTE'),
  'the historical-sale proof helper is private'
);
select ok(
  not has_function_privilege('authenticated', 'private.fn_guard_historical_treasury_sale()', 'EXECUTE'),
  'the historical-sale guard function is private'
);
select ok(
  not has_function_privilege('authenticated', 'private.fn_guard_historical_treasury_sale_delete()', 'EXECUTE'),
  'the historical-sale delete guard function is private'
);
select ok(
  not has_function_privilege('authenticated', 'private.fn_guard_historical_sale_collection()', 'EXECUTE'),
  'the historical-sale collection guard function is private'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.proname in (
        'fn_execute_reconciliation_batch', 'fn_revenue_sales_report',
        'fn_reconciliation_historical_revenue_codes',
        'fn_reconciliation_historical_sale_revenue_code',
        'fn_reconciliation_sale_has_exact_historical_journal',
        'fn_guard_historical_treasury_sale',
        'fn_guard_historical_treasury_sale_delete',
        'fn_guard_historical_sale_collection'
      )
      and p.proconfig[1] = 'search_path=""'),
  8, 'every function this slice emits pins an empty search path'
);
select is(
  (select count(*)::int from pg_trigger
    where tgrelid = 'public.sales'::regclass
      and tgname in ('guard_historical_treasury_sale', 'guard_historical_treasury_sale_delete')
      and not tgisinternal),
  2, 'both historical-sale guards are installed on public.sales'
);
select is(
  (select count(*)::int from pg_trigger
    where tgrelid = 'public.sale_collections'::regclass
      and tgname = 'guard_historical_sale_collection' and not tgisinternal),
  1, 'the collection guard is installed on public.sale_collections'
);

-- ── the crop -> typed revenue leaf mapping IS the established 20260707115445 contract ─────────────
select is(private.fn_reconciliation_historical_sale_revenue_code('برحي'), '4010',
  'date-crop keywords map to 4010 تمور برحي');
select is(private.fn_reconciliation_historical_sale_revenue_code('فسائل صغيرة'), '4020',
  'offshoot keywords map to 4020 فسائل');
select is(private.fn_reconciliation_historical_sale_revenue_code('برتقال بلدي'), '4030',
  'citrus/fruit keywords map to 4030 موالح وفاكهة');
select is(private.fn_reconciliation_historical_sale_revenue_code('بنجر'), '4040',
  'beet maps to 4040 بنجر');
select is(private.fn_reconciliation_historical_sale_revenue_code('قمح'), '4050',
  'field-crop keywords map to 4050 محاصيل حقلية');
select is(private.fn_reconciliation_historical_sale_revenue_code('خرده حديد'), '4090',
  'scrap keywords map to 4090 إيرادات أخرى');
select is(private.fn_reconciliation_historical_sale_revenue_code('محصول غير مصنف'), '4090',
  'an unmatched crop falls closed to the established 4090 fallback');
select is(private.fn_reconciliation_historical_sale_revenue_code(null), '4090',
  'a null crop falls closed to the established 4090 fallback');
-- Branch ORDER is load-bearing in the source mapping: the scrap branch is tested first.
select is(private.fn_reconciliation_historical_sale_revenue_code('خشب نخيل برحي'), '4090',
  'the scrap branch wins over the date-crop branch, preserving the source branch order');
select is(
  (select count(*)::int from (values
     ('برحي'), ('فسائل'), ('برتقال'), ('بنجر'), ('قمح'), ('خرده'), ('أي شيء'), (null)
   ) as sample(crop)
   where private.fn_reconciliation_historical_sale_revenue_code(sample.crop) = '4000'),
  0, 'the mapping can never route a historical sale to the 4000 PARENT account'
);
select ok(
  (select a.parent_id is null from public.accounts a
    where a.org_id = :'orgA' and a.code = '4000'),
  '4000 is the revenue parent, which is why a historical sale never posts to it'
);
select is(
  (select count(*)::int from public.accounts a
    where a.org_id = :'orgA'
      and a.code = any (private.fn_reconciliation_historical_revenue_codes())
      and a.parent_id = (select id from public.accounts where org_id = :'orgA' and code = '4000')
      and a.active),
  6, 'all six typed revenue leaves exist and hang off 4000'
);

-- ── authorization ─────────────────────────────────────────────────────────────────────────────────
select pg_temp.make_batch('a0000000-0000-0000-0000-000000000001', 'approved');
select pg_temp.add_sale_row(
  'a0000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000001', 'authz-row', 10, current_date
);
select pg_temp.as_user(current_setting('t.acct'));
select throws_ok(
  $$select public.fn_execute_reconciliation_batch('a0000000-0000-0000-0000-000000000001'::uuid)$$,
  '42501', null, 'an accountant cannot execute sale reconciliation money writes'
);
reset role;
select pg_temp.as_user(current_setting('t.fmgr'));
select throws_ok(
  $$select public.fn_execute_reconciliation_batch('a0000000-0000-0000-0000-000000000001'::uuid)$$,
  '42501', null, 'a farm manager cannot execute sale reconciliation'
);
reset role;
-- CROSS-TENANT EXISTENCE ORACLE. A caller outside the org must not be able to tell an EXISTING batch
-- belonging to someone else apart from a uuid that exists nowhere. Both are resolved through org
-- membership and fall out as the same not-found, with the same SQLSTATE and the same message — so the
-- pair below is asserted to be IDENTICAL, not merely each non-'executed'.
select pg_temp.as_user('11111111-2222-3333-4444-555555555555');
select throws_ok(
  $$select public.fn_execute_reconciliation_batch('a0000000-0000-0000-0000-000000000001'::uuid)$$,
  'P0002', 'reconciliation batch not found',
  'an existing batch outside the caller org is indistinguishable from a missing one'
);
select throws_ok(
  $$select public.fn_execute_reconciliation_batch('ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)$$,
  'P0002', 'reconciliation batch not found',
  'a uuid that exists nowhere returns that same not-found response'
);
reset role;
-- Prove the two responses are byte-identical rather than merely both P0002: capture SQLSTATE and
-- message text for each and compare. A future change that reintroduced a distinct 'cross-org' message
-- would keep both SQLSTATEs at 42501/P0002-ish and still leak, so the message is compared too.
create or replace function pg_temp.exec_error(p_batch uuid) returns text language plpgsql as $$
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
select pg_temp.as_user('11111111-2222-3333-4444-555555555555');
select is(
  pg_temp.exec_error('a0000000-0000-0000-0000-000000000001'),
  pg_temp.exec_error('ffffffff-ffff-ffff-ffff-ffffffffffff'),
  'the cross-org and unknown-uuid responses are the SAME sqlstate and the SAME message'
);
select is(
  pg_temp.exec_error('a0000000-0000-0000-0000-000000000001'),
  'P0002|reconciliation batch not found',
  'and that shared response is the redacted not-found, never a cross-org disclosure'
);
reset role;
-- A NON-OWNER MEMBER still gets the owner verdict. The normalization must not have collapsed the role
-- check into not-found for people who legitimately see the batch — that would be a real loss of
-- diagnosability, and it also proves the not-found above is genuinely about MEMBERSHIP, not about the
-- owner check swallowing everything.
select pg_temp.as_user(current_setting('t.acct'));
select is(
  pg_temp.exec_error('a0000000-0000-0000-0000-000000000001'),
  '42501|forbidden: only an owner may execute reconciliation',
  'a non-owner MEMBER still gets the owner verdict, not the not-found response'
);
reset role;

select pg_temp.make_batch('a0000000-0000-0000-0000-000000000002', 'reviewed');
select pg_temp.add_sale_row(
  'a0000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002',
  'a2000000-0000-0000-0000-000000000002', 'not-approved-row', 10, current_date
);
select pg_temp.as_user(current_setting('t.owner'));
select throws_ok(
  $$select public.fn_execute_reconciliation_batch('a0000000-0000-0000-0000-000000000002'::uuid)$$,
  '22023', null, 'the owner cannot execute a non-approved sale batch'
);
reset role;

-- ── positive sale addition: the proven historical cash-in contract ────────────────────────────────
select pg_temp.make_batch('a0000000-0000-0000-0000-000000000010');
select pg_temp.add_sale_row(
  'a0000000-0000-0000-0000-000000000010', 'a1000000-0000-0000-0000-000000000010',
  'a2000000-0000-0000-0000-000000000010', 'addition-row', 1234.56, '2024-05-04',
  'برحي', null, 12, 102.88, 1234.56, '2024-05-04', 'use_source_text_date',
  null, null,
  null, null, null
);
select set_config('t.sales_before', (select count(*)::text from public.sales), false);
select pg_temp.as_user(current_setting('t.owner'));
select set_config('t.rev_before_add',
  (public.fn_revenue_sales_report(:'orgA', '2024-01-01', '2024-12-31', '2024-12-31'))::text, false);
select is(
  (public.fn_execute_reconciliation_batch('a0000000-0000-0000-0000-000000000010'))->>'status',
  'executed', 'the owner executes an approved historical sale addition'
);
reset role;
select is(
  (select count(*)::int from public.sales) - current_setting('t.sales_before')::int,
  1, 'a sale addition creates exactly one sale'
);
select set_config('t.sale_added', (
  select target_id::text from public.reconciliation_action_links
   where batch_id = 'a0000000-0000-0000-0000-000000000010' and action_kind = 'addition'
), false);
select is(
  (select total from public.sales where id = current_setting('t.sale_added')::uuid),
  1234.56::numeric, 'the addition preserves the reviewed amount exactly'
);
select is(
  (select sale_date from public.sales where id = current_setting('t.sale_added')::uuid),
  '2024-05-04'::date, 'the addition posts on the reviewed effective date'
);
select is(
  (select price_status from public.sales where id = current_setting('t.sale_added')::uuid),
  'finalized', 'the addition is a priced sale, never left pending'
);
select is(
  (select payment_status from public.sales where id = current_setting('t.sale_added')::uuid),
  'historical_treasury', 'the addition is durably marked a historical treasury sale'
);
select is(
  (select unit_price from public.sales where id = current_setting('t.sale_added')::uuid),
  102.88::numeric, 'the addition preserves the reviewed unit price'
);
select ok(
  (select buyer_id is null from public.sales where id = current_setting('t.sale_added')::uuid),
  'the addition never fabricates a buyer'
);
select is(
  (select count(*)::int from public.sale_collections
    where sale_id = current_setting('t.sale_added')::uuid),
  0, 'the addition never records a collection'
);
select ok(
  (select je.source_type = 'sale' and je.source_id = al.target_id
      and je.status = 'posted' and je.entry_date = '2024-05-04'::date
     from public.reconciliation_action_links al
     join public.journal_entries je on je.id = al.journal_entry_id
    where al.batch_id = 'a0000000-0000-0000-0000-000000000010'
      and al.action_kind = 'addition'),
  'the addition journal uses the new sale as its stable source on the reviewed date'
);
select is(
  (select a.code from public.reconciliation_action_links al
     join public.journal_lines jl on jl.journal_entry_id = al.journal_entry_id and jl.debit > 0
     join public.accounts a on a.id = jl.account_id
    where al.batch_id = 'a0000000-0000-0000-0000-000000000010'),
  '1010', 'a historical sale DEBITS general treasury 1010 — cash in, not a receivable'
);
select is(
  (select a.code from public.reconciliation_action_links al
     join public.journal_lines jl on jl.journal_entry_id = al.journal_entry_id and jl.credit > 0
     join public.accounts a on a.id = jl.account_id
    where al.batch_id = 'a0000000-0000-0000-0000-000000000010'),
  '4010', 'a برحي sale CREDITS the typed revenue leaf 4010, never the 4000 parent'
);
select is(
  (select count(*)::int from public.reconciliation_action_links al
     join public.journal_lines jl on jl.journal_entry_id = al.journal_entry_id
     join public.accounts a on a.id = jl.account_id
    where al.batch_id = 'a0000000-0000-0000-0000-000000000010'
      and a.code in ('1200', '1100', '4000', '1000')),
  0, 'a historical sale never touches receivable 1200, sales cash 1100, parent 4000, or custody 1000'
);
select is(
  (select round(sum(jl.debit) - sum(jl.credit), 2)
     from public.journal_lines jl
     join public.reconciliation_action_links al on al.journal_entry_id = jl.journal_entry_id
    where al.batch_id = 'a0000000-0000-0000-0000-000000000010'),
  0::numeric, 'the addition journal balances'
);
select is(
  (select count(*)::int from public.journal_lines jl
     join public.reconciliation_action_links al on al.journal_entry_id = jl.journal_entry_id
    where al.batch_id = 'a0000000-0000-0000-0000-000000000010'),
  2, 'the addition posts exactly the proven two-line entry'
);
select is(
  (select status from public.reconciliation_execution_ledger
    where evidence_item_id = 'a1000000-0000-0000-0000-000000000010'),
  'executed', 'the addition records the execution ledger'
);
select is(
  (select execution_result from public.reconciliation_batch_rows
    where id = 'a2000000-0000-0000-0000-000000000010'),
  'posted', 'the addition marks its frozen row posted'
);
select is(
  (select sales_count from public.reconciliation_baselines
    where batch_id = 'a0000000-0000-0000-0000-000000000010'),
  current_setting('t.sales_before')::int,
  'the baseline captured the real pre-execution sales count, not a hardcoded zero'
);

-- ── the revenue / A-R report defect is closed for historical cash-in sales ────────────────────────
select pg_temp.as_user(current_setting('t.owner'));
select set_config('t.rev_after_add',
  (public.fn_revenue_sales_report(:'orgA', '2024-01-01', '2024-12-31', '2024-12-31'))::text, false);
reset role;
select is(
  (current_setting('t.rev_after_add')::jsonb->>'outstanding_total')::numeric,
  (current_setting('t.rev_before_add')::jsonb->>'outstanding_total')::numeric,
  'a historical cash-in sale adds NOTHING to outstanding receivables'
);
select is(
  (current_setting('t.rev_after_add')::jsonb->>'finalized_revenue')::numeric,
  (current_setting('t.rev_before_add')::jsonb->>'finalized_revenue')::numeric + 1234.56,
  'a historical cash-in sale IS counted as finalized revenue'
);
select is(
  (select count(*)::int
     from jsonb_array_elements(current_setting('t.rev_after_add')::jsonb->'ar_rows') r
    where r->>'sale_id' = current_setting('t.sale_added')),
  0, 'a historical cash-in sale never appears in the A-R aging rows'
);
select is(
  (select (r->>'outstanding')::numeric
     from jsonb_array_elements(current_setting('t.rev_after_add')::jsonb->'sales') r
    where r->>'sale_id' = current_setting('t.sale_added')),
  0::numeric,
  'the historical sale reports outstanding = 0 despite having zero sale_collections rows'
);
select is(
  (current_setting('t.rev_after_add')::jsonb->>'over_30_amount')::numeric,
  (current_setting('t.rev_before_add')::jsonb->>'over_30_amount')::numeric,
  'a historical cash-in sale never ages into the over-30 A-R bucket'
);

-- An OPERATIONAL receivable is still reported exactly as before (no collateral damage).
insert into public.buyers(id, org_id, name) values
  ('a8000000-0000-0000-0000-000000000001', :'orgA', 'مشتري تشغيلي');
insert into public.sales(
  id, org_id, sale_date, crop, qty, unit, unit_price, total,
  price_status, price_finalized_at, payment_status, buyer_id
) values (
  'a9000000-0000-0000-0000-000000000001', :'orgA', '2024-06-01', 'برحي', 1, 'كجم',
  500, 500, 'finalized', now(), 'unpaid', 'a8000000-0000-0000-0000-000000000001'
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (select (r->>'outstanding')::numeric
     from jsonb_array_elements(
       (public.fn_revenue_sales_report(:'orgA', '2024-01-01', '2024-12-31', '2024-12-31'))->'sales'
     ) r
    where r->>'sale_id' = 'a9000000-0000-0000-0000-000000000001'),
  500::numeric, 'an operational unpaid sale still reports its full outstanding receivable'
);
reset role;

-- ── P1: a historical sale is SETTLED CASH, so it must register as collected, not merely as zero A/R ──
-- It has no `sale_collections` detail row and by contract never can (the guard refuses one), so a
-- report that only sums that table understates collected-to-date and period collections. This is the
-- 25.8m-equivalent semantics: revenue recognised AND cash recognised, receivable zero.
select pg_temp.as_user(current_setting('t.owner'));
select set_config('t.rev_cash',
  (public.fn_revenue_sales_report(:'orgA', '2024-05-01', '2024-05-31', '2024-05-31'))::text, false);
reset role;
select is(
  (select (r->>'collected_to_as_of')::numeric
     from jsonb_array_elements(current_setting('t.rev_cash')::jsonb->'sales') r
    where r->>'sale_id' = current_setting('t.sale_added')),
  1234.56::numeric,
  'a historical sale reports its own total as collected-to-as-of — it was settled in cash at posting'
);
select is(
  (select (r->>'collected_in_period')::numeric
     from jsonb_array_elements(current_setting('t.rev_cash')::jsonb->'sales') r
    where r->>'sale_id' = current_setting('t.sale_added')),
  1234.56::numeric,
  'a historical sale settled inside the window counts as collected IN PERIOD'
);
select is(
  (current_setting('t.rev_cash')::jsonb->>'period_collections')::numeric,
  1234.56::numeric,
  'period_collections includes the historical settlement even though no collection row exists'
);
select is(
  (current_setting('t.rev_cash')::jsonb->>'finalized_revenue')::numeric,
  1234.56::numeric,
  'revenue and cash agree for a historical cash-in sale — the sheet-exact reconciliation semantics'
);
select is(
  (current_setting('t.rev_cash')::jsonb->>'outstanding_total')::numeric,
  0::numeric, 'and the receivable is still zero'
);
select is(
  (select count(*)::int from public.sale_collections
    where sale_id = current_setting('t.sale_added')::uuid),
  0, 'no collection DETAIL row was invented — the settlement is derived, not fabricated'
);
select is(
  (select count(*)::int
     from jsonb_array_elements(current_setting('t.rev_cash')::jsonb->'collections') r
    where r->>'sale_id' = current_setting('t.sale_added')),
  0, 'the historical settlement never appears as a collection line item'
);
-- As-of discipline: before the sale's economic date it is neither revenue nor cash.
select pg_temp.as_user(current_setting('t.owner'));
select is(
  ((public.fn_revenue_sales_report(:'orgA', '2024-01-01', '2024-04-30', '2024-04-30'))
    ->>'period_collections')::numeric,
  0::numeric,
  'a historical settlement does not leak into a period that ends before its economic date'
);
select is(
  (select (r->>'collected_to_as_of')::numeric
     from jsonb_array_elements(
       (public.fn_revenue_sales_report(:'orgA', '2024-01-01', '2024-12-31', '2024-04-30'))->'sales'
     ) r
    where r->>'sale_id' = current_setting('t.sale_added')),
  0::numeric, 'collected-to-as-of respects an as-of date earlier than the settlement'
);
reset role;
-- The report's own economic-date fallback must be timezone-pinned too. A historical sale with NO
-- sale_date falls back to created_at, which is timestamptz: a bare `::date` would resolve against
-- the READER's session zone, so the same sale could sit inside or outside a period boundary
-- depending on who ran the report.
insert into public.sales(
  id, org_id, crop, qty, unit, unit_price, total,
  price_status, price_finalized_at, payment_status, created_at
) values (
  'd5000000-0000-0000-0000-000000000001', :'orgA', 'برحي', 1, 'كجم', 640, 640,
  'finalized', now(), 'unpaid', '2024-03-01 00:30:00+00'
);
insert into public.journal_entries(
  id, org_id, entry_date, source_type, source_id, source_sequence, description, status, posted_at
) values (
  'd6000000-0000-0000-0000-000000000001', :'orgA', '2024-03-01', 'sale',
  'd5000000-0000-0000-0000-000000000001', 1, 'report tz probe', 'posted', now()
);
insert into public.journal_lines(org_id, journal_entry_id, account_id, debit, credit) values
  (:'orgA', 'd6000000-0000-0000-0000-000000000001', current_setting('t.cash')::uuid, 640, 0),
  (:'orgA', 'd6000000-0000-0000-0000-000000000001', current_setting('t.rev4010')::uuid, 0, 640);
update public.sales set payment_status = 'historical_treasury'
 where id = 'd5000000-0000-0000-0000-000000000001';

create or replace function pg_temp.march_first_settlement() returns numeric language sql as $$
  select coalesce((
    select (r->>'collected_to_as_of')::numeric
      from jsonb_array_elements(
        (public.fn_revenue_sales_report(
          '00000000-0000-0000-0000-000000000001', '2024-03-01', '2024-03-01', '2024-03-01'))->'sales'
      ) r
     where r->>'sale_id' = 'd5000000-0000-0000-0000-000000000001'), -1);
$$;
select pg_temp.as_user(current_setting('t.owner'));
set local timezone = 'UTC';
select is(pg_temp.march_first_settlement(), 640::numeric,
  'a null-sale_date historical sale settles on its pinned-UTC economic date (UTC session)');
set local timezone = 'America/New_York';
select is(pg_temp.march_first_settlement(), 640::numeric,
  'the report economic-date fallback is INVARIANT under a westward reader timezone');
set local timezone = 'Asia/Tokyo';
select is(pg_temp.march_first_settlement(), 640::numeric,
  'the report economic-date fallback is INVARIANT under an eastward reader timezone');
set local timezone = 'Africa/Cairo';
select is(pg_temp.march_first_settlement(), 640::numeric,
  'the report economic-date fallback is INVARIANT under the tenant timezone');
reset timezone;
reset role;

-- An OPERATIONAL sale's collection behaviour is untouched by all of the above.
insert into public.sale_collections(id, org_id, sale_id, amount, occurred_at)
values ('a9100000-0000-0000-0000-000000000001', :'orgA',
        'a9000000-0000-0000-0000-000000000001', 200, '2024-06-10');
select pg_temp.as_user(current_setting('t.owner'));
select set_config('t.rev_op',
  (public.fn_revenue_sales_report(:'orgA', '2024-06-01', '2024-06-30', '2024-06-30'))::text, false);
reset role;
select is(
  (select (r->>'collected_to_as_of')::numeric
     from jsonb_array_elements(current_setting('t.rev_op')::jsonb->'sales') r
    where r->>'sale_id' = 'a9000000-0000-0000-0000-000000000001'),
  200::numeric, 'an operational sale still reports only its REAL collections'
);
select is(
  (select (r->>'outstanding')::numeric
     from jsonb_array_elements(current_setting('t.rev_op')::jsonb->'sales') r
    where r->>'sale_id' = 'a9000000-0000-0000-0000-000000000001'),
  300::numeric, 'an operational sale still carries its genuine remaining receivable'
);
select is(
  (current_setting('t.rev_op')::jsonb->>'period_collections')::numeric,
  200::numeric, 'operational period_collections is unchanged by the historical branch'
);

-- ── replay and cross-batch idempotency ────────────────────────────────────────────────────────────
select set_config('t.je_after_add', (select count(*)::text from public.journal_entries), false);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch('a0000000-0000-0000-0000-000000000010'))->>'idempotent',
  'true', 'same-batch replay returns idempotently'
);
reset role;
select is(
  (select count(*)::int from public.journal_entries),
  current_setting('t.je_after_add')::int, 'same-batch replay creates no second journal'
);

select pg_temp.make_batch('a0000000-0000-0000-0000-000000000011');
insert into public.reconciliation_batch_rows(
  id, org_id, batch_id, evidence_item_id, review_state, reviewer_id, review_reason,
  reviewed_at, target_table, disposition, sale_crop, sale_quantity, sale_unit,
  sale_unit_price, sale_recorded_total, sale_historical_date_decision, sale_effective_date
) values (
  'a2000000-0000-0000-0000-000000000011', :'orgA', 'a0000000-0000-0000-0000-000000000011',
  'a1000000-0000-0000-0000-000000000010', 'reviewed', current_setting('t.acct')::uuid,
  'cross-batch replay', now(), 'sales', 'include', 'برحي', 12, 'كجم', 102.88, 1234.56,
  'use_source_text_date', '2024-05-04'
);
update public.reconciliation_batch_rows br
   set payload_hash = private.fn_reconciliation_execution_payload_hash(br),
       frozen = true, frozen_at = now(), review_state = 'frozen'
 where br.id = 'a2000000-0000-0000-0000-000000000011';
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch('a0000000-0000-0000-0000-000000000011'))->>'status',
  'executed', 'a second batch reviewing the same evidence completes without reposting'
);
reset role;
select is(
  (select execution_result from public.reconciliation_batch_rows
    where id = 'a2000000-0000-0000-0000-000000000011'),
  'skipped', 'cross-batch evidence replay marks the new review row skipped'
);
select is(
  (select count(*)::int from public.reconciliation_action_links
    where batch_id = 'a0000000-0000-0000-0000-000000000011'),
  0, 'cross-batch evidence replay creates no second money action'
);

-- ── zero-value sale addition: explicit, deterministic no-op ───────────────────────────────────────
select pg_temp.make_batch('a0000000-0000-0000-0000-000000000012');
select pg_temp.add_sale_row(
  'a0000000-0000-0000-0000-000000000012', 'a1000000-0000-0000-0000-000000000012',
  'a2000000-0000-0000-0000-000000000012', 'zero-sale-row', 0, current_date,
  'برحي', null, 0, 0, 0
);
select set_config('t.sales_before_zero', (select count(*)::text from public.sales), false);
select set_config('t.je_before_zero', (select count(*)::text from public.journal_entries), false);
select pg_temp.as_user(current_setting('t.owner'));
select set_config('t.zero_result',
  (public.fn_execute_reconciliation_batch('a0000000-0000-0000-0000-000000000012'))::text, false);
reset role;
select is(current_setting('t.zero_result')::jsonb->>'status', 'executed',
  'a zero-value sale executes as an explicit no-op');
select is(current_setting('t.zero_result')::jsonb->>'skipped_rows', '1',
  'a zero-value sale addition is counted as skipped, not executed');
select is(current_setting('t.zero_result')::jsonb->>'executed_rows', '0',
  'a zero-value sale addition contributes nothing to the executed count');
select is((select count(*)::int from public.sales), current_setting('t.sales_before_zero')::int,
  'a zero-value sale creates no sale row');
select is((select count(*)::int from public.journal_entries), current_setting('t.je_before_zero')::int,
  'a zero-value sale creates no journal');
select is(
  (select action_kind from public.reconciliation_action_links
    where batch_id = 'a0000000-0000-0000-0000-000000000012'),
  'zero_value_noop', 'a zero-value sale records an auditable no-op link');
select is(
  (select execution_result from public.reconciliation_batch_rows
    where id = 'a2000000-0000-0000-0000-000000000012'),
  'skipped', 'a zero-value sale row records a durable skipped result');
select is(
  (select status from public.reconciliation_execution_ledger
    where evidence_item_id = 'a1000000-0000-0000-0000-000000000012'),
  'executed', 'a zero-value sale is claimed so it cannot be replayed');

-- ── exact correction: reverse the proven original, post the reviewed replacement ──────────────────
select pg_temp.make_historical_sale(
  'b5000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000001',
  'b7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000002',
  4000, '2024-03-10', 'برحي'
);
select is(
  (select payment_status from public.sales where id = 'b5000000-0000-0000-0000-000000000001'),
  'historical_treasury',
  'the lifecycle guard ACCEPTS a claim backed by the exact proven direct-treasury journal'
);
select pg_temp.make_batch('a0000000-0000-0000-0000-000000000060');
select pg_temp.add_sale_row(
  'a0000000-0000-0000-0000-000000000060', 'a1000000-0000-0000-0000-000000000060',
  'a2000000-0000-0000-0000-000000000060', 'correction-row', 5500, '2024-03-10',
  'برحي', 'b5000000-0000-0000-0000-000000000001', 10, 550, 5500, '2024-03-10'
);
select pg_temp.as_user(current_setting('t.owner'));
select set_config('t.rev_before_corr',
  (public.fn_revenue_sales_report(:'orgA', '2024-01-01', '2024-12-31', '2024-12-31'))::text, false);
select set_config('t.tb_before_corr',
  (select round(sum((r->>'debit')::numeric - (r->>'credit')::numeric), 2)::text
     from jsonb_array_elements(public.fn_accounting_trial_balance(:'orgA')) r), false);
select is(
  (public.fn_execute_reconciliation_batch('a0000000-0000-0000-0000-000000000060'))->>'status',
  'executed', 'an exact historical sale correction executes atomically'
);
reset role;
select is(
  (select total from public.sales where id = 'b5000000-0000-0000-0000-000000000001'),
  4000::numeric, 'the correction leaves the original sale amount untouched'
);
select is(
  (select sale_date from public.sales where id = 'b5000000-0000-0000-0000-000000000001'),
  '2024-03-10'::date, 'the correction leaves the original sale date untouched'
);
select is(
  (select payment_status from public.sales where id = 'b5000000-0000-0000-0000-000000000001'),
  'historical_reversed', 'the correction durably excludes the reversed original'
);
select is(
  (select status from public.journal_entries where id = 'b6000000-0000-0000-0000-000000000001'),
  'reversed', 'the correction reverses the original posted journal'
);
select is(
  (select count(*)::int from public.reconciliation_baseline_journal_headers
    where batch_id = 'a0000000-0000-0000-0000-000000000060'),
  1, 'the correction snapshots the exact original sale journal header'
);
select is(
  (select count(*)::int from public.reconciliation_baseline_journal_lines bl
     join public.reconciliation_baseline_journal_headers bh on bh.id = bl.baseline_journal_header_id
    where bh.batch_id = 'a0000000-0000-0000-0000-000000000060'),
  2, 'the correction snapshots every original sale journal line'
);
select is(
  (select source_type from public.reconciliation_baseline_journal_headers
    where batch_id = 'a0000000-0000-0000-0000-000000000060'),
  'sale', 'the sale snapshot is typed as a sale, not mislabelled as an expense'
);
select is(
  (select total from public.sales where corrects_sale_id = 'b5000000-0000-0000-0000-000000000001'),
  5500::numeric, 'the correction creates the reviewed replacement sale'
);
select is(
  (select payment_status from public.sales
    where corrects_sale_id = 'b5000000-0000-0000-0000-000000000001'),
  'historical_treasury', 'the replacement is durably posted through general treasury'
);
select is(
  (select count(*)::int from public.reconciliation_action_links
    where batch_id = 'a0000000-0000-0000-0000-000000000060'
      and action_kind in ('correction_reversal', 'correction_replacement')),
  2, 'the correction records explicit reversal and replacement links'
);
select is(
  (select count(*)::int from public.reconciliation_action_links
    where batch_id = 'a0000000-0000-0000-0000-000000000060' and target_table = 'sales'),
  2, 'both correction links are typed against the sales domain'
);
-- The reversal must be the exact inverse: same accounts, debit/credit swapped, same total.
select is(
  (select round(sum(jl.debit) - sum(jl.credit), 2)
     from public.journal_lines jl
     join public.journal_entries je on je.id = jl.journal_entry_id
    where je.reversal_of = 'b6000000-0000-0000-0000-000000000001'),
  0::numeric, 'the sale reversal journal balances'
);
select is(
  (select a.code from public.journal_entries je
     join public.journal_lines jl on jl.journal_entry_id = je.id and jl.credit > 0
     join public.accounts a on a.id = jl.account_id
    where je.reversal_of = 'b6000000-0000-0000-0000-000000000001'),
  '1010', 'the sale reversal CREDITS treasury 1010 — the exact inverse of the original debit'
);
select is(
  (select a.code from public.journal_entries je
     join public.journal_lines jl on jl.journal_entry_id = je.id and jl.debit > 0
     join public.accounts a on a.id = jl.account_id
    where je.reversal_of = 'b6000000-0000-0000-0000-000000000001'),
  '4010', 'the sale reversal DEBITS the original typed revenue leaf'
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (select round(sum((r->>'debit')::numeric - (r->>'credit')::numeric), 2)
     from jsonb_array_elements(public.fn_accounting_trial_balance(:'orgA')) r),
  current_setting('t.tb_before_corr')::numeric,
  'the correction leaves the trial balance balanced'
);
select set_config('t.rev_after_corr',
  (public.fn_revenue_sales_report(:'orgA', '2024-01-01', '2024-12-31', '2024-12-31'))::text, false);
reset role;
select is(
  (current_setting('t.rev_after_corr')::jsonb->>'finalized_revenue')::numeric,
  (current_setting('t.rev_before_corr')::jsonb->>'finalized_revenue')::numeric + 1500,
  'revenue replaces 4000 with 5500 instead of double-counting both sales'
);
select is(
  (current_setting('t.rev_after_corr')::jsonb->>'outstanding_total')::numeric,
  (current_setting('t.rev_before_corr')::jsonb->>'outstanding_total')::numeric,
  'the correction changes no receivable'
);
select is(
  (select count(*)::int
     from jsonb_array_elements(current_setting('t.rev_after_corr')::jsonb->'sales') r
    where r->>'sale_id' = 'b5000000-0000-0000-0000-000000000001'),
  0, 'the reversed original leaves the revenue report entirely'
);

-- ── P1: an approved manual reclassification survives a correction ─────────────────────────────────
-- 20260708090000 moved three palm-TREE disposals from 4010 to 4090 by PINNED sale_id; their crop
-- text still matches the 4010 keywords, so re-deriving the leaf from the crop would reverse 4090 and
-- replace into 4010 — silently undoing the accountant's decision and moving money between revenue
-- lines. A correction restates an AMOUNT; it must inherit the leaf the original actually used.
select pg_temp.make_historical_sale(
  'ca000000-0000-0000-0000-000000000001', 'cb000000-0000-0000-0000-000000000001',
  'cc000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000002',
  256600, '2023-03-15',
  'النخيل المجدول والخلاص بالخطارة حتي تاريخ 15-03-2023م',
  current_setting('t.rev4090')::uuid          -- manually reclassed 4010 -> 4090, exactly as in prod
);
-- The crop genuinely maps to 4010: this is precisely the trap.
select is(
  private.fn_reconciliation_historical_sale_revenue_code(
    'النخيل المجدول والخلاص بالخطارة حتي تاريخ 15-03-2023م'),
  '4010',
  'the palm-disposal crop still maps to 4010 — so a crop-derived correction WOULD have reclassed it'
);
select pg_temp.make_batch('a0000000-0000-0000-0000-0000000000e0');
select pg_temp.add_sale_row(
  'a0000000-0000-0000-0000-0000000000e0', 'a1000000-0000-0000-0000-0000000000e0',
  'a2000000-0000-0000-0000-0000000000e0', 'palm-disposal-correction', 270000, '2023-03-15',
  'النخيل المجدول والخلاص بالخطارة حتي تاريخ 15-03-2023م',
  'ca000000-0000-0000-0000-000000000001', 1, 270000, 270000, '2023-03-15'
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch('a0000000-0000-0000-0000-0000000000e0'))->>'status',
  'executed', 'a correction of a reclassified palm-disposal sale executes'
);
reset role;
select is(
  (select a.code from public.journal_entries je
     join public.journal_lines jl on jl.journal_entry_id = je.id and jl.debit > 0
     join public.accounts a on a.id = jl.account_id
    where je.reversal_of = 'cb000000-0000-0000-0000-000000000001'),
  '4090', 'the REVERSAL debits 4090 — the leaf the original was actually posted to'
);
select is(
  (select a.code from public.reconciliation_action_links al
     join public.journal_lines jl on jl.journal_entry_id = al.journal_entry_id and jl.credit > 0
     join public.accounts a on a.id = jl.account_id
    where al.batch_id = 'a0000000-0000-0000-0000-0000000000e0'
      and al.action_kind = 'correction_replacement'),
  '4090',
  'the REPLACEMENT also credits 4090 — the approved reclassification is preserved, not re-derived'
);
select is(
  (select count(*)::int from public.reconciliation_action_links al
     join public.journal_lines jl on jl.journal_entry_id = al.journal_entry_id
     join public.accounts a on a.id = jl.account_id
    where al.batch_id = 'a0000000-0000-0000-0000-0000000000e0' and a.code = '4010'),
  0, 'no leg of the correction touches 4010, so no revenue is silently reclassified'
);
-- Net effect on the two revenue lines: 4090 moves by exactly the amount delta, 4010 not at all.
select is(
  (select round(coalesce(sum(jl.credit), 0) - coalesce(sum(jl.debit), 0), 2)
     from public.journal_lines jl
     join public.journal_entries je on je.id = jl.journal_entry_id
     join public.accounts a on a.id = jl.account_id and a.code = '4090'
    where je.org_id = :'orgA' and je.source_id in (
      'ca000000-0000-0000-0000-000000000001',
      (select target_id from public.reconciliation_action_links
        where batch_id = 'a0000000-0000-0000-0000-0000000000e0'
          and action_kind = 'correction_replacement'))),
  270000::numeric,
  'net 4090 revenue equals the corrected amount — the original nets out, the replacement stands'
);

-- Changing the crop during a correction is a RECLASSIFICATION, and is refused outright.
select pg_temp.make_historical_sale(
  'ca000000-0000-0000-0000-000000000002', 'cb000000-0000-0000-0000-000000000002',
  'cc000000-0000-0000-0000-000000000003', 'cc000000-0000-0000-0000-000000000004',
  500, '2023-04-04', 'برحي'
);
select pg_temp.make_batch('a0000000-0000-0000-0000-0000000000e1');
select pg_temp.add_sale_row(
  'a0000000-0000-0000-0000-0000000000e1', 'a1000000-0000-0000-0000-0000000000e1',
  'a2000000-0000-0000-0000-0000000000e1', 'crop-change-correction', 600, '2023-04-04',
  'بنجر', 'ca000000-0000-0000-0000-000000000002', 1, 600, 600, '2023-04-04'
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch('a0000000-0000-0000-0000-0000000000e1'))->>'failure_code',
  'integrity_check',
  'a correction that changes the crop is refused — reclassification is a separate, explicit action'
);
reset role;
select is(
  (select status from public.journal_entries where id = 'cb000000-0000-0000-0000-000000000002'),
  'posted', 'the refused crop-change correction leaves the original posted'
);

-- ── zero-value correction: full reversal, no replacement ──────────────────────────────────────────
select pg_temp.make_historical_sale(
  'b5000000-0000-0000-0000-000000000003', 'b6000000-0000-0000-0000-000000000003',
  'b7000000-0000-0000-0000-000000000031', 'b7000000-0000-0000-0000-000000000032',
  2500, '2024-04-11', 'برحي'
);
select pg_temp.make_batch('a0000000-0000-0000-0000-000000000063');
select pg_temp.add_sale_row(
  'a0000000-0000-0000-0000-000000000063', 'a1000000-0000-0000-0000-000000000063',
  'a2000000-0000-0000-0000-000000000063', 'zero-correction-row', 0, '2024-04-11',
  'برحي', 'b5000000-0000-0000-0000-000000000003', 0, 0, 0, '2024-04-11'
);
select pg_temp.as_user(current_setting('t.owner'));
select set_config('t.rev_before_zero_corr',
  (public.fn_revenue_sales_report(:'orgA', '2024-01-01', '2024-12-31', '2024-12-31'))::text, false);
select set_config('t.zero_corr_result',
  (public.fn_execute_reconciliation_batch('a0000000-0000-0000-0000-000000000063'))::text, false);
select is(current_setting('t.zero_corr_result')::jsonb->>'status', 'executed',
  'a zero-value sale correction executes as a full reversal');
select is(current_setting('t.zero_corr_result')::jsonb->>'executed_rows', '1',
  'a zero-value sale correction stays counted as executed');
select is(current_setting('t.zero_corr_result')::jsonb->>'skipped_rows', '0',
  'a zero-value sale correction is never counted as skipped');
select is(
  ((public.fn_revenue_sales_report(:'orgA', '2024-01-01', '2024-12-31', '2024-12-31'))
    ->>'finalized_revenue')::numeric,
  (current_setting('t.rev_before_zero_corr')::jsonb->>'finalized_revenue')::numeric - 2500,
  'a zero-value sale correction removes the original amount from revenue'
);
reset role;
select is(
  (select payment_status from public.sales where id = 'b5000000-0000-0000-0000-000000000003'),
  'historical_reversed', 'a zero-value sale correction durably reverses the original');
select is(
  (select count(*)::int from public.sales
    where corrects_sale_id = 'b5000000-0000-0000-0000-000000000003'),
  0, 'a zero-value sale correction creates no replacement sale');
select is(
  (select execution_result from public.reconciliation_batch_rows
    where id = 'a2000000-0000-0000-0000-000000000063'),
  'reversed', 'a zero-value sale correction row records reversed, not skipped');

-- ── adversarial correction targets: every ineligible shape fails closed ───────────────────────────
-- Returns `setof text` (NOT void): pgTAP assertions RETURN their TAP line, so a helper that
-- `perform`ed them would advance the plan counter while silently swallowing every result — a
-- false green in which a failing assertion prints nothing at all.
create or replace function pg_temp.expect_correction_rejected(
  p_batch uuid, p_evidence uuid, p_row uuid, p_locator text,
  p_target uuid, p_date date, p_label text
) returns setof text language plpgsql as $$
declare v_before int; v_result jsonb;
begin
  perform pg_temp.make_batch(p_batch);
  perform pg_temp.add_sale_row(
    p_batch, p_evidence, p_row, p_locator, 999, p_date,
    'برحي', p_target, 1, 999, 999, p_date
  );
  select count(*) into v_before from public.sales;
  perform pg_temp.as_user(current_setting('t.owner'));
  v_result := public.fn_execute_reconciliation_batch(p_batch);
  reset role;
  return next is(v_result->>'failure_code', 'integrity_check', p_label);
  return next is((select count(*)::int from public.sales), v_before,
    p_label || ' — creates no sale');
  return next is(
    (select count(*)::int from public.reconciliation_action_links where batch_id = p_batch),
    0, p_label || ' — leaves no partial action');
end $$;

-- (1) a target carrying a real collection row (so it is genuinely receivable-backed)
select pg_temp.make_historical_sale(
  'b5000000-0000-0000-0000-000000000004', 'b6000000-0000-0000-0000-000000000004',
  'b7000000-0000-0000-0000-000000000041', 'b7000000-0000-0000-0000-000000000042',
  3000, '2024-02-02', 'برحي', null, null, null, null, false
);
insert into public.sale_collections(id, org_id, sale_id, amount, occurred_at)
values ('ba000000-0000-0000-0000-000000000001', :'orgA',
        'b5000000-0000-0000-0000-000000000004', 1000, '2024-02-03');
update public.sales set payment_status = 'partially_collected'
 where id = 'b5000000-0000-0000-0000-000000000004';
select * from pg_temp.expect_correction_rejected(
  'a0000000-0000-0000-0000-000000000070', 'a1000000-0000-0000-0000-000000000070',
  'a2000000-0000-0000-0000-000000000070', 'partly-collected-target',
  'b5000000-0000-0000-0000-000000000004', '2024-02-02',
  'a partially collected sale is rejected as a correction target'
);
select is(
  (select payment_status from public.sales where id = 'b5000000-0000-0000-0000-000000000004'),
  'partially_collected', 'the rejected partially collected target is left untouched'
);
select is(
  (select status from public.journal_entries where id = 'b6000000-0000-0000-0000-000000000004'),
  'posted', 'the rejected partially collected target keeps its posted journal'
);

-- (2) an OPERATIONAL A/R sale (Dr 1200 / Cr 4000) — the wrong economic contract entirely
insert into public.sales(
  id, org_id, sale_date, crop, qty, unit, unit_price, total,
  price_status, price_finalized_at, payment_status
) values (
  'b5000000-0000-0000-0000-000000000005', :'orgA', '2024-02-05', 'برحي', 1, 'كجم',
  3200, 3200, 'finalized', now(), 'unpaid'
);
insert into public.journal_entries(
  id, org_id, entry_date, source_type, source_id, source_sequence, description, status, posted_at
) values (
  'b6000000-0000-0000-0000-000000000005', :'orgA', '2024-02-05', 'sale',
  'b5000000-0000-0000-0000-000000000005', 1, 'operational receivable', 'posted', now()
);
insert into public.journal_lines(id, org_id, journal_entry_id, account_id, debit, credit) values
  ('b7000000-0000-0000-0000-000000000051', :'orgA', 'b6000000-0000-0000-0000-000000000005',
   public.fn_ensure_account(:'orgA', '1200', 'ذمم مدينة (عملاء)', 'asset', 'debit'), 3200, 0),
  ('b7000000-0000-0000-0000-000000000052', :'orgA', 'b6000000-0000-0000-0000-000000000005',
   current_setting('t.rev4000')::uuid, 0, 3200);
select * from pg_temp.expect_correction_rejected(
  'a0000000-0000-0000-0000-000000000071', 'a1000000-0000-0000-0000-000000000071',
  'a2000000-0000-0000-0000-000000000071', 'operational-ar-target',
  'b5000000-0000-0000-0000-000000000005', '2024-02-05',
  'an operational Dr1200/Cr4000 receivable sale is rejected as a correction target'
);

-- (3) an already-reversed historical target
select * from pg_temp.expect_correction_rejected(
  'a0000000-0000-0000-0000-000000000072', 'a1000000-0000-0000-0000-000000000072',
  'a2000000-0000-0000-0000-000000000072', 'already-reversed-target',
  'b5000000-0000-0000-0000-000000000003', '2024-04-11',
  'an already reversed historical sale is rejected as a correction target'
);

-- (4) an ambiguous target carrying TWO sale journals
select pg_temp.make_historical_sale(
  'b5000000-0000-0000-0000-000000000006', 'b6000000-0000-0000-0000-000000000006',
  'b7000000-0000-0000-0000-000000000061', 'b7000000-0000-0000-0000-000000000062',
  1800, '2024-02-08', 'برحي', null, null, null, null, false
);
insert into public.journal_entries(
  id, org_id, entry_date, source_type, source_id, source_sequence, description, status, posted_at
) values (
  'b6000000-0000-0000-0000-000000000007', :'orgA', '2024-02-08', 'sale',
  'b5000000-0000-0000-0000-000000000006', 2, 'ambiguous second entry', 'posted', now()
);
insert into public.journal_lines(id, org_id, journal_entry_id, account_id, debit, credit) values
  ('b7000000-0000-0000-0000-000000000071', :'orgA', 'b6000000-0000-0000-0000-000000000007',
   current_setting('t.cash')::uuid, 1800, 0),
  ('b7000000-0000-0000-0000-000000000072', :'orgA', 'b6000000-0000-0000-0000-000000000007',
   current_setting('t.rev4010')::uuid, 0, 1800);
select throws_ok(
  $$update public.sales set payment_status = 'historical_treasury'
     where id = 'b5000000-0000-0000-0000-000000000006'$$,
  '22023', null,
  'the lifecycle guard refuses to certify a sale carrying two journals'
);
select * from pg_temp.expect_correction_rejected(
  'a0000000-0000-0000-0000-000000000073', 'a1000000-0000-0000-0000-000000000073',
  'a2000000-0000-0000-0000-000000000073', 'ambiguous-two-journal-target',
  'b5000000-0000-0000-0000-000000000006', '2024-02-08',
  'a target with two sale journals is rejected as ambiguous'
);

-- (5) a target whose journal amount differs from the sale total
select pg_temp.make_historical_sale(
  'b5000000-0000-0000-0000-000000000008', 'b6000000-0000-0000-0000-000000000008',
  'b7000000-0000-0000-0000-000000000081', 'b7000000-0000-0000-0000-000000000082',
  2200, '2024-02-09', 'برحي', null, null, 2100, null, false
);
select throws_ok(
  $$update public.sales set payment_status = 'historical_treasury'
     where id = 'b5000000-0000-0000-0000-000000000008'$$,
  '22023', null,
  'the lifecycle guard refuses a sale whose journal amount differs from its total'
);
select * from pg_temp.expect_correction_rejected(
  'a0000000-0000-0000-0000-000000000074', 'a1000000-0000-0000-0000-000000000074',
  'a2000000-0000-0000-0000-000000000074', 'non-exact-amount-target',
  'b5000000-0000-0000-0000-000000000008', '2024-02-09',
  'a target whose journal amount differs from its total is rejected'
);

-- (6) a target whose journal entry_date is not the sale's economic date
select pg_temp.make_historical_sale(
  'b5000000-0000-0000-0000-000000000009', 'b6000000-0000-0000-0000-000000000009',
  'b7000000-0000-0000-0000-000000000091', 'b7000000-0000-0000-0000-000000000092',
  1400, '2024-02-10', 'برحي', null, null, null, '2024-02-20', false
);
select throws_ok(
  $$update public.sales set payment_status = 'historical_treasury'
     where id = 'b5000000-0000-0000-0000-000000000009'$$,
  '22023', null,
  'the lifecycle guard refuses a sale mis-periodised against its journal'
);

-- (7) a target credited to the 4000 PARENT rather than a typed revenue leaf
select pg_temp.make_historical_sale(
  'b5000000-0000-0000-0000-00000000000a', 'b6000000-0000-0000-0000-00000000000a',
  'b7000000-0000-0000-0000-0000000000a1', 'b7000000-0000-0000-0000-0000000000a2',
  1500, '2024-02-11', 'برحي', (select id from public.accounts where org_id = '00000000-0000-0000-0000-000000000001' and code = '4000'),
  null, null, null, false
);
select throws_ok(
  $$update public.sales set payment_status = 'historical_treasury'
     where id = 'b5000000-0000-0000-0000-00000000000a'$$,
  '22023', null,
  'the lifecycle guard refuses a sale credited to the 4000 parent account'
);

-- ── historical sale lifecycle guards ──────────────────────────────────────────────────────────────
select throws_ok(
  $$update public.sales set total = 9999
     where id = (select id from public.sales
                  where corrects_sale_id = 'b5000000-0000-0000-0000-000000000001')$$,
  '22023', null, 'a posted historical sale cannot be re-priced'
);
select throws_ok(
  $$update public.sales set sale_date = sale_date + 1
     where id = current_setting('t.sale_added')::uuid$$,
  '22023', null, 'a posted historical sale date cannot diverge from its journal period'
);
select throws_ok(
  $$update public.sales set crop = 'محصول آخر'
     where id = current_setting('t.sale_added')::uuid$$,
  '22023', null, 'a posted historical sale crop cannot be edited away from its revenue leaf'
);
select throws_ok(
  $$update public.sales set buyer_id = 'a8000000-0000-0000-0000-000000000001'
     where id = current_setting('t.sale_added')::uuid$$,
  '22023', null, 'a buyer cannot be grafted onto a posted historical sale'
);
select throws_ok(
  $$update public.sales set payment_status = 'collected'
     where id = current_setting('t.sale_added')::uuid$$,
  '22023', null, 'a posted historical sale cannot be rerouted into an operational payment state'
);
select throws_ok(
  $$update public.sales set payment_status = 'historical_reversed'
     where id = current_setting('t.sale_added')::uuid$$,
  '22023', null, 'a historical sale cannot be flagged reversed without a verified reversal'
);
select throws_ok(
  $$delete from public.sales where id = current_setting('t.sale_added')::uuid$$,
  '22023', null, 'a historical_treasury sale cannot be deleted'
);
select throws_ok(
  $$delete from public.sales where id = 'b5000000-0000-0000-0000-000000000001'$$,
  '22023', null, 'a historical_reversed sale cannot be deleted'
);
select throws_ok(
  $$update public.sales set crop = 'تلاعب'
     where id = 'b5000000-0000-0000-0000-000000000001'$$,
  '22023', null, 'a reversed historical sale stays immutable in every other column'
);
select lives_ok(
  $$update public.sales set reversed_by_rollback_at = now()
     where id = 'b5000000-0000-0000-0000-000000000001'$$,
  'reversed_by_rollback_at is the one permitted update on a reversed historical sale'
);
select throws_ok(
  $$update public.sales set notes = 'تلاعب', reversed_by_rollback_at = now()
     where id = 'b5000000-0000-0000-0000-000000000001'$$,
  '22023', null, 'the rollback stamp does not open a general edit path on a reversed sale'
);
insert into public.sales(id, org_id, sale_date, crop, qty, unit)
values ('b5000000-0000-0000-0000-0000000000ff', :'orgA', current_date, 'برحي', 1, 'كجم');
select lives_ok(
  $$delete from public.sales where id = 'b5000000-0000-0000-0000-0000000000ff'$$,
  'the delete guard leaves ordinary sales deletable'
);

-- ── the public reversal RPC fails CLOSED on a historical reconciliation sale journal ─────────────
-- `public.fn_reverse_journal_entry` (20260706081636) is granted to `authenticated` and gated on
-- `budget.write` — a permission the ACCOUNTANT holds. Without the private boundary, such a user could
-- reverse the journal behind a historical_treasury sale outside reconciliation, and the result is
-- UNRECOVERABLE rather than merely unlogged: the sale keeps `historical_treasury` (so the revenue
-- report keeps showing settled revenue and zero receivable), the lifecycle guard freezes every field,
-- DELETE is refused, and the proof helper then fails on it — so the executor refuses it as a
-- correction target too. The contract is therefore two-sided: the public path is DENIED, and the
-- owner-only executor still produces the exact inverse.
select ok(
  not has_function_privilege('authenticated',
    'private.fn_reverse_journal_entry_internal(uuid, text, date, boolean)', 'EXECUTE'),
  'the reversal helper is private — authenticated cannot reach it to assert the reconciliation context'
);
select ok(
  not has_function_privilege('anon',
    'private.fn_reverse_journal_entry_internal(uuid, text, date, boolean)', 'EXECUTE'),
  'and anon cannot reach the reversal helper either'
);
select ok(
  has_function_privilege('authenticated', 'public.fn_reverse_journal_entry(uuid, text, date)', 'EXECUTE'),
  'the public reversal RPC retains its ordinary authenticated route'
);
select ok(
  (select p.proconfig[1] = 'search_path=""' from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'fn_reverse_journal_entry_internal'),
  'the private reversal helper pins an empty search path'
);
select ok(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'fn_reverse_journal_entry'),
  'the public reversal RPC is still SECURITY DEFINER, so it can reach the private helper'
);

select pg_temp.make_historical_sale(
  'f1000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001',
  'f3000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000002',
  7200, '2024-05-20', 'برحي'
);
select is(
  (select payment_status from public.sales where id = 'f1000000-0000-0000-0000-000000000001'),
  'historical_treasury', 'the bypass target is a certified historical treasury sale'
);
select pg_temp.as_user(current_setting('t.acct'));
-- NON-VACUITY: if the accountant did not hold budget.write the denial below would prove nothing,
-- because the RPC would have refused them anyway.
select ok(
  public.authorize('budget.write', '00000000-0000-0000-0000-000000000001'::uuid),
  'non-vacuity: the accountant really does hold the budget.write permission this RPC gates on'
);
select throws_ok(
  $$select public.fn_reverse_journal_entry(
      'f2000000-0000-0000-0000-000000000001'::uuid, 'محاولة عكس مباشرة', '2024-05-20'::date)$$,
  '42501', null,
  'an accountant WITH budget.write cannot reverse a historical treasury sale journal directly'
);
reset role;
select pg_temp.as_user(current_setting('t.owner'));
select throws_ok(
  $$select public.fn_reverse_journal_entry(
      'f2000000-0000-0000-0000-000000000001'::uuid, 'محاولة عكس مباشرة', '2024-05-20'::date)$$,
  '42501', null,
  'and neither can the OWNER on the public path — the boundary is the PATH, not the role'
);
reset role;
select is(
  (select status from public.journal_entries where id = 'f2000000-0000-0000-0000-000000000001'),
  'posted', 'the refused direct reversal leaves the original journal posted'
);
select is(
  (select count(*)::int from public.journal_entries
    where reversal_of = 'f2000000-0000-0000-0000-000000000001'),
  0, 'the refused direct reversal created no mirror entry'
);
select is(
  (select payment_status from public.sales where id = 'f1000000-0000-0000-0000-000000000001'),
  'historical_treasury',
  'and the sale is left in the correctable state rather than stranded as unsupported revenue'
);
select ok(
  private.fn_reconciliation_sale_has_exact_historical_journal(
    'f1000000-0000-0000-0000-000000000001'),
  'the sale still satisfies the proof, so the executor can still correct it — the damage never happened'
);

-- The other half: the owner-only executor DOES produce exactly the correction the public path refused.
select pg_temp.make_batch('a0000000-0000-0000-0000-0000000000f8');
select pg_temp.add_sale_row(
  'a0000000-0000-0000-0000-0000000000f8', 'a1000000-0000-0000-0000-0000000000f8',
  'a2000000-0000-0000-0000-0000000000f8', 'bypass-then-correct', 7500, '2024-05-20',
  'برحي', 'f1000000-0000-0000-0000-000000000001', 10, 750, 7500, '2024-05-20'
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch('a0000000-0000-0000-0000-0000000000f8'))->>'status',
  'executed',
  'the owner-only executor still produces the correction the public reversal path was denied'
);
reset role;
select is(
  (select status from public.journal_entries where id = 'f2000000-0000-0000-0000-000000000001'),
  'reversed', 'the executor reversed the original journal through the private boundary'
);
select is(
  (select payment_status from public.sales where id = 'f1000000-0000-0000-0000-000000000001'),
  'historical_reversed', 'and the sale state moved WITH its journal, which is the whole point'
);
select is(
  (select a.code from public.journal_entries je
     join public.journal_lines jl on jl.journal_entry_id = je.id and jl.credit > 0
     join public.accounts a on a.id = jl.account_id
    where je.reversal_of = 'f2000000-0000-0000-0000-000000000001'),
  '1010', 'the executor reversal is still the EXACT inverse — treasury 1010 is credited'
);
select is(
  (select round(sum(jl.debit) - sum(jl.credit), 2) from public.journal_lines jl
     join public.journal_entries je on je.id = jl.journal_entry_id
    where je.reversal_of = 'f2000000-0000-0000-0000-000000000001'),
  0::numeric, 'and the executor reversal balances'
);
-- A `historical_reversed` journal is refused too. Without covering it, the already-reversed branch of
-- the RPC would idempotently hand a caller back the reconciliation reversal's id.
select pg_temp.as_user(current_setting('t.acct'));
select throws_ok(
  $$select public.fn_reverse_journal_entry(
      'f2000000-0000-0000-0000-000000000001'::uuid, 'محاولة ثانية', '2024-05-21'::date)$$,
  '42501', null,
  'a historical_REVERSED sale journal is refused too, not answered idempotently'
);
reset role;
-- The REPLACEMENT the executor just posted is itself historical_treasury, so it is protected as well.
select set_config('t.bypass_replacement_journal', (
  select al.journal_entry_id::text from public.reconciliation_action_links al
   where al.batch_id = 'a0000000-0000-0000-0000-0000000000f8'
     and al.action_kind = 'correction_replacement'
), false);
select pg_temp.as_user(current_setting('t.acct'));
select throws_ok(
  format($$select public.fn_reverse_journal_entry(%L::uuid, 'عكس البديل', '2024-05-20'::date)$$,
         current_setting('t.bypass_replacement_journal')),
  '42501', null,
  'the replacement journal the executor just posted is protected by the same boundary'
);
reset role;

-- REGRESSION: ordinary OPERATIONAL and EXPENSE reversals through the public RPC are untouched.
insert into public.sales(
  id, org_id, sale_date, crop, qty, unit, unit_price, total,
  price_status, price_finalized_at, payment_status
) values (
  'f1000000-0000-0000-0000-000000000002', :'orgA', '2024-05-22', 'برحي', 1, 'كجم',
  640, 640, 'finalized', now(), 'unpaid'
);
insert into public.journal_entries(
  id, org_id, entry_date, source_type, source_id, source_sequence, description, status, posted_at
) values (
  'f2000000-0000-0000-0000-000000000002', :'orgA', '2024-05-22', 'sale',
  'f1000000-0000-0000-0000-000000000002', 1, 'operational receivable', 'posted', now()
);
insert into public.journal_lines(org_id, journal_entry_id, account_id, debit, credit) values
  (:'orgA', 'f2000000-0000-0000-0000-000000000002',
   public.fn_ensure_account(:'orgA', '1200', 'ذمم مدينة (عملاء)', 'asset', 'debit'), 640, 0),
  (:'orgA', 'f2000000-0000-0000-0000-000000000002', current_setting('t.rev4000')::uuid, 0, 640);
select pg_temp.as_user(current_setting('t.acct'));
select lives_ok(
  $$select public.fn_reverse_journal_entry(
      'f2000000-0000-0000-0000-000000000002'::uuid, 'تصحيح تشغيلي', '2024-05-22'::date)$$,
  'an OPERATIONAL sale journal is still reversible through the public RPC, exactly as before'
);
reset role;
select is(
  (select status from public.journal_entries where id = 'f2000000-0000-0000-0000-000000000002'),
  'reversed', 'the operational reversal really did happen — the regression is not vacuous'
);
insert into public.expenses(
  id, org_id, date, category, description, total, kind, account_id
) values (
  'f4000000-0000-0000-0000-000000000001', :'orgA', '2024-05-23', 'اختبار', 'ordinary expense',
  95, 'operating', current_setting('t.expense_account')::uuid
);
insert into public.journal_entries(
  id, org_id, entry_date, source_type, source_id, source_sequence, description, status, posted_at
) values (
  'f4100000-0000-0000-0000-000000000001', :'orgA', '2024-05-23', 'expense',
  'f4000000-0000-0000-0000-000000000001', 1, 'ordinary expense journal', 'posted', now()
);
insert into public.journal_lines(org_id, journal_entry_id, account_id, debit, credit, expense_id) values
  (:'orgA', 'f4100000-0000-0000-0000-000000000001', current_setting('t.expense_account')::uuid,
   95, 0, 'f4000000-0000-0000-0000-000000000001'),
  (:'orgA', 'f4100000-0000-0000-0000-000000000001', current_setting('t.cash')::uuid,
   0, 95, 'f4000000-0000-0000-0000-000000000001');
select pg_temp.as_user(current_setting('t.acct'));
select lives_ok(
  $$select public.fn_reverse_journal_entry(
      'f4100000-0000-0000-0000-000000000001'::uuid, 'تصحيح مصروف', '2024-05-23'::date)$$,
  'an ordinary EXPENSE journal is still reversible through the public RPC'
);
reset role;
select is(
  (select status from public.journal_entries where id = 'f4100000-0000-0000-0000-000000000001'),
  'reversed', 'the ordinary expense reversal really did happen'
);

-- ── the same boundary on the EXPENSE half of the reconciliation contract ─────────────────────────
-- The expense executor (20260726150000) created `historical_treasury` expenses BEFORE this slice
-- existed, and `public.fn_reverse_journal_entry` never knew about them either. The exposure is not an
-- analogue of the sale one, it is the SAME defect in the other domain, and just as unrecoverable: the
-- expense keeps `historical_treasury` (so fn_owner_pnl_summary keeps counting settled cash spend)
-- while its journal leaves the posted ledger, 20260726150000's lifecycle guard freezes every field of
-- such a row, its DELETE guard refuses removal, and the executor then rejects it as a correction
-- target because the posted journal it requires is gone. The contract is two-sided here too: the
-- public path is DENIED, and the owner-only executor still produces the correction.
insert into public.expenses(
  id, org_id, date, category, description, total, kind, account_id
) values (
  'f5000000-0000-0000-0000-000000000001', :'orgA', '2024-05-24', 'اختبار', 'historical expense',
  480, 'operating', current_setting('t.expense_account')::uuid
);
insert into public.journal_entries(
  id, org_id, entry_date, source_type, source_id, source_sequence, description, status, posted_at
) values (
  'f5100000-0000-0000-0000-000000000001', :'orgA', '2024-05-24', 'expense',
  'f5000000-0000-0000-0000-000000000001', 1, 'historical expense journal', 'posted', now()
);
insert into public.journal_lines(org_id, journal_entry_id, account_id, debit, credit, expense_id) values
  (:'orgA', 'f5100000-0000-0000-0000-000000000001', current_setting('t.expense_account')::uuid,
   480, 0, 'f5000000-0000-0000-0000-000000000001'),
  (:'orgA', 'f5100000-0000-0000-0000-000000000001', current_setting('t.cash')::uuid,
   0, 480, 'f5000000-0000-0000-0000-000000000001');
update public.expenses set payment_status = 'historical_treasury'
 where id = 'f5000000-0000-0000-0000-000000000001';
select is(
  (select payment_status from public.expenses where id = 'f5000000-0000-0000-0000-000000000001'),
  'historical_treasury', 'the expense bypass target is a certified historical treasury expense'
);
select pg_temp.as_user(current_setting('t.acct'));
select throws_ok(
  $$select public.fn_reverse_journal_entry(
      'f5100000-0000-0000-0000-000000000001'::uuid, 'محاولة عكس مصروف تاريخي', '2024-05-24'::date)$$,
  '42501', null,
  'an accountant WITH budget.write cannot reverse a historical treasury EXPENSE journal directly'
);
reset role;
select pg_temp.as_user(current_setting('t.owner'));
select throws_ok(
  $$select public.fn_reverse_journal_entry(
      'f5100000-0000-0000-0000-000000000001'::uuid, 'محاولة عكس مصروف تاريخي', '2024-05-24'::date)$$,
  '42501', null,
  'and neither can the OWNER on the public expense path — the boundary is the PATH, not the role'
);
reset role;
select is(
  (select status from public.journal_entries where id = 'f5100000-0000-0000-0000-000000000001'),
  'posted', 'the refused direct expense reversal leaves the original journal posted'
);
select is(
  (select count(*)::int from public.journal_entries
    where reversal_of = 'f5100000-0000-0000-0000-000000000001'),
  0, 'the refused direct expense reversal created no mirror entry'
);
select is(
  (select payment_status from public.expenses where id = 'f5000000-0000-0000-0000-000000000001'),
  'historical_treasury',
  'and the expense is left in the correctable state rather than stranded as unsupported spend'
);

-- The other half: the owner-only executor STILL corrects that expense. This is the regression that
-- would fail if §7 closed the public path without routing §8's expense branch through the private
-- helper — the executor would be denied its own reversal.
select pg_temp.make_batch('a0000000-0000-0000-0000-0000000000f9');
select pg_temp.add_expense_row(
  'a0000000-0000-0000-0000-0000000000f9', 'a1000000-0000-0000-0000-0000000000f9',
  'a2000000-0000-0000-0000-0000000000f9', 'expense-bypass-then-correct', 500, '2024-05-24',
  'f5000000-0000-0000-0000-000000000001'
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch('a0000000-0000-0000-0000-0000000000f9'))->>'status',
  'executed',
  'the owner-only executor still corrects the expense the public reversal path was denied'
);
reset role;
select is(
  (select status from public.journal_entries where id = 'f5100000-0000-0000-0000-000000000001'),
  'reversed', 'the executor reversed the original expense journal through the private boundary'
);
select is(
  (select payment_status from public.expenses where id = 'f5000000-0000-0000-0000-000000000001'),
  'historical_reversed', 'and the expense state moved WITH its journal'
);
select is(
  (select a.code from public.journal_entries je
     join public.journal_lines jl on jl.journal_entry_id = je.id and jl.debit > 0
     join public.accounts a on a.id = jl.account_id
    where je.reversal_of = 'f5100000-0000-0000-0000-000000000001'),
  '1010', 'the executor expense reversal is still the EXACT inverse — treasury 1010 is debited back'
);
select is(
  (select round(sum(jl.debit) - sum(jl.credit), 2) from public.journal_lines jl
     join public.journal_entries je on je.id = jl.journal_entry_id
    where je.reversal_of = 'f5100000-0000-0000-0000-000000000001'),
  0::numeric, 'and the executor expense reversal balances'
);
-- A `historical_reversed` EXPENSE journal is refused too, for the same reason the sale one is: the
-- already-reversed branch would otherwise idempotently hand a caller the reconciliation reversal's id.
select pg_temp.as_user(current_setting('t.acct'));
select throws_ok(
  $$select public.fn_reverse_journal_entry(
      'f5100000-0000-0000-0000-000000000001'::uuid, 'محاولة ثانية', '2024-05-25'::date)$$,
  '42501', null,
  'a historical_REVERSED expense journal is refused too, not answered idempotently'
);
reset role;
-- The REPLACEMENT expense the executor just posted is itself historical_treasury, so it is protected.
select set_config('t.expense_replacement_journal', (
  select al.journal_entry_id::text from public.reconciliation_action_links al
   where al.batch_id = 'a0000000-0000-0000-0000-0000000000f9'
     and al.action_kind = 'correction_replacement'
), false);
select is(
  (select e.payment_status from public.expenses e
     join public.reconciliation_action_links al
       on al.target_id = e.id and al.target_table = 'expenses'
    where al.batch_id = 'a0000000-0000-0000-0000-0000000000f9'
      and al.action_kind = 'correction_replacement'),
  'historical_treasury',
  'non-vacuity: the replacement expense really is a historical treasury row worth protecting'
);
select pg_temp.as_user(current_setting('t.acct'));
select throws_ok(
  format($$select public.fn_reverse_journal_entry(%L::uuid, 'عكس البديل', '2024-05-24'::date)$$,
         current_setting('t.expense_replacement_journal')),
  '42501', null,
  'the replacement expense journal the executor just posted is protected by the same boundary'
);
reset role;

-- Duplicate-collection / alternate-money-path protection.
select pg_temp.as_user(current_setting('t.owner'));
select throws_ok(
  format($$select public.fn_record_sale_collection(%L::uuid, 100)$$,
         current_setting('t.sale_added')),
  '22023', null, 'a historical treasury sale cannot be collected through the operational RPC'
);
reset role;
select throws_ok(
  format($$insert into public.sale_collections(org_id, sale_id, amount, occurred_at)
           values (%L::uuid, %L::uuid, 100, current_date)$$,
         :'orgA', current_setting('t.sale_added')),
  '22023', null,
  'even a privileged direct insert cannot open a collection against a historical sale'
);
select is(
  (select count(*)::int from public.sale_collections
    where sale_id = current_setting('t.sale_added')::uuid),
  0, 'the refused collection leaves the historical sale uncollected'
);

-- ── the guards close the routes that would let an unprovable claim exist at all ───────────────────
-- INSERT: both historical states must be EARNED by a posted journal. On insert no journal can
-- reference a row that does not exist yet, so an insert-time claim is unprovable by construction —
-- and would be indelible, because the UPDATE guard freezes every field and DELETE is refused.
select throws_ok(
  format($$insert into public.sales(
      id, org_id, sale_date, crop, qty, unit, unit_price, total,
      price_status, price_finalized_at, payment_status)
    values ('be000000-0000-0000-0000-000000000001', %L::uuid, current_date, 'برحي', 1, 'كجم',
            10, 10, 'finalized', now(), 'historical_treasury')$$, :'orgA'),
  '22023', null,
  'a historical treasury state cannot be claimed on INSERT, only earned by a posted journal'
);
select throws_ok(
  format($$insert into public.sales(
      id, org_id, sale_date, crop, qty, unit, payment_status)
    values ('be000000-0000-0000-0000-000000000002', %L::uuid, current_date, 'برحي', 1, 'كجم',
            'historical_reversed')$$, :'orgA'),
  '22023', null,
  'a historical reversed state cannot be claimed on INSERT either'
);
select is(
  (select count(*)::int from public.sales
    where id in ('be000000-0000-0000-0000-000000000001', 'be000000-0000-0000-0000-000000000002')),
  0, 'neither refused insert left a row behind'
);
select lives_ok(
  format($$insert into public.sales(id, org_id, sale_date, crop, qty, unit, payment_status)
           values ('be000000-0000-0000-0000-000000000003', %L::uuid, current_date, 'برحي', 1, 'كجم',
                   'unpaid')$$, :'orgA'),
  'the INSERT guard leaves an ordinary operational sale insertable'
);

-- DELETE on sale_collections is the laundering route: `sale_collections` is the ONLY evidence the
-- proof uses to rule out a receivable, yet a collection row can be removed while its posted
-- Dr 1100 / Cr 1200 journal survives (the journal holds no FK back to the row). Deleting a settled
-- collection would turn an operational receivable into a "proven" historical cash sale AND orphan
-- real posted money.
insert into public.sales(
  id, org_id, sale_date, crop, qty, unit, unit_price, total,
  price_status, price_finalized_at, payment_status
) values (
  'bf000000-0000-0000-0000-000000000001', :'orgA', '2024-02-14', 'برحي', 1, 'كجم',
  1200, 1200, 'finalized', now(), 'partially_collected'
);
insert into public.journal_entries(
  id, org_id, entry_date, source_type, source_id, source_sequence, description, status, posted_at
) values (
  'bf100000-0000-0000-0000-000000000001', :'orgA', '2024-02-14', 'sale',
  'bf000000-0000-0000-0000-000000000001', 1, 'launder target', 'posted', now()
);
insert into public.journal_lines(org_id, journal_entry_id, account_id, debit, credit) values
  (:'orgA', 'bf100000-0000-0000-0000-000000000001', current_setting('t.cash')::uuid, 1200, 0),
  (:'orgA', 'bf100000-0000-0000-0000-000000000001', current_setting('t.rev4010')::uuid, 0, 1200);
insert into public.sale_collections(
  id, org_id, sale_id, amount, occurred_at, journal_entry_id
) values (
  'bf200000-0000-0000-0000-000000000001', :'orgA', 'bf000000-0000-0000-0000-000000000001',
  400, '2024-02-15', 'bf100000-0000-0000-0000-000000000001'
);
select ok(
  not private.fn_reconciliation_sale_has_exact_historical_journal(
    'bf000000-0000-0000-0000-000000000001'),
  'while the collection row exists the sale is correctly refused by the proof'
);
select throws_ok(
  $$delete from public.sale_collections
     where id = 'bf200000-0000-0000-0000-000000000001'$$,
  '22023', null,
  'a POSTED sale collection cannot be deleted — that would orphan real money and launder the proof'
);
select ok(
  not private.fn_reconciliation_sale_has_exact_historical_journal(
    'bf000000-0000-0000-0000-000000000001'),
  'the refused delete leaves the sale still correctly refused by the proof'
);
-- An unposted collection (no journal yet) is still removable, so the guard is scoped to real money.
insert into public.sale_collections(id, org_id, sale_id, amount, occurred_at)
values ('bf200000-0000-0000-0000-000000000002', :'orgA',
        'bf000000-0000-0000-0000-000000000001', 50, '2024-02-16');
select lives_ok(
  $$delete from public.sale_collections
     where id = 'bf200000-0000-0000-0000-000000000002'$$,
  'an unposted collection row is still deletable — the guard is scoped to posted money'
);
-- The collection guard also covers UPDATE, not just INSERT.
select throws_ok(
  format($$update public.sale_collections set sale_id = %L::uuid
            where id = 'bf200000-0000-0000-0000-000000000001'$$,
         current_setting('t.sale_added')),
  '22023', null,
  'a collection cannot be re-pointed onto a historical sale by UPDATE'
);
select throws_ok(
  $$update public.sale_collections
       set sale_id = 'be000000-0000-0000-0000-000000000003'
     where id = 'bf200000-0000-0000-0000-000000000001'$$,
  '22023', null,
  'a posted collection cannot be reassigned even to another ordinary sale'
);
select throws_ok(
  $$update public.sale_collections set amount = amount + 1
     where id = 'bf200000-0000-0000-0000-000000000001'$$,
  '22023', null, 'a posted collection amount is immutable'
);
select throws_ok(
  $$update public.sale_collections set occurred_at = occurred_at + 1
     where id = 'bf200000-0000-0000-0000-000000000001'$$,
  '22023', null, 'a posted collection economic date is immutable'
);
select throws_ok(
  $$update public.sale_collections set journal_entry_id = null
     where id = 'bf200000-0000-0000-0000-000000000001'$$,
  '22023', null, 'a posted collection cannot clear its journal identity'
);

insert into public.organization(id, name)
values ('b0000000-0000-0000-0000-000000000001', 'collection tenant probe');
select throws_ok(
  $$insert into public.sale_collections(id, org_id, sale_id, amount, occurred_at)
    values ('bf200000-0000-0000-0000-000000000010',
            'b0000000-0000-0000-0000-000000000001',
            'bf000000-0000-0000-0000-000000000001', 1, '2024-02-17')$$,
  '23503', null,
  'the composite sale/org foreign key rejects a collection claiming another tenant'
);

-- Defence in depth: even if a privileged maintenance session bypasses the structural FK, the proof
-- itself must count ANY matching sale_id and fail closed rather than trusting the collection's org_id.
select pg_temp.make_historical_sale(
  'bf000000-0000-0000-0000-000000000011', 'bf100000-0000-0000-0000-000000000011',
  'bf110000-0000-0000-0000-000000000011', 'bf120000-0000-0000-0000-000000000011',
  111, '2024-02-18', 'برحي'
);
set local session_replication_role = replica;
insert into public.sale_collections(id, org_id, sale_id, amount, occurred_at)
values ('bf200000-0000-0000-0000-000000000011',
        'b0000000-0000-0000-0000-000000000001',
        'bf000000-0000-0000-0000-000000000011', 1, '2024-02-19');
set local session_replication_role = origin;
select ok(
  not private.fn_reconciliation_sale_has_exact_historical_journal(
    'bf000000-0000-0000-0000-000000000011'),
  'the proof rejects any collection matching sale_id even when its org_id is forged'
);
delete from public.sale_collections where id = 'bf200000-0000-0000-0000-000000000011';
select ok(
  private.fn_reconciliation_sale_has_exact_historical_journal(
    'bf000000-0000-0000-0000-000000000011'),
  'removing the unposted forged probe restores the exact historical proof'
);

-- The proof must be DETERMINISTIC: `created_at::date` is timezone-dependent, so without a pinned
-- zone the same row would classify differently for different callers and the backfill, the guard and
-- the executor could disagree about it.
insert into public.sales(
  id, org_id, delivery_date, crop, qty, unit, unit_price, total,
  price_status, price_finalized_at, payment_status, created_at
) values (
  'bf000000-0000-0000-0000-000000000009', :'orgA', '2024-02-01', 'برحي', 1, 'كجم', 90, 90,
  'finalized', now(), 'unpaid', '2024-03-01 00:30:00+00'
);
insert into public.journal_entries(
  id, org_id, entry_date, source_type, source_id, source_sequence, description, status, posted_at
) values (
  'bf100000-0000-0000-0000-000000000009', :'orgA', '2024-03-01', 'sale',
  'bf000000-0000-0000-0000-000000000009', 1, 'tz probe', 'posted', now()
);
insert into public.journal_lines(org_id, journal_entry_id, account_id, debit, credit) values
  (:'orgA', 'bf100000-0000-0000-0000-000000000009', current_setting('t.cash')::uuid, 90, 0),
  (:'orgA', 'bf100000-0000-0000-0000-000000000009', current_setting('t.rev4010')::uuid, 0, 90);
set local timezone = 'UTC';
select ok(
  private.fn_reconciliation_sale_has_exact_historical_journal(
    'bf000000-0000-0000-0000-000000000009'),
  'a null-sale_date row resolves against the pinned UTC economic date'
);
set local timezone = 'America/New_York';
select ok(
  private.fn_reconciliation_sale_has_exact_historical_journal(
    'bf000000-0000-0000-0000-000000000009'),
  'the proof is INVARIANT under a westward session timezone'
);
set local timezone = 'Asia/Tokyo';
select ok(
  private.fn_reconciliation_sale_has_exact_historical_journal(
    'bf000000-0000-0000-0000-000000000009'),
  'the proof is INVARIANT under an eastward session timezone'
);
set local timezone = 'Africa/Cairo';
select ok(
  private.fn_reconciliation_sale_has_exact_historical_journal(
    'bf000000-0000-0000-0000-000000000009'),
  'the proof is INVARIANT under the tenant timezone'
);
reset timezone;
update public.sales
   set payment_status = 'historical_treasury'
 where id = 'bf000000-0000-0000-0000-000000000009';
select pg_temp.as_user(current_setting('t.owner'));
set local timezone = 'America/New_York';
select is(
  (select sale_row->>'report_date'
     from jsonb_array_elements(
       public.fn_revenue_sales_report(:'orgA', '2024-03-01', '2024-03-31', '2024-03-31')->'sales'
     ) sale_row
    where sale_row->>'sale_id' = 'bf000000-0000-0000-0000-000000000009'),
  '2024-03-01',
  'historical reporting uses the same UTC created_at fallback as proof, not conflicting delivery_date'
);
select is(
  (select (sale_row->>'collected_to_as_of')::numeric
     from jsonb_array_elements(
       public.fn_revenue_sales_report(:'orgA', '2024-03-01', '2024-03-31', '2024-03-31')->'sales'
     ) sale_row
    where sale_row->>'sale_id' = 'bf000000-0000-0000-0000-000000000009'),
  90::numeric,
  'the historical sale is recognized as collected on that same economic date'
);
select is(
  (select count(*)::int
     from jsonb_array_elements(
       public.fn_revenue_sales_report(:'orgA', '2024-02-01', '2024-02-29', '2024-02-29')->'sales'
     ) sale_row
    where sale_row->>'sale_id' = 'bf000000-0000-0000-0000-000000000009'),
  0,
  'the conflicting February delivery date cannot pull historical cash into the wrong period'
);
reset timezone;
reset role;

-- ── reviewed-data validation at execution time ────────────────────────────────────────────────────
create or replace function pg_temp.expect_row_rejected(
  p_batch uuid, p_evidence uuid, p_row uuid, p_locator text, p_label text,
  p_amount numeric default 700,
  p_crop text default 'برحي',
  p_qty numeric default 7,
  p_unit_price numeric default 100,
  p_recorded_total numeric default 700,
  p_effective_date date default null,
  p_date_decision text default 'use_source_text_date',
  p_review_reason text default 'reviewed',
  p_buyer uuid default null,
  p_cost_center uuid default null,
  p_invalid_calendar boolean default false,
  p_expected_code text default 'integrity_check'
) returns setof text language plpgsql as $$
declare v_before int; v_result jsonb;
begin
  perform pg_temp.make_batch(p_batch);
  perform pg_temp.add_sale_row(
    p_batch, p_evidence, p_row, p_locator, p_amount, '2024-07-07',
    p_crop, null, p_qty, p_unit_price, p_recorded_total,
    coalesce(p_effective_date, '2024-07-07'::date), p_date_decision,
    p_buyer, p_cost_center, null, null, null, false, p_review_reason,
    null, p_invalid_calendar
  );
  select count(*) into v_before from public.sales;
  perform pg_temp.as_user(current_setting('t.owner'));
  v_result := public.fn_execute_reconciliation_batch(p_batch);
  reset role;
  return next is(v_result->>'failure_code', p_expected_code, p_label);
  return next is((select count(*)::int from public.sales), v_before,
    p_label || ' — creates no sale');
end $$;

select * from pg_temp.expect_row_rejected(
  'a0000000-0000-0000-0000-000000000080', 'a1000000-0000-0000-0000-000000000080',
  'a2000000-0000-0000-0000-000000000080', 'total-mismatch',
  'a reviewed total that differs from the source amount fails closed',
  700, 'برحي', 7, 100, 650
);
select * from pg_temp.expect_row_rejected(
  'a0000000-0000-0000-0000-000000000081', 'a1000000-0000-0000-0000-000000000081',
  'a2000000-0000-0000-0000-000000000081', 'qty-price-mismatch',
  'a reviewed quantity x unit price that does not reconcile fails closed',
  700, 'برحي', 7, 99, 700
);
select * from pg_temp.expect_row_rejected(
  'a0000000-0000-0000-0000-000000000082', 'a1000000-0000-0000-0000-000000000082',
  'a2000000-0000-0000-0000-000000000082', 'source-date-mismatch',
  'a reviewed effective date that contradicts the source date fails closed',
  700, 'برحي', 7, 100, 700, '2024-08-08'
);
select * from pg_temp.expect_row_rejected(
  'a0000000-0000-0000-0000-000000000083', 'a1000000-0000-0000-0000-000000000083',
  'a2000000-0000-0000-0000-000000000083', 'manual-override-no-reason',
  'a manual date override without a review reason fails closed',
  700, 'برحي', 7, 100, 700, '2024-08-08', 'manual_override', ''
);
select * from pg_temp.expect_row_rejected(
  'a0000000-0000-0000-0000-000000000084', 'a1000000-0000-0000-0000-000000000084',
  'a2000000-0000-0000-0000-000000000084', 'matched-production-no-target',
  'a matched-production date without a correction target fails closed',
  700, 'برحي', 7, 100, 700, '2024-07-07', 'use_matched_production_date'
);
select * from pg_temp.expect_row_rejected(
  'a0000000-0000-0000-0000-000000000085', 'a1000000-0000-0000-0000-000000000085',
  'a2000000-0000-0000-0000-000000000085', 'invalid-calendar-not-overridden',
  'an unparseable source date fails closed unless the reviewer took the manual override',
  700, 'برحي', 7, 100, 700, '2024-07-07', 'use_source_text_date', 'reviewed',
  null, null, true
);

-- A manual override WITH a reason is the one accepted route past an unparseable source date.
select pg_temp.make_batch('a0000000-0000-0000-0000-000000000086');
select pg_temp.add_sale_row(
  'a0000000-0000-0000-0000-000000000086', 'a1000000-0000-0000-0000-000000000086',
  'a2000000-0000-0000-0000-000000000086', 'manual-override-ok', 800, '2024-07-09',
  'قمح', null, 8, 100, 800, '2024-07-09', 'manual_override',
  null, null, null, null, null, false, 'التاريخ المصدر غير صالح — قرار يدوي موثق', null, true
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch('a0000000-0000-0000-0000-000000000086'))->>'status',
  'executed', 'a documented manual date override executes on the reviewed effective date'
);
reset role;
select is(
  (select a.code from public.reconciliation_action_links al
     join public.journal_lines jl on jl.journal_entry_id = al.journal_entry_id and jl.credit > 0
     join public.accounts a on a.id = jl.account_id
    where al.batch_id = 'a0000000-0000-0000-0000-000000000086'),
  '4050', 'a قمح sale credits the typed field-crop leaf 4050'
);

-- An archived revenue leaf is rechecked at execution time.
update public.accounts set active = false where org_id = :'orgA' and code = '4040';
select * from pg_temp.expect_row_rejected(
  'a0000000-0000-0000-0000-000000000087', 'a1000000-0000-0000-0000-000000000087',
  'a2000000-0000-0000-0000-000000000087', 'archived-revenue-leaf',
  'an archived typed revenue leaf fails execution instead of silently re-routing',
  700, 'بنجر', 7, 100, 700
);
update public.accounts set active = true where org_id = :'orgA' and code = '4040';

-- An inactive buyer is rechecked at execution time.
insert into public.buyers(id, org_id, name, active)
values ('a8000000-0000-0000-0000-000000000002', :'orgA', 'مشتري موقوف', false);
select * from pg_temp.expect_row_rejected(
  'a0000000-0000-0000-0000-000000000088', 'a1000000-0000-0000-0000-000000000088',
  'a2000000-0000-0000-0000-000000000088', 'inactive-buyer',
  'an inactive reviewed buyer fails execution',
  700, 'برحي', 7, 100, 700, null, 'use_source_text_date', 'reviewed',
  'a8000000-0000-0000-0000-000000000002'
);

-- The positive `use_matched_production_date` path: a correction may adopt the TARGET's economic date
-- rather than the source text date, which is the whole reason that decision exists.
select pg_temp.make_historical_sale(
  'b5000000-0000-0000-0000-00000000000d', 'b6000000-0000-0000-0000-00000000000d',
  'b7000000-0000-0000-0000-0000000000d1', 'b7000000-0000-0000-0000-0000000000d2',
  700, '2024-09-20', 'برحي'
);
select pg_temp.make_batch('a0000000-0000-0000-0000-0000000000d5');
-- source text date is 2024-09-25, but the reviewer adopts the matched production date 2024-09-20.
select pg_temp.add_sale_row(
  'a0000000-0000-0000-0000-0000000000d5', 'a1000000-0000-0000-0000-0000000000d5',
  'a2000000-0000-0000-0000-0000000000d5', 'matched-production-date', 750, '2024-09-25',
  'برحي', 'b5000000-0000-0000-0000-00000000000d', 10, 75, 750,
  '2024-09-20', 'use_matched_production_date'
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch('a0000000-0000-0000-0000-0000000000d5'))->>'status',
  'executed', 'a correction may adopt the matched production date instead of the source text date'
);
reset role;
select is(
  (select sale_date from public.sales
    where corrects_sale_id = 'b5000000-0000-0000-0000-00000000000d'),
  '2024-09-20'::date,
  'the replacement posts on the matched production date, not the source text date'
);
select is(
  (select je.entry_date
     from public.reconciliation_action_links al
     join public.journal_entries je on je.id = al.journal_entry_id
    where al.batch_id = 'a0000000-0000-0000-0000-0000000000d5'
      and al.action_kind = 'correction_replacement'),
  '2024-09-20'::date,
  'the replacement journal is periodised on the matched production date'
);
select is(
  (select je.entry_date from public.journal_entries je
    where je.reversal_of = 'b6000000-0000-0000-0000-00000000000d'),
  '2024-09-20'::date,
  'the reversal is periodised on the same matched production date, so the period nets to zero'
);

-- ── frozen-payload drift and redaction ────────────────────────────────────────────────────────────
select pg_temp.make_batch('a0000000-0000-0000-0000-000000000020');
select pg_temp.add_sale_row(
  'a0000000-0000-0000-0000-000000000020', 'a1000000-0000-0000-0000-000000000020',
  'a2000000-0000-0000-0000-000000000020', 'sale-payload-drift-private-value', 20, '2024-09-09',
  'برحي', null, 2, 10, 20, '2024-09-09', 'use_source_text_date',
  null, null, null, null, null, true
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch('a0000000-0000-0000-0000-000000000020'))->>'failure_code',
  'integrity_check', 'frozen sale payload drift returns a redacted code'
);
reset role;
select is(
  (select status from public.reconciliation_batches where id = 'a0000000-0000-0000-0000-000000000020'),
  'failed', 'sale payload drift durably marks only the batch failed'
);
select is(
  (select execution_result from public.reconciliation_batch_rows
    where id = 'a2000000-0000-0000-0000-000000000020'),
  'pending', 'sale payload drift leaves the frozen row pending'
);
select ok(
  (select result_summary::text not like '%sale-payload-drift-private-value%'
     from public.reconciliation_batches where id = 'a0000000-0000-0000-0000-000000000020'),
  'the sale failure summary contains no private locator text'
);

-- ── period lock ───────────────────────────────────────────────────────────────────────────────────
insert into public.accounting_periods(id, org_id, period_start, period_end, status, note)
values ('a4000000-0000-0000-0000-000000000001', :'orgA',
        '2098-01-01', '2098-01-31', 'locked', 'sale execution lock test');
select pg_temp.make_batch('a0000000-0000-0000-0000-000000000040');
select pg_temp.add_sale_row(
  'a0000000-0000-0000-0000-000000000040', 'a1000000-0000-0000-0000-000000000040',
  'a2000000-0000-0000-0000-000000000040', 'sale-locked-private-row', 40, '2098-01-15',
  'برحي', null, 4, 10, 40, '2098-01-15'
);
select set_config('t.sales_before_lock', (select count(*)::text from public.sales), false);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch('a0000000-0000-0000-0000-000000000040'))->>'failure_code',
  'locked_period', 'a locked period is returned as a redacted sale failure'
);
reset role;
select is(
  (select count(*)::int from public.sales), current_setting('t.sales_before_lock')::int,
  'a locked period rolls back the sale insert'
);
select is(
  (select count(*)::int from public.reconciliation_baselines
    where batch_id = 'a0000000-0000-0000-0000-000000000040'),
  0, 'a locked period rolls back the baseline with all inner writes'
);
select ok(
  (select result_summary::text not like '%sale-locked-private-row%'
     from public.reconciliation_batches where id = 'a0000000-0000-0000-0000-000000000040'),
  'the locked-period sale summary contains no private source text'
);

-- ── mixed expense + sale batch: one atomic boundary ───────────────────────────────────────────────
select pg_temp.make_batch('a0000000-0000-0000-0000-000000000090');
select pg_temp.add_sale_row(
  'a0000000-0000-0000-0000-000000000090', 'a1000000-0000-0000-0000-000000000090',
  'a2000000-0000-0000-0000-000000000090', 'mixed-sale', 300, '2024-10-01',
  'برتقال', null, 3, 100, 300, '2024-10-01'
);
select pg_temp.add_expense_row(
  'a0000000-0000-0000-0000-000000000090', 'a1000000-0000-0000-0000-000000000091',
  'a2000000-0000-0000-0000-000000000091', 'mixed-expense', 120, '2024-10-01'
);
select set_config('t.sales_before_mixed', (select count(*)::text from public.sales), false);
select set_config('t.exp_before_mixed', (select count(*)::text from public.expenses), false);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch('a0000000-0000-0000-0000-000000000090'))->>'status',
  'executed', 'a mixed expense + sale batch executes atomically'
);
reset role;
select is(
  (select count(*)::int from public.sales) - current_setting('t.sales_before_mixed')::int,
  1, 'the mixed batch creates exactly one sale'
);
select is(
  (select count(*)::int from public.expenses) - current_setting('t.exp_before_mixed')::int,
  1, 'the mixed batch creates exactly one expense'
);
select is(
  (select count(*)::int from public.reconciliation_action_links
    where batch_id = 'a0000000-0000-0000-0000-000000000090' and action_kind = 'addition'),
  2, 'the mixed batch records one addition per domain'
);
select is(
  (select count(distinct target_table)::int from public.reconciliation_action_links
    where batch_id = 'a0000000-0000-0000-0000-000000000090'),
  2, 'the mixed batch links both domains'
);
select is(
  (select a.code from public.reconciliation_action_links al
     join public.journal_lines jl on jl.journal_entry_id = al.journal_entry_id and jl.credit > 0
     join public.accounts a on a.id = jl.account_id
    where al.batch_id = 'a0000000-0000-0000-0000-000000000090' and al.target_table = 'sales'),
  '4030', 'the mixed batch routes the برتقال sale to the typed 4030 leaf'
);
select is(
  (select a.code from public.reconciliation_action_links al
     join public.journal_lines jl on jl.journal_entry_id = al.journal_entry_id and jl.credit > 0
     join public.accounts a on a.id = jl.account_id
    where al.batch_id = 'a0000000-0000-0000-0000-000000000090' and al.target_table = 'expenses'),
  '1010', 'the mixed batch still credits treasury for the expense leg'
);

-- A mid-batch failure in a MIXED batch rolls back BOTH domains.
select pg_temp.make_batch('a0000000-0000-0000-0000-000000000091');
select pg_temp.add_sale_row(
  'a0000000-0000-0000-0000-000000000091', 'a1000000-0000-0000-0000-000000000092',
  'a2000000-0000-0000-0000-000000000092', 'mixed-good-sale', 55, '2024-10-02',
  'برحي', null, 5, 11, 55, '2024-10-02'
);
select pg_temp.add_expense_row(
  'a0000000-0000-0000-0000-000000000091', 'a1000000-0000-0000-0000-000000000093',
  'a2000000-0000-0000-0000-000000000093', 'mixed-locked-expense', 66, '2098-01-16'
);
select set_config('t.sales_before_multi', (select count(*)::text from public.sales), false);
select set_config('t.exp_before_multi', (select count(*)::text from public.expenses), false);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch('a0000000-0000-0000-0000-000000000091'))->>'status',
  'failed', 'a later-row failure fails the whole mixed batch'
);
reset role;
select is(
  (select count(*)::int from public.sales), current_setting('t.sales_before_multi')::int,
  'a mixed-batch failure rolls back the already-written sale'
);
select is(
  (select count(*)::int from public.expenses), current_setting('t.exp_before_multi')::int,
  'a mixed-batch failure rolls back the expense domain too'
);
select is(
  (select count(*)::int from public.reconciliation_action_links
    where batch_id = 'a0000000-0000-0000-0000-000000000091'),
  0, 'a mixed-batch failure rolls back every action link'
);
select is(
  (select count(*)::int from public.reconciliation_execution_ledger
    where evidence_item_id in (
      'a1000000-0000-0000-0000-000000000092', 'a1000000-0000-0000-0000-000000000093')),
  0, 'a mixed-batch failure rolls back every execution-ledger claim'
);
select is(
  (select count(*)::int from public.reconciliation_batch_rows
    where batch_id = 'a0000000-0000-0000-0000-000000000091' and execution_result = 'pending'),
  2, 'a mixed-batch failure leaves both frozen rows pending'
);

-- A three-way mixed batch: expense addition + sale CORRECTION + zero-value sale, one transaction.
select pg_temp.make_historical_sale(
  'b5000000-0000-0000-0000-00000000000c', 'b6000000-0000-0000-0000-00000000000c',
  'b7000000-0000-0000-0000-0000000000c1', 'b7000000-0000-0000-0000-0000000000c2',
  900, '2024-10-03', 'بنجر', (select id from public.accounts
                               where org_id = '00000000-0000-0000-0000-000000000001' and code = '4040')
);
select pg_temp.make_batch('a0000000-0000-0000-0000-000000000095');
select pg_temp.add_expense_row(
  'a0000000-0000-0000-0000-000000000095', 'a1000000-0000-0000-0000-000000000095',
  'a2000000-0000-0000-0000-000000000095', 'three-way-expense', 40, '2024-10-03'
);
select pg_temp.add_sale_row(
  'a0000000-0000-0000-0000-000000000095', 'a1000000-0000-0000-0000-000000000096',
  'a2000000-0000-0000-0000-000000000096', 'three-way-sale-correction', 950, '2024-10-03',
  'بنجر', 'b5000000-0000-0000-0000-00000000000c', 10, 95, 950, '2024-10-03'
);
select pg_temp.add_sale_row(
  'a0000000-0000-0000-0000-000000000095', 'a1000000-0000-0000-0000-000000000097',
  'a2000000-0000-0000-0000-000000000097', 'three-way-zero-sale', 0, '2024-10-03',
  'برحي', null, 0, 0, 0, '2024-10-03'
);
select set_config('t.je_before_three', (select count(*)::text from public.journal_entries), false);
select set_config('t.posted_before_three',
  (select count(*)::text from public.journal_entries where status = 'posted'), false);
select pg_temp.as_user(current_setting('t.owner'));
select set_config('t.three_result',
  (public.fn_execute_reconciliation_batch('a0000000-0000-0000-0000-000000000095'))::text, false);
reset role;
select is(current_setting('t.three_result')::jsonb->>'status', 'executed',
  'a three-way mixed batch (expense add + sale correction + zero sale) executes atomically');
select is(current_setting('t.three_result')::jsonb->>'executed_rows', '2',
  'the three-way batch counts the expense addition and the sale correction as executed');
select is(current_setting('t.three_result')::jsonb->>'skipped_rows', '1',
  'the three-way batch counts only the zero-value sale as skipped');
-- Posted-journal delta: +1 expense addition, +1 sale replacement, -1 reversed original = +1.
select is(
  (select count(*)::int from public.journal_entries where status = 'posted'),
  current_setting('t.posted_before_three')::int + 1,
  'the three-way batch moves the posted-journal count by exactly the expected net delta'
);
select is(
  (select payment_status from public.sales where id = 'b5000000-0000-0000-0000-00000000000c'),
  'historical_reversed', 'the three-way batch reverses the sale correction target'
);
select is(
  (select total from public.sales where corrects_sale_id = 'b5000000-0000-0000-0000-00000000000c'),
  950::numeric, 'the three-way batch posts the reviewed sale replacement'
);
select is(
  (select count(*)::int from public.reconciliation_action_links
    where batch_id = 'a0000000-0000-0000-0000-000000000095'),
  4, 'the three-way batch records addition + reversal + replacement + zero-value links'
);
select is(
  (select count(*)::int from public.reconciliation_action_links
    where batch_id = 'a0000000-0000-0000-0000-000000000095' and action_kind = 'zero_value_noop'),
  1, 'the zero-value sale in a mixed batch still records its no-op link'
);

-- ── Cross-domain UUID collision: expenses.id and sales.id are INDEPENDENT uuid spaces ────────────
-- The postflight matched a baseline snapshot to an action link on (batch_id, source_id) alone. A
-- colliding expense/sale pair corrected in one batch would therefore cross-match domains and verify
-- each other's reversal. The id below is deliberately used for BOTH rows.
\set collide 'cd000000-0000-0000-0000-00000000c01d'
insert into public.expenses(
  id, org_id, date, category, description, total, kind, account_id
) values (
  :'collide', :'orgA', '2024-11-11', 'collision', 'uuid collision target', 300, 'operating',
  current_setting('t.expense_account')::uuid
);
insert into public.journal_entries(
  id, org_id, entry_date, source_type, source_id, source_sequence, description, status, posted_at
) values (
  'ce000000-0000-0000-0000-000000000001', :'orgA', '2024-11-11', 'expense', :'collide', 1,
  'collision expense journal', 'posted', now()
);
insert into public.journal_lines(id, org_id, journal_entry_id, account_id, debit, credit, expense_id)
values
  ('cf000000-0000-0000-0000-000000000001', :'orgA', 'ce000000-0000-0000-0000-000000000001',
   current_setting('t.expense_account')::uuid, 300, 0, :'collide'),
  ('cf000000-0000-0000-0000-000000000002', :'orgA', 'ce000000-0000-0000-0000-000000000001',
   current_setting('t.cash')::uuid, 0, 300, :'collide');
update public.expenses set payment_status = 'historical_treasury' where id = :'collide';
select pg_temp.make_historical_sale(
  :'collide', 'ce000000-0000-0000-0000-000000000002',
  'cf000000-0000-0000-0000-000000000003', 'cf000000-0000-0000-0000-000000000004',
  800, '2024-11-11', 'برحي'
);
select is(
  (select count(*)::int from (
     select id from public.expenses where id = :'collide'
     union all
     select id from public.sales where id = :'collide'
   ) both_domains),
  2, 'an expense and a sale really do share one uuid — the collision is set up'
);
select pg_temp.make_batch('a0000000-0000-0000-0000-0000000000f0');
select pg_temp.add_expense_row(
  'a0000000-0000-0000-0000-0000000000f0', 'a1000000-0000-0000-0000-0000000000f0',
  'a2000000-0000-0000-0000-0000000000f0', 'collision-expense-correction', 350, '2024-11-11',
  :'collide'
);
select pg_temp.add_sale_row(
  'a0000000-0000-0000-0000-0000000000f0', 'a1000000-0000-0000-0000-0000000000f1',
  'a2000000-0000-0000-0000-0000000000f1', 'collision-sale-correction', 850, '2024-11-11',
  'برحي', :'collide', 1, 850, 850, '2024-11-11'
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch('a0000000-0000-0000-0000-0000000000f0'))->>'status',
  'executed',
  'a mixed batch correcting an expense and a sale that SHARE a uuid still verifies per domain'
);
reset role;
select is(
  (select count(*)::int from public.reconciliation_baseline_journal_headers
    where batch_id = 'a0000000-0000-0000-0000-0000000000f0'),
  2, 'both colliding originals are snapshotted'
);
select is(
  (select count(distinct source_type)::int from public.reconciliation_baseline_journal_headers
    where batch_id = 'a0000000-0000-0000-0000-0000000000f0'),
  2, 'the two snapshots are typed to different domains despite the shared source_id'
);
select is(
  (select payment_status from public.expenses where id = :'collide'),
  'historical_reversed', 'the colliding EXPENSE was reversed'
);
select is(
  (select payment_status from public.sales where id = :'collide'),
  'historical_reversed', 'the colliding SALE was reversed'
);
select is(
  (select count(*)::int from public.expenses where corrects_expense_id = :'collide'),
  1, 'exactly one expense replacement was created'
);
select is(
  (select count(*)::int from public.sales where corrects_sale_id = :'collide'),
  1, 'exactly one sale replacement was created'
);
select is(
  (select count(*)::int from public.reconciliation_action_links
    where batch_id = 'a0000000-0000-0000-0000-0000000000f0'),
  4, 'the colliding mixed correction records exactly reversal+replacement per domain'
);

-- Determinism of the matched-production-date path across session timezones.
select pg_temp.make_historical_sale(
  'cd000000-0000-0000-0000-000000000002', 'ce000000-0000-0000-0000-000000000003',
  'cf000000-0000-0000-0000-000000000005', 'cf000000-0000-0000-0000-000000000006',
  480, '2024-08-08', 'برحي', p_claim_status => false
);
-- Force the proof and matched-production path onto the timestamptz fallback. At 00:30 UTC this is
-- still the PREVIOUS calendar day in New York, so a bare `created_at::date` would resolve 2024-08-07
-- and fail the reviewed 2024-08-08 effective date below.
update public.sales
   set sale_date = null,
       created_at = '2024-08-08 00:30:00+00'::timestamptz
 where id = 'cd000000-0000-0000-0000-000000000002';
update public.sales
   set payment_status = 'historical_treasury'
 where id = 'cd000000-0000-0000-0000-000000000002';
select pg_temp.make_batch('a0000000-0000-0000-0000-0000000000f5');
select pg_temp.add_sale_row(
  'a0000000-0000-0000-0000-0000000000f5', 'a1000000-0000-0000-0000-0000000000f5',
  'a2000000-0000-0000-0000-0000000000f5', 'matched-date-tz', 520, '2024-08-20',
  'برحي', 'cd000000-0000-0000-0000-000000000002', 1, 520, 520,
  '2024-08-08', 'use_matched_production_date'
);
set local timezone = 'America/New_York';
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch('a0000000-0000-0000-0000-0000000000f5'))->>'status',
  'executed',
  'the matched-production-date path resolves identically under a westward session timezone'
);
reset role;
reset timezone;
select is(
  (select sale_date from public.sales
    where corrects_sale_id = 'cd000000-0000-0000-0000-000000000002'),
  '2024-08-08'::date,
  'the replacement still adopts the target economic date regardless of the executing timezone'
);

-- ── expense-path regression: the expense contract is untouched by this slice ──────────────────────
select pg_temp.make_batch('a0000000-0000-0000-0000-0000000000a0');
select pg_temp.add_expense_row(
  'a0000000-0000-0000-0000-0000000000a0', 'a1000000-0000-0000-0000-0000000000a0',
  'a2000000-0000-0000-0000-0000000000a0', 'expense-regression', 77.77, '2024-11-01'
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch('a0000000-0000-0000-0000-0000000000a0'))->>'status',
  'executed', 'an expense-only batch still executes exactly as before'
);
reset role;
select is(
  (select e.payment_status from public.expenses e
     join public.reconciliation_action_links al on al.target_id = e.id
    where al.batch_id = 'a0000000-0000-0000-0000-0000000000a0' and al.action_kind = 'addition'),
  'historical_treasury', 'the expense addition still lands as a historical treasury expense'
);
select is(
  (select a.code from public.reconciliation_action_links al
     join public.journal_lines jl on jl.journal_entry_id = al.journal_entry_id and jl.credit > 0
     join public.accounts a on a.id = jl.account_id
    where al.batch_id = 'a0000000-0000-0000-0000-0000000000a0'),
  '1010', 'the expense addition still credits general treasury'
);

-- ── postflight tampering on a sale correction rolls the batch back ────────────────────────────────
select pg_temp.make_historical_sale(
  'b5000000-0000-0000-0000-00000000000b', 'b6000000-0000-0000-0000-00000000000b',
  'b7000000-0000-0000-0000-0000000000b1', 'b7000000-0000-0000-0000-0000000000b2',
  6000, '2024-12-01', 'برحي'
);
select pg_temp.make_batch('a0000000-0000-0000-0000-0000000000b0');
select pg_temp.add_sale_row(
  'a0000000-0000-0000-0000-0000000000b0', 'a1000000-0000-0000-0000-0000000000b0',
  'a2000000-0000-0000-0000-0000000000b0', 'sale-equal-total-substitution', 6500, '2024-12-01',
  'برحي', 'b5000000-0000-0000-0000-00000000000b', 10, 650, 6500, '2024-12-01'
);
create or replace function pg_temp.swap_sale_journal_accounts()
returns trigger language plpgsql as $$
declare v_dr uuid; v_cr uuid;
begin
  if new.batch_id = 'a0000000-0000-0000-0000-0000000000b0'
     and new.action_kind = 'correction_replacement' then
    select account_id into v_dr from public.journal_lines
     where id = 'b7000000-0000-0000-0000-0000000000b1';
    select account_id into v_cr from public.journal_lines
     where id = 'b7000000-0000-0000-0000-0000000000b2';
    update public.journal_lines
       set account_id = case id
             when 'b7000000-0000-0000-0000-0000000000b1'::uuid then v_cr else v_dr end
     where id in ('b7000000-0000-0000-0000-0000000000b1', 'b7000000-0000-0000-0000-0000000000b2');
  end if;
  return new;
end $$;
create trigger test_sale_equal_total_substitution
  after insert on public.reconciliation_action_links
  for each row execute function pg_temp.swap_sale_journal_accounts();
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch('a0000000-0000-0000-0000-0000000000b0'))->>'failure_code',
  'integrity_check',
  'an equal-total account substitution on the original sale journal fails the snapshot postflight'
);
reset role;
drop trigger test_sale_equal_total_substitution on public.reconciliation_action_links;
select is(
  (select status from public.journal_entries where id = 'b6000000-0000-0000-0000-00000000000b'),
  'posted', 'the failed substitution rolls back the original sale journal reversal'
);
select is(
  (select account_id from public.journal_lines where id = 'b7000000-0000-0000-0000-0000000000b1'),
  current_setting('t.cash')::uuid, 'the failed substitution restores the original journal account'
);
select is(
  (select payment_status from public.sales where id = 'b5000000-0000-0000-0000-00000000000b'),
  'historical_treasury', 'the failed substitution leaves the original sale unreversed'
);
select is(
  (select count(*)::int from public.reconciliation_baselines
    where batch_id = 'a0000000-0000-0000-0000-0000000000b0'),
  0, 'the failed substitution rolls back every baseline snapshot'
);

-- ── retryable SQLSTATEs re-raise rather than stranding an approved sale batch ─────────────────────
create or replace function pg_temp.raise_injected_sqlstate()
returns trigger language plpgsql as $$
begin
  if new.batch_id::text = current_setting('t.inject_batch') then
    raise exception 'injected conflict' using errcode = current_setting('t.inject_code');
  end if;
  return new;
end $$;
create trigger test_sale_injected_sqlstate
  before insert on public.reconciliation_action_links
  for each row execute function pg_temp.raise_injected_sqlstate();

select set_config('t.sales_before_retry', (select count(*)::text from public.sales), false);
select pg_temp.make_batch('a0000000-0000-0000-0000-0000000000c0');
select pg_temp.add_sale_row(
  'a0000000-0000-0000-0000-0000000000c0', 'a1000000-0000-0000-0000-0000000000c0',
  'a2000000-0000-0000-0000-0000000000c0', 'sale-retryable-40001', 17, '2024-12-05',
  'برحي', null, 1, 17, 17, '2024-12-05'
);
select set_config('t.inject_batch', 'a0000000-0000-0000-0000-0000000000c0', false);
select set_config('t.inject_code', '40001', false);
select pg_temp.as_user(current_setting('t.owner'));
select throws_ok(
  $$select public.fn_execute_reconciliation_batch('a0000000-0000-0000-0000-0000000000c0'::uuid)$$,
  '40001', null,
  'a serialization failure in the sale path propagates out instead of being swallowed as failed'
);
reset role;
select is(
  (select status from public.reconciliation_batches where id = 'a0000000-0000-0000-0000-0000000000c0'),
  'approved', 'a re-raised serialization failure leaves the sale batch approved for retry'
);
select is(
  (select count(*)::int from public.sales), current_setting('t.sales_before_retry')::int,
  're-raising rolls back every sale written before the conflict'
);

select pg_temp.make_batch('a0000000-0000-0000-0000-0000000000c1');
select pg_temp.add_sale_row(
  'a0000000-0000-0000-0000-0000000000c1', 'a1000000-0000-0000-0000-0000000000c1',
  'a2000000-0000-0000-0000-0000000000c1', 'sale-retryable-40P01', 18, '2024-12-06',
  'برحي', null, 1, 18, 18, '2024-12-06'
);
select set_config('t.inject_batch', 'a0000000-0000-0000-0000-0000000000c1', false);
select set_config('t.inject_code', '40P01', false);
select pg_temp.as_user(current_setting('t.owner'));
select throws_ok(
  $$select public.fn_execute_reconciliation_batch('a0000000-0000-0000-0000-0000000000c1'::uuid)$$,
  '40P01', null, 'a deadlock in the sale path propagates out'
);
reset role;
select is(
  (select status from public.reconciliation_batches where id = 'a0000000-0000-0000-0000-0000000000c1'),
  'approved', 'a re-raised deadlock leaves the sale batch approved for retry'
);

select pg_temp.make_batch('a0000000-0000-0000-0000-0000000000c2');
select pg_temp.add_sale_row(
  'a0000000-0000-0000-0000-0000000000c2', 'a1000000-0000-0000-0000-0000000000c2',
  'a2000000-0000-0000-0000-0000000000c2', 'sale-nonretryable-23514', 19, '2024-12-07',
  'برحي', null, 1, 19, 19, '2024-12-07'
);
select set_config('t.inject_batch', 'a0000000-0000-0000-0000-0000000000c2', false);
select set_config('t.inject_code', '23514', false);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch('a0000000-0000-0000-0000-0000000000c2'))->>'failure_code',
  'integrity_check',
  'a non-retryable conflict at the same point is still persisted as a terminal failure'
);
reset role;
select is(
  (select status from public.reconciliation_batches where id = 'a0000000-0000-0000-0000-0000000000c2'),
  'failed', 'a non-retryable conflict durably marks the sale batch failed'
);
drop trigger test_sale_injected_sqlstate on public.reconciliation_action_links;

-- ── unsupported domain still fails closed ─────────────────────────────────────────────────────────
select pg_temp.make_batch('a0000000-0000-0000-0000-0000000000d0');
insert into public.reconciliation_evidence_items(
  id, org_id, origin_kind, source_workbook_sha256, sheet_name, row_locator,
  source_identity_fingerprint, source_amount, source_date_text, source_date_parsed,
  classification, invalid_calendar_quality_flag, first_staged_batch_id, evidence_label
) values (
  'a1000000-0000-0000-0000-0000000000d0', :'orgA', 'source_workbook_row', repeat('b', 64),
  'sale execution test', 'untyped-row', 'untyped-row', 10, '2024-12-08', '2024-12-08',
  'source_addition_candidate', false, 'a0000000-0000-0000-0000-0000000000d0', 'untyped'
);
insert into public.reconciliation_batch_rows(
  id, org_id, batch_id, evidence_item_id, review_state, disposition, frozen, frozen_at, payload_hash
) values (
  'a2000000-0000-0000-0000-0000000000d0', :'orgA', 'a0000000-0000-0000-0000-0000000000d0',
  'a1000000-0000-0000-0000-0000000000d0', 'frozen', 'hold', true, now(), repeat('c', 64)
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch('a0000000-0000-0000-0000-0000000000d0'))->>'status',
  'executed', 'a held (non-included) untyped row is simply not executed'
);
reset role;

-- ── the proof-gated classification invariant holds on this database ───────────────────────────────
select is(
  (select count(*)::int from public.sales s
    where s.payment_status = 'historical_treasury'
      and not private.fn_reconciliation_sale_has_exact_historical_journal(s.id)),
  0, 'every historical_treasury sale satisfies the exact proven direct-treasury predicate'
);
-- These two rows are created INSIDE this test transaction, long after the migration's one-time DO
-- block ran, so they prove the GUARD refuses them — not the backfill. The backfill's own rule is
-- covered by exercising its exact predicate and WHERE clause above.
select is(
  (select payment_status from public.sales where id = 'b5000000-0000-0000-0000-000000000005'),
  'unpaid',
  'an operational A/R sale is left untouched by the classification rule'
);
select is(
  (select payment_status from public.sales where id = 'b5000000-0000-0000-0000-000000000004'),
  'partially_collected',
  'a sale carrying a collection row is left untouched by the classification rule'
);
select ok(
  (select conname is not null from pg_constraint
    where conrelid = 'public.sales'::regclass and conname = 'sales_payment_status_check'),
  'the extended sale payment-status constraint is installed'
);
select throws_ok(
  format($$insert into public.sales(org_id, sale_date, crop, payment_status)
           values (%L::uuid, current_date, 'برحي', 'مجهول')$$, :'orgA'),
  '23514', null, 'the extended constraint still rejects an unknown payment status'
);

-- ── the backfill's proof predicate, exercised directly ────────────────────────────────────────────
-- The migration's one-time DO block relabels `collected` -> `historical_treasury` using EXACTLY this
-- predicate, so proving the predicate here proves the backfill's classification rule. A fresh test
-- database has no pre-existing sales, so this is the only way to cover the rule without depending on
-- tenant data — and no tenant row count appears in it.
select pg_temp.make_historical_sale(
  'bb000000-0000-0000-0000-000000000001', 'bb100000-0000-0000-0000-000000000001',
  'bb200000-0000-0000-0000-000000000001', 'bb200000-0000-0000-0000-000000000002',
  777, '2023-05-05', 'فسائل', (select id from public.accounts
                                where org_id = '00000000-0000-0000-0000-000000000001' and code = '4020'),
  null, null, null, false
);
select ok(
  private.fn_reconciliation_sale_has_exact_historical_journal('bb000000-0000-0000-0000-000000000001'),
  'the predicate accepts a proven Dr 1010 / Cr typed-leaf cash-in sale still labelled collected'
);
-- The backfill is PROOF-driven, not status-driven: filtering on a prior `collected` status would be
-- a silent no-op wherever the historical rows carry the column's `unpaid` default. This fixture row
-- is deliberately left `collected`; the sibling below is left `unpaid`. Both must be selected.
select is(
  (select count(*)::int from public.sales s
    where s.id = 'bb000000-0000-0000-0000-000000000001'
      and s.payment_status not in ('historical_treasury', 'historical_reversed')
      and private.fn_reconciliation_sale_has_exact_historical_journal(s.id)),
  1, 'the backfill WHERE clause selects a proven row that is still labelled collected'
);
select pg_temp.make_historical_sale(
  'bb000000-0000-0000-0000-000000000003', 'bb100000-0000-0000-0000-000000000003',
  'bb200000-0000-0000-0000-000000000005', 'bb200000-0000-0000-0000-000000000006',
  640, '2023-07-07', 'قمح', (select id from public.accounts
                              where org_id = '00000000-0000-0000-0000-000000000001' and code = '4050'),
  null, null, null, false
);
update public.sales set payment_status = 'unpaid'
 where id = 'bb000000-0000-0000-0000-000000000003';
select is(
  (select count(*)::int from public.sales s
    where s.id = 'bb000000-0000-0000-0000-000000000003'
      and s.payment_status not in ('historical_treasury', 'historical_reversed')
      and private.fn_reconciliation_sale_has_exact_historical_journal(s.id)),
  1,
  'the backfill also selects a proven row still carrying the unpaid DEFAULT — the case a status-driven filter would silently skip'
);
-- The completeness half of the migration's two-sided invariant: with these fixtures present there ARE
-- provably-historical rows left unlabelled, so the invariant query must see them. This is what makes a
-- silent no-op impossible.
select cmp_ok(
  (select count(*)::int from public.sales s
    where s.payment_status not in ('historical_treasury', 'historical_reversed')
      and private.fn_reconciliation_sale_has_exact_historical_journal(s.id)),
  '>=', 2,
  'the completeness invariant detects provably historical rows that were left unclassified'
);
select ok(
  not private.fn_reconciliation_sale_has_exact_historical_journal(
    'b5000000-0000-0000-0000-000000000004'),
  'the predicate rejects a sale carrying a collection row'
);
select ok(
  not private.fn_reconciliation_sale_has_exact_historical_journal(
    'b5000000-0000-0000-0000-000000000005'),
  'the predicate rejects an operational Dr1200/Cr4000 receivable sale'
);
select ok(
  not private.fn_reconciliation_sale_has_exact_historical_journal(
    'b5000000-0000-0000-0000-000000000006'),
  'the predicate rejects a sale with two journals'
);
select ok(
  not private.fn_reconciliation_sale_has_exact_historical_journal(
    'b5000000-0000-0000-0000-000000000008'),
  'the predicate rejects a journal amount that differs from the sale total'
);
select ok(
  not private.fn_reconciliation_sale_has_exact_historical_journal(
    'b5000000-0000-0000-0000-000000000009'),
  'the predicate rejects a journal mis-periodised against the sale economic date'
);
select ok(
  not private.fn_reconciliation_sale_has_exact_historical_journal(
    'b5000000-0000-0000-0000-00000000000a'),
  'the predicate rejects a credit to the 4000 parent instead of a typed leaf'
);
select ok(
  not private.fn_reconciliation_sale_has_exact_historical_journal(
    'b5000000-0000-0000-0000-000000000003'),
  'the predicate rejects an already-reversed sale'
);
-- Three sharper false-positive attacks on the predicate: a BALANCED four-line journal that still
-- contains a valid 1010/typed-leaf pair; an operational receivable wearing a TYPED leaf (so the
-- leaf check alone would not catch it); and a reversed-then-reposted sale whose latest entry is
-- posted and perfectly shaped. All three must be refused.
insert into public.sales(
  id, org_id, sale_date, crop, qty, unit, unit_price, total,
  price_status, price_finalized_at, payment_status
) values
  ('bc000000-0000-0000-0000-000000000001', :'orgA', '2024-01-01', 'برحي', 1, 'كجم',
   100, 100, 'finalized', now(), 'collected'),
  ('bc000000-0000-0000-0000-000000000003', :'orgA', '2024-01-03', 'برحي', 1, 'كجم',
   300, 300, 'finalized', now(), 'collected'),
  ('bc000000-0000-0000-0000-000000000004', :'orgA', '2024-01-04', 'برحي', 1, 'كجم',
   400, 400, 'finalized', now(), 'collected');
insert into public.journal_entries(
  id, org_id, entry_date, source_type, source_id, source_sequence, description, status, posted_at, reversal_of
) values
  ('bd000000-0000-0000-0000-000000000001', :'orgA', '2024-01-01', 'sale',
   'bc000000-0000-0000-0000-000000000001', 1, 'four line', 'posted', now(), null),
  ('bd000000-0000-0000-0000-000000000003', :'orgA', '2024-01-03', 'sale',
   'bc000000-0000-0000-0000-000000000003', 1, 'ar typed leaf', 'posted', now(), null),
  ('bd000000-0000-0000-0000-000000000004', :'orgA', '2024-01-04', 'sale',
   'bc000000-0000-0000-0000-000000000004', 1, 'reposted', 'posted', now(), null),
  ('bd000000-0000-0000-0000-000000000014', :'orgA', '2024-01-04', 'sale',
   'bc000000-0000-0000-0000-000000000004', 2, 'its reversal', 'reversed', now(),
   'bd000000-0000-0000-0000-000000000004');
insert into public.journal_lines(org_id, journal_entry_id, account_id, debit, credit) values
  -- balanced FOUR-line entry that nonetheless contains an exact 1010 debit + typed-leaf credit pair
  (:'orgA', 'bd000000-0000-0000-0000-000000000001', current_setting('t.cash')::uuid, 100, 0),
  (:'orgA', 'bd000000-0000-0000-0000-000000000001', current_setting('t.rev4010')::uuid, 0, 100),
  (:'orgA', 'bd000000-0000-0000-0000-000000000001', current_setting('t.cash')::uuid, 50, 0),
  (:'orgA', 'bd000000-0000-0000-0000-000000000001',
   (select id from public.accounts where org_id = '00000000-0000-0000-0000-000000000001' and code = '4030'), 0, 50),
  -- operational receivable wearing a TYPED revenue leaf
  (:'orgA', 'bd000000-0000-0000-0000-000000000003',
   public.fn_ensure_account('00000000-0000-0000-0000-000000000001'::uuid, '1200', 'ذمم مدينة (عملاء)', 'asset', 'debit'), 300, 0),
  (:'orgA', 'bd000000-0000-0000-0000-000000000003', current_setting('t.rev4010')::uuid, 0, 300),
  -- reversed-then-reposted: the surviving posted entry is perfectly shaped
  (:'orgA', 'bd000000-0000-0000-0000-000000000004', current_setting('t.cash')::uuid, 400, 0),
  (:'orgA', 'bd000000-0000-0000-0000-000000000004', current_setting('t.rev4010')::uuid, 0, 400),
  (:'orgA', 'bd000000-0000-0000-0000-000000000014', current_setting('t.rev4010')::uuid, 400, 0),
  (:'orgA', 'bd000000-0000-0000-0000-000000000014', current_setting('t.cash')::uuid, 0, 400);
select ok(
  not private.fn_reconciliation_sale_has_exact_historical_journal(
    'bc000000-0000-0000-0000-000000000001'),
  'the predicate rejects a balanced FOUR-line journal that still contains a valid 1010/leaf pair'
);
select ok(
  not private.fn_reconciliation_sale_has_exact_historical_journal(
    'bc000000-0000-0000-0000-000000000003'),
  'the predicate rejects a Dr 1200 receivable even when it credits a TYPED revenue leaf'
);
select ok(
  not private.fn_reconciliation_sale_has_exact_historical_journal(
    'bc000000-0000-0000-0000-000000000004'),
  'the predicate rejects a reversed-then-reposted sale whose surviving entry is perfectly shaped'
);
select throws_ok(
  $$update public.sales set payment_status = 'historical_treasury'
     where id = 'bc000000-0000-0000-0000-000000000003'$$,
  '22023', null,
  'the lifecycle guard refuses to certify a receivable-backed sale as historical treasury'
);
-- An archived-but-posted revenue leaf is deliberately still ACCEPTED: the repo already treats an
-- archived account that carries postings as live evidence (fn_accounting_trial_balance keeps its
-- balance), and reversing such a sale is still an exact inverse.
select ok(
  private.fn_reconciliation_sale_has_exact_historical_journal(
    'bb000000-0000-0000-0000-000000000001'),
  'the predicate still accepts the proven row before its leaf is archived'
);
update public.accounts set active = false where org_id = :'orgA' and code = '4020';
select ok(
  private.fn_reconciliation_sale_has_exact_historical_journal(
    'bb000000-0000-0000-0000-000000000001'),
  'an archived-but-posted revenue leaf does not strand an otherwise proven historical sale'
);
update public.accounts set active = true where org_id = :'orgA' and code = '4020';

-- A pending-price sale can never be swept in, even with a hand-built journal.
insert into public.sales(id, org_id, sale_date, crop, qty, unit)
values ('bb000000-0000-0000-0000-000000000002', :'orgA', '2023-06-06', 'برحي', 3, 'كجم');
select ok(
  not private.fn_reconciliation_sale_has_exact_historical_journal(
    'bb000000-0000-0000-0000-000000000002'),
  'the predicate rejects a pending-price sale outright'
);

-- ── the migration's classification, replayed END-TO-END on a pre-migration-shaped fixture ────────
-- The one-time DO block ran at migration time against an empty database, so it never demonstrated
-- anything. Here the pre-migration world is reconstructed — provable rows carrying the `unpaid`
-- DEFAULT, plus an AMBIGUOUS LOOKALIKE that must survive untouched — and the migration's exact
-- UPDATE and both invariant halves are executed verbatim against it.
select pg_temp.make_historical_sale(
  'e1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001',
  'e3000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000002',
  1500, '2022-01-10', 'برحي', null, null, null, null, false
);
select pg_temp.make_historical_sale(
  'e1000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000002',
  'e3000000-0000-0000-0000-000000000003', 'e3000000-0000-0000-0000-000000000004',
  2500, '2022-02-11', 'بنجر', (select id from public.accounts
                                where org_id = '00000000-0000-0000-0000-000000000001' and code = '4040'),
  null, null, null, false
);
-- The AMBIGUOUS LOOKALIKE: a posted sale journal with a real 1010 debit — so it trips the
-- "looks historical" heuristic — but its amount does not match the sale total, so the exact proof
-- refuses it. It must be counted as ambiguous and left completely alone.
select pg_temp.make_historical_sale(
  'e1000000-0000-0000-0000-000000000003', 'e2000000-0000-0000-0000-000000000003',
  'e3000000-0000-0000-0000-000000000005', 'e3000000-0000-0000-0000-000000000006',
  3500, '2022-03-12', 'برحي', null, null, 3400, null, false
);
update public.sales set payment_status = 'unpaid'
 where id in ('e1000000-0000-0000-0000-000000000001',
              'e1000000-0000-0000-0000-000000000002',
              'e1000000-0000-0000-0000-000000000003');
select is(
  (select count(*)::int from public.sales
    where id in ('e1000000-0000-0000-0000-000000000001',
                 'e1000000-0000-0000-0000-000000000002',
                 'e1000000-0000-0000-0000-000000000003')
      and payment_status = 'unpaid'),
  3, 'the pre-migration fixture carries the unpaid DEFAULT, as an unstaged import would'
);

-- ---- the migration's UPDATE, verbatim ----
do $$
declare v_n int;
begin
  update public.sales s
     set payment_status = 'historical_treasury'
   where s.payment_status not in ('historical_treasury', 'historical_reversed')
     and private.fn_reconciliation_sale_has_exact_historical_journal(s.id);
  get diagnostics v_n = row_count;
  perform set_config('t.reclassified', v_n::text, false);
end $$;
select cmp_ok(
  current_setting('t.reclassified')::int, '>=', 2,
  'the classification relabels the provable unpaid-default rows a status-driven filter would skip'
);
select is(
  (select payment_status from public.sales where id = 'e1000000-0000-0000-0000-000000000001'),
  'historical_treasury', 'the first provable pre-migration row is classified'
);
select is(
  (select payment_status from public.sales where id = 'e1000000-0000-0000-0000-000000000002'),
  'historical_treasury', 'the second provable pre-migration row is classified'
);
select is(
  (select payment_status from public.sales where id = 'e1000000-0000-0000-0000-000000000003'),
  'unpaid', 'the AMBIGUOUS LOOKALIKE is left completely untouched'
);

-- ---- the migration's ambiguous-count query, verbatim ----
select cmp_ok(
  (select count(*)::int
     from public.sales s
    where s.payment_status <> 'historical_treasury'
      and exists (
        select 1
          from public.journal_entries je
          join public.journal_lines jl on jl.journal_entry_id = je.id
          join public.accounts a
            on a.id = jl.account_id and a.org_id = s.org_id and a.code = '1010'
         where je.org_id = s.org_id and je.source_type = 'sale'
           and je.source_id = s.id and je.status = 'posted' and jl.debit > 0
      )
      and not private.fn_reconciliation_sale_has_exact_historical_journal(s.id)),
  '>=', 1,
  'the ambiguous-count query SEES the lookalike rather than silently ignoring it'
);

-- ---- both halves of the migration's two-sided invariant, verbatim ----
select is(
  (select count(*)::int from public.sales s
    where s.payment_status = 'historical_treasury'
      and not private.fn_reconciliation_sale_has_exact_historical_journal(s.id)),
  0, 'soundness half: nothing ended up labelled without the proof'
);
select is(
  (select count(*)::int from public.sales s
    where s.payment_status not in ('historical_treasury', 'historical_reversed')
      and private.fn_reconciliation_sale_has_exact_historical_journal(s.id)),
  0, 'completeness half: no provable row was left behind'
);
-- The classified rows are now correct everywhere a reader looks.
select pg_temp.as_user(current_setting('t.owner'));
select is(
  ((public.fn_revenue_sales_report(:'orgA', '2022-01-01', '2022-12-31', '2022-12-31'))
    ->>'outstanding_total')::numeric,
  3500::numeric,
  'after classification only the UNclassified lookalike still reports as outstanding A/R'
);
select is(
  ((public.fn_revenue_sales_report(:'orgA', '2022-01-01', '2022-12-31', '2022-12-31'))
    ->>'period_collections')::numeric,
  4000::numeric,
  'and the two classified sales register their totals as settled cash (1500 + 2500)'
);
reset role;

-- ── direct GL readers: a reversed sale nets to zero, a historical one is ordinary posted revenue ──
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (select round(sum((r->>'debit')::numeric - (r->>'credit')::numeric), 2)
     from jsonb_array_elements(public.fn_accounting_trial_balance(:'orgA')) r),
  0::numeric, 'the trial balance still balances after every sale posting and reversal in this file'
);
reset role;
-- Scoped to journals this slice actually created (via the action links), NOT the whole ledger: this
-- file also builds OPERATIONAL Dr1200/Cr4000 fixtures on purpose, and those must keep their balances.
select is(
  (select count(*)::int
     from public.reconciliation_action_links al
     join public.journal_lines jl on jl.journal_entry_id = al.journal_entry_id
     join public.accounts a on a.id = jl.account_id
    where a.code in ('1200', '1100')),
  0, 'no reconciliation-created journal line ever touches receivable 1200 or sales cash 1100'
);
select is(
  (select count(*)::int
     from public.reconciliation_action_links al
     join public.journal_lines jl on jl.journal_entry_id = al.journal_entry_id
     join public.accounts a on a.id = jl.account_id
    where a.code = '4000'),
  0, 'and no reconciliation-created journal line ever touches the 4000 PARENT'
);
select is(
  (select count(distinct a.code)::int
     from public.reconciliation_action_links al
     join public.journal_lines jl on jl.journal_entry_id = al.journal_entry_id
     join public.accounts a on a.id = jl.account_id
    where al.target_table = 'sales'
      and a.code not in ('1010', '4010', '4020', '4030', '4040', '4050', '4090')),
  0, 'every reconciliation sale line sits on treasury 1010 or a typed revenue leaf — nothing else'
);

-- ── a correction cannot repost into a typed account that has become a parent ─────────────────────
select pg_temp.make_historical_sale(
  'cafe0000-0000-0000-0000-000000000001', 'cafe1000-0000-0000-0000-000000000001',
  'cafe2000-0000-0000-0000-000000000001', 'cafe3000-0000-0000-0000-000000000001',
  600, '2024-06-15', 'برحي'
);
insert into public.accounts(
  id, org_id, parent_id, code, name_ar, account_type, normal_balance, active
) values (
  'cafe4000-0000-0000-0000-000000000001', :'orgA', current_setting('t.rev4010')::uuid,
  '4010-TEST-CHILD', 'اختبار فرع إيراد', 'revenue', 'credit', true
);
select pg_temp.make_batch('cafe5000-0000-0000-0000-000000000001');
select pg_temp.add_sale_row(
  'cafe5000-0000-0000-0000-000000000001', 'cafe6000-0000-0000-0000-000000000001',
  'cafe7000-0000-0000-0000-000000000001', 'inherited-parent-account', 650, '2024-06-15',
  'برحي', 'cafe0000-0000-0000-0000-000000000001', 1, 650, 650, '2024-06-15'
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch('cafe5000-0000-0000-0000-000000000001'))->>'failure_code',
  'integrity_check',
  'a correction fails closed when the inherited typed revenue account has an active child'
);
reset role;
select is(
  (select payment_status from public.sales where id = 'cafe0000-0000-0000-0000-000000000001'),
  'historical_treasury', 'the failed non-leaf correction leaves the original sale correctable'
);
select is(
  (select status from public.journal_entries where id = 'cafe1000-0000-0000-0000-000000000001'),
  'posted', 'the failed non-leaf correction leaves the original journal posted'
);
select is(
  (select count(*)::int from public.reconciliation_action_links
    where batch_id = 'cafe5000-0000-0000-0000-000000000001'),
  0, 'the failed non-leaf correction creates no financial action'
);
select is(
  (select count(*)::int from public.sales
    where corrects_sale_id = 'cafe0000-0000-0000-0000-000000000001'),
  0, 'the failed non-leaf correction creates no replacement sale'
);
update public.accounts
   set active = false
 where id = 'cafe4000-0000-0000-0000-000000000001';

-- NOTE ON PLACEMENT: this block is LAST on purpose. It drops and re-adds a CHECK on
-- reconciliation_batch_rows, which takes ACCESS EXCLUSIVE on that table for the remainder of
-- the transaction — any earlier placement would block the side connections the concurrency
-- race above uses, and hang the file.
-- ── a reviewed sale price must be PRESENT, not merely non-negative ────────────────────────────────
-- Built WITHOUT pg_temp.add_sale_row, whose defaults would coalesce a null away and could not prove
-- this. The table CHECK is the first line of defence; the executor no longer relies on it alone.
insert into public.reconciliation_evidence_items(
  id, org_id, origin_kind, source_workbook_sha256, sheet_name, row_locator,
  source_identity_fingerprint, source_amount, source_date_text, source_date_parsed,
  classification, invalid_calendar_quality_flag, first_staged_batch_id, evidence_label
) values (
  'd1000000-0000-0000-0000-000000000001', :'orgA', 'source_workbook_row', repeat('b', 64),
  'sale execution test', 'null-price-row', 'null-price-row', 0, '2024-07-07', '2024-07-07',
  'zero_value_source_placeholder', false, 'a0000000-0000-0000-0000-000000000010', 'null price'
);
select pg_temp.make_batch('a0000000-0000-0000-0000-0000000000d8');
select throws_ok(
  format($$insert into public.reconciliation_batch_rows(
      id, org_id, batch_id, evidence_item_id, review_state, target_table, disposition,
      sale_crop, sale_quantity, sale_unit_price, sale_recorded_total,
      sale_historical_date_decision, sale_effective_date)
    values ('d2000000-0000-0000-0000-000000000001', %L::uuid,
            'a0000000-0000-0000-0000-0000000000d8', 'd1000000-0000-0000-0000-000000000001',
            'reviewed', 'sales', 'include', 'برحي', null, null, 0,
            'use_source_text_date', '2024-07-07')$$, :'orgA'),
  '23514', null,
  'an included sales row with NULL quantity and unit price is rejected by the table CHECK'
);
select throws_ok(
  format($$insert into public.reconciliation_batch_rows(
      id, org_id, batch_id, evidence_item_id, review_state, target_table, disposition,
      sale_crop, sale_quantity, sale_unit_price, sale_recorded_total,
      sale_historical_date_decision, sale_effective_date)
    values ('d2000000-0000-0000-0000-000000000002', %L::uuid,
            'a0000000-0000-0000-0000-0000000000d8', 'd1000000-0000-0000-0000-000000000001',
            'reviewed', 'sales', 'include', 'برحي', 5, null, 0,
            'use_source_text_date', '2024-07-07')$$, :'orgA'),
  '23514', null,
  'a NULL unit price alone is rejected too — a zero source amount is no excuse'
);
-- The executor carries its OWN non-null guard rather than trusting a constraint it does not own.
-- Reaching that guard means getting a genuinely-null row past the CHECK, and a CHECK cannot be
-- bypassed by session_replication_role (that only disables triggers) — so the constraint is dropped
-- for the remainder of this transaction and rolled back with the file. This is the only way to prove
-- the executor is safe on its own rather than merely shadowed by the table constraint.
alter table public.reconciliation_batch_rows
  drop constraint reconciliation_batch_rows_target_required;
insert into public.reconciliation_batch_rows(
  id, org_id, batch_id, evidence_item_id, review_state, reviewer_id, review_reason, reviewed_at,
  target_table, disposition, sale_crop, sale_quantity, sale_unit_price, sale_recorded_total,
  sale_historical_date_decision, sale_effective_date
) values (
  'd2000000-0000-0000-0000-000000000003', :'orgA', 'a0000000-0000-0000-0000-0000000000d8',
  'd1000000-0000-0000-0000-000000000001', 'reviewed', current_setting('t.acct')::uuid,
  'null quantity bypass', now(), 'sales', 'include', 'برحي', null, 0, 0,
  'use_source_text_date', '2024-07-07'
);
update public.reconciliation_batch_rows br
   set payload_hash = private.fn_reconciliation_execution_payload_hash(br),
       frozen = true, frozen_at = now(), review_state = 'frozen'
 where br.id = 'd2000000-0000-0000-0000-000000000003';
select ok(
  (select sale_quantity is null and sale_unit_price = 0
     from public.reconciliation_batch_rows where id = 'd2000000-0000-0000-0000-000000000003'),
  'the first bypassed row isolates NULL quantity with a present zero unit price'
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch('a0000000-0000-0000-0000-0000000000d8'))->>'failure_code',
  'integrity_check',
  'the executor independently refuses a null reviewed quantity with the CHECK bypassed'
);
reset role;
select is(
  (select count(*)::int from public.reconciliation_action_links
    where batch_id = 'a0000000-0000-0000-0000-0000000000d8'),
  0, 'the null-quantity row posts nothing'
);
-- Isolate the other half too: quantity is present, only unit price is NULL.
select pg_temp.make_batch('a0000000-0000-0000-0000-0000000000d9');
insert into public.reconciliation_batch_rows(
  id, org_id, batch_id, evidence_item_id, review_state, reviewer_id, review_reason, reviewed_at,
  target_table, disposition, sale_crop, sale_quantity, sale_unit_price, sale_recorded_total,
  sale_historical_date_decision, sale_effective_date
) values (
  'd2000000-0000-0000-0000-000000000005', :'orgA', 'a0000000-0000-0000-0000-0000000000d9',
  'd1000000-0000-0000-0000-000000000001', 'reviewed', current_setting('t.acct')::uuid,
  'null unit price bypass', now(), 'sales', 'include', 'برحي', 0, null, 0,
  'use_source_text_date', '2024-07-07'
);
update public.reconciliation_batch_rows br
   set payload_hash = private.fn_reconciliation_execution_payload_hash(br),
       frozen = true, frozen_at = now(), review_state = 'frozen'
 where br.id = 'd2000000-0000-0000-0000-000000000005';
select ok(
  (select sale_quantity = 0 and sale_unit_price is null
     from public.reconciliation_batch_rows where id = 'd2000000-0000-0000-0000-000000000005'),
  'the second bypassed row isolates NULL unit price with a present zero quantity'
);
select pg_temp.as_user(current_setting('t.owner'));
select is(
  (public.fn_execute_reconciliation_batch('a0000000-0000-0000-0000-0000000000d9'))->>'failure_code',
  'integrity_check',
  'the executor independently refuses a null reviewed unit price with the CHECK bypassed'
);
reset role;
select is(
  (select count(*)::int from public.reconciliation_action_links
    where batch_id = 'a0000000-0000-0000-0000-0000000000d9'),
  0, 'the null-unit-price row posts nothing'
);
-- Restore it immediately: nothing after this point may run with the constraint missing. Restored
-- NOT VALID because the bypass row cannot be removed first — a frozen batch row is delete-guarded,
-- which is itself a protection worth keeping. NOT VALID skips only the scan of pre-existing rows;
-- the CHECK still applies in full to every subsequent insert and update, which is what matters here.
alter table public.reconciliation_batch_rows
  add constraint reconciliation_batch_rows_target_required check (
    disposition <> 'include'
    or (
      target_table = 'expenses'
        and expense_category is not null and expense_kind is not null and expense_account_id is not null
    )
    or (
      target_table = 'sales'
        and sale_crop is not null and sale_quantity is not null
        and sale_unit_price is not null and sale_recorded_total is not null
    )
  ) not valid;
select ok(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.reconciliation_batch_rows'::regclass
      and conname = 'reconciliation_batch_rows_target_required') = 1,
  'the target_required CHECK is restored before any later assertion runs'
);
select throws_ok(
  format($$insert into public.reconciliation_batch_rows(
      id, org_id, batch_id, evidence_item_id, target_table, disposition,
      sale_crop, sale_quantity, sale_unit_price, sale_recorded_total)
    values ('d2000000-0000-0000-0000-000000000004', %L::uuid,
            'a0000000-0000-0000-0000-0000000000d8', 'd1000000-0000-0000-0000-000000000001',
            'sales', 'include', 'برحي', null, null, 0)$$, :'orgA'),
  '23514', null,
  'and the restored CHECK still rejects a fresh null-price row'
);

select * from finish();
rollback;
