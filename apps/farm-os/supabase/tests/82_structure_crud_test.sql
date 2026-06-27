-- 50 — STRUCT-1: editable farm structure (sectors/hawshat/lines/palms) + node media.
-- Verifies migrations 0051–0053: the structure.write role gate (owner/farm_manager), the create/edit
-- CRUD RPCs, the cascading soft-delete/restore (rows preserved), the direct-REST gate, the op.execute
-- node-media RPCs, the soft-delete posture on attachments, and that structural writes are audited.
-- op.execute = owner/farm_manager/agri_engineer/supervisor; structure.write = owner/farm_manager only.
-- Impersonation via request.jwt.claims. Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(35);

\set org '00000000-0000-0000-0000-000000000001'
select set_config('test.farm', (select id::text from public.farms
  where org_id = :'org' order by code limit 1), false);
-- members, one per role (the seed has exactly one of each).
select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'owner' limit 1), false);
select set_config('test.mgr', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'farm_manager' limit 1), false);
select set_config('test.sup', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'supervisor' limit 1), false);
select set_config('test.sk', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'storekeeper' limit 1), false);
select set_config('test.palm', (select id::text from public.assets
  where org_id = :'org' and type = 'palm' order by id limit 1), false);

select isnt(current_setting('test.farm'), '', 'fixture: a farm exists in orgA');

-- ===== 1) structure.write maps to owner/farm_manager only =====
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select pg_temp.as_user(current_setting('test.mgr'));
select is(public.authorize('structure.write', :'org'), true,
  'structure.write: farm_manager HAS it');
reset role;
select pg_temp.as_user(current_setting('test.sup'));
select is(public.authorize('structure.write', :'org'), false,
  'structure.write: supervisor does NOT (op.execute only)');
reset role;
select pg_temp.as_user(current_setting('test.sk'));
select is(public.authorize('structure.write', :'org'), false,
  'structure.write: storekeeper does NOT');
reset role;

-- ===== 2) create the full chain as a farm_manager (the legit author) =====
select pg_temp.as_user(current_setting('test.mgr'));

select lives_ok(
  format($$ select set_config('test.newsec',
    (public.fn_save_sector(null, %L, 'قطاع اختبار', 'TST', 'نخيل برحي', null, null, null))->>'id', false) $$,
    current_setting('test.farm')),
  'fn_save_sector: farm_manager can CREATE a sub-farm (sector)');
select isnt(current_setting('test.newsec'), '', 'create returned a new sector id');

select lives_ok(
  format($$ select set_config('test.newhaw',
    (public.fn_save_hawsha(null, %L, 'حوشة اختبار', 'TST-H01', 5, 4, 100, 6, null, null))->>'id', false) $$,
    current_setting('test.newsec')),
  'fn_save_hawsha: create a hawsha under the new sector');

select lives_ok(
  format($$ select set_config('test.newline',
    (public.fn_save_line(null, %L, 1, 'TST-H01-L01', 10, null, null))->>'id', false) $$,
    current_setting('test.newhaw')),
  'fn_save_line: create a line under the new hawsha');

-- L3: two ACTIVE lines can't share a line_no within one hawsha (partial-unique index, migration 0078).
select throws_ok(
  format($$ select public.fn_save_line(null, %L, 1, 'DUP', null, null, null) $$, current_setting('test.newhaw')),
  '23505', null,
  'fn_save_line: a duplicate line_no in the same hawsha is rejected (unique within an active hawsha)');

select lives_ok(
  format($$ select set_config('test.newpalm',
    (public.fn_save_palm(null, %L, %L, 'نخلة اختبار', 'برحي', 'female', 'TST-P001', null, 'good'))->>'id', false) $$,
    current_setting('test.newhaw'), current_setting('test.newline')),
  'fn_save_palm: create a single palm under the new hawsha/line');

select is(
  (select status from public.assets where id = current_setting('test.newpalm')::uuid),
  'active', 'a newly created palm starts active (status via fn_update_palm_status, not here)');
select is(
  (select type from public.assets where id = current_setting('test.newpalm')::uuid),
  'palm', 'a newly created palm has type=palm');

