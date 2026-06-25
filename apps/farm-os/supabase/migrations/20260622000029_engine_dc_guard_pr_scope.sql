-- Farm OS MVP-0 — ENGINE-DC fix: the disjointness guard (migration 0026) is too coarse.
--
-- THE BUG. Migration 0026 added a BEFORE INSERT trigger (inv_guard_receipt_no_open_po) that rejects a
-- `receipt` whenever ANY approved + needed_by purchase_request exists for the SAME (org_id, item_id).
-- The check is ITEM-scoped, not PR-scoped. A raw inventory_movements receipt carries no PR linkage, so
-- the trigger literally cannot tell which approved PO "this receipt" belongs to — it only has the row's
-- (org_id, item_id). That is fine while an item has at most one open PO, but it is WRONG when an item
-- has two:
--   * tests/06 models exactly this — two APPROVED needed_by POs for one item (PR-C-P1, PR-C-P2): a
--     supported domain scenario (multiple scheduled receipts in different periods).
--   * fn_post_receipt (0024) receives ONE PO at a time: it flips only that PR approved→received, then
--     posts its receipt. With two open POs, flipping PR #1 still leaves PR #2 'approved', so the
--     item-scoped guard fires on PR #1's own receipt — and symmetrically on PR #2's — so BOTH POs
--     become un-receivable. A deadlock on a legitimate, modeled state.
--
-- WHY fn_post_receipt IS ACTUALLY SAFE HERE. The engine's disjointness invariant (0018) is:
--   on_hand = Σ(receipts)        (received-to-date)
--   forward = approved-not-received PRs (genuinely-future supply)
-- When fn_post_receipt receives PR #1 it flips PR #1 out of the forward projection at the SAME instant
-- PR #1's qty enters on_hand (claim-first, one txn — 0024:70-71,87). PR #2 stays 'approved' and stays
-- in the forward projection — correctly, because PR #2's qty is genuinely-future supply that has NOT
-- been received. on_hand and the projection remain DISJOINT. There is no double-count; the guard is
-- simply firing a false positive because it cannot see the PR boundary.
--
-- THE FIX (chosen: gate the guard to the trusted RPC, not PR-scope the row check). Approach (b),
-- "make the trigger PR-scoped", is impossible to do precisely: the inventory_movements row has no PR
-- reference, so the trigger cannot attribute a receipt to a specific PO and therefore cannot tell the
-- legit multi-PO receive apart from a genuine double-count. So instead we make the invariant explicit:
--   * fn_post_receipt is the ONE trusted path that maintains disjointness by construction (claim-first
--     flip). It sets a TRANSACTION-LOCAL GUC app.posting_receipt='1' before posting its movements, and
--     the trigger SKIPS the item-scoped check when that GUC is set. fn_post_receipt has already proven
--     disjointness (it raised 23505 if the PR was not 'approved', and flipped exactly that PR to
--     'received'), so its receipts are trusted.
--   * EVERY OTHER receipt path stays fully guarded. A direct/out-of-band receipt (the SPEC-0001 #1
--     double-count hole, pinned by tests/27 case (e)) is posted WITHOUT the GUC, so the full
--     item-scoped check still runs and still rejects the orphan/double-count state.
--
-- WHY THIS IS SAFE FOR ALL LEGITIMATE PATHS (audited):
--   * fn_post_receipt (the field receive path) — now sets the GUC → multi-PO receive succeeds.
--   * seed.sql opening-balance receipts — direct inserts, but NO approved PR exists for those items at
--     seed time, so the full check passes (GUC unset). Unaffected.
--   * manual adjustment / opening stock receipts with no matching PR — full check passes. Unaffected.
--   * tests/16 + tests/27 roundtrips — flip the PR to 'received' first, so no approved PR remains;
--     full check passes. Unaffected.
-- The GUC is set with is_local=true, so it is scoped to fn_post_receipt's transaction and auto-resets
-- at commit/rollback — it can never leak to a later out-of-band receipt in another transaction.
--
-- ADR-0006 conventions: create-or-replace functions; drop-then-create the trigger; SECURITY DEFINER +
-- set search_path = ''; fully schema-qualified; function-lockdown revoke pattern preserved.

