-- Farm OS MVP-0 — Phase B, migration 3
-- Location hierarchy + assets: farms -> sectors -> hawshat -> lines -> assets (type=palm).
-- Build spec §4 (Structure & assets). RLS deny-by-default + org_id index on every table.

create table public.farms (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  name text not null,
  code text not null,
  area_feddan numeric,
  owner_person_id uuid references public.people(id),
  manager_person_id uuid references public.people(id),
  main_crop text,
  notes text
);

create table public.sectors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  farm_id uuid not null references public.farms(id) on delete cascade,
  name text not null,
  code text not null,
  area_feddan numeric,
  crop text,
  planting_date date,
  notes text
);

create table public.hawshat (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  sector_id uuid not null references public.sectors(id) on delete cascade,
  name text not null,
  code text not null,
  area_qirat numeric,
  row_count int,
  palm_count_barhi int,
  palm_count_male int,
  planting_date date,
  notes text
);

create table public.lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  hawsha_id uuid not null references public.hawshat(id) on delete cascade,
  line_no int not null,
  line_code text,
  palm_count int,
  direction text,
  notes text
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  type text not null default 'palm',
  name text,
  parent_id uuid references public.assets(id),
  sector_id uuid references public.sectors(id),
  hawsha_id uuid references public.hawshat(id),
  line_id uuid references public.lines(id),
  variety text,
  sex text,
  status text not null default 'active'
    check (status in ('active','watch','sick','dead','removed','replaced')),
  health_status text,
  planting_date date,
  id_tag text,             -- e.g. EBD-BAB-H03-L12-P008
  archived boolean not null default false
);

create table public.palm_status_history (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  status text,
  health_status text,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  reason text
);

-- index org_id + enable RLS + tenant_all policy on each (same pattern across phase B)
do $$
declare t text;
begin
  foreach t in array array['farms','sectors','hawshat','lines','assets','palm_status_history'] loop
    execute format('create index %I on public.%I(org_id)', t || '_org_idx', t);
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy tenant_all on public.%I for all to authenticated
      using (org_id in (select public.user_org_ids()))
      with check (org_id in (select public.user_org_ids()))$p$, t);
  end loop;
end $$;