-- registry preservation (fn_save_hawsha coalesce fix): editing a hawsha WITHOUT resupplying counts must
-- NOT erase the canonical palm_count_barhi/male (non-negotiable #5). The hawsha was created with barhi=100.
select lives_ok(
  format($$ select public.fn_save_hawsha(%L, null, 'حوشة اختبار (معدّلة)', 'TST-H01', null, null, null, null, null, null) $$,
    current_setting('test.newhaw')),
  'fn_save_hawsha: edit-in-place without resupplying the palm counts');
select is(
  (select palm_count_barhi from public.hawshat where id = current_setting('test.newhaw')::uuid),
  100, 'canonical barhi count PRESERVED on a count-less edit (coalesce — not nulled)');

-- edit-in-place: rename the sector
select lives_ok(
  format($$ select public.fn_save_sector(%L, null, 'قطاع اختبار (معدّل)', 'TST', null, null, null, null) $$,
    current_setting('test.newsec')),
  'fn_save_sector: edit-in-place (rename) works');
select is(
  (select name from public.sectors where id = current_setting('test.newsec')::uuid),
  'قطاع اختبار (معدّل)', 'the sector rename persisted');

reset role;

-- ===== 3) a non-structure role (supervisor) cannot create/edit structure =====
select pg_temp.as_user(current_setting('test.sup'));
select throws_ok(
  format($$ select public.fn_save_sector(null, %L, 'لا يجب', 'NO') $$, current_setting('test.farm')),
  '42501', null,
  'fn_save_sector: a supervisor (no structure.write) is FORBIDDEN');
-- direct REST is gated too (not just the RPC): the new structure.write WITH CHECK
select throws_ok(
  format($$ update public.sectors set name = 'مخترق' where id = %L $$, current_setting('test.newsec')),
  '42501', null,
  'direct-REST: a supervisor cannot PATCH a sector (structure.write RLS gate)');
-- fn_save_palm has the unique org-re-derivation path, so assert its role gate independently.
select throws_ok(
  format($$ select public.fn_save_palm(null, %L, null, 'لا يجب', 'برحي', 'female') $$, current_setting('test.newhaw')),
  '42501', null,
  'fn_save_palm: a supervisor (no structure.write) is FORBIDDEN');
reset role;

-- ===== 4) cascading soft-delete + PROVENANCE-AWARE restore (the documented restore hazard) =====
-- Remove ONE palm independently, THEN remove the whole sector. A later restore of the sector must bring
-- back the cascade-removed nodes but NOT resurrect the independently-removed palm.
select pg_temp.as_user(current_setting('test.mgr'));
select lives_ok(
  format($$ select public.fn_archive_structure('palm', %L, true) $$, current_setting('test.newpalm')),
  'fn_archive_structure: remove a single palm independently first');
select lives_ok(
  format($$ select public.fn_archive_structure('sector', %L, true) $$, current_setting('test.newsec')),
  'fn_archive_structure: remove the whole sector (cascade)');
reset role;

select is(
  (select archived from public.hawshat where id = current_setting('test.newhaw')::uuid),
  true, 'archive cascaded to the hawsha');
select is(
  (select archived from public.lines where id = current_setting('test.newline')::uuid),
  true, 'archive cascaded to the line');
select is(
  (select count(*)::int from public.assets where id = current_setting('test.newpalm')::uuid),
  1, 'the palm ROW is preserved (soft delete, not destroyed)');

-- M1: restoring a CHILD while its parent is still archived is refused (would orphan it as visible).
select pg_temp.as_user(current_setting('test.mgr'));
select throws_ok(
  format($$ select public.fn_archive_structure('hawsha', %L, false) $$, current_setting('test.newhaw')),
  'PT001', null,
  'fn_archive_structure: cannot restore a hawsha while its parent sector is archived (no orphan-visible node)');
reset role;

select pg_temp.as_user(current_setting('test.mgr'));
select lives_ok(
  format($$ select public.fn_archive_structure('sector', %L, false) $$, current_setting('test.newsec')),
  'fn_archive_structure: restore the sector');
