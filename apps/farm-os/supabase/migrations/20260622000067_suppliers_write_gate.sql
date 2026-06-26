-- Farm OS MVP-0 — gate suppliers WRITES on inventory.write (procurement authz + payment-detail integrity).
--
-- THE GAP. suppliers' tenant_all policy is org-only on writes — any authenticated org member can
-- INSERT/UPDATE a supplier, including its phone/terms (payment-relevant contact + payment terms). A
-- non-procurement member editing a supplier's contact/terms is a payment-redirect vector (the same trust
-- surface as the cross-org supplier_id refs closed in 0061/0063). suppliers belong to the procurement
-- domain — inventory_movements/bin/items are all gated on authorize('inventory.write')
-- (owner/farm_manager/storekeeper, 0001/0015/0016/0066); the supplier master is the last unguarded one.
--
-- THE FIX. Re-emit tenant_all adding `and public.authorize('inventory.write', org_id)` to the WITH CHECK
-- only. USING stays org-only so every member can still READ suppliers (needed for PR/coverage screens);
-- only writes are gated. No app member-write path exists (the app only reads suppliers; creation is
-- seed/admin via superuser), so no legitimate flow is affected — this hardens the direct-REST surface and
-- completes the procurement domain's uniform inventory.write posture.

drop policy if exists tenant_all on public.suppliers;
create policy tenant_all on public.suppliers for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('inventory.write', org_id)
  );
