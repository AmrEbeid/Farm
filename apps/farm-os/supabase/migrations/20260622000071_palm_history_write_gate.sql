-- Farm OS MVP-0 — 360-review (security): gate palm_status_history writes on op.execute + same-org asset.
--
-- THE GAP (residual the 0049/0061-0064 sweep missed). palm_status_history.tenant_all (cmd=ALL) is
-- org-only on writes: `WITH CHECK (org_id IN user_org_ids())` with NO role gate and NO cross-org asset
-- validation. The intended writer is the SECURITY DEFINER fn_update_palm_status (0039), which requires
-- authorize('op.execute') and runs as the BYPASSRLS owner — so it is unaffected by RLS. But the org-only
-- policy lets ANY authenticated org member (e.g. accountant/storekeeper, no op.execute) INSERT history
-- rows directly via PostgREST, and set asset_id to ANOTHER org's asset (the FK only checks existence) —
-- forging a palm-history timeline and planting a cross-org reference. Same class as the 0049 assets fix
-- and the 0061-0064 cross-org FK sweep, on the one log table they did not cover.
--
-- THE FIX. Re-emit tenant_all adding to the WITH CHECK: `authorize('op.execute', org_id)` (matches the
-- DEFINER writer's gate, same as assets 0049) AND a same-org asset EXISTS (matches the cross-org sweep).
-- USING stays org-only → reads unaffected (org members still see their org's history). The DEFINER fn
-- bypasses RLS, so the legitimate write path is untouched; only the direct-REST hole closes. DELETE is
-- already revoked org-wide for log tables; grants unchanged. Prod has 0 cross-org rows (log is seed-empty).

drop policy if exists tenant_all on public.palm_status_history;
create policy tenant_all on public.palm_status_history for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('op.execute', org_id)
    and exists (select 1 from public.assets a
                where a.id = palm_status_history.asset_id and a.org_id = palm_status_history.org_id)
  );
