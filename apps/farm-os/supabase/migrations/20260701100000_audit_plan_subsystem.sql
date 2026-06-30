-- Farm OS — audit the plan subsystem + event quantities (#494; same class as #492 org-settings).
--
-- These org_id tenant tables are member-writable (authorize('plan.write')) but wrote NO audit_log row and
-- had no fn_audit trigger. plan_material_requirements is the demand qty the coverage engine multiplies into
-- PR orders/spend — the exact "drives the recommendation" rationale 0059 used to audit inventory_items.
-- All five carry a NOT NULL org_id, so the generic fn_audit trigger (which logs coalesce(new.org_id,
-- old.org_id)) attaches cleanly with no per-table code.
--
-- Scope decisions (decision-free, documented):
--   * Audited here: plans, plan_operations, plan_material_requirements, plan_labor_requirements, quantities.
--   * EXCLUDED on purpose: plan_checks (the plan builder delete+reinserts it on every recompute, 0069 —
--     auditing would be log spam); organization_member / people (already audited via fn_audit_org_member
--     0019 / the redacting path 0060); audit_log (recursive), user_active_org (transient), inventory_bin
--     (a rebuilt projection — inventory_movements is the audited ledger).
--   * Verified no mass delete+reinsert churn on these five (per-row edits only), so audit volume is bounded.
--
-- Security: additive only (triggers write to the append-only audit_log via the SECURITY DEFINER fn_audit).
-- Idempotent (drop-if-exists + create). Rollback: drop the five triggers.
-- Validation: pgTAP 99_audit_plan_subsystem_test.sql; then prod re-probe (org_id tables w/o audit trigger).

drop trigger if exists audit_plan on public.plans;
create trigger audit_plan
  after insert or update or delete on public.plans
  for each row execute function public.fn_audit('plan');

drop trigger if exists audit_plan_operation on public.plan_operations;
create trigger audit_plan_operation
  after insert or update or delete on public.plan_operations
  for each row execute function public.fn_audit('plan_operation');

drop trigger if exists audit_plan_material_req on public.plan_material_requirements;
create trigger audit_plan_material_req
  after insert or update or delete on public.plan_material_requirements
  for each row execute function public.fn_audit('plan_material_requirement');

drop trigger if exists audit_plan_labor_req on public.plan_labor_requirements;
create trigger audit_plan_labor_req
  after insert or update or delete on public.plan_labor_requirements
  for each row execute function public.fn_audit('plan_labor_requirement');

drop trigger if exists audit_quantity on public.quantities;
create trigger audit_quantity
  after insert or update or delete on public.quantities
  for each row execute function public.fn_audit('quantity');
