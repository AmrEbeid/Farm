-- 09 — D2: bin.reserved is ledger-backed = greatest(0, Σ(reserve) − Σ(release)).
-- Proves reserve/release via fn_post_movement keep inventory_bin.reserved reconciled
-- with the movement ledger (no read-modify-write drift). Run via `supabase test db`.

begin;
select plan(4);

\set orgA '00000000-0000-0000-0000-000000000001'
\set item 'dddd0002-0000-0000-0000-0000000000a0'

insert into public.inventory_items (id, org_id, name, unit) values (:'item', :'orgA', 'صنف اختبار الحجز', 'kg');

select set_config('test.ownerA', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='owner'), false);
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.ownerA'), 'role','authenticated')::text, true);
set role authenticated;

-- reserve 200 → reserved 200
select public.fn_post_movement(:'item', 'reserve', 200);
select is((select reserved from public.inventory_bin where item_id = :'item' and location = 'main'),
  200::numeric, 'reserve 200 → reserved 200');

-- reserve +100 then release 120 → reserved 180
select public.fn_post_movement(:'item', 'reserve', 100);
select public.fn_post_movement(:'item', 'release', 120);
select is((select reserved from public.inventory_bin where item_id = :'item' and location = 'main'),
  180::numeric, 'reserve 200+100 − release 120 → reserved 180');

-- reconciliation: bin.reserved == greatest(0, Σ(reserve) − Σ(release))
select is(
  (select reserved from public.inventory_bin where item_id = :'item' and location = 'main'),
  (select greatest(0, coalesce(sum(case when type='reserve' then qty
                                        when type='release' then -qty else 0 end), 0))
   from public.inventory_movements where item_id = :'item' and location = 'main'),
  'bin.reserved == greatest(0, Σ(reserve) − Σ(release))');

-- over-release clamps reserved at 0 (never negative)
select public.fn_post_movement(:'item', 'release', 1000);
select is((select reserved from public.inventory_bin where item_id = :'item' and location = 'main'),
  0::numeric, 'over-release clamps reserved to 0');

reset role;
select * from finish();
rollback;
