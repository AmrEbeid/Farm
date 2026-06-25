-- 10 — B2: direct writes to the stock tables require `inventory.write`; reads stay open to the
-- org; and execution via the bypassrls fn_post_movement RPC is unaffected (so non-inventory.write
-- roles like supervisor can still execute ops). Run via `supabase test db`.

begin;
select plan(4);

\set orgA '00000000-0000-0000-0000-000000000001'
\set pot  '39e22867-fbe2-5cd9-8a76-ce5871a8e8f4'

select set_config('test.sup', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='supervisor'), false);
select set_config('test.store', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='storekeeper'), false);

-- ===== supervisor: NO inventory.write =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.sup'), 'role','authenticated')::text, true);
set local role authenticated;

-- direct REST-style insert is denied
select throws_ok($$
  insert into public.inventory_movements (org_id, item_id, type, qty, location)
  values ('00000000-0000-0000-0000-000000000001','39e22867-fbe2-5cd9-8a76-ce5871a8e8f4','receipt',5,'main')
$$, '42501', null, 'B2: supervisor (no inventory.write) cannot direct-insert inventory_movements');

-- but can still READ stock (USING org) and EXECUTE via the bypassrls RPC
select isnt((select count(*) from public.inventory_bin), 0::bigint,
  'B2: supervisor can still read inventory_bin');
select isnt(public.fn_post_movement(:'pot', 'issue', 1), null,
  'B2: supervisor can still issue stock via fn_post_movement (execution unaffected)');

reset role;

-- ===== storekeeper: HAS inventory.write =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.store'), 'role','authenticated')::text, true);
set local role authenticated;

select lives_ok($$
  insert into public.inventory_movements (org_id, item_id, type, qty, location)
  values ('00000000-0000-0000-0000-000000000001','39e22867-fbe2-5cd9-8a76-ce5871a8e8f4','adjustment',1,'main')
$$, 'B2: storekeeper (inventory.write) can direct-insert inventory_movements');

reset role;
select * from finish();
rollback;
