-- Farm OS MVP-0 — #270 H3: gate assets writes on op.execute (close the assets.status bypass).
--
-- THE BUG (live on prod 0047). The `assets` tenant_all policy (0012) is org-scoped only, with NO role
-- gate. So a member WITHOUT op.execute (accountant/storekeeper) can PATCH /rest/v1/assets?id=eq.<palm>
-- {"status":"active"|"dead"} directly: USING + WITH CHECK pass (a status-only change leaves the FK
-- columns untouched), the status flips with no role gate AND no palm_status_history row — exactly the
-- two harms migration 0039's fn_update_palm_status claims to close (#238). 0039 added the gated RPC but
-- left the table itself unguarded, so the direct-REST path bypasses it.
--
-- THE FIX. Re-emit assets tenant_all adding `and public.authorize('op.execute', org_id)` to the WITH
-- CHECK — same pattern as 0035/0042/0043/0044/0046. The app writes assets ONLY through the SECURITY
-- DEFINER fn_update_palm_status (0039), which bypasses RLS, so this is defense-in-depth closing the
-- direct-REST hole (no app path is affected — every other app reference to assets is a .select read).
--   * USING stays org-only → reads unaffected;
--   * the RLS-H1 parent-org EXISTS predicates (sector_id/hawsha_id/line_id, 0012) preserved verbatim;
--   * DELETE already revoked (0027); grants unchanged.
-- op.execute = owner/farm_manager/agri_engineer/supervisor (0001) — the field-operation authority, which
-- is exactly what fn_update_palm_status enforces (0039), so the gate matches the intended writer.

drop policy if exists tenant_all on public.assets;
create policy tenant_all on public.assets for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('op.execute', org_id)
    and (sector_id is null or exists (select 1 from public.sectors s where s.id = assets.sector_id and s.org_id = assets.org_id))
    and (hawsha_id is null or exists (select 1 from public.hawshat h where h.id = assets.hawsha_id and h.org_id = assets.org_id))
    and (line_id   is null or exists (select 1 from public.lines   l where l.id = assets.line_id   and l.org_id = assets.org_id))
  );
