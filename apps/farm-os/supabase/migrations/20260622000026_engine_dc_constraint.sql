-- Farm OS MVP-0 — ENGINE-DC: a DB-level guard for the engine's double-count invariant (migration 0018).
--
-- Migration 0018 fixed the stock-coverage double-count by making the two supply sources DISJOINT by
-- construction (docs/SECURITY-FINDING-engine-receipt-doublecount-2026-06-25.md):
--   * on_hand            = Σ(receipt movements)         — received-to-date     (fn_bin_rebuild)
--   * forward projection = APPROVED-not-received PRs     — genuinely-future supply (fn_stock_coverage)
-- The whole model hinges on the HAND-OFF at receipt (pinned by tests 14/16): when a PO is received it
-- flips 'approved'→'received' (so it LEAVES the forward projection) at the SAME moment a receipt
-- movement lands in on_hand (so it ENTERS the opening). fn_post_receipt (migration 0024) does exactly
-- this, claim-first: it sets the PR 'received' BEFORE posting any receipt movement, in one transaction.
--
-- Today that disjointness is CONVENTION-enforced — it relies on every receipt path flipping the PR
-- first. A direct receipt (e.g. /rest/v1/inventory_movements, or a future code path) posted while its
-- PO is still 'approved' would put the quantity in on_hand AND keep it projected forward → the exact
-- double-count 0018 set out to kill, silently re-masking a real shortage (SPEC-0001 #1 risk).
--
-- GUARD (matches the SECURITY DEFINER + pinned-search_path trigger style of migration 0017): a
-- BEFORE INSERT trigger on inventory_movements, firing only for type='receipt', that rejects the
-- insert when an APPROVED-but-not-yet-received purchase request still exists for the SAME (org, item).
-- That is precisely the double-count state — the qty would be counted once in on_hand and again in the
-- forward projection. The trigger turns the engine's disjointness invariant into a hard DB control.
--
-- Why a trigger (not a CHECK/partial-unique): the invariant is cross-row across two tables
-- (inventory_movements × purchase_requests) and conditional on PR status, which a column CHECK or a
-- partial-unique index cannot express. A trigger is the minimal control that can read the related-PR
-- state at insert time.
--
-- Safe for the legitimate path: fn_post_receipt flips the PR to 'received' BEFORE its receipt
-- movements insert, so by the time this trigger fires no 'approved' PR remains for the item → it
-- passes (verified by tests 16 + 23). A receipt with NO matching PR (manual adjustment / opening
-- stock) also passes (test 14). Non-receipt movements (issue/return/adjustment/…) are untouched. The
-- only thing rejected is the orphan/double-count state itself.
--
-- SECURITY DEFINER + pinned empty search_path, fully schema-qualified, mirroring migrations 0017/0023.
create or replace function public.inv_guard_receipt_no_open_po()
returns trigger
language plpgsql
security definer
set search_path to ''
as $fn$
begin
  -- Only receipts can enter on_hand as "received supply"; everything else is irrelevant to the
  -- engine's scheduled-receipt projection, so leave those movements alone.
  if new.type <> 'receipt' then
    return new;
  end if;

  -- ENGINE-DC invariant: a received qty must be in on_hand XOR projected as an open PO, never both.
  -- If an APPROVED-not-received PR for this (org, item) still exists at the instant a receipt lands,
  -- the qty would be double-counted (on_hand + forward projection). The correct path (fn_post_receipt)
  -- flips that PR to 'received' first, so this never trips for the legitimate roundtrip.
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
      'ENGINE-DC: cannot post a receipt for item % while an approved purchase request for it is still open — receive the PO (approved→received) first so on_hand and the scheduled-receipt projection stay disjoint',
      new.item_id
      using errcode = '23514';   -- check_violation: the disjointness invariant is breached
  end if;

  return new;
end
$fn$;

create trigger inv_guard_receipt_no_open_po
  before insert on public.inventory_movements
  for each row
  execute function public.inv_guard_receipt_no_open_po();

-- Lock the trigger function down (migration 0021 precedent + INV-2 in test 22): a trigger function is
-- never invoked directly, so no client role may hold EXECUTE. Revoke from PUBLIC *and* anon/
-- authenticated to defeat the Supabase default-privilege auto-grant on functions created in public.
revoke execute on function public.inv_guard_receipt_no_open_po() from public, anon, authenticated;
