-- Farm OS MVP-0 — #306 registry/structural tail: org-scope the remaining direct-REST member-writable
-- cross-org FKs (the farm-structure hierarchy, RACI/reports links, and plan links). LOW severity
-- (dangling references to RLS-invisible rows — not exfiltration or a shortage-mask; the engine's item_id
-- vector is already gated), but this leaves NO direct-REST member-writable FK able to point at another
-- tenant's row. Same `(<fk> is null or exists(<target> same-org))` pattern as 0061/0063/0064; the
-- `is null or` is harmless for NOT NULL columns and required for nullable ones. USING unchanged; every
-- existing WITH CHECK clause preserved verbatim. The 3 definer-RPC-written FKs (inventory_bin.item_id,
-- palm_status_history.asset_id, people_compensation.person_id) are a SEPARATE arm (the RPC must validate)
-- and are tracked on #306 — not in this direct-REST sweep.

-- farms — manager_person_id + owner_person_id → people
drop policy if exists tenant_all on public.farms;
create policy tenant_all on public.farms for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and (farms.manager_person_id is null
         or exists (select 1 from public.people pe where pe.id = farms.manager_person_id and pe.org_id = farms.org_id))
    and (farms.owner_person_id is null
         or exists (select 1 from public.people pe where pe.id = farms.owner_person_id and pe.org_id = farms.org_id))
  );

-- sectors — farm_id → farms
drop policy if exists tenant_all on public.sectors;
create policy tenant_all on public.sectors for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and (sectors.farm_id is null
         or exists (select 1 from public.farms f where f.id = sectors.farm_id and f.org_id = sectors.org_id))
  );

-- hawshat — sector_id → sectors
drop policy if exists tenant_all on public.hawshat;
create policy tenant_all on public.hawshat for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and (hawshat.sector_id is null
         or exists (select 1 from public.sectors s where s.id = hawshat.sector_id and s.org_id = hawshat.org_id))
  );

-- lines — hawsha_id → hawshat
drop policy if exists tenant_all on public.lines;
create policy tenant_all on public.lines for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and (lines.hawsha_id is null
         or exists (select 1 from public.hawshat h where h.id = lines.hawsha_id and h.org_id = lines.org_id))
  );

-- people.reports_to_person_id → people is DEFERRED: it is SELF-REFERENTIAL, and an RLS WITH CHECK gives
-- no NEW-row alias, so a subquery `from public.people pe` cannot unambiguously reference the new row's
-- org_id (it resolves to the inner pe → the check passes vacuously; verified empirically). The correct
-- mechanism for a self-referential org check is a BEFORE-INSERT/UPDATE trigger (which has NEW). LOW
-- severity (a cross-org reporting line is an org-chart oddity, RLS-invisible) — tracked on #306 for a
-- trigger-based follow-up rather than shipped vacuous here.

-- plan_operations — plan_id → plans (preserve org + plan.write + responsible_person FK from 0063)
drop policy if exists tenant_all on public.plan_operations;
create policy tenant_all on public.plan_operations for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('plan.write', org_id)
    and (plan_operations.responsible_person_id is null
         or exists (select 1 from public.people pe where pe.id = plan_operations.responsible_person_id and pe.org_id = plan_operations.org_id))
    and (plan_operations.plan_id is null
         or exists (select 1 from public.plans p where p.id = plan_operations.plan_id and p.org_id = plan_operations.org_id))
  );

-- purchase_requests — plan_id → plans. Its policies are the custom pr_select/pr_insert/pr_update/pr_delete
-- set (NOT tenant_all). plan_id is writable on INSERT and (in principle) UPDATE, so gate both WITH CHECKs.
drop policy if exists pr_insert on public.purchase_requests;
create policy pr_insert on public.purchase_requests for insert to authenticated
  with check (
    org_id in (select public.user_org_ids())
    and (plan_id is null
         or exists (select 1 from public.plans p where p.id = purchase_requests.plan_id and p.org_id = purchase_requests.org_id))
  );

-- pr_update: re-emit the F2/H4 gate (migration 0051) verbatim + the plan-org clause.
drop policy if exists pr_update on public.purchase_requests;
create policy pr_update on public.purchase_requests for update to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and (
      status <> 'approved'
      or ( public.authorize('pr.approve', org_id)
           and requested_by is distinct from (select auth.uid()) )
    )
    and (
      status not in ('partially_received', 'received')
      or (select auth.uid()) is null
      or coalesce(current_setting('app.posting_receipt', true), '') = '1'
    )
    and (plan_id is null
         or exists (select 1 from public.plans p where p.id = purchase_requests.plan_id and p.org_id = purchase_requests.org_id))
  );
