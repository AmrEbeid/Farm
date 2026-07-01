-- 114 — agronomist-signoff-gate: plan_operations.signed_off_by/at + fn_sign_off_plan_operation +
-- the direct-REST spoofing guard + the un-sign-on-material-edit trigger (docs/CLAUDE.md non-negotiable
-- #4). Asserts: (a) a freshly-authored op is pending (both columns null); (b) only agronomy.signoff
-- holders (owner/agri_engineer — a REASONABLE DEFAULT, not the Owner's final word on sign-off
-- authority) can sign off, every other role is refused with 42501; (c) a successful sign-off stamps the
-- CALLER's linked person + now(), never a client-supplied value; (d) a direct-REST write that tries to
-- SET signed_off_by/at without agronomy.signoff is rejected by the guard trigger, while CLEARING it (the
-- safe direction) is not extra-gated; (d.1) the OTHER agronomy.signoff role can sign off a currently-
-- unsigned op, AND signing off an ALREADY-signed-off op is refused (22023, claim-first) rather than
-- silently re-stamping a new caller's identity/timestamp over the existing one (independent review
-- finding, 2026-07-01); (e) editing plan_material_requirements for a signed-off op clears its sign-off;
-- (f) cross-org rejection; (g) a non-existent op raises P0002.
-- Run via supabase test db or test-shims/run-pgtap-local.sh.

begin;
select plan(27);

-- ===== grants =====
select ok(not has_function_privilege('anon', 'public.fn_sign_off_plan_operation(uuid)', 'EXECUTE'),
  'agronomy-signoff: anon cannot EXECUTE fn_sign_off_plan_operation');
select ok(has_function_privilege('authenticated', 'public.fn_sign_off_plan_operation(uuid)', 'EXECUTE'),
  'agronomy-signoff: authenticated CAN EXECUTE fn_sign_off_plan_operation (the agronomy.signoff gate is internal)');

\set orgA    '00000000-0000-0000-0000-000000000001'
\set orgB    '20114000-0000-0000-0000-000000000b00'
\set plan    'd0114000-0000-0000-0000-000000000001'
\set opFert  'd0114000-0000-0000-0000-000000000002'
\set opIrri  'd0114000-0000-0000-0000-000000000003'
\set opSpoof 'd0114000-0000-0000-0000-000000000004'
\set item    'd0114000-0000-0000-0000-000000000005'
\set noOp    'd0114000-0000-0000-0000-000000000009'

select set_config('t.plan', :'plan', false);
select set_config('t.opFert', :'opFert', false);
select set_config('t.opIrri', :'opIrri', false);
select set_config('t.opSpoof', :'opSpoof', false);
select set_config('t.item', :'item', false);
select set_config('t.noOp', :'noOp', false);

-- actors: owner + agri_engineer HAVE agronomy.signoff; farm_manager/accountant/supervisor/storekeeper do NOT.
select set_config('t.owner', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'owner' limit 1), false);
select set_config('t.eng', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'agri_engineer' limit 1), false);
select set_config('t.mgr', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'farm_manager' limit 1), false);
select set_config('t.acc', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'accountant' limit 1), false);
select set_config('t.sup', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'supervisor' limit 1), false);
select set_config('t.store', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'storekeeper' limit 1), false);
select set_config('t.eng_person', (select id::text from public.people
  where user_id = current_setting('t.eng')::uuid and org_id = :'orgA'), false);
select set_config('t.owner_person', (select id::text from public.people
  where user_id = current_setting('t.owner')::uuid and org_id = :'orgA'), false);

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role','authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- fixtures (direct writes, run as the connecting superuser — RLS not yet in play for setup).
insert into public.inventory_items (id, org_id, name, unit, pack_size, safety_stock, lead_time_days)
  values (:'item', :'orgA', 'صنف اعتماد المهندس', 'kg', 1, 0, 5);
insert into public.plans (id, org_id, type, scope_type, scope_id, status)
  values (:'plan', :'orgA', 'monthly', 'sector', null, 'active');
insert into public.plan_operations (id, org_id, plan_id, subtype, planned_at, est_cost, status)
  values (:'opFert', :'orgA', :'plan', 'fertilization', '2026-07-01', 500, 'planned');
insert into public.plan_operations (id, org_id, plan_id, subtype, planned_at, est_cost, status)
  values (:'opIrri', :'orgA', :'plan', 'irrigation', '2026-07-01', 100, 'planned');

