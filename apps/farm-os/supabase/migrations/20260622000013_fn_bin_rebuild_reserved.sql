-- Farm OS MVP-0 — D2: ledger-back `inventory_bin.reserved`.
--
-- Until now on_hand was rebuilt from the movement ledger but `reserved` was a direct
-- read-modify-write in the app (reserveStock bumped it; executeOperation cleared it with
-- no `release` movement) — so it could race and drift, and was never reconcilable.
-- This makes reserved = Σ(reserve) − Σ(release) over the ledger (clamped at 0), exactly
-- like on_hand. The app posts `reserve`/`release` via fn_post_movement, so every mutation
-- recomputes both quantities atomically from the ledger. CREATE OR REPLACE: fn_post_movement
-- (which calls fn_bin_rebuild) picks this up automatically.

create or replace function public.fn_bin_rebuild(p_item uuid, p_location text default 'main')
returns numeric
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_onhand numeric;
  v_reserved numeric;
begin
  select org_id into v_org from public.inventory_bin
    where item_id = p_item and location = p_location;
  if v_org is null then
    select org_id into v_org from public.inventory_items where id = p_item;
  end if;
  -- org guard: callers in a JWT context must belong to the item's org.
  if (select auth.uid()) is not null
     and v_org is not null
     and v_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org access to item %', p_item using errcode = '42501';
  end if;

  -- on_hand = Σ(signed stock movements). expiry/reserve/release do not move physical stock.
  select coalesce(sum(case
    when m.type in ('receipt','return','adjustment') then m.qty
    when m.type in ('issue','loss','expiry','transfer') then -m.qty
    else 0 end), 0)
  into v_onhand
  from public.inventory_movements m
  where m.item_id = p_item and m.location = p_location;

  -- D2: reserved = Σ(reserve) − Σ(release), clamped at 0 (matches the app's max(0,…)).
  select greatest(0, coalesce(sum(case
    when m.type = 'reserve' then m.qty
    when m.type = 'release' then -m.qty
    else 0 end), 0))
  into v_reserved
  from public.inventory_movements m
  where m.item_id = p_item and m.location = p_location;

  update public.inventory_bin
    set on_hand = v_onhand,
        reserved = v_reserved,
        projected = v_onhand - v_reserved + ordered
    where item_id = p_item and location = p_location;

  return v_onhand;
end;
$$;
