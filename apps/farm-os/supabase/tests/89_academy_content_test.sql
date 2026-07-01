-- 89 — STAGE 10 (SPEC-0008): Care Academy content + the #4 sign-off gate (migration 20260701400000).
-- Verifies: academy.write maps to owner/agri_engineer only; the CRUD RPCs; that EDITING content RESETS
-- a prior sign-off (changed figures must be re-reviewed, #4); that a sign-off records a named agronomist;
-- that CHEMICAL content cannot be signed off without a CURRENT Egyptian pesticide registration; the
-- soft-delete posture; the audit; and that the RPC authorizes against the content's OWN org.
-- Impersonation via request.jwt.claims. Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(38);

\set org '00000000-0000-0000-0000-000000000001'
select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'owner' limit 1), false);
select set_config('test.eng', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'agri_engineer' limit 1), false);
select set_config('test.manager', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'farm_manager' limit 1), false);
select set_config('test.accountant', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'accountant' limit 1), false);
select set_config('test.sup', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'supervisor' limit 1), false);

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- ===== 1) academy.write = owner/agri_engineer only =====
select pg_temp.as_user(current_setting('test.eng'));
select is(public.authorize('academy.write', :'org'), true, 'academy.write: agri_engineer HAS it');
reset role;
select pg_temp.as_user(current_setting('test.sup'));
select is(public.authorize('academy.write', :'org'), false, 'academy.write: supervisor does NOT');
reset role;
select pg_temp.as_user(current_setting('test.owner'));
select is(public.authorize('export.write', :'org'), true, 'authorize union: owner keeps export.write');
select is(public.authorize('request.approve.final', :'org'), true, 'authorize union: owner keeps final payment approval');
reset role;
select pg_temp.as_user(current_setting('test.manager'));
select is(public.authorize('export.write', :'org'), true, 'authorize union: farm_manager keeps export.write');
select is(public.authorize('finance.read', :'org'), false, 'authorize union: farm_manager does NOT get finance.read');
select is(public.authorize('custody.write', :'org'), false, 'authorize union: farm_manager does NOT get custody.write');
select is(public.authorize('request.prepare', :'org'), false, 'authorize union: farm_manager does NOT get request.prepare');
select is(public.authorize('request.approve.op', :'org'), false, 'authorize union: farm_manager does NOT get operational payment approval');
reset role;
select pg_temp.as_user(current_setting('test.accountant'));
select is(public.authorize('finance.read', :'org'), true, 'authorize union: accountant keeps finance.read');
select is(public.authorize('custody.write', :'org'), true, 'authorize union: accountant keeps custody.write');
select is(public.authorize('request.prepare', :'org'), true, 'authorize union: accountant keeps request.prepare');
select is(public.authorize('request.approve.op', :'org'), true, 'authorize union: accountant keeps operational payment approval');
select is(public.authorize('request.approve.final', :'org'), false, 'authorize union: accountant does NOT get final payment approval');
reset role;
select pg_temp.as_user(current_setting('test.sup'));
select is(public.authorize('export.write', :'org'), false, 'authorize union: supervisor does NOT get export.write');
reset role;
select is(
  (select count(*)::int
     from unnest(array[
       'pr.approve', 'plan.write', 'op.execute', 'inventory.write', 'budget.write',
       'payroll.read', 'structure.write', 'academy.write', 'export.write', 'responsibility.write',
       'finance.read', 'custody.write', 'request.prepare', 'request.approve.op', 'request.approve.final'
     ]) as perm
     where position(perm in pg_get_functiondef('public.authorize(text, uuid)'::regprocedure)) = 0),
  0,
  'authorize union: academy re-emit preserves the full in-flight permission set');

-- ===== 2) agri_engineer creates content; it starts ADVISORY (no sign-off) =====
select pg_temp.as_user(current_setting('test.eng'));
select lives_ok(
  format($$ select set_config('test.c1',
    (public.fn_save_academy_content(null, %L, 'تسميد البرحي', 'NPK 2-1-3', 'npk', false))->>'id', false) $$, :'org'),
  'fn_save_academy_content: agri_engineer can create content');
select isnt(current_setting('test.c1'), '', 'create returned an id');
select is(
  (select agronomist_name from public.academy_content where id = current_setting('test.c1')::uuid),
  null, 'new content is ADVISORY (no agronomist sign-off)');
reset role;

-- ===== 3) a non-academy role (supervisor) cannot write — RPC + direct REST =====
select pg_temp.as_user(current_setting('test.sup'));
select throws_ok(
  format($$ select public.fn_save_academy_content(null, %L, 'لا يجب', 'x', 'general', false) $$, :'org'),
  '42501', null, 'fn_save_academy_content: a supervisor (no academy.write) is FORBIDDEN');
select throws_ok(
  format($$ update public.academy_content set title = 'مخترق' where id = %L $$, current_setting('test.c1')),
  '42501', null, 'direct-REST: a supervisor cannot PATCH academy content (academy.write RLS gate)');
reset role;

