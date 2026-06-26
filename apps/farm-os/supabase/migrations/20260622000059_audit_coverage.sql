-- Farm OS MVP-0 — #235: extend audit coverage to financially-/fraud-sensitive tables that were
-- unaudited.
--
-- THE GAP. fn_audit triggers (0008/0019/0046) cover purchase_requests, budgets, budget_lines, expenses,
-- farm_event, inventory_movements, organization_member, people_compensation — but NOT the tables that
-- carry the PR's monetary substance and the procurement trust anchors:
--   • suppliers — a changed bank/phone/terms is a payment-redirect FRAUD vector with no trail;
--   • purchase_request_items — qty / received_qty are the order's money + the engine-trusted receipt
--     counter, mutable on a draft line with no record of what changed;
--   • inventory_items — min_stock / safety_stock / pack_size drive the coverage recommendation;
--   • responsibility_assignments — the RACI routing (who is accountable).
-- A tamper or mistake on any of these is currently invisible to the audit log.
--
-- THE FIX. Add the standard fn_audit AFTER-ROW trigger to each (singular entity_type, matching the
-- existing naming). SAFETY: each table's READ is org-only (tenant_all, no authorize() gate) with ALL
-- columns granted to authenticated (verified on prod) — so the audit mirror reveals nothing an org
-- member cannot already read, and the audit-leak invariant (tests/56) stays satisfied (none are
-- role-restricted, so no audit_read gate is required). `people` is DELIBERATELY EXCLUDED: its contact
-- PII (phone/email) is restricted via column-level GRANTS (0048), not RLS, so an audit mirror WOULD leak
-- it to org members and the tests/56 invariant (which keys on authorize() in the policy) would not catch
-- it — auditing people needs a column-aware redaction first (separate work).

create trigger audit_supplier
  after insert or update or delete on public.suppliers
  for each row execute function public.fn_audit('supplier');

create trigger audit_pr_item
  after insert or update or delete on public.purchase_request_items
  for each row execute function public.fn_audit('purchase_request_item');

create trigger audit_inventory_item
  after insert or update or delete on public.inventory_items
  for each row execute function public.fn_audit('inventory_item');

create trigger audit_responsibility
  after insert or update or delete on public.responsibility_assignments
  for each row execute function public.fn_audit('responsibility_assignment');
