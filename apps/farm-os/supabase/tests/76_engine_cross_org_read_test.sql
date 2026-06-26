-- 76 — the stock-coverage engine must REFUSE to read another org's item. fn_stock_coverage resolves the
-- item's org from its bin and raises 42501 (`forbidden: cross-org`) when an authenticated caller is not a
-- member of that org — otherwise a member could read a FOREIGN org's stock levels, shortage flag, and
-- stockout date (a confidentiality leak through a SECURITY DEFINER read RPC). The grant-level guard (anon
-- cannot EXECUTE) is pinned in test 05; this pins the IN-BODY org guard for an authenticated cross-org
-- caller, which nothing covered. orgB + its item/bin and an orgA item/bin are seeded as superuser.
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(2);

\set orgA  '00000000-0000-0000-0000-000000000001'
\set orgB  '07500000-0000-0000-0000-0000000000b0'
\set itmB  '07500000-0000-0000-0000-0000000000b1'
\set itmA  '07500000-0000-0000-0000-0000000000a1'

select set_config('test.store', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'storekeeper' limit 1), false);

insert into public.organization (id, name) values (:'orgB', 'مزرعة عاشرة');
insert into public.inventory_items (id, org_id, name) values
  (:'itmB', :'orgB', 'صنف بعيد'), (:'itmA', :'orgA', 'صنف محلي');
insert into public.inventory_bin (org_id, item_id, location) values
  (:'orgB', :'itmB', 'main'), (:'orgA', :'itmA', 'main');

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.store'), 'role', 'authenticated')::text, true);
set local role authenticated;

-- a member CANNOT read another org's coverage (the in-body org guard)
select throws_ok(
  format($$ select public.fn_stock_coverage(%L, 'main', 8) $$, :'itmB'),
  '42501', null, 'CONF: the engine refuses to read a CROSS-ORG item''s coverage');

-- ...but reading own-org coverage works (the guard does not over-block)
select lives_ok(
  format($$ select public.fn_stock_coverage(%L, 'main', 8) $$, :'itmA'),
  'CONF: a member CAN read their own org''s coverage');

select * from finish();
rollback;
