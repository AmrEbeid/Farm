-- Farm OS — #398 slice 1 (SCHEMA): multi-day operations + multi-employee assignment.
-- Owner observation (2026-06-28): a plan operation may span more than one day and be assigned to one or
-- more employees, and may carry several needs (materials of various kinds + labour). This migration adds
-- the SCHEMA foundation only (Owner-gated apply). The multi-line-needs create RPC + multi-person assign
-- RPC are slice 2; the OperationBuilder UI is slice 3 (SPEC-0011 extension; design in issue #398).
--
-- Product decisions embedded here (per the Owner's standing "go with my recommendation" directive —
-- confirmable at the gate, see #398):
--   * Multi-day = planned_at (the START / demand date) .. ends_on. `planned_at` is LEFT UNCHANGED so
--     fn_stock_coverage keeps bucketing demand on the start date — ZERO engine change (SPEC-0001).
--   * Assignees = a join table (one-or-more people) with an optional is_lead flag. The existing single
--     plan_operations.responsible_person_id is KEPT (not dropped) as a back-compat "lead" pointer.
-- Conventions: ADR-0006 (force RLS, org-scoped 2-arg authorize AUTHZ-2/0035, fn_audit/0008,
-- FK-index/0036, delete-posture/0027). Mirrors people_compensation (0046) + plan_operations gate (0025).

-- ── 1) Multi-day span: an operation runs planned_at .. ends_on (inclusive). ends_on NULL = single-day.
alter table public.plan_operations
  add column if not exists ends_on date;
-- ends_on, when set, must not precede the start (planned_at). NULL on either side = unconstrained.
alter table public.plan_operations
  add constraint plan_operations_ends_on_after_start
  check (ends_on is null or planned_at is null or ends_on >= planned_at);

-- ── 2) Multi-employee assignment: one operation → one-or-more people (replaces the free-text
--       plan_labor_requirements.person_or_team for *who* is assigned; labour COUNT/days stays there). ──
create table public.plan_operation_assignees (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organization(id) on delete cascade,
  plan_op_id  uuid not null references public.plan_operations(id) on delete cascade,
  person_id   uuid not null references public.people(id) on delete cascade,
  is_lead     boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (plan_op_id, person_id)   -- a person is assigned to a given operation at most once
);

-- FK-index convention (migration 0036): cover FK columns used by joins / ON DELETE cascade.
create index plan_operation_assignees_plan_op_idx on public.plan_operation_assignees(plan_op_id, org_id);
create index plan_operation_assignees_person_idx  on public.plan_operation_assignees(person_id, org_id);

alter table public.plan_operation_assignees enable row level security;
alter table public.plan_operation_assignees force  row level security;

-- WRITES are plan.write-gated (matches plan_operations, 0025) and org-scoped; READS are org-scoped only
-- (an assignee is non-sensitive people data — a name, not compensation; the SPEC-0006 need-to-know gate
-- applies to wages, not to who is doing the work). org-scoping via the active-org-narrowed
-- user_org_ids() (fail-closed); 2-arg org-scoped authorize (AUTHZ-2, 0035).
-- CROSS-ORG FK VALIDATION (invariant test 74): both member-writable FKs must be same-org-validated in
-- the WITH CHECK via the EXISTS-same-org pattern, so a member cannot attach an assignee row to a
-- plan_operation or a person from another org (RLS would otherwise only constrain this row's org_id).
create policy tenant_all on public.plan_operation_assignees
  for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('plan.write', org_id)
    and exists (
      select 1 from public.plan_operations po
      where po.id = plan_operation_assignees.plan_op_id
        and po.org_id = plan_operation_assignees.org_id)
    and exists (
      select 1 from public.people pe
      where pe.id = plan_operation_assignees.person_id
        and pe.org_id = plan_operation_assignees.org_id)
  );

-- New table needs its own grant (0009's blanket grant predates it; no default privileges set). NOT anon.
-- DELETE withheld per the 0027 delete-posture (un-assign routes through a slice-2 RPC, not client DELETE).
-- force RLS (above) is the real boundary.
grant select, insert, update on public.plan_operation_assignees to authenticated;

-- Audit: assignment changes are tracked in the append-only audit_log via the generic fn_audit (0008);
-- the table has an `id` column so the generic trigger keys the audit row on new.id directly.
create trigger audit_plan_operation_assignees
  after insert or update or delete on public.plan_operation_assignees
  for each row execute function public.fn_audit('plan_operation_assignees');
