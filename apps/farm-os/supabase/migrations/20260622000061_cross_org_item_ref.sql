-- Farm OS MVP-0 — #235: a line item may only reference an inventory item from its OWN org.
--
-- THE GAP (tenant-isolation). purchase_request_items and plan_material_requirements both carry an
-- item_id FK to inventory_items, and their tenant_all WITH CHECK verifies org_id + the PARENT row's org
-- (RLS-H1) — but NOT that item_id's item belongs to the same org. The FK only checks the item EXISTS, in
-- any org. So a member who knows a foreign org's item UUID can `POST /rest/v1/purchase_request_items`
-- (or plan_material_requirements) with their own org_id + their own parent + a CROSS-ORG item_id. The
-- row passes RLS. Downstream this is a cross-tenant integrity hazard: the receipt/coverage paths resolve
-- stock by item, so a forged cross-org item line can pull another tenant's item into this org's
-- procurement/projection. Found in #235 ("missing item ownership check → cross-org item line").
--
-- THE FIX. Re-emit each tenant_all policy adding one WITH CHECK clause — the item must be in the row's
-- org: `exists (inventory_items it where it.id = item_id and it.org_id = org_id)`. Mirrors the existing
-- parent-org EXISTS (RLS-H1). USING is unchanged (reads unaffected); all existing clauses preserved
-- verbatim. Prod has 0 cross-org lines (verified), so it is satisfied by all current rows. This gates
-- the DIRECT-REST surface (the app inserts PR items directly); the fn_add_plan_operation SECURITY
-- DEFINER RPC bypasses RLS, so it should validate p_item_id's org itself — tracked separately.

-- 1) purchase_request_items — re-emit from 0010 + the item-org clause
drop policy if exists tenant_all on public.purchase_request_items;
create policy tenant_all on public.purchase_request_items for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and exists (select 1 from public.purchase_requests pr
                where pr.id = purchase_request_items.pr_id and pr.org_id = purchase_request_items.org_id)
    and exists (select 1 from public.inventory_items it
                where it.id = purchase_request_items.item_id and it.org_id = purchase_request_items.org_id)
  );

-- 2) plan_material_requirements — re-emit from 0042 + the item-org clause
drop policy if exists tenant_all on public.plan_material_requirements;
create policy tenant_all on public.plan_material_requirements for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('plan.write', org_id)
    and exists (select 1 from public.plan_operations po
                where po.id = plan_material_requirements.plan_op_id and po.org_id = plan_material_requirements.org_id)
    and exists (select 1 from public.inventory_items it
                where it.id = plan_material_requirements.item_id and it.org_id = plan_material_requirements.org_id)
  );
