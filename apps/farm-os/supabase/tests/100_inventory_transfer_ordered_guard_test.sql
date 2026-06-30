-- 100 — #431 latent inventory cleanup.
--
-- Transfer is disabled until it has destination-location semantics, and inventory_bin.ordered is pinned at zero
-- until a real PO writer maintains it. Existing physical movement paths still work.

begin;
select plan(6);

\set orgA '00000000-0000-0000-0000-000000000001'
\set item '43100000-0000-0000-0000-0000000000a0'

insert into public.inventory_items (id, org_id, name, unit)
values (:'item', :'orgA', 'صنف اختبار التحويل', 'kg');

select set_config('test.ownerA', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='owner'), false);
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.ownerA'), 'role','authenticated')::text, true);

select is(public.fn_post_movement(:'item', 'receipt', 100), 100::numeric,
  'receipt still posts normally after the transfer/ordered guard');

select throws_ok(
  format($$ select public.fn_post_movement(%L, 'transfer', 10) $$, :'item'),
  '22023', null,
  'fn_post_movement rejects transfer until a destination-bin model exists');

select throws_ok(
  format($$ insert into public.inventory_movements (org_id, item_id, type, qty, location)
          values (%L, %L, 'transfer', 1, 'main') $$, :'orgA', :'item'),
  '23514', null,
  'table constraint rejects direct transfer ledger rows');

select throws_ok(
  format($$ update public.inventory_bin set ordered = 1 where item_id = %L and location = 'main' $$, :'item'),
  '23514', null,
  'inventory_bin.ordered is pinned at zero until a writer owns it');

select is(
  (select ordered from public.inventory_bin where item_id = :'item' and location = 'main'),
  0::numeric,
  'ordered remains zero after the rejected update');

select is(
  (select projected from public.inventory_bin where item_id = :'item' and location = 'main'),
  (select on_hand - reserved from public.inventory_bin where item_id = :'item' and location = 'main'),
  'projected equals on_hand - reserved while ordered is pinned to zero');

select * from finish();
rollback;
