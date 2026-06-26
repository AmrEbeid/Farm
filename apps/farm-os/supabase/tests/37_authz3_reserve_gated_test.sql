-- 37 — AUTHZ-3 (#182 / SPEC-0002 §8b): fn_post_movement is INTERNAL; client reserves go through the
-- role-gated wrapper fn_reserve_stock.
--
-- THE BUG. fn_post_movement was SECURITY DEFINER + `grant execute to authenticated` with only an ORG
-- guard (no ROLE gate), so ANY authenticated org member could POST /rest/v1/rpc/fn_post_movement and
-- move their org's stock — past the inventory.write RBAC line. Migration 0037 revokes that grant
-- (making it internal) and adds fn_reserve_stock, which enforces inventory.write before delegating.
--
-- This pins:
--   (c) catalog: `authenticated` can no longer EXECUTE fn_post_movement, but CAN EXECUTE the wrapper;
--   (a) an inventory.write role (storekeeper) CAN reserve via fn_reserve_stock (reserved bumps);
--   (b) a non-inventory.write role (accountant, agri_engineer) is refused 42501, with NO side effect;
--   (d) regression: the internal definer path still posts movements — fn_post_receipt (which calls the
--       now-internal fn_post_movement as the OWNER) still posts a receipt. This proves the revoke did
--       NOT break the legitimate definer callers (internal calls check EXECUTE against the OWNER).
--
-- JWT impersonation via request.jwt.claims + `set local role`, exactly the harness used by tests
-- 22/23/24/36. authorize()/the RPCs are SECURITY DEFINER and read auth.uid() from the JWT GUC, so the
-- assertions reflect the real RBAC decision. Run via `supabase test db` or the local shim.

begin;
select plan(10);

\set orgA  '00000000-0000-0000-0000-000000000001'
\set ritem '37000000-0000-0000-0000-0000000000a0'
\set pitem '37000000-0000-0000-0000-0000000000b0'
\set pr    '37ab0000-0000-0000-0000-0000000037ab'

-- actors: storekeeper HAS inventory.write; accountant + agri_engineer do NOT (negative authz cases).
-- farm_manager requests / owner approves the PR (SoD: requested_by must differ from approved_by).
select set_config('t.store', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'storekeeper' limit 1), false);
select set_config('t.acc', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'accountant' limit 1), false);
select set_config('t.eng', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'agri_engineer' limit 1), false);
select set_config('t.mgr', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'farm_manager' limit 1), false);
select set_config('t.owner', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'owner' limit 1), false);

-- fixtures (superuser): a reserve item already at on_hand 100, and a receipt item at 0 with an
-- APPROVED single-line PR. The born-approved PR is inserted here, as superuser (no JWT) — the insert-
-- side SoD guard (migration 0023) blocks a born-approved PR for an authenticated caller, so it must be
-- created before any request.jwt.claims GUC is set below (same pattern as test 23).
insert into public.inventory_items (id, org_id, name, unit, pack_size, safety_stock, lead_time_days)
  values (:'ritem', :'orgA', 'صنف اختبار الحجز ٣٧', 'kg', 1, 0, 5),
         (:'pitem', :'orgA', 'صنف استلام ٣٧', 'kg', 1, 0, 5);
insert into public.inventory_bin (org_id, item_id, location, on_hand, reserved, ordered, projected)
  values (:'orgA', :'ritem', 'main', 100, 0, 0, 0),
         (:'orgA', :'pitem', 'main', 0, 0, 0, 0);
insert into public.purchase_requests (id, org_id, code, requested_by, approved_by, status)
  values (:'pr', :'orgA', 'PR-AUTHZ37',
          current_setting('t.mgr')::uuid, current_setting('t.owner')::uuid, 'approved');
insert into public.purchase_request_items (pr_id, org_id, item_id, qty, unit, supplier_id)
  values (:'pr', :'orgA', :'pitem', 80, 'kg', null);

-- ===== (c) catalog-level grant posture (independent of RLS) =====
select ok(not has_function_privilege('anon', 'public.fn_reserve_stock(uuid, numeric, uuid)', 'EXECUTE'),
  'AUTHZ-3: anon cannot EXECUTE fn_reserve_stock');
select ok(has_function_privilege('authenticated', 'public.fn_reserve_stock(uuid, numeric, uuid)', 'EXECUTE'),
  'AUTHZ-3: authenticated CAN EXECUTE fn_reserve_stock (the gated reserve entry point)');
select ok(not has_function_privilege('authenticated',
  'public.fn_post_movement(uuid, text, numeric, text, text, numeric, uuid, uuid, uuid, timestamptz)', 'EXECUTE'),
  'AUTHZ-3 (c): authenticated can NO LONGER EXECUTE fn_post_movement directly (now internal)');

-- ===== (a) an inventory.write role (storekeeper) CAN reserve via the wrapper =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.store'), 'role', 'authenticated')::text, true);
set local role authenticated;
select isnt(public.fn_reserve_stock(:'ritem', 30, null), null,
  'AUTHZ-3 (a): storekeeper (inventory.write) reserves stock via fn_reserve_stock');
reset role;
select is((select reserved from public.inventory_bin where item_id = :'ritem' and location = 'main'),
  30::numeric, 'AUTHZ-3 (a): the reserve posted — bin.reserved 0 → 30');

-- ===== (b) a non-inventory.write role is refused 42501, with NO side effect =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.acc'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  $$ select public.fn_reserve_stock('37000000-0000-0000-0000-0000000000a0', 10, null) $$,
  '42501', null,
  'AUTHZ-3 (b): an accountant (no inventory.write) is refused 42501 by fn_reserve_stock');
reset role;

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.eng'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  $$ select public.fn_reserve_stock('37000000-0000-0000-0000-0000000000a0', 10, null) $$,
  '42501', null,
  'AUTHZ-3 (b): an agri_engineer (op.execute, no inventory.write) is refused 42501 by fn_reserve_stock');
reset role;

select is((select reserved from public.inventory_bin where item_id = :'ritem' and location = 'main'),
  30::numeric, 'AUTHZ-3 (b): the refused attempts posted nothing — bin.reserved still 30');

-- ===== (d) regression: the internal definer path still posts movements =====
-- fn_post_receipt (inventory.write) claim-flips the PR and posts a receipt via the now-INTERNAL
-- fn_post_movement, called as the function OWNER. If the revoke had broken the definer path, this
-- would fail with permission denied instead of posting the receipt.
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.store'), 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$ select public.fn_post_receipt('37ab0000-0000-0000-0000-0000000037ab'::uuid) $$,
  'AUTHZ-3 (d): fn_post_receipt still runs (internal fn_post_movement reached via the OWNER)');
reset role;
select is((select on_hand from public.inventory_bin where item_id = :'pitem' and location = 'main'),
  80::numeric, 'AUTHZ-3 (d): the internal definer path posted the receipt — pitem on_hand 0 → 80');

select * from finish();
rollback;
