-- 63 — #235 (RPC arm): fn_add_plan_operation must reject a cross-org p_item_id. The RPC is SECURITY
-- DEFINER (BYPASSRLS), so 0061's plan_material_requirements item-org WITH CHECK does not apply to its
-- insert; 0062 validates p_item_id ∈ the plan's org inside the function. A foreign org (orgB) + its item
-- are seeded as superuser; the orgA owner (plan.write) calls the RPC. Impersonation via request.jwt.claims.
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(3);

\set orgA   '00000000-0000-0000-0000-000000000001'
\set orgB   '0b630000-0000-0000-0000-0000000000b0'
\set itemA  '39e22867-fbe2-5cd9-8a76-ce5871a8e8f4'
\set itemB  '0b630000-0000-0000-0000-0000000000b1'
\set plan   '0c630000-0000-0000-0000-0000000000c2'

select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'owner' limit 1), false);

-- a foreign org + its item, and an orgA plan — all as superuser
insert into public.organization (id, name) values (:'orgB', 'مزرعة ثالثة');
insert into public.inventory_items (id, org_id, name) values (:'itemB', :'orgB', 'صنف بعيد');
insert into public.plans (id, org_id, type, status) values (:'plan', :'orgA', 'monthly', 'draft');

-- act as the orgA owner (holds plan.write)
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;

-- a cross-org item is rejected by the RPC's own guard (not the FK — the item exists, just in orgB)
select throws_ok(
  format($$ select public.fn_add_plan_operation(%L, 'fertilization', date '2026-07-01', 100, %L, 5, 'kg') $$,
         :'plan', :'itemB'),
  '42501', null,
  '#235: fn_add_plan_operation rejects a CROSS-ORG p_item_id (RPC tenant isolation)');

-- a same-org item is accepted (the RPC creates the op + requirement)
select lives_ok(
  format($$ select public.fn_add_plan_operation(%L, 'irrigation', date '2026-07-02', 100, %L, 5, 'kg') $$,
         :'plan', :'itemA'),
  '#235: fn_add_plan_operation accepts a same-org p_item_id');

reset role;

-- structural: the guard is present in the function body
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'fn_add_plan_operation'
       and pg_get_functiondef(p.oid) like '%and org_id = v_org%'),
  1,
  '#235: fn_add_plan_operation carries the item-org guard');

select * from finish();
rollback;
