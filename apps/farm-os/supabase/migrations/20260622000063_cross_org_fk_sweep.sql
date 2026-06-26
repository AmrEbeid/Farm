-- Farm OS MVP-0 — #306: extend the cross-org FK-reference validation (already present on `expenses`,
-- which org-checks every FK target) to the remaining member-writable tables that were missed.
--
-- THE GAP. After 0061/0062 closed item_id, four FK columns on tenant_all (member-writable) tables still
-- let a member reference a FOREIGN org's row by knowing its UUID (the FK checks existence in ANY org;
-- the WITH CHECK did not org-scope the target):
--   • purchase_request_items.supplier_id  → suppliers   (payment-redirect vector; same table as 0061)
--   • inventory_items.preferred_supplier_id → suppliers  (a foreign default supplier)
--   • plan_checks.plan_id                  → plans        (a check attached to a foreign plan)
--   • responsibility_assignments.person_id → people       (assign a foreign person to a responsibility)
--
-- THE FIX. Re-emit each tenant_all policy adding the same `(<fk> is null or exists(<target> same-org))`
-- clause `expenses` already uses (NOT NULL FKs omit the `is null or`). USING stays org-only (reads
-- unaffected); every existing WITH CHECK clause is preserved verbatim — purchase_request_items keeps its
-- 0061 pr-org + item-org EXISTS. Prod has 0 cross-org references on these columns. This is the
-- direct-REST arm; definer RPCs that write these tables should validate the FK org themselves (cf 0062).

-- 1) purchase_request_items — preserve 0061 (org + pr-org + item-org), add supplier-org (nullable)
drop policy if exists tenant_all on public.purchase_request_items;
create policy tenant_all on public.purchase_request_items for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and exists (select 1 from public.purchase_requests pr
                where pr.id = purchase_request_items.pr_id and pr.org_id = purchase_request_items.org_id)
    and exists (select 1 from public.inventory_items it
                where it.id = purchase_request_items.item_id and it.org_id = purchase_request_items.org_id)
    and (purchase_request_items.supplier_id is null
         or exists (select 1 from public.suppliers sup
                    where sup.id = purchase_request_items.supplier_id and sup.org_id = purchase_request_items.org_id))
  );

-- 2) inventory_items — org-only + preferred_supplier-org (nullable)
drop policy if exists tenant_all on public.inventory_items;
create policy tenant_all on public.inventory_items for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and (inventory_items.preferred_supplier_id is null
         or exists (select 1 from public.suppliers sup
                    where sup.id = inventory_items.preferred_supplier_id and sup.org_id = inventory_items.org_id))
  );

-- 3) plan_checks — org-only + plan-org (NOT NULL)
drop policy if exists tenant_all on public.plan_checks;
create policy tenant_all on public.plan_checks for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and exists (select 1 from public.plans p
                where p.id = plan_checks.plan_id and p.org_id = plan_checks.org_id)
  );

-- 4) responsibility_assignments — org-only + person-org (NOT NULL)
drop policy if exists tenant_all on public.responsibility_assignments;
create policy tenant_all on public.responsibility_assignments for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and exists (select 1 from public.people pe
                where pe.id = responsibility_assignments.person_id and pe.org_id = responsibility_assignments.org_id)
  );
