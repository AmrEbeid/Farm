-- Farm OS — SPEC-0024 S-1: editable chart-of-accounts tree + expense account linkage.
--
-- INTENT. Extend the live cash-method accounting kernel from a flat account list into a
-- protected editable tree, seed the first farm-ready COA, and let custody/payment-request
-- settlement post to the selected expense leaf account while preserving legacy NULL-account
-- fallbacks.
--
-- SECURITY. Reuses the existing budget.write gate for account-tree edits. No authorize()
-- re-emit here. Direct account writes remain revoked; all writes go through SECURITY DEFINER
-- RPCs with pinned search_path. Expense account_id is directly writable through the existing
-- budget.write expense table path, but payment routing fields remain RPC-only.

begin;

-- ── 1) Tree columns + expense linkage ────────────────────────────────────────────────────────────────
alter table public.accounts add column if not exists parent_id uuid references public.accounts(id);
alter table public.accounts add column if not exists kind text;
alter table public.accounts add column if not exists is_system boolean not null default false;
alter table public.accounts add column if not exists sort_order int;
alter table public.accounts drop constraint if exists accounts_kind_check;
alter table public.accounts
  add constraint accounts_kind_check check (kind is null or kind in ('operating','drawing','capex'));

create index if not exists accounts_parent_idx on public.accounts(parent_id);
create index if not exists accounts_org_parent_idx on public.accounts(org_id, parent_id);
create index if not exists accounts_org_kind_idx on public.accounts(org_id, kind);

alter table public.expenses add column if not exists account_id uuid references public.accounts(id);
create index if not exists expenses_account_idx on public.expenses(account_id);

-- Re-grant direct expense entry while including account_id. Payment routing columns and kind stay RPC-only.
revoke insert, update on public.expenses from authenticated, anon;
grant insert (
  id, org_id, date, farm_id, sector_id, hawsha_id, event_id, plan_id, category, description,
  supplier_id, qty, unit, unit_price, total, payment_method, recorded_by, approved_by, status, account_id
) on public.expenses to authenticated;
grant update (
  id, org_id, date, farm_id, sector_id, hawsha_id, event_id, plan_id, category, description,
  supplier_id, qty, unit, unit_price, total, payment_method, recorded_by, approved_by, status, account_id
) on public.expenses to authenticated;

-- ── 2) Guards ───────────────────────────────────────────────────────────────────────────────────────
create or replace function public.expense_account_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_org uuid;
  v_account_kind text;
  v_account_active boolean;
  v_has_active_child boolean;
begin
  if new.account_id is null then
    return new;
  end if;

  select org_id, kind, active
    into v_account_org, v_account_kind, v_account_active
    from public.accounts
   where id = new.account_id;

  if v_account_org is null then
    raise exception 'account % not found', new.account_id using errcode = 'P0002';
  end if;
  if v_account_org is distinct from new.org_id then
    raise exception 'forbidden: cross-org expense account' using errcode = '42501';
  end if;
  if not coalesce(v_account_active, false) then
    raise exception 'expense account is inactive' using errcode = '22023';
  end if;
  if v_account_kind is distinct from coalesce(new.kind, 'operating') then
    raise exception 'expense account kind (%) does not match expense kind (%)',
      coalesce(v_account_kind, 'NULL'), coalesce(new.kind, 'operating') using errcode = '22023';
  end if;

  select exists (
      select 1
        from public.accounts child
       where child.parent_id = new.account_id
         and child.org_id = new.org_id
         and child.active)
    into v_has_active_child;
  if v_has_active_child then
    raise exception 'expense account must be an active leaf account' using errcode = '22023';
  end if;

  return new;
end;
$$;
revoke execute on function public.expense_account_guard() from public, anon, authenticated;

drop trigger if exists expense_account_guard on public.expenses;
create trigger expense_account_guard
  before insert or update of account_id, kind, org_id on public.expenses
  for each row execute function public.expense_account_guard();

-- Re-emit the routed-money immutability guard so account_id can be added before request/cash posting,
-- but not changed after accounting/custody/request references exist.
create or replace function public.expense_guard_routed_money_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_has_request_line boolean := false;
  v_has_cash_movement boolean := false;
  v_has_journal_line boolean := false;
  v_money_changed boolean;
  v_account_changed boolean;
  v_merge_source uuid;
  v_merge_target uuid;
begin
  v_money_changed := old.total is distinct from new.total or old.kind is distinct from new.kind;
  v_account_changed := old.account_id is distinct from new.account_id;
  if not v_money_changed and not v_account_changed then
    return new;
  end if;

  if to_regclass('public.payment_request_lines') is not null then
    execute 'select exists (select 1 from public.payment_request_lines l where l.expense_id = $1)'
      into v_has_request_line
      using old.id;
  end if;

  v_has_cash_movement := exists (
    select 1 from public.custody_movements m where m.expense_id = old.id and m.amount_out > 0);

  if to_regclass('public.journal_lines') is not null then
    execute 'select exists (select 1 from public.journal_lines l where l.expense_id = $1)'
      into v_has_journal_line
      using old.id;
  end if;

  if v_money_changed and (
       coalesce(old.payment_status, '') in ('paid_from_custody','post_paid_unpaid')
    or v_has_cash_movement
    or v_has_request_line
    or v_has_journal_line) then
    raise exception 'routed expense amount/kind is immutable; post a reversal or create a new expense'
      using errcode = '22023';
  end if;

  if v_account_changed and (v_has_cash_movement or v_has_request_line or v_has_journal_line) then
    begin
      v_merge_source := nullif(current_setting('app.account_merge_source', true), '')::uuid;
      v_merge_target := nullif(current_setting('app.account_merge_target', true), '')::uuid;
    exception when invalid_text_representation then
      v_merge_source := null;
      v_merge_target := null;
    end;
    if v_merge_source is not distinct from old.account_id
       and v_merge_target is not distinct from new.account_id then
      return new;
    end if;
    raise exception 'routed expense account is immutable after request/cash/accounting posting'
      using errcode = '22023';
  end if;

  return new;
