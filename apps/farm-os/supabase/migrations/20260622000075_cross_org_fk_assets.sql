-- Farm OS MVP-0 — #306: two cross-org FKs the registry sweep MISSED (surfaced by the test-74 invariant
-- review — both proven exploitable by a live cross-org insert):
--   event_assets.asset_id → assets : event_assets' WITH CHECK gated only event_id, never asset_id, so a
--     member could link one of THEIR event_assets rows to a FOREIGN org's asset.
--   assets.parent_id → assets       : assets' WITH CHECK gated sector/hawsha/line but never parent_id, so
--     a member could give their asset a FOREIGN org's parent. SELF-REFERENTIAL — needs a trigger (RLS
--     WITH CHECK can't reference the new row of the same table; see 0071 for the reports_to template).
-- LOW severity (dangling references to RLS-invisible rows), but these are the exact cross-org-FK class the
-- work-stream closes, so the "every member-writable cross-org FK is validated" claim requires them.

-- event_assets.asset_id → assets (NOT NULL; preserve org + the existing event_id gate verbatim, add asset_id)
drop policy if exists tenant_all on public.event_assets;
create policy tenant_all on public.event_assets for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and exists (select 1 from public.farm_event e where e.id = event_assets.event_id and e.org_id = event_assets.org_id)
    and exists (select 1 from public.assets a where a.id = event_assets.asset_id and a.org_id = event_assets.org_id)
  );

-- assets.parent_id → assets (SELF-REFERENTIAL → trigger, mirroring people_reports_to_same_org/0071).
-- assets writes are op.execute-gated by the tenant_all WITH CHECK; this trigger adds only the parent-org
-- integrity check. SECURITY DEFINER + empty search_path; EXECUTE revoked (fires owner-context).
create or replace function public.assets_parent_same_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.parent_id is not null
     and not exists (select 1 from public.assets p where p.id = new.parent_id and p.org_id = new.org_id) then
    raise exception 'parent_id % is not in the same org as the asset', new.parent_id using errcode = '42501';
  end if;
  return new;
end
$fn$;

revoke execute on function public.assets_parent_same_org() from public, anon, authenticated;

create trigger assets_parent_same_org
  before insert or update on public.assets
  for each row execute function public.assets_parent_same_org();
