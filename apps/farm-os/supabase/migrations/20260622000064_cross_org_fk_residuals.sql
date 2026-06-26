-- Farm OS MVP-0 — #306 (residual tail): org-scope the remaining NULLABLE member-writable FK columns the
-- #308 review enumerated, completing the cross-org-FK tenant-isolation property. LOW severity (nullable
-- advisory tags; the referenced foreign-org row is RLS-invisible to the writer, so the exposure is a
-- dangling cross-org reference, not exfiltration), but closing them leaves no member-writable FK able to
-- point at another tenant's row. Same pattern as 0063/expenses: `(<fk> is null or exists(<target>
-- same-org))`. USING unchanged; every existing WITH CHECK clause preserved verbatim (org predicate,
-- role gate, parent-event/plan EXISTS). Prod has 0 cross-org references on these columns.

-- 1) quantities — material_id → inventory_items (preserve op.execute + parent-event EXISTS)
drop policy if exists tenant_all on public.quantities;
create policy tenant_all on public.quantities for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('op.execute', org_id)
    and exists (select 1 from public.farm_event e where e.id = quantities.event_id and e.org_id = quantities.org_id)
    and (quantities.material_id is null
         or exists (select 1 from public.inventory_items it where it.id = quantities.material_id and it.org_id = quantities.org_id))
  );

-- 2) event_followups — assigned_to_person_id → people (preserve parent-event EXISTS)
drop policy if exists tenant_all on public.event_followups;
create policy tenant_all on public.event_followups for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and exists (select 1 from public.farm_event e where e.id = event_followups.event_id and e.org_id = event_followups.org_id)
    and (event_followups.assigned_to_person_id is null
         or exists (select 1 from public.people pe where pe.id = event_followups.assigned_to_person_id and pe.org_id = event_followups.org_id))
  );

-- 3) event_locations — farm_id/sector_id/hawsha_id/line_id (preserve op.execute + parent-event EXISTS)
drop policy if exists tenant_all on public.event_locations;
create policy tenant_all on public.event_locations for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('op.execute', org_id)
    and exists (select 1 from public.farm_event e where e.id = event_locations.event_id and e.org_id = event_locations.org_id)
    and (event_locations.farm_id is null
         or exists (select 1 from public.farms f where f.id = event_locations.farm_id and f.org_id = event_locations.org_id))
    and (event_locations.sector_id is null
         or exists (select 1 from public.sectors s where s.id = event_locations.sector_id and s.org_id = event_locations.org_id))
    and (event_locations.hawsha_id is null
         or exists (select 1 from public.hawshat h where h.id = event_locations.hawsha_id and h.org_id = event_locations.org_id))
    and (event_locations.line_id is null
         or exists (select 1 from public.lines l where l.id = event_locations.line_id and l.org_id = event_locations.org_id))
  );

-- 4) plan_operations — responsible_person_id → people (preserve plan.write)
drop policy if exists tenant_all on public.plan_operations;
create policy tenant_all on public.plan_operations for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('plan.write', org_id)
    and (plan_operations.responsible_person_id is null
         or exists (select 1 from public.people pe where pe.id = plan_operations.responsible_person_id and pe.org_id = plan_operations.org_id))
  );

-- 5) farm_event (PARTITIONED parent — the policy applies to all partitions) — performed_by/assigned_to
drop policy if exists tenant_all on public.farm_event;
create policy tenant_all on public.farm_event for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('op.execute', org_id)
    and (farm_event.performed_by_person_id is null
         or exists (select 1 from public.people pe where pe.id = farm_event.performed_by_person_id and pe.org_id = farm_event.org_id))
    and (farm_event.assigned_to_person_id is null
         or exists (select 1 from public.people pe where pe.id = farm_event.assigned_to_person_id and pe.org_id = farm_event.org_id))
  );
