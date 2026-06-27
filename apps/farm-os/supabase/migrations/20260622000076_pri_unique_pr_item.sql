-- Farm OS MVP-0 — C1 (#270): purchase_request_items must hold AT MOST ONE line per (pr_id, item_id).
--
-- THE LATENT MASK. fn_post_receipt (0045) matches the p_lines receive-qty AND bumps received_qty keyed
-- by item_id (not the line id). With TWO lines for the same item, the receive loop would post the
-- movement and bump received_qty ONCE PER LINE → DOUBLE-POSTING the received stock into on_hand. An
-- inflated on_hand makes fn_stock_coverage see more stock than exists → it can MASK a shortage
-- (non-negotiable #1). Today this is unreachable — the only line-creating path (the coverage→create-PR
-- action) inserts exactly one line per PR, and no live PR has duplicate-item lines — so the receipt
-- code's item_id keying is correct ONLY BECAUSE item-per-PR is de-facto unique. This constraint makes
-- that assumption EXPLICIT and enforced, so a future app path or direct-REST write can't silently
-- reintroduce the double-post.
--
-- NOTE (model): supplier_id is per-line, so "the same item from two suppliers in one PR" is conceivable
-- — but it is NOT supported today (the receipt keys by item_id and would double-post). Supporting it is
-- a SEPARATE feature that needs a line-id-keyed p_lines receipt contract; whoever builds that drops this
-- constraint as part of it. Until then, fail-fast at creation beats mask-at-receipt.
--
-- Safe to add: verified no existing row violates it (no duplicate (pr_id, item_id) pairs in live data).

alter table public.purchase_request_items
  add constraint purchase_request_items_pr_item_uniq unique (pr_id, item_id);
