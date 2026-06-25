-- Farm OS MVP-0 — #159: floor on_hand at 0 — an outflow movement cannot exceed current physical stock.
--
-- CONFIRMED gap (local probe): fn_post_movement validated only `qty > 0`, never availability, and
-- fn_bin_rebuild clamps `reserved` with greatest(0,…) but NOT `on_hand`. So an issue/loss/expiry/
-- transfer larger than the balance drove on_hand NEGATIVE silently, e.g. issue 999999 against on_hand
-- 100 → on_hand −999899, and fn_stock_coverage then trusted it: available=−999899, recommend_qty=999899
-- ("اطلب 999899 كجم اليوم") — one bad issue corrupts the core engine's buy recommendation.
--
-- Fix: in fn_post_movement, before appending an OUTFLOW, reject p_qty > current on_hand for the
-- (item, location). Outflow types are exactly those fn_bin_rebuild subtracts from on_hand:
-- issue / loss / expiry / transfer. Inflows (receipt/return/adjustment) and the non-physical
-- reserve/release are unaffected. This makes on_hand >= 0 an enforced invariant at the write path.
--
-- CREATE OR REPLACE: re-emits fn_post_movement verbatim from 0011 with ONLY the availability check
-- added (and its grants re-stated for clarity; CREATE OR REPLACE preserves them anyway). Independent
-- of migration 0030 (#163) — different object; applies in any order.
--
-- Trade-off (owner-ratified at merge): this HARD-BLOCKS an over-issue (errcode 23514) rather than
-- allow-and-warn. Hard-block is the conservative, physically-correct default (you cannot issue stock
-- you do not have); on_hand is read from the ledger-derived bin (kept accurate by fn_bin_rebuild after
-- every movement), so a legitimate issue within stock is never blocked.

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

  -- #159: floor on_hand at 0. An OUTFLOW (the types fn_bin_rebuild subtracts from on_hand) cannot
  -- exceed current physical stock, else on_hand goes negative and the coverage engine trusts garbage.
  -- on_hand is read from the ledger-derived bin (accurate after each movement); a missing bin row = 0.
  if p_type in ('issue','loss','expiry','transfer') then
    select coalesce(on_hand, 0) into v_onhand
      from public.inventory_bin where item_id = p_item and location = p_location;
    if p_qty > coalesce(v_onhand, 0) then
      raise exception 'insufficient stock: cannot % % of item % at % (on_hand %)',
        p_type, p_qty, p_item, p_location, coalesce(v_onhand, 0) using errcode = '23514';
    end if;
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
