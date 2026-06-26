-- Farm OS MVP-0 — #235/#308 note: gate inventory_items WRITES on inventory.write (intra-tenant authz).
--
-- THE GAP. inventory_items' tenant_all policy is org-only on writes — any authenticated org member
-- (agri_engineer, supervisor, accountant, …) can INSERT/UPDATE/DELETE an item via PostgREST. That edits
-- ENGINE INPUTS: min_stock, safety_stock, pack_size, lead_time_days feed fn_stock_coverage's reorder
-- point (round(daily*lead + safety_stock)) and pack rounding — so a non-inventory member can distort the
-- purchase recommendation (raise safety_stock to force over-ordering, or zero it to suppress a reorder),
-- or create/rename bogus items. inventory_movements/bin are already gated on authorize('inventory.write')
-- (owner/farm_manager/storekeeper, migration 0001/0016); the item master was missed.
--
-- THE FIX. Re-emit tenant_all adding `and public.authorize('inventory.write', org_id)` to the WITH CHECK
-- only — mirroring the inventory ledger and the 0042 plan-requirements gate. USING stays org-only, so
-- every member can still READ the catalogue (they need it for coverage/PR screens); only writes are
-- gated. The 0063 cross-org preferred_supplier_id clause is preserved verbatim.

drop policy if exists tenant_all on public.inventory_items;
create policy tenant_all on public.inventory_items for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('inventory.write', org_id)
    and (inventory_items.preferred_supplier_id is null
         or exists (select 1 from public.suppliers sup
                    where sup.id = inventory_items.preferred_supplier_id and sup.org_id = inventory_items.org_id))
  );
