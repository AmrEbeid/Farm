-- Farm OS MVP-0 — D1: FORCE ROW LEVEL SECURITY on the tenant tables.
--
-- Every tenant table already has `enable row level security` (migrations 0001–0007),
-- so RLS is the tenant boundary for the `authenticated` client role. But ENABLE alone is
-- bypassed by the TABLE OWNER (and any role with BYPASSRLS). On Supabase the migrations run
-- as the table-owning role, and any SECURITY DEFINER / superuser-owned path then reads & writes
-- across orgs without a policy ever being evaluated. FORCE makes the OWNER obey RLS too, closing
-- the "owner bypass" gap: now ONLY the explicit service_role (bypassrls by design, server-only)
-- and an actual superuser can cross the tenant boundary; an owner-context code path cannot.
--
-- Additive / idempotent: ALTER … FORCE only flips pg_class.relforcerowsecurity; it adds no policy
-- and changes no behaviour for `authenticated` (already policy-bound) or `service_role` (bypassrls
-- is independent of FORCE). The SECURITY DEFINER write primitives (fn_post_movement, fn_post_receipt,
-- fn_execute_operation, …) are owned by a role that holds bypassrls in the Supabase environment, so
-- their intended cross-org-by-org-guard logic is unaffected; FORCE only removes the *implicit*,
-- unguarded owner bypass on direct table access.
--
-- The forced list is EXACTLY the set of tables that carry `enable row level security` today
-- (the tenant tables + the farm_event partition children). Tables that intentionally have no RLS
-- are NOT forced.
--
-- NOTE: the Docker-free pgTAP harness (test-shims/run-pgtap-local.sh) runs as a LOCAL SUPERUSER,
-- which bypasses RLS unconditionally (FORCE included) — it therefore CANNOT exercise the runtime
-- FORCE behaviour. So test 29 asserts the FLAG (pg_class.relforcerowsecurity = true) for each forced
-- table rather than runtime owner-bypass denial. `supabase test db` / the Playwright e2e on the
-- Docker stack remain the authoritative runtime gates.

do $$
declare t text;
begin
  foreach t in array array[
    -- 0001 tenancy spine
    'organization','organization_member',
    -- 0002 people / responsibility / audit
    'people','responsibility_assignments','audit_log',
    -- 0003 structure / assets
    'farms','sectors','hawshat','lines','assets','palm_status_history',
    -- 0004 events + partition children + quantities
    'farm_event','farm_event_2025_07','farm_event_2025_08','farm_event_default',
    'event_assets','event_locations','quantities',
    'event_status_history','event_followups','event_attachments',
    -- 0005 inventory
    'suppliers','inventory_items','inventory_bin','inventory_movements',
    -- 0006 plans
    'plans','plan_operations','plan_material_requirements',
    'plan_labor_requirements','plan_checks',
    -- 0007 budget / purchasing / expenses
    'budgets','budget_lines','purchase_requests','purchase_request_items','expenses'
  ] loop
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;
