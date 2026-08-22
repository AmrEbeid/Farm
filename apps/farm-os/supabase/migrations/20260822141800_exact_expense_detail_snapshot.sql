-- One exact, atomic core snapshot for the expense 360 page.
begin;

create or replace function public.fn_expense_detail_snapshot(p_org uuid, p_expense uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_can_finance boolean;
  v_kind text;
  v_expense jsonb;
  v_event jsonb;
  v_account jsonb;
  v_movements jsonb := '[]'::jsonb;
  v_request_linked boolean := false;
begin
  if p_org is null or p_expense is null then
    raise exception 'org and expense required' using errcode = '23502';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org expense detail snapshot' using errcode = '42501';
  end if;

  select m.role into v_role
    from public.organization_member m
   where m.user_id = (select auth.uid()) and m.org_id = p_org
   limit 1;
  if v_role is null or v_role not in ('owner','accountant','farm_manager') then
    raise exception 'forbidden: expense detail requires owner/accountant/farm_manager'
      using errcode = '42501';
  end if;
  v_can_finance := public.authorize('finance.read', p_org);

  select e.kind into v_kind
    from public.expenses e
   where e.id = p_expense and e.org_id = p_org;
  if v_kind is null or (v_kind = 'drawing' and not v_can_finance) then
    return jsonb_build_object(
      'version', 'farm-os.expense-detail.v1',
      'org_id', p_org,
      'expense_id', p_expense,
      'expense', null,
      'event', null,
      'account', null,
      'movements', '[]'::jsonb,
      'request_linked', false
    );
  end if;

  if exists (
    select 1 from public.expenses e
     where e.id = p_expense and e.org_id = p_org
       and (
         (e.supplier_id is not null and not exists (select 1 from public.suppliers x where x.id = e.supplier_id and x.org_id = p_org)) or
         (e.plan_id is not null and not exists (select 1 from public.plans x where x.id = e.plan_id and x.org_id = p_org)) or
         (e.event_id is not null and not exists (select 1 from public.farm_event x where x.id = e.event_id and x.org_id = p_org)) or
         (e.farm_id is not null and not exists (select 1 from public.farms x where x.id = e.farm_id and x.org_id = p_org)) or
         (e.sector_id is not null and not exists (select 1 from public.sectors x where x.id = e.sector_id and x.org_id = p_org)) or
         (e.hawsha_id is not null and not exists (select 1 from public.hawshat x where x.id = e.hawsha_id and x.org_id = p_org)) or
         (e.account_id is not null and not exists (select 1 from public.accounts x where x.id = e.account_id and x.org_id = p_org)) or
         (e.cost_center_id is not null and not exists (select 1 from public.cost_centers x where x.id = e.cost_center_id and x.org_id = p_org))
       )
  ) then
    raise exception 'expense detail snapshot: cross-organization reference corruption'
      using errcode = '23514';
  end if;

  select jsonb_build_object(
    'id', e.id,
    'date', case when e.date is null then null else e.date::text end,
    'category', e.category,
    'description', e.description,
    'total', case when e.total is null then null else e.total::text end,
    'qty', case when e.qty is null then null else e.qty::text end,
    'unit', e.unit,
    'unit_price', case when e.unit_price is null then null else e.unit_price::text end,
    'payment_method', e.payment_method,
    'status', e.status,
    'payment_status', e.payment_status,
    'kind', e.kind,
    'account_id', e.account_id,
    'cost_center_id', e.cost_center_id,
    'supplier_id', e.supplier_id,
    'plan_id', e.plan_id,
    'event_id', e.event_id,
    'farm_id', e.farm_id,
    'sector_id', e.sector_id,
    'hawsha_id', e.hawsha_id,
    'supplier', case when s.id is null then null else jsonb_build_object('id', s.id, 'name', s.name) end,
    'plan', case when p.id is null then null else jsonb_build_object(
      'id', p.id, 'type', p.type,
      'period_start', case when p.period_start is null then null else p.period_start::text end,
      'period_end', case when p.period_end is null then null else p.period_end::text end) end,
    'farm', case when f.id is null then null else jsonb_build_object('id', f.id, 'name', f.name) end,
    'sector', case when sec.id is null then null else jsonb_build_object('id', sec.id, 'name', sec.name) end,
    'hawsha', case when h.id is null then null else jsonb_build_object('id', h.id, 'name', h.name) end
  ) into v_expense
    from public.expenses e
    left join public.suppliers s on s.id = e.supplier_id and s.org_id = p_org
    left join public.plans p on p.id = e.plan_id and p.org_id = p_org
    left join public.farms f on f.id = e.farm_id and f.org_id = p_org
    left join public.sectors sec on sec.id = e.sector_id and sec.org_id = p_org
    left join public.hawshat h on h.id = e.hawsha_id and h.org_id = p_org
   where e.id = p_expense and e.org_id = p_org;

  select jsonb_build_object(
    'id', ev.id, 'subtype', ev.subtype, 'status', ev.status,
    'occurred_at', case when ev.occurred_at is null then null else ev.occurred_at::text end,
    'notes', ev.notes
  ) into v_event
    from public.farm_event ev
   where ev.id = (v_expense->>'event_id')::uuid and ev.org_id = p_org;

  if v_can_finance then
    select jsonb_build_object('id', a.id, 'code', a.code, 'name_ar', a.name_ar)
      into v_account
      from public.accounts a
     where a.id = (v_expense->>'account_id')::uuid and a.org_id = p_org;

    if exists (
      select 1 from public.custody_movements cm
       where cm.expense_id = p_expense
         and (
           cm.org_id <> p_org or
           not exists (
           select 1 from public.custody_accounts ca
            where ca.id = cm.custody_account_id and ca.org_id = p_org
           )
         )
    ) then
      raise exception 'expense detail snapshot: custody movement reference corruption'
        using errcode = '23514';
    end if;

    if exists (
      select 1 from public.payment_request_lines l
       where l.expense_id = p_expense and l.org_id <> p_org
    ) then
      raise exception 'expense detail snapshot: payment request reference corruption'
        using errcode = '23514';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'id', cm.id,
      'occurred_at', cm.occurred_at::text,
      'created_at', cm.created_at::text,
      'movement_type', cm.movement_type,
      'amount_in', cm.amount_in::text,
      'amount_out', cm.amount_out::text,
      'custody_account_id', cm.custody_account_id,
      'custody_account_label', ca.holder_label,
      'payment_request_id', cm.payment_request_id,
      'reversal_of', cm.reversal_of,
      'reversed_by', cm.reversed_by,
      'reversal_reason', cm.reversal_reason,
      'expense_reversal_outcome', cm.expense_reversal_outcome
    ) order by cm.created_at, cm.id), '[]'::jsonb)
      into v_movements
      from public.custody_movements cm
      join public.custody_accounts ca
        on ca.id = cm.custody_account_id and ca.org_id = p_org
     where cm.expense_id = p_expense and cm.org_id = p_org;

    select exists (
      select 1 from public.payment_request_lines l
       where l.expense_id = p_expense and l.org_id = p_org
    ) into v_request_linked;
  end if;

  return jsonb_build_object(
    'version', 'farm-os.expense-detail.v1',
    'org_id', p_org,
    'expense_id', p_expense,
    'expense', v_expense,
    'event', v_event,
    'account', v_account,
    'movements', v_movements,
    'request_linked', v_request_linked
  );
end;
$$;

revoke execute on function public.fn_expense_detail_snapshot(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.fn_expense_detail_snapshot(uuid,uuid)
  to authenticated;

commit;