-- ── 1) The guard: skip the item-scoped check for receipts posted by the trusted RPC ───────────────
create or replace function public.inv_guard_receipt_no_open_po()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  -- Only receipts can enter on_hand as "received supply"; everything else is irrelevant to the
  -- engine's scheduled-receipt projection, so leave those movements alone.
  if new.type <> 'receipt' then
    return new;
  end if;

  -- TRUSTED PATH BYPASS. fn_post_receipt sets app.posting_receipt='1' (txn-local) before posting its
  -- receipts. It maintains the disjointness invariant by construction: it claim-flips exactly the PR
  -- being received from 'approved'→'received' (so that PR leaves the forward projection) in the SAME
  -- transaction as the receipt insert. Any OTHER approved PO for the item is genuinely-future supply
  -- that is correctly still projected — NOT a double-count. So when this GUC is set, the item-scoped
  -- check would be a false positive (it deadlocks multi-PO items, e.g. tests/06); skip it.
  -- current_setting(..., true) returns NULL if the GUC was never set (no error).
  if coalesce(current_setting('app.posting_receipt', true), '') = '1' then
    return new;
  end if;

  -- OUT-OF-BAND RECEIPT (not via fn_post_receipt): enforce the full disjointness invariant. A received
  -- qty must be in on_hand XOR projected as an open PO, never both. If an APPROVED-not-received PR for
  -- this (org, item) still exists at the instant a direct receipt lands, the qty would be
  -- double-counted (on_hand + forward projection) — the SPEC-0001 #1 hole. Reject it.
  if exists (
    select 1
      from public.purchase_request_items pri
      join public.purchase_requests pr on pr.id = pri.pr_id
      where pri.item_id = new.item_id
        and pr.org_id   = new.org_id
        and pr.status   = 'approved'
        and pr.needed_by is not null
  ) then
    raise exception
      'ENGINE-DC: cannot post a direct receipt for item % while an approved purchase request for it is still open — receive the PO via fn_post_receipt (which flips approved→received first) so on_hand and the scheduled-receipt projection stay disjoint',
      new.item_id
      using errcode = '23514';   -- check_violation: the disjointness invariant is breached
  end if;

  return new;
end
$fn$;

drop trigger if exists inv_guard_receipt_no_open_po on public.inventory_movements;
create trigger inv_guard_receipt_no_open_po
  before insert on public.inventory_movements
  for each row
  execute function public.inv_guard_receipt_no_open_po();

-- Lock the trigger function down (ADR-0006 §3): a trigger function is never invoked directly, so no
-- client role may hold EXECUTE. Revoke from PUBLIC *and* anon/authenticated to defeat the Supabase
-- default-privilege auto-grant on functions created in public.
revoke execute on function public.inv_guard_receipt_no_open_po() from public, anon, authenticated;

-- ── 2) fn_post_receipt: mark its receipts as trusted (txn-local) before posting them ──────────────
-- Re-emitted verbatim from migration 0024 (RCP-ATOMIC-1 / RCP-1 idempotency intact) with ONE added
-- line: set_config('app.posting_receipt','1', true) immediately before the receipt-posting loop. The
-- claim-first flip (status='approved'→'received') has already proven this PR is being legitimately
-- received and removed it from the forward projection; the GUC tells the guard to trust the receipts
-- that follow. is_local=true scopes the GUC to THIS transaction (auto-reset at commit/rollback).
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

  -- ENGINE-DC trusted-path marker (migration 0029): the claim flip above removed THIS PR from the
  -- forward projection, so the receipts we are about to post do not double-count. Mark the txn so the
  -- inv_guard_receipt_no_open_po trigger skips its item-scoped check — which would otherwise be a
  -- false positive (deadlock) when the item has a SECOND, still-approved open PO. Txn-local: it
  -- auto-resets at commit/rollback and cannot leak to a later out-of-band receipt.
  perform set_config('app.posting_receipt', '1', true);

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

  -- Close the trust window immediately after the receipts are posted. set_config(..., true) is
  -- transaction-scoped, so in production (one RPC = one transaction) it would reset at commit anyway;
  -- resetting it here additionally keeps the bypass from applying to any later receipt that happens to
  -- share the transaction (e.g. a batch caller, or a pgTAP test that runs many cases in one txn). The
  -- bypass is thus active ONLY across this PR's own claim-flipped receipt loop.
  perform set_config('app.posting_receipt', '0', true);

  return jsonb_build_object('pr_id', p_pr_id, 'items_posted', v_items, 'status', 'received');
end $$;

revoke all     on function public.fn_post_receipt(uuid) from public;
revoke execute on function public.fn_post_receipt(uuid) from anon;
grant  execute on function public.fn_post_receipt(uuid) to authenticated;
