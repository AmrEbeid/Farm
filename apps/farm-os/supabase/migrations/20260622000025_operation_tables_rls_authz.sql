-- Farm OS MVP-0 — AUTHZ-1 Option B: REST-layer role gate on the operation tables.
--
-- Closes the residual surface left by SPEC-0002 Option A (migration 0020): the execution RPC
-- enforces `op.execute`, but the operation tables themselves kept the org-only `tenant_all` policy,
-- so ANY authenticated org member could still POST directly to /rest/v1/farm_event (or quantities /
-- event_locations) via PostgREST and forge a `done` operation — recording consumption + actuals —
-- WITHOUT op.execute, bypassing fn_execute_operation entirely. This migration adds the role check to
-- the WITH CHECK of these tables' write policies, mirroring the B2 inventory pattern in migration 0015.
--
-- Decision — which permission each table is gated to (verified against the app's server actions):
--   * farm_event (+ partition children), event_locations, quantities → `op.execute`.
--     ALL app writes to these go through fn_execute_operation (SECURITY DEFINER, bypassrls, migration
--     0020); the authenticated client only ever READS them (sector/PvA pages). So direct authenticated
--     writes are pure attack surface and are gated to op.execute — the same permission the RPC enforces.
--   * plan_operations → `plan.write` (NOT op.execute). The planning server action
--     `addPlanOperation` (app/(app)/plans/[planId]/actions.ts) INSERTs plan_operations directly with
--     the authenticated session client, app-layer gated to `plan.write` (owner/farm_manager). Gating
--     it to op.execute would (a) break authoring for the planning roles, and (b) wrongly let
--     agri_engineer/supervisor (op.execute but NOT plan.write) author plans via REST. So plan_operations
--     is gated to plan.write — matching the permission the app already requires.
--
-- USING (reads) stays org-only on every table so dashboards / the engine / sector + PvA pages are
-- unaffected for all org members. The role check lives in WITH CHECK, so it applies to INSERT/UPDATE
-- only (single FOR ALL policy, to keep PostgREST embedding happy — same shape as 0015). The
-- SECURITY DEFINER RPC path (fn_execute_operation) is unaffected — it bypasses RLS.
--
-- PRESERVES the RLS-H1 parent-org WITH CHECK that migration 0010 added to event_locations/quantities
-- (a child must reference a SAME-org farm_event). This migration ANDs the op.execute gate onto that
-- existing integrity check rather than replacing it. (Verifiable on plain Postgres as `authenticated`;
-- tests 05 / 24 pin RLS-H1, test 26 pins the role gate + the unaffected RPC path.)

-- farm_event + its partition children → op.execute. (A partition child queried directly does not
-- inherit the parent's policy, so each child is gated independently — same enumeration as 0004.
-- farm_event is the event spine itself: no parent-org EXISTS check applies, only org + op.execute.)
do $$
declare t text;
begin
  foreach t in array array['farm_event','farm_event_2025_07','farm_event_2025_08','farm_event_default'] loop
    execute format('drop policy if exists tenant_all on public.%I', t);
    execute format($p$create policy tenant_all on public.%I for all to authenticated
      using (org_id in (select public.user_org_ids()))
      with check (org_id in (select public.user_org_ids()) and public.authorize('op.execute'))$p$, t);
  end loop;
end $$;

-- event children (event_locations, quantities) → op.execute, KEEPING the RLS-H1 same-org parent-event
-- EXISTS check from migration 0010 (event_id has no FK — farm_event is partitioned — so the EXISTS is
-- the integrity boundary). New gate is ANDed onto it.
do $$
declare t text;
begin
  foreach t in array array['event_locations','quantities'] loop
    execute format('drop policy if exists tenant_all on public.%I', t);
    execute format($p$create policy tenant_all on public.%I for all to authenticated
      using (org_id in (select public.user_org_ids()))
      with check (
        org_id in (select public.user_org_ids())
        and public.authorize('op.execute')
        and exists (select 1 from public.farm_event e
                    where e.id = %I.event_id and e.org_id = %I.org_id)
      )$p$, t, t, t);
  end loop;
end $$;

-- plan_operations → plan.write (the planning flow writes this directly as the authenticated user; gate
-- to plan.write to match the app, NOT op.execute). org-only USING; no parent-org EXISTS check applies.
drop policy if exists tenant_all on public.plan_operations;
create policy tenant_all on public.plan_operations for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (org_id in (select public.user_org_ids()) and public.authorize('plan.write'));
