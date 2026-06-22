-- Farm OS MVP-0 — Phase B, migration 2
-- people, responsibility_assignments, audit_log (append-only/immutable).
-- audit_log has SELECT only; NO insert/update/delete policy -> rows are written by
-- the AFTER triggers (security definer, migration 8) and are immutable by omission (AP-4).

create table public.people (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  position text,
  employment_type text,
  rate numeric,
  user_id uuid references auth.users(id),
  active boolean not null default true,
  reports_to_person_id uuid references public.people(id),
  created_at timestamptz not null default now()
);
create index people_org_idx on public.people(org_id);

create table public.responsibility_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  scope_type text not null,          -- farm|sector|hawsha|operation_type|budget_category|inventory_category|team
  scope_id uuid,
  responsibility_type text not null  -- accountable_manager|engineer|daily_supervisor|inventory_responsible|...
);
create index responsibility_assignments_org_idx on public.responsibility_assignments(org_id);

create table public.audit_log (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organization(id) on delete cascade,
  actor_user_id uuid,
  action text not null,              -- INSERT|UPDATE|DELETE
  entity_type text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  occurred_at timestamptz not null default now()
);
create index audit_log_org_time_idx on public.audit_log(org_id, occurred_at);

alter table public.people enable row level security;
alter table public.responsibility_assignments enable row level security;
alter table public.audit_log enable row level security;

create policy tenant_all on public.people
  for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (org_id in (select public.user_org_ids()));

create policy tenant_all on public.responsibility_assignments
  for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (org_id in (select public.user_org_ids()));

-- audit_log: SELECT only. No INSERT/UPDATE/DELETE policy -> immutable by omission (AP-4).
create policy audit_read on public.audit_log
  for select to authenticated
  using (org_id in (select public.user_org_ids()));
