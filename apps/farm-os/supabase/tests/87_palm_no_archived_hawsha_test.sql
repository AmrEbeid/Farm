-- 87 — STRUCT data-integrity: fn_save_palm must not re-parent a palm into an ARCHIVED hawsha.
-- Gap (independent review 2026-06-27): on an EDIT (p_id not null) with a non-null p_hawsha_id, fn_save_palm
-- re-parents the palm to the target hawsha without checking archived. A live palm could be moved under an
-- archived hawsha and then vanish from every live view (which all filter archived=false) — a data-integrity
-- hole, not a tenant-isolation one (the cross-org guard, asserted in 82_structure_crud_test, is sound).
-- Verifies migration 20260622000087: the new guard rejects (22023) re-parenting into an archived hawsha,
-- still ALLOWS re-parent into a live hawsha, and does NOT block an in-place edit of a palm whose own hawsha
-- is archived (the guard is gated on p_hawsha_id, so it only fires on an explicit re-parent target).
-- Impersonation via request.jwt.claims. Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(9);

\set org '00000000-0000-0000-0000-000000000001'
select set_config('test.farm', (select id::text from public.farms
  where org_id = :'org' order by code limit 1), false);
select set_config('test.mgr', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'farm_manager' limit 1), false);

select isnt(current_setting('test.farm'), '', 'fixture: a farm exists in orgA');
select isnt(current_setting('test.mgr'), '', 'fixture: a farm_manager exists in orgA');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- ===== build a sector with three LIVE hawshat (A = home, B = to-archive, C = live re-parent target) =====
select pg_temp.as_user(current_setting('test.mgr'));

select set_config('test.sec',
  (public.fn_save_sector(null, current_setting('test.farm')::uuid, 'قطاع أرشفة', 'ARCH', null, null, null, null))->>'id', false);
select set_config('test.hawA',
  (public.fn_save_hawsha(null, current_setting('test.sec')::uuid, 'حوشة أ', 'ARCH-HA', null, null, 0, 0, null, null))->>'id', false);
select set_config('test.hawB',
  (public.fn_save_hawsha(null, current_setting('test.sec')::uuid, 'حوشة ب', 'ARCH-HB', null, null, 0, 0, null, null))->>'id', false);
select set_config('test.hawC',
  (public.fn_save_hawsha(null, current_setting('test.sec')::uuid, 'حوشة ج', 'ARCH-HC', null, null, 0, 0, null, null))->>'id', false);

select lives_ok(
  format($$ select set_config('test.palm',
    (public.fn_save_palm(null, %L, null, 'نخلة أرشفة', 'برحي', 'female'))->>'id', false) $$,
    current_setting('test.hawA')),
  'fn_save_palm: create a live palm under live hawsha A');

-- archive hawsha B so it becomes a non-live re-parent target
select lives_ok(
  format($$ select public.fn_archive_structure('hawsha', %L, true) $$, current_setting('test.hawB')),
  'fn_archive_structure: archive hawsha B');

-- ===== the guard: re-parenting the live palm into the ARCHIVED hawsha B is rejected =====
select throws_ok(
  format($$ select public.fn_save_palm(%L, %L, null, 'نخلة أرشفة', 'برحي', 'female') $$,
    current_setting('test.palm'), current_setting('test.hawB')),
  '22023', null,
  'fn_save_palm: re-parenting a palm into an ARCHIVED hawsha is rejected (22023)');

select is(
  (select hawsha_id::text from public.assets where id = current_setting('test.palm')::uuid),
  current_setting('test.hawA'),
  'the palm is untouched (still in hawsha A) after the blocked archived re-parent');

-- ===== positive control: re-parent into a LIVE hawsha C still works =====
select lives_ok(
  format($$ select public.fn_save_palm(%L, %L, null, 'نخلة أرشفة', 'برحي', 'female') $$,
    current_setting('test.palm'), current_setting('test.hawC')),
  'fn_save_palm: re-parenting into a LIVE hawsha C is allowed');
select is(
  (select hawsha_id::text from public.assets where id = current_setting('test.palm')::uuid),
  current_setting('test.hawC'),
  'the palm moved to live hawsha C');

-- ===== gating check: archiving the palm's OWN hawsha then an in-place edit (no target) is NOT blocked =====
-- archiving C cascades archived=true onto the palm; an edit with p_hawsha_id=null is not a re-parent, so the
-- new guard (gated on p_hawsha_id is not null) must leave it alone.
select public.fn_archive_structure('hawsha', current_setting('test.hawC')::uuid, true);
select lives_ok(
  format($$ select public.fn_save_palm(%L, null, null, 'نخلة معدّلة', 'برحي', 'female') $$,
    current_setting('test.palm')),
  'fn_save_palm: an in-place edit of a palm in an archived hawsha is NOT blocked (guard is re-parent-only)');

reset role;

select * from finish();
rollback;
