-- Farm OS MVP-0 — Phase B, migration 1
-- Extensions + core tenancy (organization, organization_member) + RBAC helpers.
-- Sources: build spec §4 (Tenancy & people), §8 (Roles); architecture 03 §2.
-- Every tenant table is org_id-scoped, RLS deny-by-default, policies TO authenticated,
-- joining membership via the security-definer helper auth.user_org_ids().

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists pgtap;      -- pgTAP unit tests (supabase test db)

-- ---------------------------------------------------------------------------
-- organization + organization_member (the tenancy spine)
-- ---------------------------------------------------------------------------
create table public.organization (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  locale text not null default 'ar',
  currency text not null default 'EGP',
  area_unit text not null default 'feddan',
  fiscal_year_start date,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.organization_member (
  org_id uuid not null references public.organization(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in
    ('owner','farm_manager','agri_engineer','accountant','storekeeper','supervisor')),
  scope jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index organization_member_user_idx on public.organization_member(user_id);
create index organization_member_org_idx on public.organization_member(org_id);

-- ---------------------------------------------------------------------------
-- Membership helper (security definer, non-recursive, indexable) — 03 §2.
-- auth.uid() wrapped in (select ...) so the planner caches it per query.
--
-- Deviation note: architecture 03 §2 / plan name this auth.user_org_ids(). Supabase
-- migrations run as the `postgres` role, which lacks CREATE on the `auth` schema
-- (owned by supabase_admin), so the helper lives in `public` instead. Same security
-- (SECURITY DEFINER, locked search_path); only the schema-qualifier changes.
-- ---------------------------------------------------------------------------
create or replace function public.user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select org_id from public.organization_member where user_id = (select auth.uid())
$$;

-- ---------------------------------------------------------------------------
-- RBAC: role -> permission map. Policies call authorize('pr.approve') rather
-- than hard-coding roles (build spec §8). Owner-only for PR approval.
-- ---------------------------------------------------------------------------
create or replace function public.authorize(perm text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_member m
    where m.user_id = (select auth.uid())
      and ( (perm = 'pr.approve'      and m.role = 'owner')
         or (perm = 'plan.write'      and m.role in ('owner','farm_manager'))
         or (perm = 'op.execute'      and m.role in ('owner','farm_manager','agri_engineer','supervisor'))
         or (perm = 'inventory.write' and m.role in ('owner','farm_manager','storekeeper'))
         or (perm = 'budget.write'    and m.role in ('owner','accountant')) )
  )
$$;

-- ---------------------------------------------------------------------------
-- RLS (deny-by-default): enable + tenant read policies.
-- ---------------------------------------------------------------------------
alter table public.organization enable row level security;
alter table public.organization_member enable row level security;

create policy org_read on public.organization
  for select to authenticated
  using (id in (select public.user_org_ids()));

create policy member_read on public.organization_member
  for select to authenticated
  using (org_id in (select public.user_org_ids()));
