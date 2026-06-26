-- Farm OS MVP-0 — #306: people_compensation.person_id must be a SAME-ORG person.
--
-- THE GAP. people_compensation's comp_rw policy gates read+write on payroll.read (owner/accountant) but
-- does NOT validate that person_id's person belongs to the row's org. So a payroll.read member could
-- direct-REST insert a compensation row with their own org_id + a CROSS-ORG person_id — attaching a wage
-- record (org = mine) to a foreign-org person. LOW severity (payroll.read is a high-trust role, the
-- foreign person is RLS-invisible, and there's no app write path — the only writer is the 0046 backfill),
-- but it is the last cross-org-FK gap reachable at the RLS layer (the other definer-RPC FKs —
-- inventory_bin.item_id, palm_status_history.asset_id — are validated by fn_post_movement /
-- fn_update_palm_status, which resolve the row's org from the item/asset and reject a cross-org caller).
--
-- THE FIX. Re-emit comp_rw adding the person-org EXISTS to the WITH CHECK only — unlike people.reports_to
-- this is NOT self-referential (people_compensation != people), so RLS can express it. USING unchanged
-- (payroll.read still gates reads — the H2/wage confidentiality); org + payroll.read preserved verbatim.
-- person_id is NOT NULL, so no `is null or` branch.

drop policy if exists comp_rw on public.people_compensation;
create policy comp_rw on public.people_compensation
  for all to authenticated
  using (
    org_id in (select public.user_org_ids())
    and public.authorize('payroll.read', org_id)
  )
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('payroll.read', org_id)
    and exists (select 1 from public.people pe
                where pe.id = people_compensation.person_id and pe.org_id = people_compensation.org_id)
  );
