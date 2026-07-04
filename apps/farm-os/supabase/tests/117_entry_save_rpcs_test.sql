-- 117 — SPEC-0024 S-9 final gap: gated save-RPCs for suppliers / inventory items / expenses (migration
-- 20260701520000). Verifies the inventory.write gate on fn_save_supplier/fn_save_inventory_item, the
-- budget.write gate on fn_save_expense, cross-org guards (supplier link, preferred supplier), kind
-- validation, that an imported expense arrives UNROUTED (payment_status null — a bulk import never moves
-- cash), and anon lockdown. Impersonation via request.jwt.claims (tests 44/82/114/115/116).

begin;
select plan(15);

\set org '00000000-0000-0000-0000-000000000001'
select set_config('test.owner', (select user_id::text from public.organization_member where org_id = :'org' and role = 'owner' limit 1), false);
select set_config('test.sk', (select user_id::text from public.organization_member where org_id = :'org' and role = 'storekeeper' limit 1), false);
select set_config('test.sup', (select user_id::text from public.organization_member where org_id = :'org' and role = 'supervisor' limit 1), false);
select isnt(current_setting('test.owner'), '', 'fixture: an owner exists in orgA');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- 1) suppliers: storekeeper (inventory.write) CAN; supervisor CANNOT
select pg_temp.as_user(current_setting('test.sk'));
select lives_ok(
  format($$ select set_config('test.supplier',
    (public.fn_save_supplier(null, %L, 'مورد استيراد', '0100', 'نقدي', 3))->>'id', false) $$, :'org'),
  'storekeeper (inventory.write) saves a supplier through the RPC');
reset role;
select pg_temp.as_user(current_setting('test.sup'));
select throws_ok(
  format($$ select public.fn_save_supplier(null, %L, 'مزيف') $$, :'org'),
  '42501', null, 'supervisor (no inventory.write) cannot save a supplier');
reset role;

-- 2) items: gate + cross-org preferred supplier
select pg_temp.as_user(current_setting('test.sk'));
select lives_ok(
  format($$ select public.fn_save_inventory_item(null, %L, 'صنف استيراد', 'سماد', 'شيكارة', 50, 10, 5, 20, 40, 3,
    current_setting('test.supplier')::uuid) $$, :'org'),
  'storekeeper saves an inventory item with a same-org preferred supplier');
reset role;
insert into public.organization (id, name) values ('00000000-0000-0000-0000-0000000000dd', 'مزرعة أخرى') on conflict (id) do nothing;
insert into public.suppliers (id, org_id, name) values ('00000000-0000-0000-0000-0000000000ee', '00000000-0000-0000-0000-0000000000dd', 'مورد أجنبي') on conflict (id) do nothing;
select pg_temp.as_user(current_setting('test.sk'));
select throws_ok(
  format($$ select public.fn_save_inventory_item(null, %L, 'صنف2', null, null, null, null, null, null, null, null,
    '00000000-0000-0000-0000-0000000000ee') $$, :'org'),
  '42501', null, 'a cross-org preferred supplier is rejected');
select throws_ok(
  format($$ select public.fn_save_inventory_item(null, %L, '') $$, :'org'),
  '23502', null, 'an empty item name is rejected');
reset role;

-- 3) expenses: budget.write gate; storekeeper cannot
select pg_temp.as_user(current_setting('test.sk'));
select throws_ok(
  format($$ select public.fn_save_expense(null, %L, current_date, 'أسمدة', 100) $$, :'org'),
  '42501', null, 'storekeeper (no budget.write) cannot save an expense');
reset role;
select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(
  format($$ select set_config('test.exp',
    (public.fn_save_expense(null, %L, current_date, 'أسمدة', 2500, 'استيراد قالب', current_setting('test.supplier')::uuid, 'operating', null, null))->>'id', false) $$, :'org'),
  'owner (budget.write) saves an expense through the RPC');
select throws_ok(
  format($$ select public.fn_save_expense(null, %L, current_date, 'س', 100, null, null, 'bogus') $$, :'org'),
  '22023', null, 'an invalid kind is rejected');
select throws_ok(
  format($$ select public.fn_save_expense(null, %L, current_date, 'س', 100, null, '00000000-0000-0000-0000-0000000000ee') $$, :'org'),
  '42501', null, 'a cross-org supplier on an expense is rejected');
select throws_ok(
  format($$ select public.fn_save_expense(null, %L, current_date, 'س', 0) $$, :'org'),
  '22023', null, 'a non-positive total is rejected');
reset role;

-- 4) the imported expense arrives UNROUTED — no payment_status, no custody movement, no journal
select is(
  (select payment_status from public.expenses where id = current_setting('test.exp')::uuid),
  null, 'an RPC-saved expense arrives unrouted (payment_status null) — import never moves cash');
select is(
  (select count(*)::int from public.custody_movements where expense_id = current_setting('test.exp')::uuid),
  0, 'no custody movement was created by the save');
select is(
  (select count(*)::int from public.journal_entries where source_type = 'expense_payment' and source_id = current_setting('test.exp')::uuid),
  0, 'no journal was posted by the save');

-- 5) anon lockdown
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('fn_save_supplier','fn_save_inventory_item','fn_save_expense')
       and has_function_privilege('anon', p.oid, 'EXECUTE')),
  'none of the entry save-RPCs are EXECUTE-able by anon');

select * from finish();
rollback;
