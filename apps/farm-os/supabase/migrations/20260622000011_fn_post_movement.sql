-- Farm OS MVP-0 — B1: transactional inventory mutation primitive.
--
-- The app's recordReceipt/executeOperation do a read-modify-write on inventory_bin.on_hand
-- in JS and insert the movement separately (security review finding B1): that races
-- (lost updates) and can leave on_hand ≠ Σ(movements), breaking the SC-6 invariant the
-- coverage engine trusts. fn_post_movement makes one server-side, org-guarded, transactional
-- call that appends to the ledger and recomputes on_hand FROM the ledger (via fn_bin_rebuild)
-- — no read-modify-write, so it is inherently lost-update-safe and always reconciled.
--
-- This is the verifiable DB primitive. Rewiring the server actions to call it (and folding
-- in `reserved` reconciliation, D2) is the e2e-gated follow-up — left to the Docker stack so
-- the wedge-loop flow is re-verified end-to-end before the app switches over.

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
returns numeric            -- the recomputed on_hand
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  -- Resolve the owning org from the item (authoritative), then the bin as a fallback.
  select org_id into v_org from public.inventory_items where id = p_item;
  if v_org is null then
    select org_id into v_org from public.inventory_bin where item_id = p_item and location = p_location;
  end if;
  if v_org is null then
    raise exception 'unknown inventory item %', p_item using errcode = 'P0002';
  end if;

  -- Org guard (mirrors fn_stock_coverage): an unauthenticated (anon) caller is never
  -- trusted; a JWT user must belong to the item's org. The null-uid path is the trusted
  -- service/superuser context only.
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org movement on item %', p_item using errcode = '42501';
  end if;

  -- Validate inputs (qty is always a positive magnitude; the TYPE carries the sign).
  if p_qty is null or p_qty <= 0 then
    raise exception 'movement qty must be a positive number, got %', p_qty using errcode = '22023';
  end if;
  if p_type not in ('receipt','issue','return','adjustment','transfer','loss','expiry','reserve','release') then
    raise exception 'invalid movement type %', p_type using errcode = '22023';
  end if;

  -- Ensure a bin row exists so fn_bin_rebuild can write on_hand back.
  insert into public.inventory_bin (org_id, item_id, location)
  values (v_org, p_item, p_location)
  on conflict (item_id, location) do nothing;

  -- Append to the ledger (the source of truth) ...
  insert into public.inventory_movements
    (org_id, item_id, type, qty, unit, unit_cost, location, occurred_at, event_id, plan_id, supplier_id)
  values
    (v_org, p_item, p_type, p_qty, p_unit, p_unit_cost, p_location, p_occurred_at, p_event_id, p_plan_id, p_supplier_id);

  -- ... then recompute on_hand FROM the ledger. Deterministic and lost-update-safe:
  -- two concurrent posts each re-sum the full signed ledger, so neither clobbers the other.
  return public.fn_bin_rebuild(p_item, p_location);
end;
$$;

revoke all on function public.fn_post_movement(uuid,text,numeric,text,text,numeric,uuid,uuid,uuid,timestamptz) from public;
grant execute on function public.fn_post_movement(uuid,text,numeric,text,text,numeric,uuid,uuid,uuid,timestamptz) to authenticated;
