-- Farm OS MVP-0 — #270 C3: freeze `partially_received` PR lines too (close the qty-inflation shortage-mask).
--
-- THE BUG (live on prod 0047, shortage-mask). `fn_pr_items_lock_when_decided` (migration 0045) blocks
-- line edits only when the parent PR is `'approved'` or `'received'` — but 0045 ALSO introduced the
-- `'partially_received'` status AND made `fn_stock_coverage` project `qty - received_qty` for
-- `('approved','partially_received')`. So once a storekeeper posts a genuine partial receipt (PR →
-- `partially_received`), ANY authenticated org member can `PATCH /rest/v1/purchase_request_items`
-- `SET qty = qty + 100000` on that line: the lock's two guards (`v_status in ('approved','received')`)
-- fall through for `partially_received`, the org-only RLS passes, the CHECK only caps `received_qty<=qty`,
-- and the engine then projects the inflated `qty - received_qty` as phantom future supply → `shortage=false`.
--
-- THE FIX. Re-emit the trigger function VERBATIM from 0045 with the ONLY change being `partially_received`
-- added to BOTH guard status sets. The trusted-receipt GUC exemption (`app.posting_receipt='1'`,
-- received_qty-only footprint) is unchanged and runs FIRST, so `fn_post_receipt` continues to advance
-- `received_qty` on a partially_received PR. The trigger created in 0032 keeps pointing at this function
-- (CREATE OR REPLACE updates the body in place). Execute stays revoked (mirrors 0032/0045).

create or replace function public.fn_pr_items_lock_when_decided()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  -- trusted server/seed context (no JWT) is exempt — same precedent as pr_guard_approval (0017/0023).
  if (select auth.uid()) is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- SPEC-0009 trusted receipt path: fn_post_receipt sets app.posting_receipt='1' (txn-local) while it
  -- advances received_qty on the line being received. Permit ONLY that — an UPDATE whose monetary
  -- footprint is byte-for-byte unchanged (only received_qty / the immutable id may differ). Every other
  -- field stays frozen, so this neither weakens #160 nor lets a forged GUC change a commitment's money.
  if tg_op = 'UPDATE'
     and coalesce(current_setting('app.posting_receipt', true), '') = '1'
     and new.pr_id       is not distinct from old.pr_id
     and new.item_id     is not distinct from old.item_id
     and new.qty         is not distinct from old.qty
     and new.unit        is not distinct from old.unit
     and new.supplier_id is not distinct from old.supplier_id
     and new.est_cost    is not distinct from old.est_cost then
    return new;
  end if;

  -- Guard the line's CURRENT parent (old) on UPDATE/DELETE: you cannot edit, delete, OR detach
  -- (pr_id-rewrite) a line that currently belongs to a decided PR — that mutates the PR's monetary
  -- footprint. #270 C3: 'partially_received' is a decided state too (engine projects its remainder).
  if tg_op in ('UPDATE','DELETE') then
    select pr.status into v_status from public.purchase_requests pr where pr.id = old.pr_id;
    if v_status in ('approved','received','partially_received') then
      raise exception
        'cannot % a line of purchase request % — it is already % (approved purchase commitments are immutable; re-issue instead)',
        lower(tg_op), old.pr_id, v_status
        using errcode = '42501';
    end if;
  end if;

  -- Guard the TARGET parent (new) on INSERT/UPDATE: you cannot add a line to, or move a line onto, a
  -- decided PR (incl. partially_received).
  if tg_op in ('INSERT','UPDATE') then
    select pr.status into v_status from public.purchase_requests pr where pr.id = new.pr_id;
    if v_status in ('approved','received','partially_received') then
      raise exception
        'cannot % a line onto purchase request % — it is already % (approved purchase commitments are immutable)',
        (case when tg_op = 'INSERT' then 'add' else 'move' end), new.pr_id, v_status
        using errcode = '42501';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- trigger function is never called directly — keep it locked down (mirrors migration 0032/0045).
revoke execute on function public.fn_pr_items_lock_when_decided() from public, anon, authenticated;
