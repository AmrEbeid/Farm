-- Farm OS MVP-0 — 360-review (engine): non-negativity/positivity CHECKs on the inventory-item engine inputs.
--
-- THE GAP. inventory_items.safety_stock and pack_size (table def 0005) carry NO CHECK. fn_stock_coverage
-- (0055) trusts both: it adds safety_stock into the recommendation sizing and the warning threshold, and
-- divides/rounds the order quantity by pack_size. A NEGATIVE safety_stock can produce shortage=true with
-- recommend_qty=0 (the warning gate `PAB < v_ss` never trips when v_ss<0, and `greatest(0, maxdef+v_ss)`
-- zeroes the order) — a shortage-mask. A negative pack_size rounds the order DOWN (`ceil(raw/neg)*neg`),
-- under-ordering. Writes are role-gated (0066) but the gate governs WHO, not the VALUE SIGN. The TS mirror
-- (lib/stock-calc.ts) already floors pack at >0; the SQL is the outlier.
--
-- THE FIX. Mirror the 0054/0056 pattern: `safety_stock >= 0` (zero is a benign no-op; nullable kept — a
-- CHECK passes on NULL and the function coalesces NULL→0) and `pack_size > 0` (a non-positive pack is the
-- broken state; nullable kept — coalesce(nullif(pack_size,0),1) already maps NULL/0 → 1). Prod has 0
-- violating rows (verified 2026-06-26 via read-only probe), so both validate immediately. Named for clear
-- 23514 violation errors.

alter table public.inventory_items
  add constraint inventory_items_safety_stock_nonneg check (safety_stock is null or safety_stock >= 0);

alter table public.inventory_items
  add constraint inventory_items_pack_size_positive check (pack_size is null or pack_size > 0);
