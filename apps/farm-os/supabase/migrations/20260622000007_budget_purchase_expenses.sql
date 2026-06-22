-- Farm OS MVP-0 — Phase B, migration 7
-- Budget + purchasing + accounting: budgets, budget_lines, purchase_requests,
-- purchase_request_items, expenses.
--
-- SEPARATION OF DUTIES (AP-1/AP-2, build spec §8): the purchase_requests approval
-- UPDATE policy requires an owner role AND requested_by <> auth.uid() (author cannot
-- self-approve). This is enforced in RLS, not the app layer. To make this provable,
-- purchase_requests does NOT get a blanket "FOR ALL" policy (which, being PERMISSIVE,
-- would OR-in and bypass the approval guard). Instead it gets explicit SELECT / INSERT /
-- DELETE policies plus a single UPDATE policy that encodes the duty separation.

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  name text,
  period text,
  scope_type text,
  scope_id uuid,
  category text,
  planned numeric not null default 0,
  approved numeric not null default 0,
  committed numeric not null default 0,
  actual numeric not null default 0,
  status text
);

create table public.budget_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  budget_id uuid not null references public.budgets(id) on delete cascade,
  category text,
  planned numeric not null default 0,
  approved numeric not null default 0,
  committed numeric not null default 0,
  actual numeric not null default 0
);

create table public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  code text not null,
  requested_by uuid,                  -- auth.users.id of the author
  needed_by date,
  reason text,
  plan_id uuid references public.plans(id),
  event_id uuid,
  status text not null default 'draft'
    check (status in ('draft','submitted','approved','rejected','received')),
  budget_category_id uuid,
  approved_by uuid,
  approved_at timestamptz,
  version int not null default 1
);

create table public.purchase_request_items (
  id uuid primary key default gen_random_uuid(),
  pr_id uuid not null references public.purchase_requests(id) on delete cascade,
  org_id uuid not null references public.organization(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id),
  qty numeric,
  unit text,
  supplier_id uuid references public.suppliers(id),
  est_cost numeric
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  date date,
  farm_id uuid references public.farms(id),
  sector_id uuid references public.sectors(id),
  hawsha_id uuid references public.hawshat(id),
  event_id uuid,
  plan_id uuid references public.plans(id),
  category text,
  description text,
  supplier_id uuid references public.suppliers(id),
  qty numeric,
  unit text,
  unit_price numeric,
  total numeric,
  payment_method text,
  recorded_by uuid,
  approved_by uuid,
  status text
);

create index budgets_org_idx on public.budgets(org_id);
create index budget_lines_org_idx on public.budget_lines(org_id);
create index purchase_requests_org_idx on public.purchase_requests(org_id);
create index purchase_request_items_org_idx on public.purchase_request_items(org_id);
create index expenses_org_idx on public.expenses(org_id);

-- Blanket tenant_all on the non-PR tables.
do $$
declare t text;
begin
  foreach t in array array['budgets','budget_lines','purchase_request_items','expenses'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy tenant_all on public.%I for all to authenticated
      using (org_id in (select public.user_org_ids()))
      with check (org_id in (select public.user_org_ids()))$p$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- purchase_requests: explicit policies (no FOR ALL) so the approval guard holds.
-- ---------------------------------------------------------------------------
alter table public.purchase_requests enable row level security;

create policy pr_select on public.purchase_requests
  for select to authenticated
  using (org_id in (select public.user_org_ids()));

create policy pr_insert on public.purchase_requests
  for insert to authenticated
  with check (org_id in (select public.user_org_ids()));

create policy pr_delete on public.purchase_requests
  for delete to authenticated
  using (org_id in (select public.user_org_ids()));

-- The one UPDATE policy. Non-approval edits (status not becoming 'approved') are open to
-- any org member; flipping a row to status='approved' requires authorize('pr.approve')
-- (owner only, AP-1) AND requested_by <> auth.uid() (author != approver, AP-2).
create policy pr_update on public.purchase_requests
  for update to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and (
      status <> 'approved'
      or ( public.authorize('pr.approve')
           and requested_by is distinct from (select auth.uid()) )
    )
  );
