-- 66 — #235/#308: inventory_items WRITES require inventory.write (owner/farm_manager/storekeeper); a
-- member without it (agri_engineer here) cannot create/edit an item — it drives engine inputs
-- (min/safety_stock, pack_size, lead_time). READS stay org-only (every member needs the catalogue). The
-- inventory ledger (movements/bin) was already gated; this closes the item master. Impersonation via
-- request.jwt.claims (tests 25/42/...).
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(5);

\set orgA  '00000000-0000-0000-0000-000000000001'
\set item  '39e22867-fbe2-5cd9-8a76-ce5871a8e8f4'

select set_config('test.eng',   (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'agri_engineer' limit 1), false);
select set_config('test.store', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'storekeeper' limit 1), false);

-- ===== a member WITHOUT inventory.write (agri_engineer) — writes refused, reads allowed =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.eng'), 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  $$ insert into public.inventory_items (org_id, name) values ('00000000-0000-0000-0000-000000000001', 'صنف مهرّب') $$,
  '42501', null,
  '#308: a non-inventory member cannot CREATE an item (engine inputs protected)');

select throws_ok(
  format($$ update public.inventory_items set safety_stock = 99999 where id = %L $$, :'item'),
  '42501', null,
  '#308: a non-inventory member cannot EDIT an item''s safety_stock (no reorder-point tampering)');

-- ...but the catalogue is still READABLE by that member (USING unchanged)
select is(
  (select count(*)::int from public.inventory_items where id = :'item'),
  1,
  '#308: a non-inventory member can still READ the item catalogue (reads ungated)');

reset role;

-- ===== a storekeeper (HAS inventory.write) — write allowed =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.store'), 'role', 'authenticated')::text, true);
set local role authenticated;

select lives_ok(
  $$ insert into public.inventory_items (org_id, name) values ('00000000-0000-0000-0000-000000000001', 'صنف مخزني') $$,
  '#308: a storekeeper (inventory.write) CAN create an item');

reset role;

-- structural invariant: the write gate is present
select is(
  (select count(*)::int from pg_policies
     where schemaname='public' and tablename='inventory_items' and policyname='tenant_all'
       and with_check ilike '%inventory.write%'),
  1,
  '#308: inventory_items tenant_all gates writes on inventory.write');

select * from finish();
rollback;
