-- Farm OS — #431 latent inventory cleanup: disable under-modeled transfer and dead ordered supply.
--
-- `inventory_movements.type='transfer'` currently has no destination location/bin field. The rebuild logic treats
-- it as a source-side outflow, so posting a transfer would reduce one bin without increasing another. No current app
-- path posts `transfer`; keep it unavailable until an atomic paired source/destination transfer model exists.
--
-- `inventory_bin.ordered` is also forward-looking but currently has no writer. Approved/open PO supply is projected
-- directly by fn_stock_coverage, not maintained in `inventory_bin.ordered`. Pin it at zero until a real writer owns
-- the field, so `projected = on_hand - reserved + ordered` cannot imply phantom supply.
--
-- Constraints are NOT VALID so they do not scan or block any unexpected historical rows during apply, but they do
-- enforce all new writes after this migration.

alter table public.inventory_movements
  add constraint inventory_movements_no_transfer_until_destination
  check (type <> 'transfer') not valid;

alter table public.inventory_bin
  add constraint inventory_bin_ordered_zero_until_writer
  check (ordered = 0) not valid;

-- Re-emit latest fn_post_movement (migration 0033) with only one behavioral change: `transfer` is no longer an
-- accepted p_type until destination semantics exist. The DB check above is the hard floor; this gives callers a
-- clearer 22023 validation error before the insert.
create or replace function public.fn_post_movement(
  p_item        uuid,
  p_type        text,
  p_qty         numeric,
  p_location    text default 'main',
  p_unit        text default null,
  p_unit_cost   numeric default null,
  p_event_id    uuid default null,
  p_plan_id     uuid default null,
  p_supplier_id uuid default null,
  p_occurred_at timestamptz default now())
returns numeric
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_onhand numeric;
begin
  select org_id into v_org from public.inventory_items where id = p_item;
  if v_org is null then
    select org_id into v_org from public.inventory_bin where item_id = p_item and location = p_location;
  end if;
  if v_org is null then
    raise exception 'unknown inventory item %', p_item using errcode = 'P0002';
  end if;

  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org movement on item %', p_item using errcode = '42501';
  end if;

  if p_qty is null or p_qty <= 0 then
    raise exception 'movement qty must be a positive number, got %', p_qty using errcode = '22023';
  end if;
  if p_type not in ('receipt','issue','return','adjustment','loss','expiry','reserve','release') then
    raise exception 'invalid movement type %', p_type using errcode = '22023';
  end if;

  insert into public.inventory_bin (org_id, item_id, location)
  values (v_org, p_item, p_location)
  on conflict (item_id, location) do nothing;

  select coalesce(on_hand, 0) into v_onhand
    from public.inventory_bin
    where item_id = p_item and location = p_location
    for update;

  if p_type in ('issue','loss','expiry') and p_qty > coalesce(v_onhand, 0) then
    raise exception 'insufficient stock: cannot % % of item % at % (on_hand %)',
      p_type, p_qty, p_item, p_location, coalesce(v_onhand, 0) using errcode = '23514';
  end if;

  insert into public.inventory_movements
    (org_id, item_id, type, qty, unit, unit_cost, location, occurred_at, event_id, plan_id, supplier_id)
  values
    (v_org, p_item, p_type, p_qty, p_unit, p_unit_cost, p_location, p_occurred_at, p_event_id, p_plan_id, p_supplier_id);

  return public.fn_bin_rebuild(p_item, p_location);
end;
$$;

revoke all on function public.fn_post_movement(uuid,text,numeric,text,text,numeric,uuid,uuid,uuid,timestamptz) from public;
revoke execute on function
  public.fn_post_movement(uuid, text, numeric, text, text, numeric, uuid, uuid, uuid, timestamptz)
  from authenticated;
