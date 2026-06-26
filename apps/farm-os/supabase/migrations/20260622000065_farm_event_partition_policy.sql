-- Farm OS MVP-0 — #306 follow-up: re-emit the farm_event cross-org person-FK gate on EVERY PARTITION.
--
-- THE BUG (live on main after 0064). 0064 added the performed_by/assigned_to person-org check to
-- farm_event but re-emitted only the PARENT policy. farm_event is partitioned and its tenant_all policy
-- is created PER-PARTITION (migrations 0025/0035 loop over the parent + every partition) because
-- `authenticated` holds direct DML on the partition children. So after 0064 the children
-- (farm_event_2025_07/_08/_default) kept the prior policy WITHOUT the person check, and a direct
-- `POST /rest/v1/farm_event_2025_07` (or _default for any out-of-range date) with a cross-org person UUID
-- bypassed the new gate. (Confirmed in independent review of #309; the parent-only re-emit was approved
-- pre-fix and merged before the per-partition fix landed.) LOW severity — a member with op.execute can
-- attach an RLS-invisible foreign-org person to their own org's event (dangling reference, not
-- exfiltration) — but the gate must hold on the path it claims to.
--
-- THE FIX. Re-emit the policy on all four relations via the established loop, carrying the full current
-- clause set: org + authorize('op.execute', org_id) + the two person-FK `(is null or exists(...))`
-- checks. Columns are %I-qualified so the EXISTS correlation `pe.org_id = <rel>.org_id` binds to the
-- OUTER row (an unqualified org_id would resolve to pe.org_id and pass vacuously). Idempotent re-emit of
-- the parent (already gated by 0064) + the three children (newly gated).
do $$
declare t text;
begin
  foreach t in array array['farm_event','farm_event_2025_07','farm_event_2025_08','farm_event_default'] loop
    execute format('drop policy if exists tenant_all on public.%I', t);
    execute format($p$create policy tenant_all on public.%I for all to authenticated
      using (org_id in (select public.user_org_ids()))
      with check (
        org_id in (select public.user_org_ids())
        and public.authorize('op.execute', org_id)
        and (%I.performed_by_person_id is null
             or exists (select 1 from public.people pe
                        where pe.id = %I.performed_by_person_id and pe.org_id = %I.org_id))
        and (%I.assigned_to_person_id is null
             or exists (select 1 from public.people pe
                        where pe.id = %I.assigned_to_person_id and pe.org_id = %I.org_id))
      )$p$, t, t, t, t, t, t, t);
  end loop;
end $$;
