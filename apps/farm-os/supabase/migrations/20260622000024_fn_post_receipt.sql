-- Farm OS MVP-0 — RCP-ATOMIC-1: atomic, single-transaction PR receipt posting.
--
-- recordReceipt (app/(app)/purchase-requests/[prId]/actions.ts) was claim-first but NOT atomic
-- across line items: it flipped the PR approved→received in one statement, then LOOPED
-- fn_post_movement('receipt', …) once per purchase_request_item from the client. If item 0
-- committed and item ≥1 failed, the PR was left `received` with only partial stock posted AND no
-- clean retry path (the claim was already consumed) → a corrupt half-received state that inflates
-- some bins but not others. The per-item revert heuristic (release the claim only if item 0 failed)
-- could not cover a mid-loop failure.
--
-- This RPC mirrors the fn_execute_operation precedent (migration 0020): the claim flip AND every
-- receipt movement run in ONE transaction, so any failure rolls the whole receipt back automatically
-- — the PR stays `approved` and nothing is posted, leaving it cleanly retryable. No app-layer revert.
--
--   * Authorization replicates exactly what recordReceipt relied on:
--       - inventory.write (owner/farm_manager/storekeeper) via authorize() — the single source of
--         truth the action checked, and the same gate fn_post_movement enforces for direct writes.
--       - org membership: the PR must belong to one of the caller's orgs (defence in depth alongside
--         RLS), matching requireMembership() + the fn_post_movement cross-org guard.
--     authorize()/auth.uid() read the caller's JWT GUC, which SECURITY DEFINER does NOT change, so
--     the *caller's* permission is evaluated even though the body runs as the definer.
--   * Idempotency (RCP-1): claim-first `update … where status='approved'`; a second/concurrent call
--     affects 0 rows and aborts (errcode 23505) BEFORE posting any receipt → no phantom stock IN.
--     Preserves the SQLSTATE the action maps to the "already received / not approved" message.
--
-- Locked down per migration 0021: pinned empty search_path, fully schema-qualified, revoked from
-- public + anon, granted only to authenticated.
create or replace function public.fn_post_receipt(p_pr_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_status text;
  v_claimed int;
  v_items int := 0;
  v_item record;
begin
  -- AUTHZ (RCP-AUTHZ-3): receiving stock is inventory.write (owner/farm_manager/storekeeper),
  -- the same gate the action checked and fn_post_movement enforces. Single source of truth.
  if not public.authorize('inventory.write') then
    raise exception 'forbidden: inventory.write is required to receive stock'
      using errcode = '42501';
  end if;

  -- resolve the PR's org
  select pr.org_id, pr.status into v_org, v_status
    from public.purchase_requests pr
    where pr.id = p_pr_id;
  if v_org is null then
    raise exception 'purchase request % not found', p_pr_id using errcode = 'P0002';
  end if;

  -- org guard: the PR must belong to one of the caller's orgs (defence in depth alongside RLS),
  -- mirroring requireMembership() + the fn_post_movement cross-org guard. The null-uid path is the
  -- trusted service/superuser context only; anon is rejected outright.
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org receipt on purchase request %', p_pr_id
      using errcode = '42501';
  end if;

  -- RCP-1: claim-first idempotency gate. Flip approved→received as the FIRST write, guarded by
  -- status='approved'; abort if no row (already received, or never approved) BEFORE posting any
  -- movement. This whole block is one transaction, so a later fn_post_movement failure rolls the
  -- claim back too — the PR returns to `approved` and is cleanly retryable.
  update public.purchase_requests set status = 'received'
    where id = p_pr_id and status = 'approved';
  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then
    raise exception 'purchase request % is not approved or already received', p_pr_id
      using errcode = '23505';
  end if;

  -- Post one receipt movement per line item, all inside THIS transaction. Any failure (bad item,
  -- cross-org item, etc.) raises and rolls back the claim + every prior receipt — never a partial
  -- multi-item receipt.
  for v_item in
    select item_id, qty, unit, supplier_id
      from public.purchase_request_items
      where pr_id = p_pr_id
      order by item_id
  loop
    perform public.fn_post_movement(
      v_item.item_id,
      'receipt',
      coalesce(v_item.qty, 0),
      'main',
      coalesce(v_item.unit, 'kg'),
      null,                 -- p_unit_cost
      null,                 -- p_event_id
      null,                 -- p_plan_id
      v_item.supplier_id);
    v_items := v_items + 1;
  end loop;

  return jsonb_build_object('pr_id', p_pr_id, 'items_posted', v_items, 'status', 'received');
end $$;

revoke all     on function public.fn_post_receipt(uuid) from public;
revoke execute on function public.fn_post_receipt(uuid) from anon;
grant  execute on function public.fn_post_receipt(uuid) to authenticated;
