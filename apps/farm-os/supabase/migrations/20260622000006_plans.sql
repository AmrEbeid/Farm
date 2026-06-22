-- Farm OS MVP-0 — Phase B, migration 6
-- Planning: plans, plan_operations, plan_material_requirements, plan_labor_requirements,
-- plan_checks. Build spec §4 (Planning). RLS deny-by-default everywhere.

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  type text,                          -- weekly|monthly|quarterly|annual
  period_start date,
  period_end date,
  scope_type text,                    -- farm|sector|hawsha
  scope_id uuid,
  status text not null default 'draft'
);

create table public.plan_operations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete cascade,
  subtype text,
  target_type text,
  target_id uuid,
  planned_at date,
  priority int,
  responsible_person_id uuid references public.people(id),
  est_cost numeric,
  approval_needed boolean not null default false,
  status text not null default 'planned'
);

create table public.plan_material_requirements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  plan_op_id uuid not null references public.plan_operations(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id),
  qty numeric,
  unit text
);

create table public.plan_labor_requirements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  plan_op_id uuid not null references public.plan_operations(id) on delete cascade,
  person_or_team text,
  count int,
  days numeric
);

create table public.plan_checks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete cascade,
  kind text not null check (kind in ('weather','stock','budget','labor','responsibility')),
  result text,                        -- ok|warn|block
  detail jsonb
);

create index plans_org_idx on public.plans(org_id);
create index plan_operations_org_idx on public.plan_operations(org_id);
create index plan_material_requirements_org_idx on public.plan_material_requirements(org_id);
create index plan_labor_requirements_org_idx on public.plan_labor_requirements(org_id);
create index plan_checks_org_idx on public.plan_checks(org_id);

do $$
declare t text;
begin
  foreach t in array array['plans','plan_operations','plan_material_requirements',
                           'plan_labor_requirements','plan_checks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy tenant_all on public.%I for all to authenticated
      using (org_id in (select public.user_org_ids()))
      with check (org_id in (select public.user_org_ids()))$p$, t);
  end loop;
end $$;
