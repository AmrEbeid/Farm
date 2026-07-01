-- Farm OS — relative operation scheduling (owner finding, 2026-07-01): real spray/operation
-- instructions are often expressed RELATIVE to another operation ("spray after tilting completes",
-- "cover the bunches before X"), not as an absolute date. Today plan_operations.planned_at is always
-- absolute. This migration adds an OPTIONAL "depends on" relationship — additive only, both new
-- columns nullable, existing operations (both columns null) behave EXACTLY as today.
--
-- Design decision (per the task brief): planned_at STAYS AUTHORITATIVE. There is NO trigger that
-- auto-recomputes planned_at from the dependency — this repo's engine (fn_stock_coverage et al.) has
-- hard-won lessons about side-effecting triggers causing subtle cascades (SPEC-0001's masked-shortage
-- history). A trigger that rewrites planned_at when a dependency shifts would ripple through ANY
-- downstream code that reads planned_at (stock-coverage bucketing, budget checks, the demand/PVA
-- reports) with no independent oracle to catch a bad cascade, and a chain of 3+ dependent ops would
-- need explicit depth-guard/cycle-safety work to terminate correctly. Instead: the relationship is
-- metadata, and the EFFECTIVE date (dependency.planned_at + offset_days) is computed at READ TIME by a
-- pure, easily-tested function (lib/relative-schedule.ts) — no cascade risk, and it is trivially
-- re-derived if the dependency's planned_at changes (no stale denormalized value to keep in sync).
--
-- depends_on_op_id       — the operation this one is scheduled relative to (nullable FK, same table).
-- depends_on_offset_days — signed day offset from the dependency's planned_at (+3 = "3 days after",
--                          -2 = "2 days before"). Nullable; only meaningful when depends_on_op_id is set.
--
-- Guards:
--   * CHECK: an op cannot depend on itself (id <> depends_on_op_id).
--   * SAME-PLAN trigger (mirrors people_reports_to_same_org/0071 + assets_parent_same_org/0075): the
--     dependency must be in the SAME PLAN. This is STRICTER than same-org (same-org is implied by
--     same-plan, since plan_id already FKs to a single org) — same-plan is what the product actually
--     needs (an operation is scheduled relative to another operation IN THE SAME PLAN, per the task).
--     RLS's WITH CHECK cannot express this (no NEW-row alias for a self-referential subquery — the same
--     footgun 0070/0071 documented), so this is a BEFORE INSERT/UPDATE trigger, not an RLS predicate.
--   * No cycle detection beyond the direct self-reference check (per the task's explicit scope: "don't
--     build full cycle detection"). A 2-hop cycle (A depends on B, B depends on A) is NOT rejected here;
--     it is display-only metadata (no trigger recomputes planned_at), so a cycle cannot cause a runaway
--     update loop — worst case is a UI showing "after: X" on both ops, which is a data-quality issue, not
--     a safety one. Tracked as a follow-up if the product wants stricter authoring-time validation.
--
-- Does NOT touch fn_add_plan_operation_multi or fn_execute_operation (several other in-flight PRs this
-- session already touch those). The dependency is set via a small, separate, additive server action
-- (setPlanOperationDependency) using the existing tenant_all RLS policy on plan_operations (already
-- plan.write-gated + org-scoped, migration 0070) — no RPC signature to collide with.

alter table public.plan_operations
  add column if not exists depends_on_op_id uuid references public.plan_operations(id) on delete set null,
  add column if not exists depends_on_offset_days int;

-- Self-reference guard: an operation cannot depend on itself.
alter table public.plan_operations
  add constraint plan_operations_no_self_dependency
  check (depends_on_op_id is null or id <> depends_on_op_id);

-- FK-index convention (migration 0036): cover the new FK column.
create index plan_operations_depends_on_op_idx on public.plan_operations(depends_on_op_id);

-- SAME-PLAN guard (self-referential → trigger, mirrors people_reports_to_same_org/0071 and
-- assets_parent_same_org/0075). SECURITY DEFINER so the check sees the dependency's actual plan_id
-- regardless of the writer's RLS visibility; EXECUTE revoked — the trigger fires in the owner context
-- regardless, a direct call is the only thing this prevents.
create or replace function public.plan_operations_dependency_same_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.depends_on_op_id is not null
     and not exists (
       select 1 from public.plan_operations dep
       where dep.id = new.depends_on_op_id
         and dep.plan_id = new.plan_id
         and dep.org_id = new.org_id) then
    raise exception 'depends_on_op_id % is not an operation in the same plan', new.depends_on_op_id
      using errcode = '42501';
  end if;
  return new;
end
$fn$;

revoke execute on function public.plan_operations_dependency_same_plan() from public, anon, authenticated;

create trigger plan_operations_dependency_same_plan
  before insert or update on public.plan_operations
  for each row execute function public.plan_operations_dependency_same_plan();
