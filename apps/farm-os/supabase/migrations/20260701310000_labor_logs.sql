-- Farm OS — SPEC-0006 slice 2: `labor_logs` (ACTUAL day-to-day attendance/labor).
--
-- SPEC-0006 (RATIFIED — Owner, 2026-06-27) §3 explicitly ALLOWS building this now, on synthetic data:
-- "Allowed: … labor_logs (person × operation/day × hours/units, links to farm_event/plan_operations) …
-- a basic payroll run …". §6 lists it as slice 2 of the Stage-8 build (after PII-1, already closed).
-- This is DISTINCT from `plan_labor_requirements` (PLANNED labor tied to a plan operation — PR #549 /
-- `feat/labor-cost-rollup`, not merged, not touched by this migration) — `labor_logs` is the ACTUAL
-- record of a day worked, independent of any plan.
--
-- CONFIDENTIALITY (SPEC-0006 §1/§4, the non-negotiable this migration must not loosen). The risk is
-- WAGES, not hours. `rate` stays exclusively in `people_compensation` (payroll.read / owner+accountant
-- only, migration 0046) — `labor_logs` carries NO rate/money column at all, only person-or-team + date
-- + hours + an optional plan-operation link + a note. Because hours-without-a-rate cannot leak a wage,
-- reads are left ORG-SCOPED ONLY (no extra role gate) — matching the `plan_operations`/`farm_event`
-- precedent (org-wide read, role-gated write), not the `payroll.read` confidentiality boundary. WRITES
-- are gated to `labor.write` (owner/farm_manager/supervisor — added in the previous migration),
-- mirroring who actually runs field crews day to day.
--
-- SHAPE. Either `person_id` (an existing `people` row) OR a free-text `team_name` (an informal crew not
-- yet onboarded) identifies who worked — mirrors `plan_labor_requirements.person_or_team`'s intent of
-- supporting an unregistered crew, adapted into two columns (a real FK when available, free text
-- otherwise) with a CHECK enforcing exactly one is set. `plan_op_id` is nullable — attendance can be
-- logged independent of any specific planned operation (the common day-to-day case). NOTE: this slice's
-- UI does not ship a plan-operation picker (scope reduction, see the PR description) — every row
-- inserted through the app today has `plan_op_id` null; the column exists so a future slice can wire it
-- without another migration.
--
-- ENFORCEMENT. RLS deny-by-default + FORCE RLS; same-org guards on person_id/plan_op_id in WITH CHECK
-- (mirrors 20260622000090's plan_operation_assignees.person_id guard); no DELETE grant (mirrors the
-- 0027 delete-posture remediation — plan_checks is the one deliberate exception, not this table);
-- audited via the GENERIC fn_audit (labor_logs carries no PII/confidential column, so — unlike
-- `people`, which needed the redacting fn_audit_people — the generic trigger is safe here, matching
-- `people_compensation`'s own `audit_people_compensation` precedent, migration 0046).

create table public.labor_logs (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organization(id) on delete cascade,
  person_id  uuid references public.people(id) on delete set null,
  team_name  text,
  work_date  date not null,
  hours      numeric not null,
  plan_op_id uuid references public.plan_operations(id) on delete set null,
  note       text,
  created_at timestamptz not null default now(),
  constraint labor_logs_person_or_team check (
    (case when person_id is not null then 1 else 0 end)
    + (case when team_name is not null and length(btrim(team_name)) > 0 then 1 else 0 end) = 1
  ),
  constraint labor_logs_hours_positive check (hours > 0)
);

-- FK-covering indexes (migration 0036 convention: leading columns = the FK columns).
create index labor_logs_org_work_date_idx on public.labor_logs(org_id, work_date);
create index labor_logs_person_id_org_id_idx on public.labor_logs(person_id, org_id);
create index labor_logs_plan_op_id_org_id_idx on public.labor_logs(plan_op_id, org_id);

alter table public.labor_logs enable row level security;
alter table public.labor_logs force  row level security;

create policy tenant_all on public.labor_logs for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('labor.write', org_id)
    and (person_id is null or exists (
      select 1 from public.people pe where pe.id = labor_logs.person_id and pe.org_id = labor_logs.org_id
    ))
    and (plan_op_id is null or exists (
      select 1 from public.plan_operations po where po.id = labor_logs.plan_op_id and po.org_id = labor_logs.org_id
    ))
  );

-- Client grant (migration 0009's blanket grant predates this table, so it needs its own). No anon;
-- DELETE deliberately withheld (0027 delete-posture remediation — no tenant table except plan_checks
-- is client-deletable).
grant select, insert, update on public.labor_logs to authenticated;

create trigger audit_labor_logs
  after insert or update or delete on public.labor_logs
  for each row execute function public.fn_audit('labor_logs');