reset role;

select is(
  (select archived from public.lines where id = current_setting('test.newline')::uuid),
  false, 'restore brought back the cascade-removed line');
select is(
  (select archived from public.hawshat where id = current_setting('test.newhaw')::uuid),
  false, 'restore brought back the cascade-removed hawsha');
select is(
  (select archived from public.assets where id = current_setting('test.newpalm')::uuid),
  true, 'PROVENANCE: the independently-removed palm STAYS removed after a parent restore');

-- ===== 5) node media: op.execute can attach; storekeeper cannot; delete is revoked =====
select pg_temp.as_user(current_setting('test.sup'));
select lives_ok(
  format($$ select public.fn_add_attachment('palm', %L, %L, 'photo', 'صورة الإصابة', 'image/jpeg', 12345) $$,
    current_setting('test.palm'), :'org' || '/palm/' || current_setting('test.palm') || '/a.jpg'),
  'fn_add_attachment: a supervisor (op.execute) can attach a photo to a palm');
reset role;

select pg_temp.as_user(current_setting('test.sk'));
select throws_ok(
  format($$ select public.fn_add_attachment('palm', %L, 'x/y/z.jpg', 'photo') $$, current_setting('test.palm')),
  '42501', null,
  'fn_add_attachment: a storekeeper (no op.execute) is FORBIDDEN');
select throws_ok(
  $$ delete from public.attachments where true $$,
  '42501', null,
  'attachments: hard DELETE is revoked from clients (soft-delete only)');
reset role;

-- ===== 6) structural writes are audited =====
select cmp_ok(
  (select count(*)::int from public.audit_log
     where entity_type = 'sector' and entity_id = current_setting('test.newsec')),
  '>=', 1, 'a structural change writes an audit_log row');

-- ===== 7) cross-org isolation: a B-org manager cannot re-parent an A-org palm (fn_save_palm org guard) =====
-- The HIGH bug: fn_save_palm edit re-derived org from the TARGET hawsha, so a B-member could hijack an
-- A-palm by passing a B-hawsha. The fix authorizes against the palm's OWN org + forbids a cross-org move.
\set orgB 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
insert into public.organization (id, name) values (:'orgB', 'مزرعة ب') on conflict (id) do nothing;
-- reuse the existing org-A storekeeper as a farm_manager in org B (avoids an auth.users FK for a fake user):
-- in B they HAVE structure.write, in A they do NOT — so editing an A-palm must be blocked by the fixed
-- palm-own-org authorize, NOT allowed via the target-B-org. This is exactly the HIGH bug's discriminator.
insert into public.organization_member (org_id, user_id, role)
  values (:'orgB', current_setting('test.sk')::uuid, 'farm_manager');
insert into public.farms (id, org_id, name, code)
  values ('b0000000-0000-0000-0000-0000000000f0', :'orgB', 'مزرعة ب', 'FB');
insert into public.sectors (id, org_id, farm_id, name, code)
  values ('b0000000-0000-0000-0000-0000000000c0', :'orgB', 'b0000000-0000-0000-0000-0000000000f0', 'قطاع ب', 'SB');
insert into public.hawshat (id, org_id, sector_id, name, code, palm_count_barhi, palm_count_male)
  values ('b0000000-0000-0000-0000-0000000000a0', :'orgB', 'b0000000-0000-0000-0000-0000000000c0', 'حوشة ب', 'HB', 0, 0);

select pg_temp.as_user(current_setting('test.sk'));
select throws_ok(
  format($$ select public.fn_save_palm(%L, 'b0000000-0000-0000-0000-0000000000a0', null, 'مخترق', 'برحي', 'female') $$,
    current_setting('test.palm')),
  '42501', null,
  'cross-org: a B-manager CANNOT re-parent an A-palm into a B-hawsha (fn_save_palm org guard)');
reset role;
select is(
  (select org_id::text from public.assets where id = current_setting('test.palm')::uuid),
  :'org', 'the A-palm is untouched (still org A) after the blocked cross-org attempt');

select * from finish();
rollback;
