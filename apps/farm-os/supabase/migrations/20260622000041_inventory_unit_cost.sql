-- Farm OS — inventory_items.unit_cost: a manual standard cost source for PR estimates (#89, Option C).
--
-- #89 bug: createPurchaseRequestFromShortage stamped every PR line est_cost = qty * 84 — the
-- 84 EGP/kg potassium-sulfate price hardcoded for EVERY item. For any non-potassium item that
-- FABRICATES a cost, violating non-negotiable #1 ("never fabricate financial data").
--
-- Option C (Owner-recommended near-term source): a manually-maintained standard unit_cost per item.
-- Additive + nullable: NULL means "price unknown" — the app must then produce a NULL est_cost
-- rather than invent one. No fabricated constant anywhere.
--
-- A later SPEC-0004 slice may DERIVE unit_cost from the last-paid receipt cost (actuals); until
-- then this column is the honest, explicit standard cost an Owner enters by hand.
alter table public.inventory_items add column if not exists unit_cost numeric;

comment on column public.inventory_items.unit_cost is
  'Manually-maintained standard unit cost (currency per `unit`). NULL = price unknown — '
  'consumers MUST treat NULL as "no estimate" and never substitute a constant (non-negotiable #1, '
  '#89). A later SPEC-0004 slice may derive this from last-paid receipt cost.';
