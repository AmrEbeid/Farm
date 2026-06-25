-- 29 — D1: FORCE ROW LEVEL SECURITY on the tenant tables (migration 0028). FORCE makes even the
-- table OWNER obey RLS, closing the implicit owner-bypass on direct table access.
--
-- The local pgTAP harness (test-shims/run-pgtap-local.sh) runs as a SUPERUSER, which bypasses RLS
-- unconditionally — so the RUNTIME force behaviour cannot be exercised here. Instead we assert the
-- catalog FLAG (pg_class.relforcerowsecurity = true) for each forced table, plus a dynamic invariant
-- that every RLS-ENABLED table in public is also FORCED (so a future table cannot silently regress).
-- These are pure pg_catalog checks, valid on the superuser cluster. Run via `supabase test db` or the
-- local shim.

begin;
select plan(37);

-- ----------------------------------------------------------------------------------------------
-- Per-table FLAG assertion: relforcerowsecurity = true for every tenant table (the exact set that
-- migration 0028 forces). One streamed ok() per table (FROM VALUES so each emits its own TAP line),
-- giving a named, RLS-independent pin for each forced table.
-- ----------------------------------------------------------------------------------------------
select ok(
  (select relforcerowsecurity
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = tbl),
  'D1: ' || tbl || ' has FORCE row level security')
from (values
  ('organization'),('organization_member'),
  ('people'),('responsibility_assignments'),('audit_log'),
  ('farms'),('sectors'),('hawshat'),('lines'),('assets'),('palm_status_history'),
  ('farm_event'),('farm_event_2025_07'),('farm_event_2025_08'),('farm_event_default'),
  ('event_assets'),('event_locations'),('quantities'),
  ('event_status_history'),('event_followups'),('event_attachments'),
  ('suppliers'),('inventory_items'),('inventory_bin'),('inventory_movements'),
  ('plans'),('plan_operations'),('plan_material_requirements'),
  ('plan_labor_requirements'),('plan_checks'),
  ('budgets'),('budget_lines'),('purchase_requests'),('purchase_request_items'),('expenses')
) as t(tbl);

-- ----------------------------------------------------------------------------------------------
-- Invariant: every RLS-ENABLED base table / partition child in public is also FORCED. Built
-- dynamically (count of enabled-but-not-forced = 0) so it auto-extends to any future table — a new
-- table that enables RLS but forgets FORCE is caught here without editing the per-table list above.
-- ----------------------------------------------------------------------------------------------
select is(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relrowsecurity
      and not c.relforcerowsecurity),
  0,
  'D1: every RLS-enabled table in public also has FORCE row level security');

-- Sanity floor: there is at least one forced table (otherwise the invariant above is vacuously
-- true and a future change that drops FORCE everywhere would silently stop testing this surface).
select cmp_ok(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relforcerowsecurity),
  '>=', 1,
  'D1: at least one table is FORCED (the invariant is not vacuous)');

select * from finish();
rollback;