-- ===== (a) a freshly-authored dose-bearing op is PENDING sign-off (both columns null) =====
select is((select signed_off_by from public.plan_operations where id = :'opFert'), null,
  'agronomy-signoff: a freshly-authored op has signed_off_by = null (pending — a template, not a prescription)');
select is((select signed_off_at from public.plan_operations where id = :'opFert'), null,
  'agronomy-signoff: a freshly-authored op has signed_off_at = null (pending)');

-- ===== (b) role gate on the RPC: farm_manager / accountant / supervisor / storekeeper are refused =====
select pg_temp.as_user(current_setting('t.mgr'));
select throws_ok(
  format($$ select public.fn_sign_off_plan_operation('%s'::uuid) $$, current_setting('t.opFert', true)),
  '42501', null, 'agronomy-signoff: farm_manager (no agronomy.signoff) is refused');
reset role;

select pg_temp.as_user(current_setting('t.acc'));
select throws_ok(
  format($$ select public.fn_sign_off_plan_operation('%s'::uuid) $$, current_setting('t.opFert', true)),
  '42501', null, 'agronomy-signoff: accountant (no agronomy.signoff) is refused');
reset role;

select pg_temp.as_user(current_setting('t.sup'));
select throws_ok(
  format($$ select public.fn_sign_off_plan_operation('%s'::uuid) $$, current_setting('t.opFert', true)),
  '42501', null, 'agronomy-signoff: supervisor (no agronomy.signoff) is refused');
reset role;

select pg_temp.as_user(current_setting('t.store'));
select throws_ok(
  format($$ select public.fn_sign_off_plan_operation('%s'::uuid) $$, current_setting('t.opFert', true)),
  '42501', null, 'agronomy-signoff: storekeeper (no agronomy.signoff) is refused');
reset role;

-- ===== (c) agri_engineer signs off: stamps the CALLER's person + now(), from the session only =====
select pg_temp.as_user(current_setting('t.eng'));
select set_config('t.res', public.fn_sign_off_plan_operation(:'opFert')::text, false);
reset role;

select is((current_setting('t.res')::jsonb)->>'operationId', current_setting('t.opFert', true),
  'agronomy-signoff: the RPC result echoes the operationId');
select is((current_setting('t.res')::jsonb)->>'signedOffBy', current_setting('t.eng_person', true),
  'agronomy-signoff: the RPC result carries the CALLER''s person id (agri_engineer), not a client value');
select is((select signed_off_by::text from public.plan_operations where id = :'opFert'), current_setting('t.eng_person', true),
  'agronomy-signoff: signed_off_by persisted on plan_operations');
select isnt((select signed_off_at from public.plan_operations where id = :'opFert'), null,
  'agronomy-signoff: signed_off_at persisted (not null) after sign-off');

-- ===== (d) direct-REST spoofing guard: farm_manager (plan.write, no agronomy.signoff) cannot
-- overwrite signed_off_by/at directly — the guard trigger rejects it even though RLS plan.write alone
-- would otherwise have allowed the write. =====
select pg_temp.as_user(current_setting('t.mgr'));
select throws_ok(
  format($$ update public.plan_operations set signed_off_by = '%s'::uuid, signed_off_at = now() where id = '%s'::uuid $$,
    current_setting('t.owner_person', true), current_setting('t.opFert', true)),
  '42501', null,
  'agronomy-signoff: a direct-REST write by a non-agronomy.signoff role cannot SET signed_off_by (guard trigger)');
reset role;
select is((select signed_off_by::text from public.plan_operations where id = :'opFert'), current_setting('t.eng_person', true),
  'agronomy-signoff: the spoof attempt left signed_off_by UNCHANGED (still the engineer)');

-- clearing (the SAFE direction) is NOT extra-gated — plan.write alone suffices.
select pg_temp.as_user(current_setting('t.mgr'));
select lives_ok(
  format($$ update public.plan_operations set signed_off_by = null, signed_off_at = null where id = '%s'::uuid $$,
    current_setting('t.opFert', true)),
  'agronomy-signoff: farm_manager (plan.write) CAN clear a sign-off directly (the safe direction)');
reset role;
select is((select signed_off_by from public.plan_operations where id = :'opFert'), null,
  'agronomy-signoff: signed_off_by is null after the direct clear');
select is((select signed_off_at from public.plan_operations where id = :'opFert'), null,
  'agronomy-signoff: signed_off_at is null after the direct clear');

