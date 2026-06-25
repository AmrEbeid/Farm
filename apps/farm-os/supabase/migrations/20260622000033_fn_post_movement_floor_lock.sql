-- Farm OS MVP-0 — CONC-1: make the #159 stock floor concurrency-safe by serializing movements per bin.
--
-- CONFIRMED gap (reasoned, READ COMMITTED): the #159 floor in fn_post_movement (migration 0031) reads
-- on_hand WITHOUT a lock, and fn_bin_rebuild only locks the bin at its closing UPDATE (after it has
-- already summed the ledger). So the floor is a check-then-act (TOCTOU): two concurrent outflows that
-- each individually fit (issue 80 + issue 80 against on_hand 100) both pass the check, both insert, and
-- the ledger truly sums to −60 while bin.on_hand races to a stale 20 — negative physical stock + a
-- bin out of sync with the ledger, the exact failure #159 set out to prevent. 0031's header only
-- claimed lost-update-safety for the REBUILD, not the CHECK. Full write-up:
-- docs/SECURITY-FINDING-stock-floor-concurrency-2026-06-25.md.
--
-- Fix: ensure the bin row exists, then `SELECT … FOR UPDATE` it BEFORE the floor check. Concurrent
-- fn_post_movement calls on the same (item, location) now serialize on that row lock, so a second
-- outflow reads the first's committed on_hand and the floor rejects correctly (23514); the rebuild's
-- sum also runs under the lock, so it can't miss a concurrent insert. Movements on the SAME bin
-- serialize (correct — a bin balance is inherently a serialization point); different bins are
-- unaffected.
--
-- CREATE OR REPLACE: re-emits fn_post_movement from 0031 verbatim with ONLY (a) the bin row ensured +
-- locked before the check and (b) the floor check reading the locked on_hand. Behaviour on the
-- single-call path is unchanged (test 32 stays green); grants re-stated for clarity. Independent of
-- 0030/0031/0032 — different concern; applies in any order after them.
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
  v_onhand numeric;
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

  -- Ensure a bin row exists, THEN lock it. CONC-1: locking the bin row here serializes concurrent
  -- movements on this (item, location), so the #159 floor check below is evaluated against a
  -- committed, non-racing on_hand (and fn_bin_rebuild's later sum runs under this same lock).
  insert into public.inventory_bin (org_id, item_id, location)
  values (v_org, p_item, p_location)
  on conflict (item_id, location) do nothing;

  select coalesce(on_hand, 0) into v_onhand
    from public.inventory_bin
    where item_id = p_item and location = p_location
    for update;

  -- #159: floor on_hand at 0. An OUTFLOW (the types fn_bin_rebuild subtracts from on_hand) cannot
  -- exceed current physical stock, else on_hand goes negative and the coverage engine trusts garbage.
  if p_type in ('issue','loss','expiry','transfer') and p_qty > coalesce(v_onhand, 0) then
    raise exception 'insufficient stock: cannot % % of item % at % (on_hand %)',
      p_type, p_qty, p_item, p_location, coalesce(v_onhand, 0) using errcode = '23514';
  end if;

  -- Append to the ledger (the source of truth) ...
  insert into public.inventory_movements
    (org_id, item_id, type, qty, unit, unit_cost, location, occurred_at, event_id, plan_id, supplier_id)
  values
    (v_org, p_item, p_type, p_qty, p_unit, p_unit_cost, p_location, p_occurred_at, p_event_id, p_plan_id, p_supplier_id);

  -- ... then recompute on_hand FROM the ledger. Under the FOR UPDATE lock above, concurrent posts on
  -- this bin serialize, so each rebuild sees every prior committed movement (no lost update).
  return public.fn_bin_rebuild(p_item, p_location);
end;
$$;

revoke all on function public.fn_post_movement(uuid,text,numeric,text,text,numeric,uuid,uuid,uuid,timestamptz) from public;
grant execute on function public.fn_post_movement(uuid,text,numeric,text,text,numeric,uuid,uuid,uuid,timestamptz) to authenticated;
