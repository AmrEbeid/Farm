-- Farm OS MVP-0 — B2.1 completion: make the stock ledger fully append-only (no client UPDATE).
--
-- Migration 0016 revoked DELETE on inventory_movements/inventory_bin, but UPDATE was still granted
-- (the prod-push assurance flagged this: "append-only" was DELETE-only). Any inventory.write role
-- could `UPDATE inventory_movements SET qty=...` via REST and forge/erase stock without a trace.
--
-- Fix: REVOKE UPDATE from authenticated|anon on both tables, symmetric to the 0016 DELETE revoke.
-- INSERT stays gated (0015 role policy) so the ledger is genuinely append-only: rows can be added by
-- inventory.write roles but never mutated or removed by any client.
--
-- Safe — no legitimate client path updates these tables:
--   * the running balance (inventory_bin) and all ledger rows are written by fn_post_movement /
--     fn_bin_rebuild (SECURITY DEFINER, owner = postgres → unaffected by these client revokes);
--   * corrections are compensating movements (new INSERTs), never in-place edits;
--   * reads stay fully open to the org (tenant policy USING untouched);
--   * service_role + table owner keep their grants.
revoke update on public.inventory_movements from authenticated, anon;
revoke update on public.inventory_bin        from authenticated, anon;
