-- Farm OS MVP-0 — B2: role-gate DIRECT writes to the stock tables.
--
-- Closes a real surface: with the org-only `tenant_all` policy, ANY authenticated org member
-- could POST to /rest/v1/inventory_movements (or inventory_bin) via the REST API and forge stock,
-- bypassing the app. Gate writes to `authorize('inventory.write')` (owner/farm_manager/storekeeper,
-- per migration 0001). Reads stay open to the org (USING) so dashboards/engine work for every role.
--
-- Safe post-B1/D2: ALL app inventory writes now go through `fn_post_movement` (SECURITY DEFINER,
-- bypassrls), so the receipt/issue/reserve/release flow — including execution by supervisors/
-- engineers who lack `inventory.write` — is unaffected. Only ad-hoc direct-table writes are gated.
-- (Single FOR ALL policy, not a SELECT/INSERT/UPDATE/DELETE split, to keep PostgREST embedding
-- happy; the role check lives in WITH CHECK so it applies to INSERT/UPDATE only.)
do $$
declare t text;
begin
  foreach t in array array['inventory_bin','inventory_movements'] loop
    execute format('drop policy if exists tenant_all on public.%I', t);
    execute format($p$create policy tenant_all on public.%I for all to authenticated
      using (org_id in (select public.user_org_ids()))
      with check (org_id in (select public.user_org_ids()) and public.authorize('inventory.write'))$p$, t);
  end loop;
end $$;
