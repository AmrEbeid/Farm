-- 67 — suppliers WRITES require inventory.write (owner/farm_manager/storekeeper); a member without it
-- (agri_engineer) cannot create a supplier or edit its phone/terms (a payment-redirect vector). READS
-- stay org-only (every member needs the supplier list for PR/coverage). Completes the procurement
-- domain's uniform inventory.write gate (items + movements + bin + suppliers). Impersonation via
-- request.jwt.claims. The seed supplier 40c8…0353 is used for the UPDATE case.
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(5);

\set orgA   '00000000-0000-0000-0000-000000000001'
\set sup    '40c8053d-c3ad-55a3-8e6b-39dd61066353'

select set_config('test.eng',   (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'agri_engineer' limit 1), false);
select set_config('test.store', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'storekeeper' limit 1), false);

-- ===== a member WITHOUT inventory.write (agri_engineer) — writes refused, reads allowed =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.eng'), 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  $$ insert into public.suppliers (org_id, name) values ('00000000-0000-0000-0000-000000000001', 'مورد مهرّب') $$,
  '42501', null,
  'suppliers: a non-inventory member cannot CREATE a supplier');

select throws_ok(
  format($$ update public.suppliers set phone = '0599999999', terms = 'تحويل بنكي جديد' where id = %L $$, :'sup'),
  '42501', null,
  'suppliers: a non-inventory member cannot EDIT a supplier''s phone/terms (payment-redirect blocked)');

select is(
  (select count(*)::int from public.suppliers where id = :'sup'),
  1,
  'suppliers: a non-inventory member can still READ the supplier list (reads ungated)');

reset role;

-- ===== a storekeeper (HAS inventory.write) — write allowed =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.store'), 'role', 'authenticated')::text, true);
set local role authenticated;

select lives_ok(
  $$ insert into public.suppliers (org_id, name) values ('00000000-0000-0000-0000-000000000001', 'مورد جديد') $$,
  'suppliers: a storekeeper (inventory.write) CAN create a supplier');

reset role;

select is(
  (select count(*)::int from pg_policies
     where schemaname='public' and tablename='suppliers' and policyname='tenant_all'
       and with_check ilike '%inventory.write%'),
  1,
  'suppliers: tenant_all gates writes on inventory.write');

select * from finish();
rollback;
