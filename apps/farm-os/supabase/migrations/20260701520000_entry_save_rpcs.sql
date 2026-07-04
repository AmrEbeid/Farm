-- SPEC-0024 S-9 (final gap) — gated save-RPCs for the remaining entry surfaces: suppliers,
-- inventory items, and expenses — so each gets an Excel/CSV import template (Owner directive D.1:
-- "every data entry has its template and allows import").
--
-- Until now these three were direct-RLS-insert forms with no fn_* write path, so the import framework
-- (which commits ONLY through gated RPCs) could not cover them. This adds the three RPCs mirroring the
-- exact posture of every other save-RPC: SECURITY DEFINER + search_path='' + EXECUTE locked to
-- authenticated + org-membership/cross-org guards + the same authorize() perms the tables' RLS already
-- uses (inventory.write for suppliers/items; budget.write for expenses). NO authorize() change.
--
-- fn_save_expense is INSERT-only from the import path's perspective (a template can never touch a
-- routed/posted expense): updates go through p_id but the existing expense_guard_routed_money_immutable
-- trigger blocks money/account changes after routing, and expense_account_guard/expense_cost_center_guard
-- re-validate links. Payment routing is deliberately NOT importable — an imported expense arrives
-- unrouted (payment_status null) and is routed one-by-one through the UI, so a bulk import can never
-- move cash (#1). People/PII import is deliberately EXCLUDED (SPEC-0006 gates).
begin;

-- ── 1) fn_save_supplier (inventory.write — matches the suppliers RLS gate, tests/67) ─────────────────
create or replace function public.fn_save_supplier(
  p_id uuid, p_org uuid, p_name text,
  p_phone text default null, p_terms text default null, p_lead_time_days int default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid; v_id uuid;
begin
  if p_name is null or trim(p_name) = '' then raise exception 'supplier name required' using errcode = '23502'; end if;
  if p_lead_time_days is not null and p_lead_time_days < 0 then
    raise exception 'lead_time_days must be non-negative' using errcode = '22023'; end if;
  if p_id is not null then
    select org_id into v_org from public.suppliers where id = p_id;
    if v_org is null then raise exception 'supplier % not found', p_id using errcode = 'P0002'; end if;
    if p_org is not null and p_org is distinct from v_org then
      raise exception 'forbidden: supplier org cannot change' using errcode = '42501'; end if;
  else
    v_org := p_org;
  end if;
  if v_org is null then raise exception 'org required' using errcode = '23502'; end if;
  if v_org not in (select public.user_org_ids()) then raise exception 'forbidden: cross-org supplier' using errcode = '42501'; end if;
  if not public.authorize('inventory.write', v_org) then raise exception 'forbidden: inventory.write is required' using errcode = '42501'; end if;

  if p_id is null then
    insert into public.suppliers(org_id, name, phone, terms, lead_time_days)
    values (v_org, trim(p_name), nullif(trim(coalesce(p_phone,'')),''), nullif(trim(coalesce(p_terms,'')),''), p_lead_time_days)
    returning id into v_id;
  else
    update public.suppliers
       set name = trim(p_name), phone = nullif(trim(coalesce(p_phone,'')),''),
           terms = nullif(trim(coalesce(p_terms,'')),''), lead_time_days = p_lead_time_days
     where id = p_id returning id into v_id;
  end if;
  return jsonb_build_object('id', v_id);
end $$;
revoke execute on function public.fn_save_supplier(uuid, uuid, text, text, text, int) from public, anon, authenticated;
grant  execute on function public.fn_save_supplier(uuid, uuid, text, text, text, int) to authenticated;

-- ── 2) fn_save_inventory_item (inventory.write — matches the items RLS gate, tests/66) ───────────────
create or replace function public.fn_save_inventory_item(
  p_id uuid, p_org uuid, p_name text,
  p_category text default null, p_unit text default null, p_pack_size numeric default null,
  p_min_stock numeric default null, p_safety_stock numeric default null,
  p_reorder_point numeric default null, p_reorder_qty numeric default null,
  p_lead_time_days int default null, p_preferred_supplier_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid; v_id uuid; v_sup_org uuid;
begin
  if p_name is null or trim(p_name) = '' then raise exception 'item name required' using errcode = '23502'; end if;
  if p_id is not null then
    select org_id into v_org from public.inventory_items where id = p_id;
    if v_org is null then raise exception 'item % not found', p_id using errcode = 'P0002'; end if;
    if p_org is not null and p_org is distinct from v_org then
      raise exception 'forbidden: item org cannot change' using errcode = '42501'; end if;
  else
    v_org := p_org;
  end if;
  if v_org is null then raise exception 'org required' using errcode = '23502'; end if;
  if v_org not in (select public.user_org_ids()) then raise exception 'forbidden: cross-org item' using errcode = '42501'; end if;
  if not public.authorize('inventory.write', v_org) then raise exception 'forbidden: inventory.write is required' using errcode = '42501'; end if;
  if p_preferred_supplier_id is not null then
    select org_id into v_sup_org from public.suppliers where id = p_preferred_supplier_id;
    if v_sup_org is distinct from v_org then raise exception 'forbidden: cross-org preferred supplier' using errcode = '42501'; end if;
  end if;

  if p_id is null then
    insert into public.inventory_items(org_id, name, category, unit, pack_size, min_stock, safety_stock,
      reorder_point, reorder_qty, lead_time_days, preferred_supplier_id)
    values (v_org, trim(p_name), nullif(trim(coalesce(p_category,'')),''), nullif(trim(coalesce(p_unit,'')),''),
      p_pack_size, p_min_stock, p_safety_stock, p_reorder_point, p_reorder_qty, p_lead_time_days, p_preferred_supplier_id)
    returning id into v_id;
  else
    update public.inventory_items
       set name = trim(p_name), category = nullif(trim(coalesce(p_category,'')),''),
           unit = nullif(trim(coalesce(p_unit,'')),''), pack_size = p_pack_size, min_stock = p_min_stock,
           safety_stock = p_safety_stock, reorder_point = p_reorder_point, reorder_qty = p_reorder_qty,
           lead_time_days = p_lead_time_days, preferred_supplier_id = p_preferred_supplier_id
     where id = p_id returning id into v_id;
  end if;
  return jsonb_build_object('id', v_id);
end $$;
revoke execute on function public.fn_save_inventory_item(uuid, uuid, text, text, text, numeric, numeric, numeric, numeric, numeric, int, uuid) from public, anon, authenticated;
grant  execute on function public.fn_save_inventory_item(uuid, uuid, text, text, text, numeric, numeric, numeric, numeric, numeric, int, uuid) to authenticated;

-- ── 3) fn_save_expense (budget.write — matches the expenses RLS gate, tests/44) ──────────────────────
-- Kind is written directly here (SECURITY DEFINER owns the column; the CHECK constraint + the
-- expense_account_guard trigger validate it, incl. kind↔account consistency #6). account/cost-center
-- links re-validated by the existing guards; cross-org supplier checked explicitly. Imported expenses
-- arrive UNROUTED (no payment_status) — routing money stays a one-by-one UI act.
create or replace function public.fn_save_expense(
  p_id uuid, p_org uuid, p_date date, p_category text, p_total numeric,
  p_description text default null, p_supplier_id uuid default null,
  p_kind text default 'operating', p_account_id uuid default null, p_cost_center_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid; v_id uuid; v_sup_org uuid;
begin
  if p_category is null or trim(p_category) = '' then raise exception 'category required' using errcode = '23502'; end if;
  if p_total is null or p_total <= 0 then raise exception 'total must be positive' using errcode = '22023'; end if;
  if coalesce(p_kind,'operating') not in ('operating','drawing','capex') then
    raise exception 'invalid expense kind: %', p_kind using errcode = '22023'; end if;
  if p_id is not null then
    select org_id into v_org from public.expenses where id = p_id;
    if v_org is null then raise exception 'expense % not found', p_id using errcode = 'P0002'; end if;
    if p_org is not null and p_org is distinct from v_org then
      raise exception 'forbidden: expense org cannot change' using errcode = '42501'; end if;
  else
    v_org := p_org;
  end if;
  if v_org is null then raise exception 'org required' using errcode = '23502'; end if;
  if v_org not in (select public.user_org_ids()) then raise exception 'forbidden: cross-org expense' using errcode = '42501'; end if;
  if not public.authorize('budget.write', v_org) then raise exception 'forbidden: budget.write is required' using errcode = '42501'; end if;
  if p_supplier_id is not null then
    select org_id into v_sup_org from public.suppliers where id = p_supplier_id;
    if v_sup_org is distinct from v_org then raise exception 'forbidden: cross-org supplier' using errcode = '42501'; end if;
  end if;

  if p_id is null then
    insert into public.expenses(org_id, date, category, description, total, supplier_id, kind, account_id, cost_center_id)
    values (v_org, p_date, trim(p_category), nullif(trim(coalesce(p_description,'')),''), p_total, p_supplier_id,
      coalesce(p_kind,'operating'), p_account_id, p_cost_center_id)
    returning id into v_id;
  else
    -- expense_guard_routed_money_immutable blocks money/account changes after routing/posting.
    update public.expenses
       set date = p_date, category = trim(p_category), description = nullif(trim(coalesce(p_description,'')),''),
           total = p_total, supplier_id = p_supplier_id, kind = coalesce(p_kind,'operating'),
           account_id = p_account_id, cost_center_id = p_cost_center_id
     where id = p_id returning id into v_id;
  end if;
  return jsonb_build_object('id', v_id);
end $$;
revoke execute on function public.fn_save_expense(uuid, uuid, date, text, numeric, text, uuid, text, uuid, uuid) from public, anon, authenticated;
grant  execute on function public.fn_save_expense(uuid, uuid, date, text, numeric, text, uuid, text, uuid, uuid) to authenticated;

commit;
