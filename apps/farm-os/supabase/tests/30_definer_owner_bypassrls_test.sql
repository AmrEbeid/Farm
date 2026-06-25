-- 30 — FORCE-RLS safety invariant: the SECURITY DEFINER write path must keep bypassing RLS.
--
-- Migration 0028 turns on FORCE ROW LEVEL SECURITY for the tenant tables, which makes even the
-- table OWNER obey RLS on direct access. The privileged write/audit path (fn_post_movement,
-- fn_execute_operation, fn_post_receipt, and the audit triggers fn_audit / fn_audit_org_member)
-- is SECURITY DEFINER: it runs as the function OWNER, not the calling client. That path only keeps
-- working under FORCE RLS because the definer OWNER is a role with BYPASSRLS (on Supabase the
-- `postgres`/owner role, which is BYPASSRLS + SUPERUSER). If ownership of these functions — or of
-- the tenant tables they write — ever moved to a NON-bypass, non-super role, FORCE RLS would make
-- the definer write/audit path obey RLS, stock posting + audit would silently break, and nothing
-- else in the suite would catch it. This file PINS that load-bearing assumption.
--
-- These are pure pg_catalog checks (pg_proc->pg_roles via proowner, pg_class->pg_roles via relowner),
-- independent of RLS, so they are valid on the local superuser shim cluster. On that shim the cluster
-- owner is `postgres` (SUPERUSER), so every assertion passes there — and that is exactly the
-- prod-relevant invariant: on Supabase the owner is `postgres` with rolbypassrls = true. Run via
-- `supabase test db` or the local shim (test-shims/run-pgtap-local.sh).

begin;
select plan(19);

-- ----------------------------------------------------------------------------------------------
-- Per-function assertion: the OWNER of each key SECURITY DEFINER function is BYPASSRLS or SUPERUSER.
-- Matched by name (proname), so overloaded variants (e.g. fn_stock_coverage) are all covered. We
-- require >=1 matching proc whose owner bypasses RLS for every name (so a missing/renamed function
-- also fails loudly rather than passing vacuously).
-- ----------------------------------------------------------------------------------------------
select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     join pg_roles r on r.oid = p.proowner
    where n.nspname = 'public'
      and p.proname = fn
      and (r.rolbypassrls or r.rolsuper)),
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = fn),
  'OWNER of public.' || fn || ' is BYPASSRLS or SUPERUSER (definer path bypasses FORCE RLS)')
from (values
  ('fn_post_movement'),
  ('fn_execute_operation'),
  ('fn_post_receipt'),
  ('fn_audit'),
  ('fn_audit_org_member'),
  ('fn_bin_rebuild'),
  ('fn_stock_coverage')
) as t(fn);

-- Sanity floor: each named function actually exists, so the per-function check above is not
-- vacuously true (a count of 0 = 0 would silently pass if a function were dropped/renamed).
select cmp_ok(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = fn),
  '>=', 1,
  'public.' || fn || ' exists (per-function owner check is not vacuous)')
from (values
  ('fn_post_movement'),
  ('fn_execute_operation'),
  ('fn_post_receipt'),
  ('fn_audit'),
  ('fn_audit_org_member'),
  ('fn_bin_rebuild'),
  ('fn_stock_coverage')
) as t(fn);

-- ----------------------------------------------------------------------------------------------
-- Per-table assertion: the OWNER of the core tenant tables written by the definer path is BYPASSRLS
-- or SUPERUSER. These are the tables the definer write/audit path mutates; if their owner lost
-- bypass, FORCE RLS would block the writes even though the functions stay SECURITY DEFINER.
-- ----------------------------------------------------------------------------------------------
select ok(
  (select (r.rolbypassrls or r.rolsuper)
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     join pg_roles r on r.oid = c.relowner
    where n.nspname = 'public' and c.relname = tbl),
  'OWNER of public.' || tbl || ' is BYPASSRLS or SUPERUSER (FORCE RLS does not block definer writes)')
from (values
  ('inventory_movements'),
  ('farm_event'),
  ('audit_log')
) as t(tbl);

-- ----------------------------------------------------------------------------------------------
-- Catalog-wide invariant: EVERY SECURITY DEFINER function in public is owned by a BYPASSRLS/SUPERUSER
-- role. Built dynamically (count of violations = 0) so a future definer function whose owner does not
-- bypass RLS is caught here without editing the per-function list above.
-- ----------------------------------------------------------------------------------------------
select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     join pg_roles r on r.oid = p.proowner
    where n.nspname = 'public'
      and p.prosecdef
      and not (r.rolbypassrls or r.rolsuper)),
  0,
  'every public SECURITY DEFINER function is owned by a BYPASSRLS/SUPERUSER role');

-- Catalog-wide invariant: every FORCE-RLS tenant table in public is owned by a BYPASSRLS/SUPERUSER
-- role. A forced table owned by a non-bypass role would break any definer path that writes it.
select is(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     join pg_roles r on r.oid = c.relowner
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relforcerowsecurity
      and not (r.rolbypassrls or r.rolsuper)),
  0,
  'every FORCE-RLS table in public is owned by a BYPASSRLS/SUPERUSER role');

select * from finish();
rollback;
