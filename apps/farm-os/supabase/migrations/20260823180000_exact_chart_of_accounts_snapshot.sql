-- SPEC-0033 R4i: one exact, active-organization Chart of Accounts snapshot.
-- Balances include posted journal entries only and leave PostgreSQL as decimal text.
-- Existing save/archive/merge RPCs and every posting path remain unchanged.

begin;

create or replace function public.fn_chart_of_accounts_snapshot(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_org is null then
    raise exception 'organization is required' using errcode = '23502';
  end if;
  if p_org not in (select public.user_org_ids())
     or not public.authorize('finance.read', p_org) then
    raise exception 'forbidden: finance.read is required for the active organization'
      using errcode = '42501';
  end if;

  if exists (
    select 1
      from public.accounts a
      left join public.accounts parent
        on parent.id = a.parent_id and parent.org_id = p_org
     where a.org_id = p_org
       and a.parent_id is not null
       and parent.id is null
  ) then
    raise exception 'chart of accounts organization relationship mismatch' using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.accounts child
      join public.accounts parent
        on parent.id = child.parent_id and parent.org_id = p_org
     where child.org_id = p_org
       and (child.account_type is distinct from parent.account_type
         or child.kind is distinct from parent.kind)
  ) then
    raise exception 'chart of accounts parent classification mismatch' using errcode = '23514';
  end if;

  if exists (
    with recursive account_walk as (
      select a.id, a.parent_id, array[a.id] as path, false as cycle, 1 as depth
        from public.accounts a
       where a.org_id = p_org
      union all
      select parent.id, parent.parent_id, walk.path || parent.id,
             parent.id = any(walk.path), walk.depth + 1
        from account_walk walk
        join public.accounts parent
          on parent.id = walk.parent_id and parent.org_id = p_org
       where not walk.cycle and walk.depth <= 5
    )
    select 1 from account_walk where cycle or depth > 4
  ) then
    raise exception 'chart of accounts hierarchy is cyclic or deeper than four levels'
      using errcode = '23514';
  end if;

  if exists (
    with candidate_lines as (
      select line.id
        from public.journal_lines line
       where line.org_id = p_org
      union
      select line.id
        from public.journal_entries entry
        join public.journal_lines line on line.journal_entry_id = entry.id
       where entry.org_id = p_org
      union
      select line.id
        from public.accounts account
        join public.journal_lines line on line.account_id = account.id
       where account.org_id = p_org
    )
    select 1
      from candidate_lines candidate
      join public.journal_lines line on line.id = candidate.id
      join public.journal_entries entry on entry.id = line.journal_entry_id
      join public.accounts account on account.id = line.account_id
     where line.org_id is distinct from p_org
        or entry.org_id is distinct from p_org
        or account.org_id is distinct from p_org
  ) then
    raise exception 'chart of accounts journal relationship mismatch' using errcode = '23514';
  end if;

  with recursive
  account_rows as materialized (
    select a.id, a.parent_id, a.code, a.name_ar, a.account_type, a.normal_balance,
           a.kind, a.active, a.is_system, a.sort_order
      from public.accounts a
     where a.org_id = p_org
  ),
  subtree as (
    select a.id as ancestor_id, a.id as descendant_id
      from account_rows a
    union all
    select tree.ancestor_id, child.id
      from subtree tree
      join account_rows child on child.parent_id = tree.descendant_id
  ),
  posted_direct as materialized (
    select line.account_id,
           count(*)::bigint as posting_count,
           coalesce(sum(line.debit), 0::numeric) as debit,
           coalesce(sum(line.credit), 0::numeric) as credit
      from public.journal_lines line
      join public.journal_entries entry
        on entry.id = line.journal_entry_id
       and entry.org_id = p_org
       and entry.status = 'posted'
     where line.org_id = p_org
     group by line.account_id
  ),
  rolled as materialized (
    select tree.ancestor_id,
           coalesce(sum(direct.debit), 0::numeric) as debit,
           coalesce(sum(direct.credit), 0::numeric) as credit,
           coalesce(sum(direct.posting_count), 0::bigint) as posting_count
      from subtree tree
      left join posted_direct direct on direct.account_id = tree.descendant_id
     group by tree.ancestor_id
  ),
  enriched as materialized (
    select account.*,
           (select count(*)::bigint from account_rows child where child.parent_id = account.id) as child_count,
           (select count(*)::bigint from account_rows child
             where child.parent_id = account.id and child.active) as active_child_count,
           rolled.posting_count,
           rolled.debit,
           rolled.credit,
           case account.normal_balance
             when 'credit' then rolled.credit - rolled.debit
             else rolled.debit - rolled.credit
           end as balance
      from account_rows account
      join rolled on rolled.ancestor_id = account.id
  ),
  totals as materialized (
    select
      count(*)::bigint as account_count,
      count(*) filter (where active)::bigint as active_count,
      count(*) filter (where not active)::bigint as archived_count,
      count(*) filter (
        where active and kind in ('operating', 'drawing', 'capex') and active_child_count = 0
      )::bigint as posting_leaf_count,
      coalesce(sum(balance) filter (where parent_id is null and kind = 'operating'), 0::numeric)
        as operating_balance,
      coalesce(sum(balance) filter (where parent_id is null and kind = 'drawing'), 0::numeric)
        as drawing_balance,
      coalesce(sum(balance) filter (where parent_id is null and kind = 'capex'), 0::numeric)
        as capex_balance
    from enriched
  )
  select jsonb_build_object(
    'version', 'farm-os.chart-of-accounts.v1',
    'org_id', p_org,
    'can_write', public.authorize('budget.write', p_org),
    'totals', jsonb_build_object(
      'account_count', totals.account_count::text,
      'active_count', totals.active_count::text,
      'archived_count', totals.archived_count::text,
      'posting_leaf_count', totals.posting_leaf_count::text,
      'operating_balance', totals.operating_balance::text,
      'drawing_balance', totals.drawing_balance::text,
      'capex_balance', totals.capex_balance::text
    ),
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', account.id,
        'parent_id', account.parent_id,
        'code', account.code,
        'name_ar', account.name_ar,
        'account_type', account.account_type,
        'normal_balance', account.normal_balance,
        'kind', account.kind,
        'active', account.active,
        'is_system', account.is_system,
        'sort_order', account.sort_order,
        'child_count', account.child_count::text,
        'active_child_count', account.active_child_count::text,
        'posting_count', account.posting_count::text,
        'debit', account.debit::text,
        'credit', account.credit::text,
        'balance', account.balance::text
      ) order by account.sort_order nulls last, account.code, account.id)
      from enriched account
    ), '[]'::jsonb)
  ) into v_result
  from totals;

  return v_result;
end;
$$;

revoke execute on function public.fn_chart_of_accounts_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.fn_chart_of_accounts_snapshot(uuid) to authenticated;

commit;
