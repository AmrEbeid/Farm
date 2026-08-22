-- One exact, bounded, accountant-only home snapshot.
--
-- Reuses the canonical month-close checklist (public.fn_month_close_summary) for the close-blocker
-- predicates and the aged-receivable definition rather than re-deriving them, so this snapshot can
-- never silently drift from the close checklist it summarizes. Exact totals/counts are independent
-- from the bounded, deterministically ordered driver samples; every money amount and every count
-- leaves PostgreSQL as text (only detail_limit is numeric). Money is nulled whenever the org's
-- finance_ledger source authority is not 'verified'; counts and queues remain regardless.

begin;

create or replace function public.fn_accountant_home_snapshot(
  p_org uuid,
  p_as_of date,
  p_cutover date,
  p_detail_limit integer default 8
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  c_version constant text := 'farm-os.accountant-home.v1';
  c_live_cutover constant date := date '2026-07-01';
  v_uid uuid := (select auth.uid());
  v_active_org uuid;
  v_authority text;
  v_money_ok boolean;
  v_month_start date;
  v_month_end date;
  v_prev_month_start date;
  v_close jsonb;
  v_blocker_count bigint;
  v_ledger_gap_count bigint;
  v_current_posted_count bigint;
  v_previous_posted_count bigint;
  v_result jsonb;
begin
  if p_org is null or p_as_of is null or p_cutover is null then
    raise exception 'organization, as-of date, and cutover are required' using errcode = '23502';
  end if;
  if p_detail_limit is null or p_detail_limit < 1 or p_detail_limit > 20 then
    raise exception 'detail limit must be between 1 and 20' using errcode = '22023';
  end if;
  if p_as_of <> (pg_catalog.now() at time zone 'Africa/Cairo')::date then
    raise exception 'accountant home as-of must equal the current Cairo business date' using errcode = '22007';
  end if;
  if p_cutover <> c_live_cutover then
    raise exception 'accountant home cutover must equal the canonical live-entry cutover' using errcode = '22023';
  end if;

  begin
    v_active_org := nullif(
      nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'active_org_id',
      ''
    )::uuid;
  exception when others then
    raise exception 'forbidden: invalid active organization claim' using errcode = '42501';
  end;

  if v_uid is null or v_active_org is null or v_active_org is distinct from p_org then
    raise exception 'forbidden: accountant home requires the active organization' using errcode = '42501';
  end if;
  if not exists (
    select 1
      from public.organization_member m
     where m.user_id = v_uid
       and m.org_id = p_org
       and m.role = 'accountant'
  ) then
    raise exception 'forbidden: accountant membership is required' using errcode = '42501';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: organization is outside the active scope' using errcode = '42501';
  end if;

  -- These canonical SECURITY DEFINER readers validate buyer tenancy and over-collection before this
  -- SECURITY INVOKER function derives uncapped exact totals under the caller's RLS.
  perform public.fn_pending_sale_pricing(p_org, 1);
  perform public.fn_open_sale_receivables(p_org, 1);

  -- Fail closed rather than turn a corrupt cross-org reference into a blended snapshot.
  if exists (
    select 1 from public.custody_movements m
    left join public.custody_accounts a on a.id = m.custody_account_id and a.org_id = p_org
    where m.org_id = p_org and a.id is null
  ) or exists (
    select 1 from public.sale_collections c
    left join public.sales s on s.id = c.sale_id and s.org_id = p_org
    where c.org_id = p_org and s.id is null
  ) or exists (
    select 1 from public.payment_request_lines l
    left join public.payment_requests pr
      on pr.id = l.payment_request_id and pr.org_id = p_org
    left join public.expenses e on e.id = l.expense_id and e.org_id = p_org
    where l.org_id = p_org and (pr.id is null or e.id is null)
  ) or exists (
    select 1 from public.payment_requests pr
    left join public.custody_accounts a on a.id = pr.custody_account_id and a.org_id = p_org
    where pr.org_id = p_org and pr.custody_account_id is not null and a.id is null
  ) or exists (
    select 1 from public.reconciliation_batch_rows r
    left join public.reconciliation_batches b on b.id = r.batch_id and b.org_id = p_org
    where r.org_id = p_org and b.id is null
  ) or exists (
    select 1 from public.reconciliation_batch_rows r
    left join public.reconciliation_evidence_items e on e.id = r.evidence_item_id and e.org_id = p_org
    where r.org_id = p_org and e.id is null
  ) then
    raise exception 'accountant home organization relationship mismatch' using errcode = '23514';
  end if;

  select coalesce((
    select d.status
      from public.data_authority_status d
     where d.org_id = p_org and d.domain = 'finance_ledger'
  ), 'unverified') into v_authority;
  v_money_ok := (v_authority = 'verified');

  v_month_start := date_trunc('month', p_as_of)::date;
  v_month_end := (date_trunc('month', p_as_of) + interval '1 month')::date;
  v_prev_month_start := (date_trunc('month', p_as_of) - interval '1 month')::date;

  -- Reuse the canonical close checklist verbatim: same undated/unrouted/unclassified/unallocated
  -- expense predicates and the same aged-receivable definition, so this snapshot cannot drift from it.
  v_close := public.fn_month_close_summary(p_org, p_cutover, p_as_of);
  v_blocker_count :=
      (v_close->>'pending_price_count')::bigint
    + (v_close->>'undated_expense_count')::bigint
    + (v_close->>'unrouted_count')::bigint
    + (v_close->>'unclassified_count')::bigint
    + (v_close->>'unallocated_count')::bigint;
  v_ledger_gap_count :=
      (v_close->>'undated_expense_count')::bigint
    + (v_close->>'unrouted_count')::bigint
    + (v_close->>'unclassified_count')::bigint
    + (v_close->>'unallocated_count')::bigint;

  select count(*) filter (where j.status = 'posted' and j.entry_date >= greatest(v_month_start, p_cutover)
                             and j.entry_date < least(v_month_end, p_as_of + 1)),
         count(*) filter (where j.status = 'posted' and j.entry_date >= greatest(v_prev_month_start, p_cutover)
                             and j.entry_date < v_month_start)
    into v_current_posted_count, v_previous_posted_count
    from public.journal_entries j
   where j.org_id = p_org;

  with
  period_summary as (
    select count(*) filter (where status = 'open')::bigint as open_count,
           count(*) filter (where status = 'locked')::bigint as locked_count,
           exists (
             select 1 from public.accounting_periods p2
              where p2.org_id = p_org and p2.status = 'locked'
                and p_as_of between p2.period_start and p2.period_end
           ) as as_of_locked
      from public.accounting_periods
     where org_id = p_org
  ),
  custody_balances as materialized (
    select a.id, a.holder_label, a.target_float,
           coalesce(sum(m.amount_in - m.amount_out), 0) as closing_balance
      from public.custody_accounts a
      left join public.custody_movements m
        on m.org_id = p_org and m.custody_account_id = a.id and m.occurred_at <= p_as_of
     where a.org_id = p_org
     group by a.id, a.holder_label, a.target_float
  ),
  custody_summary as (
    select count(*)::bigint as account_count,
           coalesce(sum(target_float), 0) as total_target_float,
           coalesce(sum(closing_balance), 0) as total_closing_balance
      from custody_balances
  ),
  custody_rows as materialized (
    select id, holder_label, target_float, closing_balance
      from custody_balances
     order by holder_label, id
     limit p_detail_limit
  ),
  pending_pricing_source as materialized (
    select s.id, s.sale_date, s.crop, s.qty, s.unit, s.delivery_note_no,
           coalesce(b.name, 'بدون اسم') as buyer_name
      from public.sales s
      left join public.buyers b on b.id = s.buyer_id and b.org_id = s.org_id
     where s.org_id = p_org
       and s.price_status = 'pending'
       and coalesce(s.sale_date, s.delivery_date, (s.created_at at time zone 'UTC')::date)
           between p_cutover and p_as_of
  ),
  pending_pricing_summary as (
    select count(*)::bigint as pending_count from pending_pricing_source
  ),
  pending_pricing_rows as materialized (
    select * from pending_pricing_source
     order by sale_date desc nulls last, id
     limit p_detail_limit
  ),
  open_receivable_source as materialized (
    select s.id, s.sale_date, s.crop, s.total,
           totals.collected,
           s.total - totals.collected as remaining,
           coalesce(b.name, 'عميل نقدي') as buyer_name
      from public.sales s
      left join public.buyers b on b.id = s.buyer_id and b.org_id = s.org_id
      left join lateral (
        select coalesce(sum(c.amount), 0) as collected
          from public.sale_collections c
         where c.sale_id = s.id and c.org_id = s.org_id
           and c.occurred_at <= p_as_of
      ) totals on true
     where s.org_id = p_org
       and s.price_status = 'finalized'
       and s.payment_status not in ('historical_treasury', 'historical_reversed')
       and s.total is not null
       and s.total - totals.collected > 0
       and exists (
         select 1 from public.journal_entries je
          where je.org_id = s.org_id and je.source_type = 'sale'
            and je.source_id = s.id and je.status = 'posted'
       )
  ),
  open_receivable_summary as (
    select count(*)::bigint as open_count,
           coalesce(sum(remaining), 0) as open_total
      from open_receivable_source
  ),
  open_receivable_rows as materialized (
    select * from open_receivable_source
     order by sale_date desc nulls last, id
     limit p_detail_limit
  ),
  reconciliation_summary as (
    select count(*)::bigint as batch_count,
           count(*) filter (where b.status = 'staged')::bigint as staged_batch_count,
           count(*) filter (where b.status = 'reviewed')::bigint as owner_waiting_count,
           count(*) filter (where b.status = 'failed')::bigint as failed_batch_count
      from public.reconciliation_batches b
     where b.org_id = p_org
  ),
  reconciliation_rows as materialized (
    select b.id, b.status,
           count(*) filter (where r.review_state = 'unreviewed')::bigint as unreviewed_count
      from public.reconciliation_batches b
      left join public.reconciliation_batch_rows r
        on r.org_id = b.org_id and r.batch_id = b.id
     where b.org_id = p_org and b.status = 'staged'
     group by b.id, b.status, b.created_at
     order by b.created_at, b.id
     limit p_detail_limit
  ),
  payment_obligation_scope as materialized (
    select pr.id, pr.request_no, pr.status, pr.period_start, pr.period_end,
           pr.approved_net_request, pr.created_at,
           (pr.status = 'approved_operational') as owner_blocked
      from public.payment_requests pr
     where pr.org_id = p_org
       and pr.status in ('draft', 'submitted', 'approved_operational', 'approved_final', 'paid')
  ),
  payment_obligation_summary as (
    select count(*) filter (where not owner_blocked)::bigint as accountant_actionable_count,
           count(*) filter (where owner_blocked)::bigint as owner_blocked_count
      from payment_obligation_scope
  ),
  payment_obligation_rows as materialized (
    select * from payment_obligation_scope
     order by created_at asc nulls last, id
     limit p_detail_limit
  ),
  operating_unpaid_summary as (
    select count(*) filter (where kind = 'operating')::bigint as operating_count,
           coalesce(sum(total) filter (where kind = 'operating'), 0) as operating_total,
           count(*) filter (where kind = 'operating' and total is null)::bigint as operating_unknown_count,
           count(*) filter (where kind = 'capex')::bigint as capex_count,
           coalesce(sum(total) filter (where kind = 'capex'), 0) as capex_total,
           count(*) filter (where kind = 'capex' and total is null)::bigint as capex_unknown_count,
           count(*) filter (where kind = 'drawing')::bigint as drawing_excluded_count
      from public.expenses
     where org_id = p_org and payment_status = 'post_paid_unpaid'
       and (date is null or date <= p_as_of)
  )
  select jsonb_build_object(
    'version', c_version,
    'org_id', p_org,
    'as_of', p_as_of::text,
    'cutover', p_cutover::text,
    'month_start', v_month_start::text,
    'month_end', v_month_end::text,
    'previous_month_start', v_prev_month_start::text,
    'previous_month_end', v_month_start::text,
    'detail_limit', p_detail_limit,
    'authority', v_authority,
    'money_available', v_money_ok,
    'state', jsonb_build_object(
      'period', jsonb_build_object(
        'open_count', (select open_count::text from period_summary),
        'locked_count', (select locked_count::text from period_summary),
        'as_of_locked', (select as_of_locked from period_summary)
      ),
      'custody', jsonb_build_object(
        'account_count', (select account_count::text from custody_summary),
        'total_target_float', case when v_money_ok then (select total_target_float::text from custody_summary) else null end,
        'total_closing_balance', case when v_money_ok then (select total_closing_balance::text from custody_summary) else null end
      )
    ),
    'queues', jsonb_build_object(
      'close_blockers', jsonb_build_object(
        'pending_price_count', v_close->>'pending_price_count',
        'undated_expense_count', v_close->>'undated_expense_count',
        'undated_expense_known_total', case when v_money_ok then v_close->>'undated_expense_known_total' else null end,
        'undated_expense_unknown_count', v_close->>'undated_expense_unknown_count',
        'unrouted_count', v_close->>'unrouted_count',
        'unrouted_known_total', case when v_money_ok then v_close->>'unrouted_known_total' else null end,
        'unrouted_unknown_count', v_close->>'unrouted_unknown_count',
        'unclassified_count', v_close->>'unclassified_count',
        'unclassified_known_total', case when v_money_ok then v_close->>'unclassified_known_total' else null end,
        'unclassified_unknown_count', v_close->>'unclassified_unknown_count',
        'unallocated_count', v_close->>'unallocated_count',
        'unallocated_known_total', case when v_money_ok then v_close->>'unallocated_known_total' else null end,
        'unallocated_unknown_count', v_close->>'unallocated_unknown_count'
      ),
      'pending_pricing', jsonb_build_object(
        'count', (select pending_count::text from pending_pricing_summary)
      ),
      'receivables', jsonb_build_object(
        'aged_count', v_close->>'aged_receivable_count',
        'aged_total', case when v_money_ok then v_close->>'aged_receivable_total' else null end,
        'open_count', (select open_count::text from open_receivable_summary),
        'open_total', case when v_money_ok then (select open_total::text from open_receivable_summary) else null end
      ),
      'reconciliation', jsonb_build_object(
        'batch_count', (select batch_count::text from reconciliation_summary),
        'staged_batch_count', (select staged_batch_count::text from reconciliation_summary),
        'owner_waiting_count', (select owner_waiting_count::text from reconciliation_summary),
        'failed_batch_count', (select failed_batch_count::text from reconciliation_summary)
      ),
      'payment_obligations', jsonb_build_object(
        'accountant_actionable_count', (select accountant_actionable_count::text from payment_obligation_summary),
        'owner_blocked_count', (select owner_blocked_count::text from payment_obligation_summary),
        'operating_unpaid_count', (select operating_count::text from operating_unpaid_summary),
        'operating_unpaid_total', case when v_money_ok then (select operating_total::text from operating_unpaid_summary) else null end,
        'operating_unpaid_unknown_count', (select operating_unknown_count::text from operating_unpaid_summary),
        'capex_unpaid_count', (select capex_count::text from operating_unpaid_summary),
        'capex_unpaid_total', case when v_money_ok then (select capex_total::text from operating_unpaid_summary) else null end,
        'capex_unpaid_unknown_count', (select capex_unknown_count::text from operating_unpaid_summary),
        'drawing_excluded_count', (select drawing_excluded_count::text from operating_unpaid_summary)
      )
    ),
    'attention', jsonb_build_object(
      'close_blocker_count', v_blocker_count::text,
      'ledger_gap_count', v_ledger_gap_count::text,
      'pending_pricing_count', (select pending_count::text from pending_pricing_summary),
      'aged_receivables_count', v_close->>'aged_receivable_count',
      'reconciliation_actionable_count', (select staged_batch_count::text from reconciliation_summary),
      'payment_obligations_actionable_count', (select accountant_actionable_count::text from payment_obligation_summary),
      'payment_obligations_owner_blocked_count', (select owner_blocked_count::text from payment_obligation_summary)
    ),
    'comparison', case when v_money_ok then jsonb_build_object(
      'comparable', true,
      'current_month_posted_count', v_current_posted_count::text,
      'previous_month_posted_count', v_previous_posted_count::text,
      'reason', null
    ) else jsonb_build_object(
      'comparable', false,
      'current_month_posted_count', null,
      'previous_month_posted_count', null,
      'reason', format('finance_ledger authority is %s, not verified', v_authority)
    ) end,
    'drivers', jsonb_build_object(
      'pending_pricing', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'sale_date', case when sale_date is null then null else sale_date::text end,
        'crop', crop, 'qty', qty::text, 'unit', coalesce(unit, ''),
        'buyer_name', buyer_name,
        'delivery_note_no', case when delivery_note_no is null then null else delivery_note_no::text end
      ) order by sale_date desc nulls last, id) from pending_pricing_rows), '[]'::jsonb),
      'receivables', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'sale_date', case when sale_date is null then null else sale_date::text end,
        'crop', crop, 'buyer_name', buyer_name,
        'total', case when v_money_ok then total::text else null end,
        'collected', case when v_money_ok then collected::text else null end,
        'remaining', case when v_money_ok then remaining::text else null end
      ) order by sale_date desc nulls last, id) from open_receivable_rows), '[]'::jsonb),
      'reconciliation', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'status', status, 'unreviewed_count', unreviewed_count::text
      ) order by id) from reconciliation_rows), '[]'::jsonb),
      'payment_obligations', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'request_no', request_no::text, 'status', status,
        'period_start', case when period_start is null then null else period_start::text end,
        'period_end', case when period_end is null then null else period_end::text end,
        'approved_net_request', case when not v_money_ok then null
          when approved_net_request is null then null else approved_net_request::text end,
        'owner_blocked', owner_blocked
      ) order by created_at asc nulls last, id) from payment_obligation_rows), '[]'::jsonb),
      'custody_accounts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'holder_label', holder_label,
        'target_float', case when v_money_ok then target_float::text else null end,
        'closing_balance', case when v_money_ok then closing_balance::text else null end
      ) order by holder_label, id) from custody_rows), '[]'::jsonb)
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.fn_accountant_home_snapshot(uuid, date, date, integer)
  from public, anon, authenticated;
grant execute on function public.fn_accountant_home_snapshot(uuid, date, date, integer)
  to authenticated;

comment on function public.fn_accountant_home_snapshot(uuid, date, date, integer) is
  'Accountant-only active-org exact home snapshot: canonical close/receivable definitions, capped evidence rows, money nulled unless finance_ledger authority is verified.';

commit;