end;
$$;
revoke execute on function public.expense_guard_routed_money_immutable() from public, anon, authenticated;

drop trigger if exists expense_guard_routed_money_immutable on public.expenses;
create trigger expense_guard_routed_money_immutable
  before update of total, kind, account_id on public.expenses
  for each row execute function public.expense_guard_routed_money_immutable();

-- ── 3) Internal accounting helpers ──────────────────────────────────────────────────────────────────
create or replace function public.fn_ensure_account(
  p_org uuid,
  p_code text,
  p_name_ar text,
  p_account_type text,
  p_normal_balance text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_kind text;
  v_is_system boolean;
  v_sort_order int;
begin
  if p_org is null then raise exception 'org required' using errcode = '23502'; end if;
  if p_code is null or trim(p_code) = '' then raise exception 'account code required' using errcode = '23502'; end if;
  if p_account_type not in ('asset','liability','equity','revenue','expense') then
    raise exception 'invalid account_type: %', p_account_type using errcode = '22023';
  end if;
  if p_normal_balance not in ('debit','credit') then
    raise exception 'invalid normal_balance: %', p_normal_balance using errcode = '22023';
  end if;

  v_kind := case trim(p_code)
    when '1500' then 'capex'
    when '3100' then 'drawing'
    when '5000' then 'operating'
    else null
  end;
  v_is_system := trim(p_code) in ('1000','1500','3000','3100','5000');
  v_sort_order := case trim(p_code)
    when '1000' then 10
    when '1500' then 20
    when '3000' then 30
    when '3100' then 40
    when '5000' then 50
    else null
  end;

  insert into public.accounts(org_id, code, name_ar, account_type, normal_balance, kind, is_system, sort_order)
  values (p_org, trim(p_code), trim(p_name_ar), p_account_type, p_normal_balance, v_kind, v_is_system, v_sort_order)
  on conflict (org_id, code) do update
     set name_ar = excluded.name_ar,
         account_type = excluded.account_type,
         normal_balance = excluded.normal_balance,
         kind = coalesce(public.accounts.kind, excluded.kind),
         is_system = public.accounts.is_system or excluded.is_system,
         sort_order = coalesce(public.accounts.sort_order, excluded.sort_order),
         active = true
  returning id into v_id;

  return v_id;
end;
$$;
revoke execute on function public.fn_ensure_account(uuid, text, text, text, text) from public, anon, authenticated;

create or replace function public.fn_account_for_expense_kind(p_org uuid, p_kind text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if coalesce(p_kind, 'operating') = 'capex' then
    return public.fn_ensure_account(p_org, '1500', 'أصول ومشروعات رأسمالية', 'asset', 'debit');
  elsif coalesce(p_kind, 'operating') = 'drawing' then
    return public.fn_ensure_account(p_org, '3100', 'مسحوبات المالك', 'equity', 'debit');
  elsif coalesce(p_kind, 'operating') = 'operating' then
    return public.fn_ensure_account(p_org, '5000', 'مصروفات تشغيلية', 'expense', 'debit');
  end if;
  raise exception 'invalid expense kind: %', p_kind using errcode = '22023';
end;
$$;
revoke execute on function public.fn_account_for_expense_kind(uuid, text) from public, anon, authenticated;

create or replace function public.fn_expense_posting_account(p_org uuid, p_expense uuid, p_kind text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_account uuid;
  v_account_org uuid;
  v_account_kind text;
  v_account_active boolean;
  v_has_active_child boolean;
begin
  select account_id into v_account
    from public.expenses
   where id = p_expense and org_id = p_org;

  if v_account is null then
    return public.fn_account_for_expense_kind(p_org, p_kind);
  end if;

  select org_id, kind, active
    into v_account_org, v_account_kind, v_account_active
    from public.accounts
   where id = v_account;

  if v_account_org is distinct from p_org then
    raise exception 'forbidden: cross-org expense account' using errcode = '42501';
  end if;
  if not coalesce(v_account_active, false) then
    raise exception 'expense account is inactive' using errcode = '22023';
  end if;
  if v_account_kind is distinct from coalesce(p_kind, 'operating') then
    raise exception 'expense account kind (%) does not match expense kind (%)',
      coalesce(v_account_kind, 'NULL'), coalesce(p_kind, 'operating') using errcode = '22023';
  end if;

  select exists (
      select 1
        from public.accounts child
       where child.parent_id = v_account
         and child.org_id = p_org
         and child.active)
    into v_has_active_child;
  if v_has_active_child then
    raise exception 'expense account must be an active leaf account' using errcode = '22023';
  end if;

  return v_account;
end;
$$;
revoke execute on function public.fn_expense_posting_account(uuid, uuid, text) from public, anon, authenticated;

-- ── 4) Account edit RPCs ──────────────────────────────────────────────────────────────────────────────
create or replace function public.fn_save_account(
  p_id uuid,
  p_org uuid,
  p_parent_id uuid,
  p_code text,
  p_name_ar text,
  p_account_type text,
  p_normal_balance text,
  p_kind text default null,
  p_sort_order int default null,
  p_active boolean default true)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_existing record;
  v_org uuid;
  v_parent record;
  v_depth int;
  v_cycle boolean;
  v_subtree_height int;
  v_effective_kind text;
  v_id uuid;
  v_conflict uuid;
  v_candidate_org uuid;
  v_visible_org_count int;
begin
  if p_code is null or trim(p_code) = '' then raise exception 'account code required' using errcode = '23502'; end if;
  if p_name_ar is null or trim(p_name_ar) = '' then raise exception 'account name required' using errcode = '23502'; end if;
  if p_account_type not in ('asset','liability','equity','revenue','expense') then
    raise exception 'invalid account_type: %', p_account_type using errcode = '22023';
  end if;
  if p_normal_balance not in ('debit','credit') then
    raise exception 'invalid normal_balance: %', p_normal_balance using errcode = '22023';
  end if;
  if p_kind is not null and p_kind not in ('operating','drawing','capex') then
    raise exception 'invalid account kind: %', p_kind using errcode = '22023';
  end if;

  if p_id is not null then
    select * into v_existing from public.accounts where id = p_id for update;
    if v_existing.id is null then raise exception 'account % not found', p_id using errcode = 'P0002'; end if;
    v_org := v_existing.org_id;
    if p_org is not null and p_org is distinct from v_org then
      raise exception 'forbidden: account org cannot change' using errcode = '42501';
    end if;
  else
    v_org := p_org;
    if v_org is null and p_parent_id is not null then
      select org_id into v_org
        from public.accounts
       where id = p_parent_id;
    end if;
    if v_org is null then
      v_visible_org_count := 0;
      for v_candidate_org in
        select org_id from public.user_org_ids() as visible_orgs(org_id)
      loop
        v_org := v_candidate_org;
        v_visible_org_count := v_visible_org_count + 1;
      end loop;
      if coalesce(v_visible_org_count, 0) <> 1 then
        v_org := null;
      end if;
    end if;
  end if;

  if v_org is null then raise exception 'org required' using errcode = '23502'; end if;
  if v_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org account' using errcode = '42501';
  end if;
  if not public.authorize('budget.write', v_org) then
    raise exception 'forbidden: budget.write is required' using errcode = '42501';
  end if;

  if p_parent_id is not null then
    select * into v_parent
      from public.accounts
     where id = p_parent_id and org_id = v_org;
    if v_parent.id is null then
      raise exception 'parent account % not found in org', p_parent_id using errcode = 'P0002';
    end if;
    if not coalesce(v_parent.active, false) then
      raise exception 'parent account is inactive' using errcode = '22023';
    end if;
    if v_parent.account_type is distinct from p_account_type then
      raise exception 'child account_type (%) must match parent account_type (%)',
        p_account_type, v_parent.account_type using errcode = '22023';
    end if;
    v_effective_kind := coalesce(p_kind, v_parent.kind);

    with recursive chain as (
      select id, parent_id, 1 as depth
        from public.accounts
       where id = p_parent_id
      union all
      select a.id, a.parent_id, c.depth + 1
        from public.accounts a
        join chain c on a.id = c.parent_id
       where c.depth < 16
    )
    select coalesce(max(depth), 0), coalesce(bool_or(id = p_id), false)
      into v_depth, v_cycle
      from chain;

    if coalesce(v_cycle, false) then
      raise exception 'account tree cycle detected' using errcode = '22023';
    end if;
    if p_id is null then
      v_subtree_height := 1;
    else
      with recursive subtree as (
        select id, 1 as depth
          from public.accounts
         where id = p_id and org_id = v_org
        union all
        select child.id, subtree.depth + 1
          from public.accounts child
          join subtree on child.parent_id = subtree.id
         where child.org_id = v_org
           and subtree.depth < 16
      )
      select coalesce(max(depth), 1)
        into v_subtree_height
        from subtree;
    end if;
    if coalesce(v_depth, 0) + coalesce(v_subtree_height, 1) > 4 then
      raise exception 'account tree depth cannot exceed 4 levels' using errcode = '22023';
    end if;
  else
    v_effective_kind := p_kind;
  end if;

  if p_id is not null then
    if coalesce(v_existing.is_system, false) then
      if p_parent_id is distinct from v_existing.parent_id then
        raise exception 'system account cannot be re-parented' using errcode = '22023';
      end if;
      if coalesce(p_active, true) is false then
        raise exception 'system account cannot be archived' using errcode = '22023';
      end if;
      if trim(p_code) is distinct from v_existing.code
         or p_account_type is distinct from v_existing.account_type
         or p_normal_balance is distinct from v_existing.normal_balance
         or v_effective_kind is distinct from v_existing.kind then
        raise exception 'system account code/type/kind cannot be changed' using errcode = '22023';
      end if;
    end if;
  end if;

  select id into v_conflict
    from public.accounts
   where org_id = v_org and code = trim(p_code) and (p_id is null or id <> p_id);
  if v_conflict is not null then
    raise exception 'account code already exists in this org: %', trim(p_code) using errcode = '23505';
  end if;

  if p_id is null then
    insert into public.accounts(
      org_id, parent_id, code, name_ar, account_type, normal_balance, kind, sort_order, active)
    values (
      v_org, p_parent_id, trim(p_code), trim(p_name_ar), p_account_type, p_normal_balance,
      v_effective_kind, p_sort_order, coalesce(p_active, true))
    returning id into v_id;
  else
    update public.accounts
       set parent_id = p_parent_id,
           code = trim(p_code),
           name_ar = trim(p_name_ar),
           account_type = p_account_type,
           normal_balance = p_normal_balance,
           kind = v_effective_kind,
           sort_order = p_sort_order,
           active = coalesce(p_active, true)
     where id = p_id
     returning id into v_id;
  end if;

  return jsonb_build_object('id', v_id);
end;
$$;
revoke execute on function public.fn_save_account(uuid, uuid, uuid, text, text, text, text, text, int, boolean) from public, anon, authenticated;
grant execute on function public.fn_save_account(uuid, uuid, uuid, text, text, text, text, text, int, boolean) to authenticated;

create or replace function public.fn_archive_account(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_has_system boolean;
  v_count int;
begin
  select org_id into v_org from public.accounts where id = p_id;
  if v_org is null then raise exception 'account % not found', p_id using errcode = 'P0002'; end if;
  if v_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org account' using errcode = '42501';
  end if;
  if not public.authorize('budget.write', v_org) then
    raise exception 'forbidden: budget.write is required' using errcode = '42501';
  end if;

  with recursive subtree as (
    select id, is_system from public.accounts where id = p_id and org_id = v_org
    union all
    select a.id, a.is_system
      from public.accounts a
      join subtree s on a.parent_id = s.id
     where a.org_id = v_org
  )
  select coalesce(bool_or(is_system), false), count(*)::int
    into v_has_system, v_count
    from subtree;

  if v_has_system then
    raise exception 'system account cannot be archived' using errcode = '22023';
  end if;

  with recursive subtree as (
    select id from public.accounts where id = p_id and org_id = v_org
    union all
    select a.id
      from public.accounts a
      join subtree s on a.parent_id = s.id
     where a.org_id = v_org
  )
  update public.accounts
     set active = false
   where id in (select id from subtree);

  return jsonb_build_object('id', p_id, 'archived_count', coalesce(v_count, 0));
end;
$$;
revoke execute on function public.fn_archive_account(uuid) from public, anon, authenticated;
grant execute on function public.fn_archive_account(uuid) to authenticated;

create or replace function public.fn_merge_accounts(p_source uuid, p_target uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_source record;
  v_target record;
  v_refs_expenses int := 0;
  v_refs_lines int := 0;
begin
  if p_source is null or p_target is null or p_source = p_target then
    raise exception 'source and target accounts must be different' using errcode = '22023';
  end if;

  select * into v_source from public.accounts where id = p_source for update;
  select * into v_target from public.accounts where id = p_target for update;
  if v_source.id is null then raise exception 'source account % not found', p_source using errcode = 'P0002'; end if;
  if v_target.id is null then raise exception 'target account % not found', p_target using errcode = 'P0002'; end if;
  if v_source.org_id is distinct from v_target.org_id then
    raise exception 'cannot merge accounts across orgs' using errcode = '42501';
  end if;
  if v_source.org_id not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org account' using errcode = '42501';
  end if;
  if not public.authorize('budget.write', v_source.org_id) then
    raise exception 'forbidden: budget.write is required' using errcode = '42501';
  end if;
  if coalesce(v_source.is_system, false) then
    raise exception 'system account cannot be merged away' using errcode = '22023';
  end if;
  if not coalesce(v_target.active, false) then
    raise exception 'target account is inactive' using errcode = '22023';
  end if;
  if v_source.account_type is distinct from v_target.account_type
     or v_source.kind is distinct from v_target.kind then
    raise exception 'source and target account type/kind must match' using errcode = '22023';
  end if;
  if exists (select 1 from public.accounts where parent_id = p_source and active) then
    raise exception 'source account must be a leaf to merge' using errcode = '22023';
  end if;
  if exists (select 1 from public.accounts where parent_id = p_target and active) then
    raise exception 'target account must be a leaf to merge' using errcode = '22023';
  end if;

  perform set_config('app.account_merge_source', p_source::text, true);
  perform set_config('app.account_merge_target', p_target::text, true);
  update public.journal_lines
     set account_id = p_target
   where account_id = p_source;
  get diagnostics v_refs_lines = row_count;

  update public.expenses
     set account_id = p_target
   where account_id = p_source;
  get diagnostics v_refs_expenses = row_count;
  perform set_config('app.account_merge_source', '', true);
  perform set_config('app.account_merge_target', '', true);

  update public.accounts
     set active = false
   where id = p_source;

  return jsonb_build_object(
    'source_id', p_source,
    'target_id', p_target,
    'expenses_repointed', v_refs_expenses,
    'journal_lines_repointed', v_refs_lines);
end;
$$;
revoke execute on function public.fn_merge_accounts(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_merge_accounts(uuid, uuid) to authenticated;

-- ── 5) Seed/reconcile first COA for every existing org ────────────────────────────────────────────────
create or replace function public.fn_seed_default_accounts(p_org uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_1000 uuid;
  v_1500 uuid;
  v_3000 uuid;
  v_3100 uuid;
  v_4000 uuid;
  v_5000 uuid;
  v_5100 uuid;
  v_5200 uuid;
  v_5300 uuid;
  v_5400 uuid;
begin
  v_org := p_org;
  if v_org is null then
    raise exception 'org required' using errcode = '23502';
  end if;

    v_1000 := public.fn_ensure_account(v_org, '1000', 'عهدة نقدية', 'asset', 'debit');
    update public.accounts set parent_id = null, kind = null, is_system = true, sort_order = 10 where id = v_1000;

    v_1500 := public.fn_ensure_account(v_org, '1500', 'أصول ومشروعات رأسمالية', 'asset', 'debit');
    update public.accounts set parent_id = null, kind = 'capex', is_system = true, sort_order = 20 where id = v_1500;

    v_3000 := public.fn_ensure_account(v_org, '3000', 'تمويل المالك', 'equity', 'credit');
    update public.accounts set parent_id = null, kind = null, is_system = true, sort_order = 30 where id = v_3000;

    v_3100 := public.fn_ensure_account(v_org, '3100', 'مسحوبات المالك', 'equity', 'debit');
    update public.accounts set parent_id = null, kind = 'drawing', is_system = true, sort_order = 40 where id = v_3100;

    v_5000 := public.fn_ensure_account(v_org, '5000', 'مصروفات تشغيلية', 'expense', 'debit');
    update public.accounts set parent_id = null, kind = 'operating', is_system = true, sort_order = 50 where id = v_5000;

    insert into public.accounts(org_id, code, name_ar, account_type, normal_balance, parent_id, kind, sort_order)
    values (v_org, '4000', 'إيرادات', 'revenue', 'credit', null, null, 45)
    on conflict (org_id, code) do update
       set name_ar = excluded.name_ar,
           account_type = excluded.account_type,
           normal_balance = excluded.normal_balance,
           parent_id = excluded.parent_id,
           kind = excluded.kind,
           sort_order = coalesce(public.accounts.sort_order, excluded.sort_order),
           active = true
    returning id into v_4000;

    insert into public.accounts(org_id, code, name_ar, account_type, normal_balance, parent_id, kind, sort_order)
    values
      (v_org, '1510', 'مباني ومنشآت', 'asset', 'debit', v_1500, 'capex', 10),
      (v_org, '1520', 'إنشاء بساتين', 'asset', 'debit', v_1500, 'capex', 20),
      (v_org, '4010', 'تمور برحي', 'revenue', 'credit', v_4000, null, 10),
      (v_org, '4020', 'فسائل', 'revenue', 'credit', v_4000, null, 20),
      (v_org, '4030', 'موالح وفاكهة', 'revenue', 'credit', v_4000, null, 30),
      (v_org, '4040', 'بنجر', 'revenue', 'credit', v_4000, null, 40),
      (v_org, '4050', 'محاصيل حقلية', 'revenue', 'credit', v_4000, null, 50),
      (v_org, '4090', 'إيرادات أخرى', 'revenue', 'credit', v_4000, null, 90)
    on conflict (org_id, code) do update
       set name_ar = excluded.name_ar,
           account_type = excluded.account_type,
           normal_balance = excluded.normal_balance,
           parent_id = excluded.parent_id,
           kind = excluded.kind,
           sort_order = coalesce(public.accounts.sort_order, excluded.sort_order),
           active = true;

    insert into public.accounts(org_id, code, name_ar, account_type, normal_balance, parent_id, kind, sort_order)
    values (v_org, '5100', 'مستلزمات زراعية', 'expense', 'debit', v_5000, 'operating', 10)
    on conflict (org_id, code) do update
       set name_ar = excluded.name_ar, account_type = excluded.account_type, normal_balance = excluded.normal_balance,
           parent_id = excluded.parent_id, kind = excluded.kind, sort_order = coalesce(public.accounts.sort_order, excluded.sort_order), active = true
    returning id into v_5100;

    insert into public.accounts(org_id, code, name_ar, account_type, normal_balance, parent_id, kind, sort_order)
    values (v_org, '5200', 'عمالة', 'expense', 'debit', v_5000, 'operating', 20)
    on conflict (org_id, code) do update
       set name_ar = excluded.name_ar, account_type = excluded.account_type, normal_balance = excluded.normal_balance,
           parent_id = excluded.parent_id, kind = excluded.kind, sort_order = coalesce(public.accounts.sort_order, excluded.sort_order), active = true
    returning id into v_5200;

    insert into public.accounts(org_id, code, name_ar, account_type, normal_balance, parent_id, kind, sort_order)
    values (v_org, '5300', 'معدات وتشغيل', 'expense', 'debit', v_5000, 'operating', 30)
    on conflict (org_id, code) do update
       set name_ar = excluded.name_ar, account_type = excluded.account_type, normal_balance = excluded.normal_balance,
           parent_id = excluded.parent_id, kind = excluded.kind, sort_order = coalesce(public.accounts.sort_order, excluded.sort_order), active = true
    returning id into v_5300;

    insert into public.accounts(org_id, code, name_ar, account_type, normal_balance, parent_id, kind, sort_order)
    values (v_org, '5400', 'تشغيل عام', 'expense', 'debit', v_5000, 'operating', 40)
    on conflict (org_id, code) do update
       set name_ar = excluded.name_ar, account_type = excluded.account_type, normal_balance = excluded.normal_balance,
           parent_id = excluded.parent_id, kind = excluded.kind, sort_order = coalesce(public.accounts.sort_order, excluded.sort_order), active = true
    returning id into v_5400;

    insert into public.accounts(org_id, code, name_ar, account_type, normal_balance, parent_id, kind, sort_order)
    values
      (v_org, '5110', 'أسمدة', 'expense', 'debit', v_5100, 'operating', 10),
      (v_org, '5120', 'مبيدات ومكافحة', 'expense', 'debit', v_5100, 'operating', 20),
      (v_org, '5210', 'عمالة موسمية ويومية', 'expense', 'debit', v_5200, 'operating', 10),
      (v_org, '5220', 'مرتبات دائمة', 'expense', 'debit', v_5200, 'operating', 20),
      (v_org, '5310', 'صيانة معدات', 'expense', 'debit', v_5300, 'operating', 10),
      (v_org, '5320', 'وقود وطاقة', 'expense', 'debit', v_5300, 'operating', 20),
      (v_org, '5330', 'إيجار معدات', 'expense', 'debit', v_5300, 'operating', 30),
      (v_org, '5410', 'مشتريات', 'expense', 'debit', v_5400, 'operating', 10),
      (v_org, '5420', 'ضيافة', 'expense', 'debit', v_5400, 'operating', 20),
      (v_org, '5430', 'كهرباء ومياه', 'expense', 'debit', v_5400, 'operating', 30),
      (v_org, '5440', 'صيانة منشآت', 'expense', 'debit', v_5400, 'operating', 40),
      (v_org, '5490', 'أخرى', 'expense', 'debit', v_5400, 'operating', 90)
    on conflict (org_id, code) do update
       set name_ar = excluded.name_ar,
           account_type = excluded.account_type,
           normal_balance = excluded.normal_balance,
           parent_id = excluded.parent_id,
           kind = excluded.kind,
           sort_order = coalesce(public.accounts.sort_order, excluded.sort_order),
           active = true;
end;
$$;
revoke execute on function public.fn_seed_default_accounts(uuid) from public, anon, authenticated;

create or replace function public.organization_seed_default_accounts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.fn_seed_default_accounts(new.id);
  return new;
end;
$$;
revoke execute on function public.organization_seed_default_accounts() from public, anon, authenticated;

drop trigger if exists organization_seed_default_accounts on public.organization;
create trigger organization_seed_default_accounts
  after insert on public.organization
  for each row execute function public.organization_seed_default_accounts();

do $$
declare
  v_org uuid;
begin
  for v_org in select id from public.organization loop
    perform public.fn_seed_default_accounts(v_org);
  end loop;
end $$;

-- ── 6) Rollup view ───────────────────────────────────────────────────────────────────────────────────
create or replace view public.v_account_rollup
with (security_invoker = true)
as
with recursive subtree as (
  select a.org_id, a.id as ancestor_id, a.id as descendant_id
    from public.accounts a
  union all
  select s.org_id, s.ancestor_id, child.id as descendant_id
    from subtree s
    join public.accounts child on child.parent_id = s.descendant_id and child.org_id = s.org_id
)
select
  a.org_id,
  a.id as account_id,
  a.parent_id,
  a.code,
  a.name_ar,
  a.account_type,
  a.normal_balance,
  a.kind,
  a.active,
  a.is_system,
  a.sort_order,
  coalesce(sum(l.debit), 0) as debit,
  coalesce(sum(l.credit), 0) as credit,
  case a.normal_balance
    when 'credit' then coalesce(sum(l.credit), 0) - coalesce(sum(l.debit), 0)
    else coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0)
  end as balance
from public.accounts a
left join subtree s on s.ancestor_id = a.id and s.org_id = a.org_id
left join public.journal_lines l on l.org_id = a.org_id and l.account_id = s.descendant_id
group by
  a.org_id, a.id, a.parent_id, a.code, a.name_ar, a.account_type, a.normal_balance,
  a.kind, a.active, a.is_system, a.sort_order;

grant select on public.v_account_rollup to authenticated;

-- ── 7) Re-emit custody/payment-request posting at the selected expense account ───────────────────────
create or replace function public.fn_record_custody_movement(
  p_account uuid, p_movement_type text, p_amount_in numeric, p_amount_out numeric,
  p_occurred_at date default current_date, p_expense_id uuid default null, p_note text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_id uuid;
  v_exp_org uuid;
  v_exp_total numeric;
  v_exp_kind text;
  v_exp_payment_status text;
  v_debit_account uuid;
  v_credit_account uuid;
  v_journal uuid;
begin
  select org_id into v_org from public.custody_accounts where id = p_account;
  if v_org is null then raise exception 'custody account % not found', p_account using errcode = 'P0002'; end if;
  if v_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org custody' using errcode = '42501'; end if;
  if not public.authorize('custody.write', v_org) then
    raise exception 'forbidden: custody.write is required' using errcode = '42501'; end if;
  if coalesce(p_amount_in,0) < 0 or coalesce(p_amount_out,0) < 0 then
    raise exception 'amounts must be non-negative' using errcode = '22023'; end if;
  if (coalesce(p_amount_in,0) > 0) = (coalesce(p_amount_out,0) > 0) then
    raise exception 'exactly one of amount_in / amount_out must be > 0' using errcode = '22023'; end if;

  if p_expense_id is not null then
    select org_id, total, kind, payment_status
      into v_exp_org, v_exp_total, v_exp_kind, v_exp_payment_status
      from public.expenses
     where id = p_expense_id;
    if v_exp_org is null then
      raise exception 'expense % not found', p_expense_id using errcode = 'P0002';
    end if;
    if v_exp_org is distinct from v_org then
      raise exception 'forbidden: cross-org expense link' using errcode = '42501';
    end if;
    if coalesce(p_amount_out,0) > 0 then
      if coalesce(v_exp_kind, 'operating') not in ('operating','drawing','capex') then
        raise exception 'invalid expense kind for custody cash out-movement (kind=%)', v_exp_kind using errcode = '22023';
      end if;
      if coalesce(v_exp_payment_status, '') <> 'paid_from_custody' then
        raise exception 'set expense payment_status to paid_from_custody through fn_set_expense_payment_status before linking a cash out-movement'
          using errcode = '22023';
      end if;
      if coalesce(p_amount_out,0) <> coalesce(v_exp_total,0) then
        raise exception 'custody cash out-movement must equal the linked expense total (%)', v_exp_total
          using errcode = '22023';
      end if;
      if exists (
         select 1 from public.custody_movements m
          where m.expense_id = p_expense_id and m.amount_out > 0) then
        raise exception 'expense already has a custody cash out-movement; post a reversal before another cash out' using errcode = '22023';
      end if;
    end if;
  end if;

  insert into public.custody_movements(org_id, custody_account_id, occurred_at, movement_type, amount_in, amount_out, expense_id, note)
  values (v_org, p_account, coalesce(p_occurred_at, current_date), p_movement_type,
          coalesce(p_amount_in,0), coalesce(p_amount_out,0), p_expense_id, p_note)
  returning id into v_id;

  if p_expense_id is null
     and coalesce(p_amount_in,0) > 0
     and p_movement_type = 'استلام عهدة من المالك' then
    v_debit_account := public.fn_ensure_account(v_org, '1000', 'عهدة نقدية', 'asset', 'debit');
    v_credit_account := public.fn_ensure_account(v_org, '3000', 'تمويل المالك', 'equity', 'credit');
    v_journal := public.fn_post_two_line_journal(
      v_org,
      coalesce(p_occurred_at, current_date),
      'custody_owner_funding',
      v_id,
      'استلام عهدة من المالك',
      v_debit_account,
      v_credit_account,
      coalesce(p_amount_in,0),
      'استلام نقدية عهدة من المالك',
      'تمويل المالك للعهدة',
      p_account,
      v_id,
      null,
      null);
    update public.custody_movements set journal_entry_id = v_journal where id = v_id;
  end if;

  if p_expense_id is not null and coalesce(p_amount_out,0) > 0 then
    v_debit_account := public.fn_expense_posting_account(v_org, p_expense_id, v_exp_kind);
    v_credit_account := public.fn_ensure_account(v_org, '1000', 'عهدة نقدية', 'asset', 'debit');
    v_journal := public.fn_post_two_line_journal(
      v_org,
      coalesce(p_occurred_at, current_date),
      'expense_payment',
      p_expense_id,
      'سداد مصروف من العهدة',
      v_debit_account,
      v_credit_account,
      coalesce(p_amount_out,0),
      'إثبات مصروف/مسحوبات/رأسمالي عند السداد النقدي',
      'خروج نقدية من العهدة',
      p_account,
      v_id,
      p_expense_id,
      null);
    update public.custody_movements set journal_entry_id = v_journal where id = v_id;
  end if;

  return v_id;
end;
$$;
revoke execute on function public.fn_record_custody_movement(uuid, text, numeric, numeric, date, uuid, text) from public, anon, authenticated;
grant  execute on function public.fn_record_custody_movement(uuid, text, numeric, numeric, date, uuid, text) to authenticated;

create or replace function public.fn_set_expense_payment_status(
  p_expense uuid, p_status text, p_custody_account uuid default null, p_paid_by text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_total numeric;
  v_kind text;
  v_payment_status text;
  v_existing int;
  v_existing_movement uuid;
  v_has_request_line boolean := false;
  v_journal uuid;
begin
  select org_id, total, kind, payment_status
    into v_org, v_total, v_kind, v_payment_status
    from public.expenses
   where id = p_expense
   for update;
  if v_org is null then raise exception 'expense % not found', p_expense using errcode = 'P0002'; end if;
  if v_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org expense' using errcode = '42501'; end if;
  if not public.authorize('budget.write', v_org) then
    raise exception 'forbidden: budget.write is required' using errcode = '42501'; end if;
  if p_status not in ('paid_from_custody','post_paid_unpaid','paid_by_owner','cancelled') then
    raise exception 'invalid payment_status: %', p_status using errcode = '22023'; end if;
  if p_status in ('paid_from_custody','post_paid_unpaid') and coalesce(v_kind, 'operating') not in ('operating','drawing','capex') then
    raise exception 'invalid expense kind for custody/request routing (kind=%)', v_kind using errcode = '22023';
  end if;

  select count(*), (array_agg(id order by created_at))[1]
    into v_existing, v_existing_movement
    from public.custody_movements
   where expense_id = p_expense and amount_out > 0;

  if p_status <> 'paid_from_custody' and v_existing > 0 then
    raise exception 'expense already has a custody cash out-movement; post a reversal before rerouting payment_status' using errcode = '22023';
  end if;

  select exists (
    select 1
      from public.payment_request_lines l
     where l.expense_id = p_expense
       and l.paid_at is null)
    into v_has_request_line;
  if v_has_request_line and p_status is distinct from v_payment_status then
    raise exception 'expense is already included in an unpaid payment request line; confirm payment through the request workflow'
      using errcode = '22023';
  end if;

  update public.expenses
     set payment_status = p_status,
         paid_by = p_paid_by
   where id = p_expense;

  if p_status = 'paid_from_custody' then
    if p_custody_account is null and v_existing = 0 then
      raise exception 'custody account required for paid_from_custody' using errcode = '22023';
    end if;
    if p_custody_account is not null and (select org_id from public.custody_accounts where id = p_custody_account) is distinct from v_org then
      raise exception 'forbidden: cross-org custody account' using errcode = '42501';
    end if;
    if v_existing = 0 and coalesce(v_total,0) > 0 then
      v_existing_movement := public.fn_record_custody_movement(
        p_custody_account, 'صرف نقدي', 0, v_total, current_date, p_expense,
        'صرف نقدي للمصروف ' || left(p_expense::text, 8));
    elsif v_existing_movement is not null then
      select journal_entry_id into v_journal from public.custody_movements where id = v_existing_movement;
      if v_journal is null then
        v_journal := public.fn_post_two_line_journal(
          v_org,
          current_date,
          'expense_payment',
          p_expense,
          'سداد مصروف من العهدة',
          public.fn_expense_posting_account(v_org, p_expense, v_kind),
          public.fn_ensure_account(v_org, '1000', 'عهدة نقدية', 'asset', 'debit'),
          coalesce(v_total,0),
          'إثبات مصروف/مسحوبات/رأسمالي عند السداد النقدي',
          'خروج نقدية من العهدة',
          (select custody_account_id from public.custody_movements where id = v_existing_movement),
          v_existing_movement,
          p_expense,
          null);
        update public.custody_movements set journal_entry_id = v_journal where id = v_existing_movement;
      end if;
    end if;
  end if;
end;
$$;
revoke execute on function public.fn_set_expense_payment_status(uuid, text, uuid, text) from public, anon, authenticated;
grant  execute on function public.fn_set_expense_payment_status(uuid, text, uuid, text) to authenticated;

create or replace function public.fn_add_expense_to_request(p_request uuid, p_expense uuid)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_org uuid;
  v_status text;
  v_exp_org uuid;
  v_exp_kind text;
  v_exp_payment_status text;
  v_exp_account uuid;
  v_paid_by text;
  v_id uuid;
  v_existing_movement uuid;
  v_existing_account uuid;
  v_existing_journal uuid;
begin
  select org_id, status into v_org, v_status from public.payment_requests where id = p_request;
  if v_org is null then raise exception 'request % not found', p_request using errcode='P0002'; end if;
  if v_org not in (select public.user_org_ids()) then raise exception 'forbidden: cross-org' using errcode='42501'; end if;
  if not public.authorize('request.prepare', v_org) then
    raise exception 'forbidden: request.prepare is required' using errcode='42501'; end if;
  if v_status <> 'draft' then raise exception 'request is not draft (%)', v_status using errcode='22023'; end if;

  select org_id, kind, payment_status, account_id, paid_by
    into v_exp_org, v_exp_kind, v_exp_payment_status, v_exp_account, v_paid_by
    from public.expenses
   where id = p_expense
   for update;
  if v_exp_org is distinct from v_org then raise exception 'forbidden: cross-org expense' using errcode='42501'; end if;
  if coalesce(v_exp_kind, 'operating') not in ('operating','drawing','capex') then
    raise exception 'invalid expense kind for a payment request (kind=%)', v_exp_kind using errcode='22023'; end if;
  if v_exp_account is null then
    raise exception 'expense account_id is required before adding an expense to a payment request' using errcode='22023';
  end if;
  perform public.fn_expense_posting_account(v_org, p_expense, v_exp_kind);
  if coalesce(v_exp_payment_status, '') not in ('post_paid_unpaid','paid_from_custody') then
    raise exception 'only post_paid_unpaid or paid_from_custody expenses can be added to a payment request (payment_status=%)', v_exp_payment_status using errcode='22023'; end if;
  if exists (
       select 1 from public.payment_request_lines l
        where l.expense_id = p_expense
          and l.payment_request_id <> p_request) then
    raise exception 'expense is already included in another payment request' using errcode='22023';
  end if;

  if v_exp_payment_status = 'paid_from_custody' then
    select m.id, m.custody_account_id, m.journal_entry_id
      into v_existing_movement, v_existing_account, v_existing_journal
      from public.custody_movements m
     where m.expense_id = p_expense and m.amount_out > 0
     order by m.created_at
     limit 1;
    if v_existing_movement is null then
      raise exception 'paid_from_custody expense has no custody cash out-movement' using errcode='22023';
    end if;
  end if;

  insert into public.payment_request_lines(
    org_id, payment_request_id, expense_id, paid_at, paid_by, paid_from_custody_account_id, custody_movement_id, journal_entry_id)
  values (
    v_org,
    p_request,
    p_expense,
    case when v_exp_payment_status = 'paid_from_custody' then now() else null end,
    case when v_exp_payment_status = 'paid_from_custody' then v_paid_by else null end,
    v_existing_account,
    v_existing_movement,
    v_existing_journal)
  on conflict (payment_request_id, expense_id) do nothing
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.fn_add_expense_to_request(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.fn_add_expense_to_request(uuid, uuid) to authenticated;

create or replace function public.fn_approve_request_final(p_request uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org uuid;
  v_status text;
  v_totals jsonb;
begin
  select org_id, status into v_org, v_status from public.payment_requests where id = p_request;
  if v_org is null then raise exception 'request % not found', p_request using errcode='P0002'; end if;
  if v_org not in (select public.user_org_ids()) then raise exception 'forbidden: cross-org' using errcode='42501'; end if;
  if not public.authorize('request.approve.final', v_org) then raise exception 'forbidden: request.approve.final (owner only)' using errcode='42501'; end if;
  if v_status <> 'approved_operational' then raise exception 'only an operationally-approved request can be finalized (is %)', v_status using errcode='22023'; end if;

  if exists (
      select 1
        from public.payment_request_lines l
        join public.expenses e on e.id = l.expense_id
       where l.payment_request_id = p_request
         and e.account_id is null) then
    raise exception 'all payment request expenses must have account_id before final approval' using errcode='22023';
  end if;

  v_totals := public.fn_payment_request_totals(p_request);
  update public.payment_requests
     set status = case
           when (v_totals ->> 'gross_request')::numeric <= 0 then 'paid'
           else 'approved_final'
         end,
         approved_final_by=(select auth.uid()),
         approved_final_at=now(),
         approved_post_paid_total=(v_totals ->> 'post_paid_unpaid')::numeric,
         approved_custody_top_up=(v_totals ->> 'custody_top_up')::numeric,
         approved_net_request=(v_totals ->> 'gross_request')::numeric
   where id=p_request and status='approved_operational';
  if not found then raise exception 'request % is no longer operationally-approved (concurrent transition)', p_request using errcode='40001'; end if;
end; $$;
revoke execute on function public.fn_approve_request_final(uuid) from public, anon, authenticated;
grant execute on function public.fn_approve_request_final(uuid) to authenticated;

commit;
