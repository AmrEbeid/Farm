-- Farm OS MVP-0 — DELETE-posture remediation: close the schema-wide direct-DELETE surface.
--
-- Finding (docs/SECURITY-FINDING-delete-exposure-2026-06-25.md): the same root cause that left the
-- stock ledger directly DELETE-able (B2.1, migration 0016) applies schema-wide. Migration 0009's
-- blanket `grant ... delete ... to authenticated`, combined with the single `tenant_all` FOR ALL
-- policy (which governs DELETE by USING — org-membership — alone, with no role/ownership check),
-- lets ANY authenticated org member DELETE rows directly via PostgREST on ~28 tenant tables
-- (financial: expenses/budgets/budget_lines; operational: farm_event*/quantities/plan_operations/
-- plans; structural: farms/sectors/hawshat/lines/assets; PII: people). RLS scopes deletes to the
-- member's own org, so this is not a cross-tenant leak — but within a tenant it is a data-integrity
-- / insider-authorization gap (any low-privilege member can erase another's records).
--
-- What the app actually deletes as the authenticated client: exactly ONE table — `plan_checks`
-- (app/(app)/plans/[planId]/actions.ts:91, the plan builder recomputes checks via delete +
-- re-insert). Verified by grepping every `.delete(` in apps/farm-os: the only other client-side
-- delete (lib/seed-auth.ts on organization_member) and all e2e cleanup deletes run through the
-- service_role admin client, which is unaffected by `authenticated`/`anon` grants. So the direct-
-- DELETE surface on the other 27 tables is open but UNUSED by the product — pure attack surface.
--
-- Fix: REVOKE delete from authenticated|anon on every exposed tenant table EXCEPT plan_checks. We
-- use a grant REVOKE (the proven 0016 pattern), NOT a tenant_all policy split — the B2 review proved
-- splitting tenant_all regresses the PostgREST nested-embed reads the wedge loop depends on. REVOKE
-- makes the deny robust: even a future permissive policy cannot re-open it, since the privilege is
-- gone. Reads stay fully open (the tenant policy's USING is untouched) for every role.
--
-- Already locked elsewhere — skipped here: audit_log (0008/0009), organization/organization_member
-- (0010 HIGH-1), inventory_movements/inventory_bin (0016).
--
-- Mirrors migration 0016. Run via `supabase db reset` / `supabase test db`.

-- Financial (record of truth — corrections become reversing entries, not deletions)
revoke delete on public.expenses     from authenticated, anon;
revoke delete on public.budgets      from authenticated, anon;
revoke delete on public.budget_lines from authenticated, anon;

-- Operational ledger the coverage/PVA engine reconciles against
revoke delete on public.farm_event              from authenticated, anon;
revoke delete on public.farm_event_2025_07      from authenticated, anon;
revoke delete on public.farm_event_2025_08      from authenticated, anon;
revoke delete on public.farm_event_default      from authenticated, anon;
revoke delete on public.quantities              from authenticated, anon;
revoke delete on public.event_assets            from authenticated, anon;
revoke delete on public.event_attachments       from authenticated, anon;
revoke delete on public.event_followups         from authenticated, anon;
revoke delete on public.event_locations         from authenticated, anon;
revoke delete on public.event_status_history    from authenticated, anon;
revoke delete on public.palm_status_history     from authenticated, anon;

-- Planning
revoke delete on public.plans                       from authenticated, anon;
revoke delete on public.plan_operations             from authenticated, anon;
revoke delete on public.plan_labor_requirements     from authenticated, anon;
revoke delete on public.plan_material_requirements  from authenticated, anon;
-- NOTE: public.plan_checks is intentionally LEFT deletable by authenticated — the plan builder
-- recomputes checks via delete + re-insert (actions.ts:91). The only legit client-side delete.

-- Procurement
revoke delete on public.purchase_requests      from authenticated, anon;
revoke delete on public.purchase_request_items from authenticated, anon;
revoke delete on public.suppliers              from authenticated, anon;

-- Structural / registry
revoke delete on public.farms   from authenticated, anon;
revoke delete on public.sectors from authenticated, anon;
revoke delete on public.hawshat from authenticated, anon;
revoke delete on public.lines   from authenticated, anon;
revoke delete on public.assets  from authenticated, anon;

-- Inventory items master + people (PII) + responsibility / assignment surface
revoke delete on public.inventory_items            from authenticated, anon;
revoke delete on public.people                      from authenticated, anon;
revoke delete on public.responsibility_assignments from authenticated, anon;
