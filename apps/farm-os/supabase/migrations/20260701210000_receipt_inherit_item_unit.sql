-- Farm OS — #216 Finding-2: fn_post_receipt must post in the ITEM's canonical unit, not the PR-line unit.
-- Owner-directed build; independent review + prod re-probe. ENGINE / cardinal-sin surface (SPEC-0001 §1).
--
-- BUG (found by the holistic re-audit; my #216 supply migration's safety note misread this): fn_post_receipt
-- passed `coalesce(v_item.unit, 'kg')` where v_item is a purchase_request_items row — i.e. the PR-LINE unit,
-- NOT inventory_items.unit (0045:257-266). Unlike the demand side, purchase_request_items has NO reconcile
-- trigger. So a PR line for a non-kg item with a null/mismatched unit → `coalesce(null,'kg')='kg' ≠ 'L'` →
-- fn_post_movement (the #216 supply reject) raises 22023 → the whole receipt tx rolls back → the PR stays
-- 'approved' → fn_stock_coverage keeps projecting it as forward supply that can NEVER arrive → masked shortage.
-- Latent today (the coverage flow writes unit=item.unit; prod probe 2026-07-01: 0 mismatched PR lines, 0 stuck
-- PRs), but undefended and asymmetric with the pmr trigger.
--
-- FIX: pass NULL for the movement unit so fn_post_movement DEFAULTS it to the item's canonical unit (the receipt
-- qty is stored in the unit on_hand is tracked in — correct, and it can no longer be rejected). Re-emitted
-- VERBATIM from 0045 with ONLY the unit argument changed (coalesce(v_item.unit,'kg') → null). All else — the
-- authorize gate, cross-org guard, RCP-1 claim-first, the app.posting_receipt trust marker, over-receipt 23514,
-- the per-line loop, received_qty update, final-status computation, grants — is byte-identical.
-- Validation: pgTAP 111 (define-check-first: a receipt on a non-kg PR line posts + is labelled the item unit) +
-- full harness; prod re-probe.

create or replace function public.fn_post_receipt(p_pr_id uuid, p_lines jsonb default null)
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
  v_remaining numeric;
  v_req numeric;
  v_final text;
begin
  select pr.org_id, pr.status into v_org, v_status
    from public.purchase_requests pr
    where pr.id = p_pr_id;
  if v_org is null then
    raise exception 'purchase request % not found', p_pr_id using errcode = 'P0002';
  end if;

  if not public.authorize('inventory.write', v_org) then
    raise exception 'forbidden: inventory.write is required to receive stock'
      using errcode = '42501';
  end if;

  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org receipt on purchase request %', p_pr_id
      using errcode = '42501';
  end if;

  -- RCP-1: claim-first idempotency gate (serialises concurrent receives; rejects a not-open PR before posting).
  update public.purchase_requests set status = status
    where id = p_pr_id and status in ('approved','partially_received');
  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then
    raise exception 'purchase request % is not receivable (must be approved or partially_received)', p_pr_id
      using errcode = '23505';
  end if;

  -- ENGINE-DC trusted-path marker (0029): the receipts we post are disjoint-by-construction (capped at
  -- remaining-on-order + the PR flips out of the forward projection in this same txn). Txn-local.
  perform set_config('app.posting_receipt', '1', true);

  for v_item in
    select item_id, qty, unit, supplier_id, coalesce(received_qty, 0) as received_qty
      from public.purchase_request_items
      where pr_id = p_pr_id
      order by item_id
  loop
    if v_item.qty is null then
      raise exception 'purchase request line for item % has no quantity', v_item.item_id
        using errcode = '22023';
    end if;

    v_remaining := v_item.qty - v_item.received_qty;

    if p_lines is null then
      v_req := v_remaining;
    else
      select (e->>'qty')::numeric into v_req
        from jsonb_array_elements(p_lines) e
        where (e->>'item_id')::uuid = v_item.item_id
        limit 1;
      v_req := coalesce(v_req, 0);
    end if;

    if v_req > v_remaining then
      raise exception
        'over-receipt: cannot receive % of item % — only % remaining on purchase request %',
        v_req, v_item.item_id, v_remaining, p_pr_id
        using errcode = '23514';   -- check_violation
    end if;

    if v_req <= 0 then
      continue;
    end if;

    perform public.fn_post_movement(
      v_item.item_id,
      'receipt',
      v_req,
      'main',
      -- #216 Finding-2: pass NULL so fn_post_movement defaults to the ITEM's canonical unit. Passing the
      -- PR-line unit (coalesce(pri.unit,'kg')) would let a non-kg line with a null/mismatched unit be
      -- REJECTED by the supply funnel → the PR sticks 'approved' → phantom forward supply → masked shortage.
      null,
      null,                 -- p_unit_cost
      null,                 -- p_event_id
      null,                 -- p_plan_id
      v_item.supplier_id);

    update public.purchase_request_items
      set received_qty = coalesce(received_qty, 0) + v_req
      where pr_id = p_pr_id and item_id = v_item.item_id;

    v_items := v_items + 1;
  end loop;

  perform set_config('app.posting_receipt', '0', true);

  if exists (
    select 1 from public.purchase_request_items
      where pr_id = p_pr_id and coalesce(received_qty, 0) < coalesce(qty, 0)
  ) then
    v_final := 'partially_received';
  else
    v_final := 'received';
  end if;
  update public.purchase_requests set status = v_final where id = p_pr_id;

  return jsonb_build_object('pr_id', p_pr_id, 'items_posted', v_items, 'status', v_final);
end $$;

revoke all     on function public.fn_post_receipt(uuid, jsonb) from public;
revoke execute on function public.fn_post_receipt(uuid, jsonb) from anon;
grant  execute on function public.fn_post_receipt(uuid, jsonb) to authenticated;
