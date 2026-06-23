-- 07 — fn_post_movement (B1): transactional, ledger-reconciled inventory mutation.
-- Proves the RPC appends to the ledger and recomputes on_hand FROM it (no read-modify-write),
-- accumulates correctly, validates inputs, and enforces the org guard. Run via `supabase test db`.

begin;
select plan(6);

\set orgA '00000000-0000-0000-0000-000000000001'
\set aitem 'dddd0001-0000-0000-0000-0000000000a0'
\set bitem 'dddd0001-0000-0000-0000-0000000000b0'

-- fixtures (superuser): an org-A item with NO bin yet, plus org B + a B item for the guard test.
insert into public.inventory_items (id, org_id, name, unit) values (:'aitem', :'orgA', 'صنف اختبار الحركة', 'kg');
insert into public.organization (id, name) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','مزرعة ب');
insert into public.inventory_items (id, org_id, name, unit)
  values (:'bitem', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'صنف ب', 'kg');

select set_config('test.ownerA', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='owner'), false);
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.ownerA'), 'role','authenticated')::text, true);
set role authenticated;

-- 1. receipt 100 on an item with no bin -> returns on_hand 100 (bin auto-created from the ledger)
select is(public.fn_post_movement(:'aitem', 'receipt', 100), 100::numeric,
  'receipt 100 → on_hand 100 (bin auto-created, rebuilt from ledger)');

-- 2. accumulate across calls: +50 receipt then −30 issue → 120 (no read-modify-write lost update)
select public.fn_post_movement(:'aitem', 'receipt', 50);
select is(public.fn_post_movement(:'aitem', 'issue', 30), 120::numeric,
  'receipt 50 + issue 30 → on_hand 120 (accumulates from the full ledger)');

-- 3. the snapshot reconciles with Σ(signed movements) — the SC-6 invariant the app violated
select is(
  (select on_hand from public.inventory_bin where item_id = :'aitem' and location = 'main'),
  (select coalesce(sum(case when type in ('receipt','return','adjustment') then qty
                            when type in ('issue','loss','expiry','transfer') then -qty else 0 end), 0)
   from public.inventory_movements where item_id = :'aitem' and location = 'main'),
  'bin.on_hand == Σ(signed movements) (SC-6 holds)');

-- 4. a non-positive qty is rejected (the sign comes from the type, not the magnitude)
select throws_ok($$ select public.fn_post_movement('dddd0001-0000-0000-0000-0000000000a0','receipt',0) $$,
  '22023', null, 'non-positive qty rejected');

-- 5. posting against another org's item is denied (org guard)
select throws_ok($$ select public.fn_post_movement('dddd0001-0000-0000-0000-0000000000b0','receipt',10) $$,
  '42501', null, 'cross-org movement denied');

-- 6. a further same-org issue keeps reconciling (120 − 20 = 100)
select is(public.fn_post_movement(:'aitem', 'issue', 20), 100::numeric,
  'issue 20 → on_hand 100');

reset role;
select * from finish();
rollback;
