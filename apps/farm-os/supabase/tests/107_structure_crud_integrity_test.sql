-- 107 — #516 structure CRUD integrity (migration 20260701160000). Three decision-free fixes:
--   (1) restoring a sector un-archives a hawsha-only palm (null sector_id) it archived via the hawsha branch
--   (2) editing a hawsha without row_count preserves it (coalesce, like the palm counts)
--   (3) creating a hawsha under an ARCHIVED sector is rejected
-- Fixtures inserted directly (superuser); behaviors exercised through the RPCs as a farm_manager.
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(3);

\set org '00000000-0000-0000-0000-000000000001'
\set S 'd0000000-0000-0000-0000-000000000516'
\set H 'd0000000-0000-0000-0000-000000000616'
\set P 'd0000000-0000-0000-0000-000000000716'

select set_config('t.mgr', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'farm_manager' limit 1), false);
select set_config('t.farm', (select id::text from public.farms where org_id = :'org' order by code limit 1), false);

insert into public.sectors (id, org_id, farm_id, name, code)
  values (:'S', :'org', current_setting('t.farm')::uuid, 'قطاع #516', 'SEC-516');
insert into public.hawshat (id, org_id, sector_id, name, code, row_count)
  values (:'H', :'org', :'S', 'حوشة #516', 'HAW-516', 5);
-- a palm with a hawsha under the sector but NULL sector_id (the bulk-import case)
insert into public.assets (id, org_id, type, hawsha_id, sector_id, name)
  values (:'P', :'org', 'palm', :'H', null, 'نخلة #516');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- (2) edit the hawsha WITHOUT row_count → must be preserved (not nulled)
select pg_temp.as_user(current_setting('t.mgr'));
select set_config('t.i', public.fn_save_hawsha(:'H', null, 'حوشة #516 معدّلة', 'HAW-516')::text, false);
reset role;
select is((select row_count from public.hawshat where id = :'H'), 5,
  '#516-2: editing a hawsha without row_count preserves it (coalesce)');

-- (1) archive the sector (cascades the palm via its hawsha), then restore → the palm is un-archived
select pg_temp.as_user(current_setting('t.mgr'));
select set_config('t.i', public.fn_archive_structure('sector', :'S', true)::text, false);
select set_config('t.i', public.fn_archive_structure('sector', :'S', false)::text, false);
reset role;
select is((select archived from public.assets where id = :'P'), false,
  '#516-1: restoring a sector un-archives a hawsha-only (null sector_id) palm');

-- (3) creating a hawsha under an ARCHIVED sector is rejected
select pg_temp.as_user(current_setting('t.mgr'));
select set_config('t.i', public.fn_archive_structure('sector', :'S', true)::text, false);
select throws_ok(
  format($$ select public.fn_save_hawsha(null, %L, 'حوشة جديدة', 'HAW-NEW') $$, :'S'),
  '22023', null, '#516-3: cannot create a hawsha under an archived sector');
reset role;

select * from finish();
rollback;