-- INSERT-time spoof: a fresh row carrying signed_off_by from a non-agronomy.signoff role is rejected too.
select pg_temp.as_user(current_setting('t.mgr'));
select throws_ok(
  format($$ insert into public.plan_operations (id, org_id, plan_id, subtype, planned_at, est_cost, status, signed_off_by, signed_off_at)
            values ('%s'::uuid, '%s'::uuid, '%s'::uuid, 'spraying', '2026-07-02', 200, 'planned', '%s'::uuid, now()) $$,
    current_setting('t.opSpoof', true), :'orgA', current_setting('t.plan', true), current_setting('t.owner_person', true)),
  '42501', null,
  'agronomy-signoff: an INSERT carrying signed_off_by from a non-agronomy.signoff role is rejected (guard trigger)');
reset role;
select is((select count(*) from public.plan_operations where id = :'opSpoof'), 0::bigint,
  'agronomy-signoff: the rejected INSERT left no row behind');

-- ===== the OTHER agronomy.signoff role (owner) signs off a currently-UNSIGNED op — opFert was
-- cleared by the direct-clear test above (d), so this is NOT a re-sign of an already-signed op (that
-- case is asserted separately right below) =====
select pg_temp.as_user(current_setting('t.owner'));
select set_config('t.res2', public.fn_sign_off_plan_operation(:'opFert')::text, false);
reset role;
select is((select signed_off_by::text from public.plan_operations where id = :'opFert'), current_setting('t.owner_person', true),
  'agronomy-signoff: owner CAN sign off, stamping their own linked person');

-- ===== idempotency guard: signing off an ALREADY-signed-off op is refused, not silently re-stamped.
-- opFert is currently signed off by the owner (immediately above); attempting to sign it off again —
-- even with a DIFFERENT permitted role (agri_engineer) — must raise 22023 and leave the existing
-- signed_off_by untouched, never overwrite it with the new caller's identity. =====
select pg_temp.as_user(current_setting('t.eng'));
select throws_ok(
  format($$ select public.fn_sign_off_plan_operation('%s'::uuid) $$, current_setting('t.opFert', true)),
  '22023', null,
  'agronomy-signoff: signing off an already-signed-off op raises 22023 (claim-first, no silent re-stamp)');
reset role;
select is((select signed_off_by::text from public.plan_operations where id = :'opFert'), current_setting('t.owner_person', true),
  'agronomy-signoff: the rejected re-sign attempt left signed_off_by UNCHANGED (still the owner, not overwritten by eng)');

-- ===== (e) editing plan_material_requirements for a signed-off op clears the sign-off =====
select pg_temp.as_user(current_setting('t.mgr'));
insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit)
  values (:'orgA', :'opFert', :'item', 25, 'kg');
reset role;
select is((select signed_off_by from public.plan_operations where id = :'opFert'), null,
  'agronomy-signoff: editing plan_material_requirements clears signed_off_by (approval no longer applies to the changed content)');
select is((select signed_off_at from public.plan_operations where id = :'opFert'), null,
  'agronomy-signoff: editing plan_material_requirements clears signed_off_at');

-- ===== (f) cross-org rejection: an owner of a DIFFERENT org cannot sign off orgA''s operation =====
insert into public.organization (id, name) values (:'orgB', 'مزرعة اعتماد بعيدة');
insert into auth.users (id, instance_id, aud, role, phone, phone_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values ('30114000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','+201140000001', now(), now(), now(), '{"provider":"phone"}'::jsonb, '{"name":"مالك بعيد"}'::jsonb)
  on conflict (id) do nothing;
insert into public.organization_member (org_id, user_id, role) values (:'orgB', '30114000-0000-0000-0000-000000000001', 'owner');

select pg_temp.as_user('30114000-0000-0000-0000-000000000001');
select throws_ok(
  format($$ select public.fn_sign_off_plan_operation('%s'::uuid) $$, current_setting('t.opIrri', true)),
  '42501', null, 'agronomy-signoff: a different org''s owner cannot sign off orgA''s operation (cross-org guard)');
reset role;
select is((select signed_off_by from public.plan_operations where id = :'opIrri'), null,
  'agronomy-signoff: opIrri remains unsigned after the cross-org attempt');

-- ===== (g) a non-existent operation raises P0002 =====
select pg_temp.as_user(current_setting('t.eng'));
select throws_ok(
  format($$ select public.fn_sign_off_plan_operation('%s'::uuid) $$, current_setting('t.noOp', true)),
  'P0002', null, 'agronomy-signoff: signing off a non-existent operation raises P0002');
reset role;

select * from finish();
rollback;