-- ===== 4) sign-off records a named agronomist; then EDITING RESETS it (#4) =====
select pg_temp.as_user(current_setting('test.eng'));
select lives_ok(
  format($$ select public.fn_signoff_academy_content(%L, 'م. أحمد الزراعي', now(), null) $$, current_setting('test.c1')),
  'fn_signoff_academy_content: records a named agronomist sign-off (non-chemical)');
select is(
  (select agronomist_name from public.academy_content where id = current_setting('test.c1')::uuid),
  'م. أحمد الزراعي', 'the sign-off persisted');
select lives_ok(
  format($$ select public.fn_save_academy_content(%L, null, 'تسميد البرحي (معدّل)', 'NPK 3-1-2', 'npk', false) $$,
    current_setting('test.c1')),
  'fn_save_academy_content: edit-in-place');
select is(
  (select agronomist_name from public.academy_content where id = current_setting('test.c1')::uuid),
  null, '#4: editing the figures RESET the sign-off → advisory again');
reset role;

-- ===== 5) CHEMICAL content needs a CURRENT Egyptian pesticide registration to sign off (#4) =====
select pg_temp.as_user(current_setting('test.eng'));
select set_config('test.c2',
  (public.fn_save_academy_content(null, :'org', 'مكافحة الحفّار', 'رش...', 'pesticide', true))->>'id', false);
select throws_ok(
  format($$ select public.fn_signoff_academy_content(%L, 'م. أحمد', now(), null) $$, current_setting('test.c2')),
  '23502', null, '#4: chemical content sign-off WITHOUT a registration expiry is rejected');
select throws_ok(
  format($$ select public.fn_signoff_academy_content(%L, 'م. أحمد', now(), current_date - 1) $$, current_setting('test.c2')),
  '22023', null, '#4: an EXPIRED pesticide registration is rejected');
select throws_ok(
  format($$ select public.fn_signoff_academy_content(%L, 'م. أحمد', now(), current_date + 365, null) $$, current_setting('test.c2')),
  '23502', null, '#4 audit trail: chemical sign-off WITHOUT the registration NUMBER is rejected');
select lives_ok(
  format($$ select public.fn_signoff_academy_content(%L, 'م. أحمد', now(), current_date + 365, 'EG-PEST-2026-04417') $$, current_setting('test.c2')),
  '#4: chemical content WITH a current registration + number signs off');
select is(
  (select pesticide_reg_number from public.academy_content where id = current_setting('test.c2')::uuid),
  'EG-PEST-2026-04417', '#4 audit trail: the registration NUMBER is stored on sign-off');
reset role;

-- ===== 5b) pesticide category can NEVER bypass the chemical gate via has_chemical=false (#4) =====
-- A caller with academy.write tries to author pesticide content but flag it non-chemical. The save must
-- FORCE has_chemical=true; signing it off with a null registration must then be rejected by the gate.
select pg_temp.as_user(current_setting('test.eng'));
select set_config('test.c3',
  (public.fn_save_academy_content(null, :'org', 'مكافحة المنّ', 'رش مبيد', 'pesticide', false))->>'id', false);
select is(
  (select has_chemical from public.academy_content where id = current_setting('test.c3')::uuid),
  true, '#4: pesticide content saved has_chemical=false is FORCED to true');
select throws_ok(
  format($$ select public.fn_signoff_academy_content(%L, 'م. أحمد', now(), null) $$, current_setting('test.c3')),
  '23502', null, '#4: forced-chemical pesticide content cannot be signed off without a registration');
-- the table CHECK is the last line of defense: a direct REST PATCH of pesticide → has_chemical=false fails.
select throws_ok(
  format($$ update public.academy_content set has_chemical = false where id = %L $$, current_setting('test.c3')),
  '23514', null, '#4: table CHECK rejects pesticide content with has_chemical=false');
reset role;

-- ===== 6) soft-delete + audit =====
select pg_temp.as_user(current_setting('test.eng'));
select lives_ok(
  format($$ select public.fn_archive_academy_content(%L, true) $$, current_setting('test.c1')),
  'fn_archive_academy_content: soft-delete');
-- hard DELETE is revoked from CLIENTS — assert under an AUTHENTICATED role (the grant-revoke targets
-- authenticated/anon, not the superuser test runner), so it both errors AND leaves the rows intact for
-- the cross-org check below (a superuser DELETE here would silently wipe c2).
select throws_ok(
  $$ delete from public.academy_content where true $$,
  '42501', null, 'academy_content: hard DELETE is revoked from clients (soft-delete only)');
reset role;
select is(
  (select archived from public.academy_content where id = current_setting('test.c1')::uuid),
  true, 'content archived (soft delete, row preserved)');
select cmp_ok(
  (select count(*)::int from public.audit_log
     where entity_type = 'academy_content' and entity_id = current_setting('test.c1')),
  '>=', 1, 'academy changes write an audit_log row');

-- ===== 7) the RPC authorizes against the content's OWN org (not the caller's other-org role) =====
-- the supervisor has academy.write in NO org here; even made an agri_engineer in a second org B, editing
-- an org-A row resolves v_org = A and authorizes there → forbidden.
\set orgB 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
insert into public.organization (id, name) values (:'orgB', 'مزرعة ب') on conflict (id) do nothing;
insert into public.organization_member (org_id, user_id, role)
  values (:'orgB', current_setting('test.sup')::uuid, 'agri_engineer');
select pg_temp.as_user(current_setting('test.sup'));
select throws_ok(
  format($$ select public.fn_save_academy_content(%L, null, 'مخترق', 'x', 'general', false) $$, current_setting('test.c2')),
  '42501', null, 'authz-by-row-org: a B-agronomist cannot edit an A-org content row');
reset role;

select * from finish();
rollback;
