-- Farm OS — #216 unit-of-measure reconciliation, SUPPLY side (Option A, slice 2, completes #216). Owner-
-- directed build; independent review + prod re-probe. Engine surface.
--
-- The demand side (20260701170000) reconciles plan_material_requirements.unit to the item's canonical unit,
-- so fn_execute_operation (reads pmr.unit) and fn_post_receipt (uses item.unit) now always pass the item's
-- unit into the funnel — which is why the supply-side reconciliation, which would otherwise hard-fail a
-- non-kg execute, is SAFE only now (the earlier supply-first ordering was rejected in review for that reason).
--
-- This adds defense-in-depth: fn_post_movement — the ONLY movement-insert path (RPC-only-insert since 0030) —
-- DEFAULTS a null unit to the item's canonical unit and REJECTS a non-null mismatch (22023, errs safe: a loud
-- reject, never a silent miscount), guaranteeing on_hand is always accumulated in ONE unit. And fn_reserve_stock
-- stops hardcoding 'kg' (which mislabelled every reserve on a litre/piece item) — it passes null to inherit the
-- item's real unit. fn_execute_operation / fn_post_receipt already pass coalesce(item.unit,'kg') → no change.
-- Prod probe (2026-07-01): 0 movement rows with unit <> item.unit → validates cleanly, no backfill.
-- Grants preserved by create-or-replace (fn_post_movement stays internal; re-applied to be explicit).
-- Validation: pgTAP 109 (define-check-first) + full harness; prod re-probe.

-- ── fn_post_movement: re-emit latest (20260629140248) + unit reconciliation ─────────────────────────────
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
  v_item_unit text;
  v_unit text;
begin
  select org_id, unit into v_org, v_item_unit from public.inventory_items where id = p_item;
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

  -- #216 unit reconciliation: default a missing unit to the item's canonical unit; REJECT a non-null mismatch
  -- so the engine's unit-blind qty sum can never mix units. Null-unit items (no canonical unit) are unaffected.
  v_unit := coalesce(p_unit, v_item_unit);
  if v_item_unit is not null and v_unit is not null and v_unit <> v_item_unit then
    raise exception 'unit mismatch for item %: got % but item is tracked in %', p_item, v_unit, v_item_unit
      using errcode = '22023';
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
    (v_org, p_item, p_type, p_qty, v_unit, p_unit_cost, p_location, p_occurred_at, p_event_id, p_plan_id, p_supplier_id);

  return public.fn_bin_rebuild(p_item, p_location);
end;
$$;

revoke all on function public.fn_post_movement(uuid,text,numeric,text,text,numeric,uuid,uuid,uuid,timestamptz) from public;
revoke execute on function
  public.fn_post_movement(uuid, text, numeric, text, text, numeric, uuid, uuid, uuid, timestamptz)
  from authenticated;

-- ── fn_reserve_stock: re-emit (0037) passing NULL unit so it inherits the item's canonical unit ─────────
create or replace function public.fn_reserve_stock(
  p_item    uuid,
  p_qty     numeric,
  p_plan_id uuid)
returns numeric
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.inventory_items where id = p_item;
  if v_org is null then
    select org_id into v_org from public.inventory_bin where item_id = p_item and location = 'main';
  end if;
  if v_org is null then
    raise exception 'unknown inventory item %', p_item using errcode = 'P0002';
  end if;

  if not public.authorize('inventory.write', v_org) then
    raise exception 'forbidden: inventory.write is required to reserve stock'
      using errcode = '42501';
  end if;

  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org reserve on item %', p_item using errcode = '42501';
  end if;

  -- Pass NULL unit so fn_post_movement defaults it to the item's canonical unit (was a hardcoded 'kg' that
  -- mislabelled every reserve on a litre/piece item). Positional args match fn_post_movement exactly.
  return public.fn_post_movement(p_item, 'reserve', p_qty, 'main', null, null, null, p_plan_id, null);
end $$;

revoke all     on function public.fn_reserve_stock(uuid, numeric, uuid) from public;
revoke execute on function public.fn_reserve_stock(uuid, numeric, uuid) from anon;
grant  execute on function public.fn_reserve_stock(uuid, numeric, uuid) to authenticated;
