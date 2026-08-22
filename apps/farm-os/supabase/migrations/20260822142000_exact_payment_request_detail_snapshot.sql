-- One role-aware atomic snapshot for the payment-request 360 page.
begin;

create or replace function public.fn_payment_request_detail_snapshot(
  p_org uuid,
  p_request uuid,
  p_available_limit integer default 150
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_version constant text := 'farm-os.payment-request-detail.v1';
  v_request jsonb;
  v_totals jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_fundings jsonb := '[]'::jsonb;
  v_custody_accounts jsonb := '[]'::jsonb;
  v_accounts jsonb := '[]'::jsonb;
  v_actors jsonb := '[]'::jsonb;
  v_available jsonb := '[]'::jsonb;
  v_available_count bigint := 0;
  v_unclassified_count bigint := 0;
  v_actor_ids uuid[];
begin
  if p_org is null or p_request is null then
    raise exception 'org and payment request required' using errcode = '23502';
  end if;
  if p_available_limit is null or p_available_limit < 1 or p_available_limit > 500 then
    raise exception 'available expense limit must be between 1 and 500' using errcode = '22023';
  end if;
  if p_org not in (select public.user_org_ids())
     or not public.authorize('finance.read', p_org) then
    raise exception 'forbidden: payment request detail requires finance.read'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', r.id,
    'request_no', r.request_no,
    'status', r.status,
    'period_start', case when r.period_start is null then null else r.period_start::text end,
    'period_end', case when r.period_end is null then null else r.period_end::text end,
    'custody_account_id', r.custody_account_id,
    'custody_account_label', ca.holder_label,
    'note', r.note,
    'created_at', r.created_at::text,
    'prepared_by', r.prepared_by,
    'submitted_at', case when r.submitted_at is null then null else r.submitted_at::text end,
    'approved_op_by', r.approved_op_by,
    'approved_op_at', case when r.approved_op_at is null then null else r.approved_op_at::text end,
    'approved_final_by', r.approved_final_by,
    'approved_final_at', case when r.approved_final_at is null then null else r.approved_final_at::text end
  ), array_remove(array[r.prepared_by, r.approved_op_by, r.approved_final_by], null)
    into v_request, v_actor_ids
    from public.payment_requests r
    left join public.custody_accounts ca
      on ca.id = r.custody_account_id and ca.org_id = p_org
   where r.id = p_request and r.org_id = p_org;

  if v_request is null then
    return jsonb_build_object(
      'version', c_version,
      'org_id', p_org,
      'request_id', p_request,
      'request', null,
      'totals', null,
      'organization_name', null,
      'lines', '[]'::jsonb,
      'fundings', '[]'::jsonb,
      'custody_accounts', '[]'::jsonb,
      'accounts', '[]'::jsonb,
      'actors', '[]'::jsonb,
      'available_expenses', '[]'::jsonb,
      'available_expense_count', '0',
      'unclassified_available_count', '0',
      'available_expenses_truncated', false
    );
  end if;

  if (v_request->>'custody_account_id') is not null
     and (v_request->>'custody_account_label') is null then
    raise exception 'payment request detail snapshot: foreign custody account'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.payment_request_lines l
      left join public.expenses e on e.id = l.expense_id
     where l.payment_request_id = p_request
       and (
         l.org_id is distinct from p_org or e.id is null or e.org_id is distinct from p_org
         or (e.account_id is not null and not exists (
           select 1 from public.accounts a where a.id = e.account_id and a.org_id = p_org
         ))
         or (
           l.paid_at is null and (
             l.paid_from_custody_account_id is not null
             or l.custody_movement_id is not null or l.journal_entry_id is not null
             or e.payment_status is distinct from 'post_paid_unpaid'
           )
         )
         or (
           l.paid_at is not null and (
             e.payment_status is distinct from 'paid_from_custody'
             or l.paid_from_custody_account_id is null
             or l.custody_movement_id is null
             or l.journal_entry_id is null
             or not exists (
               select 1
                 from public.custody_movements cm
                where cm.id = l.custody_movement_id
                  and cm.org_id = p_org
                  and cm.custody_account_id = l.paid_from_custody_account_id
                  and cm.expense_id = e.id
                  and cm.amount_in = 0
                  and cm.amount_out = e.total
                  and cm.journal_entry_id = l.journal_entry_id
                  and cm.reversal_of is null
                  and cm.reversed_by is null
                  and (cm.payment_request_id is null or cm.payment_request_id = p_request)
             )
             or not exists (
               select 1
                 from public.journal_entries je
                where je.id = l.journal_entry_id
                  and je.org_id = p_org
                  and je.source_type = 'expense_payment'
                  and je.source_id = e.id
                  and je.status = 'posted'
                  and je.reversal_of is null
                  and je.entry_date = (
                    select cm.occurred_at from public.custody_movements cm
                     where cm.id = l.custody_movement_id
                  )
             )
             or not exists (
               select 1
                 from public.journal_lines jl
                where jl.journal_entry_id = l.journal_entry_id
                group by jl.journal_entry_id
               having count(*) = 2
                  and count(*) filter (
                    where jl.org_id = p_org
                      and jl.custody_account_id = l.paid_from_custody_account_id
                      and jl.custody_movement_id = l.custody_movement_id
                      and jl.expense_id = e.id
                      and (jl.payment_request_id is null or jl.payment_request_id = p_request)
                  ) = 2
                  and sum(jl.debit) = e.total
                  and sum(jl.credit) = e.total
                  and count(*) filter (
                    where jl.debit = e.total and jl.credit = 0
                      and (
                        jl.account_id = e.account_id
                        or (
                          e.account_id is null
                          and exists (
                            select 1 from public.accounts debit_account
                             where debit_account.id = jl.account_id
                               and debit_account.org_id = p_org
                               and debit_account.code = case e.kind
                                 when 'capex' then '1500'
                                 when 'drawing' then '3100'
                                 else '5000'
                               end
                          )
                        )
                      )
                  ) = 1
                  and count(*) filter (
                    where jl.debit = 0 and jl.credit = e.total
                      and exists (
                        select 1 from public.accounts credit_account
                         where credit_account.id = jl.account_id
                           and credit_account.org_id = p_org
                           and credit_account.code = '1000'
                      )
                  ) = 1
             )
           )
         )
       )
  ) then
    raise exception 'payment request detail snapshot: line reference corruption'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.payment_request_fundings f
     where f.payment_request_id = p_request
       and (
         f.org_id is distinct from p_org
         or not exists (
           select 1 from public.custody_accounts ca
            where ca.id = f.custody_account_id and ca.org_id = p_org
         )
         or f.custody_movement_id is null
         or f.journal_entry_id is null
         or not exists (
           select 1
             from public.custody_movements cm
            where cm.id = f.custody_movement_id
              and cm.org_id = p_org
              and cm.custody_account_id = f.custody_account_id
              and cm.payment_request_id = p_request
              and cm.expense_id is null
              and cm.occurred_at = f.occurred_at
              and cm.amount_in = f.amount
              and cm.amount_out = 0
              and cm.journal_entry_id = f.journal_entry_id
              and cm.reversal_of is null
              and cm.reversed_by is null
         )
         or not exists (
           select 1
             from public.journal_entries je
            where je.id = f.journal_entry_id
              and je.org_id = p_org
              and je.source_type = 'payment_request_funding'
              and je.source_id = f.id
              and je.status = 'posted'
              and je.reversal_of is null
              and je.entry_date = f.occurred_at
         )
         or not exists (
           select 1
             from public.journal_lines jl
            where jl.journal_entry_id = f.journal_entry_id
            group by jl.journal_entry_id
           having count(*) = 2
              and count(*) filter (
                where jl.org_id = p_org
                  and jl.custody_account_id = f.custody_account_id
                  and jl.custody_movement_id = f.custody_movement_id
                  and jl.expense_id is null
                  and jl.payment_request_id = p_request
              ) = 2
              and sum(jl.debit) = f.amount
              and sum(jl.credit) = f.amount
              and count(*) filter (
                where jl.debit = f.amount and jl.credit = 0
                  and exists (
                    select 1 from public.accounts debit_account
                     where debit_account.id = jl.account_id
                       and debit_account.org_id = p_org
                       and debit_account.code = '1000'
                  )
              ) = 1
              and count(*) filter (
                where jl.debit = 0 and jl.credit = f.amount
                  and exists (
                    select 1 from public.accounts credit_account
                     where credit_account.id = jl.account_id
                       and credit_account.org_id = p_org
                       and credit_account.code = '3000'
                  )
              ) = 1
         )
       )
  ) then
    raise exception 'payment request detail snapshot: funding reference corruption'
      using errcode = '23514';
  end if;

  v_totals := public.fn_payment_request_totals(p_request);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', l.id,
    'expense_id', e.id,
    'paid_at', case when l.paid_at is null then null else l.paid_at::text end,
    'paid_by', l.paid_by,
    'paid_from_custody_account_id', l.paid_from_custody_account_id,
    'custody_movement_id', l.custody_movement_id,
    'journal_entry_id', l.journal_entry_id,
    'expense', jsonb_build_object(
      'id', e.id,
      'date', case when e.date is null then null else e.date::text end,
      'description', e.description,
      'category', e.category,
      'total', case when e.total is null then null else e.total::text end,
      'payment_status', e.payment_status,
      'kind', e.kind,
      'account_id', e.account_id
    )
  ) order by l.created_at, l.id), '[]'::jsonb)
    into v_lines
    from public.payment_request_lines l
    join public.expenses e on e.id = l.expense_id and e.org_id = p_org
   where l.payment_request_id = p_request and l.org_id = p_org;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', f.id,
    'occurred_at', f.occurred_at::text,
    'amount', f.amount::text,
    'custody_account_id', f.custody_account_id,
    'note', f.note
  ) order by f.occurred_at desc, f.created_at desc, f.id desc), '[]'::jsonb)
    into v_fundings
    from public.payment_request_fundings f
   where f.payment_request_id = p_request and f.org_id = p_org;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ca.id, 'holder_label', ca.holder_label, 'active', ca.active
  ) order by ca.active desc, ca.holder_label, ca.id), '[]'::jsonb)
    into v_custody_accounts
    from public.custody_accounts ca
   where ca.org_id = p_org;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'code', a.code,
    'name_ar', a.name_ar,
    'account_type', a.account_type,
    'kind', a.kind,
    'parent_id', a.parent_id,
    'active', a.active
  ) order by a.code, a.id), '[]'::jsonb)
    into v_accounts
    from public.accounts a
   where a.org_id = p_org;

  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', actor.user_id, 'name', actor.name
  ) order by actor.name, actor.user_id), '[]'::jsonb)
    into v_actors
    from (
      select distinct on (p.user_id) p.user_id, p.name
        from public.people p
       where p.org_id = p_org and p.user_id = any(coalesce(v_actor_ids, '{}'::uuid[]))
       order by p.user_id, p.id
    ) actor;

  if v_request->>'status' = 'draft' then
    if exists (
      select 1
        from public.expenses e
        join public.payment_request_lines l on l.expense_id = e.id
        left join public.payment_requests r on r.id = l.payment_request_id
       where e.org_id = p_org
         and (l.org_id is distinct from p_org or r.id is null or r.org_id is distinct from p_org)
    ) then
      raise exception 'payment request detail snapshot: available expense link corruption'
        using errcode = '23514';
    end if;

    select count(*) filter (where e.account_id is not null),
           count(*) filter (where e.account_id is null)
      into v_available_count, v_unclassified_count
      from public.expenses e
     where e.org_id = p_org
       and e.payment_status in ('post_paid_unpaid', 'paid_from_custody')
       and not exists (select 1 from public.payment_request_lines l where l.expense_id = e.id);

    select coalesce(jsonb_agg(row.payload order by row.date desc nulls last, row.id desc), '[]'::jsonb)
      into v_available
      from (
        select e.id, e.date, jsonb_build_object(
          'id', e.id,
          'date', case when e.date is null then null else e.date::text end,
          'description', e.description,
          'category', e.category,
          'total', case when e.total is null then null else e.total::text end,
          'payment_status', e.payment_status,
          'kind', e.kind,
          'account_id', e.account_id
        ) payload
          from public.expenses e
         where e.org_id = p_org
           and e.account_id is not null
           and e.payment_status in ('post_paid_unpaid', 'paid_from_custody')
           and not exists (select 1 from public.payment_request_lines l where l.expense_id = e.id)
         order by e.date desc nulls last, e.id desc
         limit p_available_limit
      ) row;
  end if;

  return jsonb_build_object(
    'version', c_version,
    'org_id', p_org,
    'request_id', p_request,
    'request', v_request,
    'totals', v_totals,
    'organization_name', (select o.name from public.organization o where o.id = p_org),
    'lines', v_lines,
    'fundings', v_fundings,
    'custody_accounts', v_custody_accounts,
    'accounts', v_accounts,
    'actors', v_actors,
    'available_expenses', v_available,
    'available_expense_count', v_available_count::text,
    'unclassified_available_count', v_unclassified_count::text,
    'available_expenses_truncated', v_available_count > jsonb_array_length(v_available)
  );
end;
$$;

revoke execute on function public.fn_payment_request_detail_snapshot(uuid,uuid,integer)
  from public, anon, authenticated;
grant execute on function public.fn_payment_request_detail_snapshot(uuid,uuid,integer)
  to authenticated;

commit;
