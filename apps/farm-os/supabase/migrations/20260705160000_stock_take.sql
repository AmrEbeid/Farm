-- 20260705160000 — fn_record_stock_take: gated stock-take (جرد) reconciliation (SPEC-0030 Phase 4, #778).
--
-- PROBLEM: inventory only moved via receipts + executions; on-hand DRIFT (spillage, miscount, shrinkage) could
--   never be corrected from the UI — the only path was posting a raw reverse movement by hand. There was no way
--   to reconcile the system on-hand to a physical COUNT.
--
-- DESIGN: a gated wrapper over the INTERNAL fn_post_movement (mirrors the AUTHZ-3 fn_reserve_stock pattern).
--   It reconciles on_hand to the physical count (ground truth):
--     variance = counted − on_hand
--     variance > 0 (system UNDER-counted) → 'adjustment' inflow of +variance
--     variance < 0 (shrinkage)            → 'loss' outflow of |variance|
--   fn_post_movement requires a POSITIVE qty, so the direction is carried by the movement TYPE, not the sign.
--   The bin row is locked FOR UPDATE first, so the read-variance-then-post is atomic against concurrent
--   movements (fn_post_movement re-locks the same row — re-entrant within this txn).
--
-- MASKED-SHORTAGE SAFETY (SPEC-0001 §1, the cardinal sin): a stock-take can only be HONEST — counting LESS
--   than the system lowers on_hand and REVEALS more shortage (the safe direction); counting MORE reconciles to
--   the real physical stock (not masking — the system was simply under-counting). The engine reads
--   'adjustment' as an inflow and 'loss' as an outflow exactly like any other movement, and the #159 on_hand
--   floor still holds (a 'loss' of |variance| ≤ on_hand can never drive on_hand negative). The only abuse
--   vector — faking a high count to hide a real shortage — is a data-integrity concern handled by the gate
--   (inventory.write: owner/farm_manager/storekeeper) + the audited, append-only movement, NOT a logic flaw.
--
-- SECURITY: SECURITY DEFINER + search_path='', VOLATILE; org resolved from the item; authorize('inventory.write',
--   org) evaluated against the CALLER (auth.uid() survives definer); anon + cross-org rejected; the internal
--   fn_post_movement call passes the definer-owner EXECUTE check. EXECUTE revoked from public/anon/authenticated,
--   granted to authenticated. Every posted movement is audited by the inventory_movements trigger.
--
-- Rollback: drop function public.fn_record_stock_take(uuid, numeric, text).

create or replace function public.fn_record_stock_take(
  p_item        uuid,
  p_counted_qty numeric,
  p_location    text default 'main'
)
returns numeric  -- the reconciled on_hand (= p_counted_qty)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org      uuid;
  v_onhand   numeric;
  v_variance numeric;
begin
  if p_counted_qty is null or p_counted_qty < 0 then
    raise exception 'counted qty must be a non-negative number, got %', p_counted_qty using errcode = '22023';
  end if;

  -- Resolve the owning org from the item (authoritative), then the bin as a fallback — mirrors
  -- fn_reserve_stock / fn_post_movement so the gate is evaluated against the SAME org the primitive uses.
  select org_id into v_org from public.inventory_items where id = p_item;
  if v_org is null then
    select org_id into v_org from public.inventory_bin where item_id = p_item and location = p_location;
  end if;
  if v_org is null then
    raise exception 'unknown inventory item %', p_item using errcode = 'P0002';
  end if;

  -- inventory.write gate (owner/farm_manager/storekeeper), SCOPED to the item's org.
  if not public.authorize('inventory.write', v_org) then
    raise exception 'forbidden: inventory.write is required to record a stock-take' using errcode = '42501';
  end if;
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org stock-take on item %', p_item using errcode = '42501';
  end if;

  -- Ensure the bin row EXISTS before locking it — else `FOR UPDATE` on a non-existent row locks nothing and
  -- does NOT serialize, so a concurrent first-ever movement on this (item,location) could commit between our
  -- read and our post, leaving on_hand ≠ counted (an over-count that could mask a shortage). Mirrors
  -- fn_post_movement's own insert-then-lock ordering. Idempotent (no-op if the bin already exists).
  insert into public.inventory_bin (org_id, item_id, location)
    values (v_org, p_item, p_location)
    on conflict (item_id, location) do nothing;

  -- Now lock the (guaranteed) bin row so read-variance-then-post is atomic vs concurrent movements.
  select coalesce(on_hand, 0) into v_onhand
    from public.inventory_bin where item_id = p_item and location = p_location for update;
  v_onhand := coalesce(v_onhand, 0);

  v_variance := p_counted_qty - v_onhand;

  if v_variance > 0 then
    perform public.fn_post_movement(p_item, 'adjustment', v_variance, p_location);
  elsif v_variance < 0 then
    perform public.fn_post_movement(p_item, 'loss', -v_variance, p_location);
  end if;
  -- v_variance = 0 → the count matches the system; no movement is posted.

  return p_counted_qty;  -- on_hand is now reconciled to the physical count
end;
$$;
revoke execute on function public.fn_record_stock_take(uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.fn_record_stock_take(uuid, numeric, text) to authenticated;
