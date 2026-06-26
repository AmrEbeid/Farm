-- Farm OS MVP-0 — #235: a purchase-request line must order a positive, non-null quantity.
--
-- THE BUG. purchase_request_items.qty has no positivity CHECK (only received_qty has
-- `received_qty >= 0 and (qty is null or received_qty <= qty)`, migration 0045). A line with qty <= 0 is
-- accepted, but it permanently breaks fulfillment: fn_post_receipt computes the remaining as
-- `qty - received_qty` and posts a movement of that amount, so a 0/negative qty posts a 0/negative
-- movement and fn_post_movement raises (22023), rolling the whole receipt back. The PR can be
-- created/submitted/approved and is then UN-RECEIVABLE forever (the 0050 lock blocks edits once
-- decided). Found in #235.
--
-- THE FIX. Add CHECK (qty > 0) — strictly `> 0` (unlike the plan-input columns' `>= 0` in 0054): a PR
-- line that orders zero is not a benign no-op here, it is the un-receivable state. Prod has 0
-- non-positive rows (verified), so the CHECK validates immediately.
--
-- SCOPE NOTE: deliberately NOT a NOT NULL constraint. A NULL qty is the same un-receivable class, but
-- (a) it already fails SAFELY — fn_post_receipt coalesces NULL→0 and the receipt rolls back atomically
-- (proven by tests/23 RCP-ATOMIC-1, which uses a NULL-qty line precisely to exercise that mid-loop
-- rollback), (b) the app never writes a NULL qty (createPurchaseRequestFromShortage always passes a
-- numeric recommendQty), and (c) a CHECK is satisfied on NULL, so this CHECK leaves the NULL path — and
-- that atomicity fixture — untouched. Forbidding NULL would require migrating tests/23's failure trigger
-- to an over-receipt path; tracked as a follow-up, not bundled here.

alter table public.purchase_request_items
  add constraint pri_qty_positive check (qty > 0);
